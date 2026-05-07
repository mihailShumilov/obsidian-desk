import type { Program } from '@coral-xyz/anchor';
import { Keypair, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { expect } from 'chai';
import { randomBytes } from 'node:crypto';
import type { ObsidianCore } from '../target/types/obsidian_core';
import { setupConfirmedProvider } from './_setup.ts';

/**
 * Pull the typed events emitted by a confirmed tx out of its logs.
 * `emit!` writes them as base-64 borsh blobs prefixed with `Program data:`.
 * We avoid `program.addEventListener` because the WS subscription path is
 * flaky against `solana-test-validator` running on a non-default RPC port.
 */
async function eventsFor<T extends Record<string, unknown>>(
  program: Program<ObsidianCore>,
  signature: string,
): Promise<Array<{ name: string; data: T }>> {
  const tx = await program.provider.connection.getTransaction(signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  });
  if (!tx?.meta?.logMessages) return [];
  const events: Array<{ name: string; data: T }> = [];
  for (const line of tx.meta.logMessages) {
    if (!line.startsWith('Program data: ')) continue;
    try {
      const decoded = program.coder.events.decode(line.slice('Program data: '.length));
      if (decoded) events.push({ name: decoded.name, data: decoded.data as T });
    } catch {
      /* ignore non-event program data lines */
    }
  }
  return events;
}

describe('obsidian-core', () => {
  const { provider, program } = setupConfirmedProvider();

  const baseMint = Keypair.generate().publicKey;
  const quoteMint = Keypair.generate().publicKey;
  const settleVault = Keypair.generate().publicKey;
  const ikaPolicy = Keypair.generate().publicKey;

  let market: PublicKey;
  let marketBump: number;

  before(() => {
    [market, marketBump] = PublicKey.findProgramAddressSync(
      [Buffer.from('market'), baseMint.toBuffer(), quoteMint.toBuffer()],
      program.programId,
    );
  });

  it('initializes a BTC/USDC market', async () => {
    await program.methods
      .initializeMarket(baseMint, quoteMint)
      .accountsPartial({
        market,
        settleVault,
        ikaPolicy,
        admin: provider.wallet.publicKey,
      })
      .rpc();

    const state = await program.account.marketState.fetch(market);
    expect(state.admin.toBase58()).to.eq(provider.wallet.publicKey.toBase58());
    expect(state.baseMint.toBase58()).to.eq(baseMint.toBase58());
    expect(state.quoteMint.toBase58()).to.eq(quoteMint.toBase58());
    expect(state.matchCount.toNumber()).to.eq(0);
    expect(state.activeOrderCount).to.eq(0);
    expect(state.bump).to.eq(marketBump);
    expect(state.orderbookHead).to.be.null;
  });

  it('submits two encrypted orders, matches them, and decrypts settlement', async () => {
    const nonceA = randomBytes(16);
    const nonceB = randomBytes(16);
    // Mock ciphertexts. Real Encrypt Ciphertext accounts are 100 B (per
    // docs/vendor/encrypt-pre-alpha.md §Reference: Accounts); the inline
    // Vec<u8> we use in the P2 scaffold just needs to be <= CT_MAX = 3000.
    const sideCt = Buffer.alloc(32);
    const priceCt = Buffer.alloc(32);
    const sizeCt = Buffer.alloc(32);
    const dwalletA = Keypair.generate().publicKey;
    const dwalletB = Keypair.generate().publicKey;

    const slot = await provider.connection.getSlot();
    const expirySlot = new BN(slot + 1_000_000);

    const [orderA] = PublicKey.findProgramAddressSync(
      [Buffer.from('order'), market.toBuffer(), nonceA],
      program.programId,
    );
    const [orderB] = PublicKey.findProgramAddressSync(
      [Buffer.from('order'), market.toBuffer(), nonceB],
      program.programId,
    );

    const submitASig = await program.methods
      .submitOrder(sideCt, priceCt, sizeCt, expirySlot, [...nonceA] as never, dwalletA)
      .accountsPartial({
        market,
        order: orderA,
        owner: provider.wallet.publicKey,
      })
      .rpc({ commitment: 'confirmed' });
    const submittedA = await eventsFor(program, submitASig);
    expect(submittedA.some((e) => e.name === 'orderSubmitted')).to.eq(
      true,
      'OrderSubmitted not emitted for order A',
    );

    await program.methods
      .submitOrder(sideCt, priceCt, sizeCt, expirySlot, [...nonceB] as never, dwalletB)
      .accountsPartial({
        market,
        order: orderB,
        owner: provider.wallet.publicKey,
      })
      .rpc({ commitment: 'confirmed' });

    const stateAfterSubmit = await program.account.marketState.fetch(market);
    expect(stateAfterSubmit.activeOrderCount).to.eq(2);
    expect(stateAfterSubmit.orderbookHead?.toBase58()).to.eq(orderB.toBase58());

    const orderAState = await program.account.encryptedOrder.fetch(orderA);
    expect(orderAState.next).to.be.null;
    expect(orderAState.dwalletId.toBase58()).to.eq(dwalletA.toBase58());

    const orderBState = await program.account.encryptedOrder.fetch(orderB);
    expect(orderBState.next?.toBase58()).to.eq(orderA.toBase58());

    // try_match
    const matchId = stateAfterSubmit.matchCount.add(new BN(1));
    const matchIdLeBytes = matchId.toArrayLike(Buffer, 'le', 8);
    const [matchIntent] = PublicKey.findProgramAddressSync(
      [Buffer.from('match_intent'), market.toBuffer(), matchIdLeBytes],
      program.programId,
    );

    const tryMatchSig = await program.methods
      .tryMatch(matchId)
      .accountsPartial({
        market,
        orderA,
        orderB,
        matchIntent,
        payer: provider.wallet.publicKey,
      })
      .rpc({ commitment: 'confirmed' });

    const matchEvents = await eventsFor<{ matchId: BN; matchIntent: PublicKey }>(
      program,
      tryMatchSig,
    );
    const matchProposed = matchEvents.find((e) => e.name === 'matchProposed');
    expect(matchProposed, 'MatchProposed not emitted').to.not.be.undefined;
    expect(matchProposed!.data.matchId.eq(matchId)).to.eq(true);
    expect(matchProposed!.data.matchIntent.toBase58()).to.eq(matchIntent.toBase58());

    const intentState = await program.account.matchIntent.fetch(matchIntent);
    expect(intentState.matchId.eq(matchId)).to.eq(true);
    expect(intentState.orderA.toBase58()).to.eq(orderA.toBase58());
    expect(intentState.orderB.toBase58()).to.eq(orderB.toBase58());
    // Mock CPI returns a 100-byte zero ciphertext.
    expect(intentState.canMatchCt.length).to.eq(100);
    expect(intentState.fillSizeCt.length).to.eq(100);

    // request_settlement
    const [matchRecord] = PublicKey.findProgramAddressSync(
      [Buffer.from('match'), market.toBuffer(), matchIdLeBytes],
      program.programId,
    );

    const settleSig = await program.methods
      .requestSettlement(matchId)
      .accountsPartial({
        market,
        matchIntent,
        matchRecord,
        orderA,
        orderB,
        payer: provider.wallet.publicKey,
      })
      .rpc({ commitment: 'confirmed' });

    const settleEvents = await eventsFor<{
      matchId: BN;
      fillSizeSats: BN;
      clearingPriceQuote: BN;
    }>(program, settleSig);
    const settleReady = settleEvents.find((e) => e.name === 'settleReady');
    expect(settleReady, 'SettleReady not emitted').to.not.be.undefined;
    expect(settleReady!.data.matchId.eq(matchId)).to.eq(true);
    expect(settleReady!.data.fillSizeSats.toNumber()).to.eq(10_000_000);

    const recordState = await program.account.matchRecord.fetch(matchRecord);
    expect(recordState.matchId.eq(matchId)).to.eq(true);
    expect(recordState.fillSizeDecrypted.toNumber()).to.eq(10_000_000);
    expect(recordState.clearingPriceDecrypted.eq(new BN('69750000000'))).to.eq(true);
    expect(recordState.settleStatus).to.deep.eq({ pending: {} });
    expect(recordState.sellerDwallet.toBase58()).to.eq(dwalletA.toBase58());
    expect(recordState.buyerDwallet.toBase58()).to.eq(dwalletB.toBase58());

    const orderAAfter = await program.account.encryptedOrder.fetch(orderA);
    const orderBAfter = await program.account.encryptedOrder.fetch(orderB);
    expect(orderAAfter.status).to.deep.eq({ matched: {} });
    expect(orderBAfter.status).to.deep.eq({ matched: {} });

    const stateAfter = await program.account.marketState.fetch(market);
    expect(stateAfter.matchCount.eq(matchId)).to.eq(true);
    expect(stateAfter.activeOrderCount).to.eq(0);
  });
});
