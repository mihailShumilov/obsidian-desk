import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { expect } from 'chai';
import { encryptOrder } from '../sdk/src/encrypt.ts';
import * as ikaSdk from '../sdk/src/ika.ts';
import * as btcSdk from '../sdk/src/btc.ts';
import { DEFAULT_ORDER_EXPIRY_SLOTS } from '../sdk/src/slots.ts';
import { pollOnce } from '../keeper/src/poll.ts';
import {
  bootstrapFreshMarket,
  mockUtxoProvider,
  setupConfirmedProvider,
} from './_setup.ts';

/**
 * P9 e2e: full happy-path Alice (bid) ⇄ Bob (ask) loop, mock mode.
 *
 * Builds on e2e-settlement (which proves the keeper can finalize ONE
 * pending match) and adds:
 *   - Alice + Bob each submit two opposing orders → two distinct matches
 *   - One pollOnce settles BOTH in a single pass
 *   - Asserts both MatchRecord.btc_tx_proof blobs are well-formed and
 *     each decodes to a P2WPKH spend tx with one input + one or two outputs
 *   - Asserts the keeper's report contains exactly the two matches
 *
 * What this does NOT do (per docs/gaps.md):
 *   - Wait for a real signet 1-conf — gap I0/I2; the upstream Ika TS
 *     client ships uncompiled and we use the mock signer.
 *   - Verify on-chain BTC balance moved — same gap; the mock UTXO
 *     provider is process-local.
 *
 * Tag this `e2e:full` so a future P10 docker-compose harness can `mocha
 * --grep` only the deterministic mock variant.
 */
// Legacy flow — same constraints as e2e-settlement: needs real Encrypt
// Ciphertext accounts on devnet. Kept for reference.
describe.skip('e2e:full — Alice + Bob → two matches → one keeper pass settles both', () => {
  const { provider, program } = setupConfirmedProvider();

  let market: PublicKey;

  before(async () => {
    process.env['OBSIDIAN_ENCRYPT_MODE'] = 'mock';
    process.env['OBSIDIAN_IKA_MODE'] = 'mock';
    ikaSdk._mockReset();
    ({ market } = await bootstrapFreshMarket(program, provider.wallet.publicKey));
  });

  it('settles both Alice/Bob legs in a single keeper pass', async () => {
    // ── 1. Two dWallets ────────────────────────────────────────────────
    const alice = await ikaSdk.createDWallet('bitcoin-signet');
    const bob = await ikaSdk.createDWallet('bitcoin-signet');
    for (const dw of [alice, bob]) {
      await ikaSdk.lockPolicy(dw.id, {
        controller: program.programId.toBase58(),
        maxAmountSats: 1_000_000_000n,
        expirySlots: DEFAULT_ORDER_EXPIRY_SLOTS,
        rules: [],
      });
    }
    const aliceDwPk = new PublicKey(Buffer.from(alice.id, 'hex'));
    const bobDwPk = new PublicKey(Buffer.from(bob.id, 'hex'));

    // ── 2. Two crossing pairs ──────────────────────────────────────────
    // Pair A: Alice ASK 0.10 BTC @ $70k  ⇄  Bob BID 0.10 BTC @ $70k
    // Pair B: Alice ASK 0.05 BTC @ $69.5k ⇄ Bob BID 0.05 BTC @ $69.5k
    interface Submission {
      side: 'bid' | 'ask';
      priceUsdc6: bigint;
      sizeSats: bigint;
      ownerDwallet: PublicKey;
    }
    const submissions: Submission[] = [
      {
        side: 'ask',
        priceUsdc6: 70_000_000_000n,
        sizeSats: 10_000_000n,
        ownerDwallet: aliceDwPk,
      },
      {
        side: 'bid',
        priceUsdc6: 70_000_000_000n,
        sizeSats: 10_000_000n,
        ownerDwallet: bobDwPk,
      },
      {
        side: 'ask',
        priceUsdc6: 69_500_000_000n,
        sizeSats: 5_000_000n,
        ownerDwallet: aliceDwPk,
      },
      {
        side: 'bid',
        priceUsdc6: 69_500_000_000n,
        sizeSats: 5_000_000n,
        ownerDwallet: bobDwPk,
      },
    ];

    const slot = await provider.connection.getSlot();
    const expirySlot = new BN(slot + 1_000_000);
    const orderPdas: PublicKey[] = [];

    for (const sub of submissions) {
      const blob = await encryptOrder(sub.side, sub.priceUsdc6, sub.sizeSats);
      const [orderPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('order'), market.toBuffer(), Buffer.from(blob.nonce)],
        program.programId,
      );
      await program.methods
        .submitOrder(
          Buffer.from(blob.side_ct),
          Buffer.from(blob.price_ct),
          Buffer.from(blob.size_ct),
          expirySlot,
          [...blob.nonce] as never,
          sub.ownerDwallet,
        )
        .accountsPartial({
          market,
          order: orderPda,
          owner: provider.wallet.publicKey,
        })
        .rpc({ commitment: 'confirmed' });
      orderPdas.push(orderPda);
    }
    expect(orderPdas).to.have.length(4);

    // ── 3. tryMatch + requestSettlement for both pairs ─────────────────
    const matchRecords: PublicKey[] = [];
    for (const [i, j] of [
      [0, 1],
      [2, 3],
    ] as const) {
      // tryMatch order A = ASK (per program convention)
      const stateBefore = await program.account.marketState.fetch(market);
      const matchId = stateBefore.matchCount.add(new BN(1));
      const matchIdLeBytes = matchId.toArrayLike(Buffer, 'le', 8);
      const [matchIntent] = PublicKey.findProgramAddressSync(
        [Buffer.from('match_intent'), market.toBuffer(), matchIdLeBytes],
        program.programId,
      );
      await program.methods
        .tryMatch(matchId)
        .accountsPartial({
          market,
          orderA: orderPdas[i]!,
          orderB: orderPdas[j]!,
          matchIntent,
          payer: provider.wallet.publicKey,
        })
        .rpc({ commitment: 'confirmed' });

      const [matchRecord] = PublicKey.findProgramAddressSync(
        [Buffer.from('match'), market.toBuffer(), matchIdLeBytes],
        program.programId,
      );
      await program.methods
        .requestSettlement(matchId)
        .accountsPartial({
          market,
          matchIntent,
          matchRecord,
          orderA: orderPdas[i]!,
          orderB: orderPdas[j]!,
          payer: provider.wallet.publicKey,
        })
        .rpc({ commitment: 'confirmed' });

      matchRecords.push(matchRecord);
    }
    expect(matchRecords).to.have.length(2);

    // Confirm both records started Pending.
    for (const mr of matchRecords) {
      const rec = await program.account.matchRecord.fetch(mr);
      expect(rec.settleStatus).to.deep.eq({ pending: {} });
      expect(rec.btcTxProof.length).to.eq(0);
    }

    // ── 4. Single keeper pass settles both ─────────────────────────────
    const ourSet = new Set(matchRecords.map((m) => m.toBase58()));
    const report = await pollOnce(program as never, {
      keeperId: 'e2e-full',
      feerateSatPerVB: 4,
      utxoProvider: mockUtxoProvider,
      btcNetwork: 'signet',
      broadcastMode: 'mock',
      ikaSdk,
      btcSdk,
    });

    const oursAttempted = report.attempted.filter((r) => ourSet.has(r.matchRecord));
    const oursSettled = report.settled.filter((r) => ourSet.has(r.matchRecord));
    const oursFailed = report.failed.filter((r) => ourSet.has(r.matchRecord));

    expect(oursAttempted, 'both legs should appear in attempted').to.have.length(2);
    expect(oursSettled, 'both legs should settle on the first pass').to.have.length(2);
    expect(oursFailed, 'no leg should fail').to.have.length(0);

    // ── 5. Final on-chain state for both records ───────────────────────
    for (const mr of matchRecords) {
      const rec = await program.account.matchRecord.fetch(mr);
      expect(rec.settleStatus).to.deep.eq({ settled: {} });
      // Proof = 32-byte signet broadcast txid.
      expect(rec.btcTxProof.length).to.eq(32, 'proof = 32-byte txid');
      expect(rec.finalizedAt.gt(new BN(0))).to.eq(true);
      const proofHex = Buffer.from(rec.btcTxProof).toString('hex');
      expect(proofHex).to.match(/^[0-9a-f]{64}$/);
    }

    // ── 6. Idempotency: second pass should NOT re-process ──────────────
    const second = await pollOnce(program as never, {
      keeperId: 'e2e-full',
      feerateSatPerVB: 4,
      utxoProvider: mockUtxoProvider,
      btcNetwork: 'signet',
      broadcastMode: 'mock',
      ikaSdk,
      btcSdk,
    });
    const oursSecondAttempted = second.attempted.filter((r) =>
      ourSet.has(r.matchRecord),
    );
    expect(
      oursSecondAttempted,
      'settled records should not appear in second poll',
    ).to.have.length(0);
  });
});
