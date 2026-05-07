import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { expect } from 'chai';
import { randomBytes } from 'node:crypto';
// Use the SOURCE files via relative paths so all in-test SDK calls go
// through the same module instance (and therefore the same ika mockStore).
// pollOnce accepts an `ikaSdk` / `btcSdk` override so the keeper uses
// THIS instance's mock store instead of its own default-loaded one.
import { CT_ID_LEN, encryptOrder } from '../sdk/src/encrypt.ts';
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
 * P4 e2e: full mock settlement flow.
 *
 * 1. Init market
 * 2. Create 2 mock dWallets (alice = seller, bob = buyer)
 * 3. Submit alice's bid + bob's ask, both encrypted (mock)
 * 4. try_match → request_settlement → MatchRecord with settle_status=Pending
 * 5. Run keeper.pollOnce — picks up the Pending record, signs the BTC tx
 *    via ika.requestSign (mock), calls finalize_settlement
 * 6. Assert MatchRecord.settle_status flipped to Settled and btc_tx_proof
 *    holds the signed BTC tx hex bytes.
 *
 * This test does NOT touch the signet network. The keeper's mock UTXO
 * provider synthesizes a deterministic input per dWallet address.
 */
// Legacy flow — `request_settlement` is now `request_decryption + finalize_decryption`.
// Needs real Encrypt Ciphertext accounts on devnet to run. See docs/gaps.md
// E2 / E3 / E4 for the closure path; this scaffold is preserved as reference.
describe.skip('e2e: settlement (encrypt + match + Ika sign + finalize)', () => {
  const { provider, program } = setupConfirmedProvider();

  let market: PublicKey;

  before(async () => {
    process.env['OBSIDIAN_ENCRYPT_MODE'] = 'mock';
    process.env['OBSIDIAN_IKA_MODE'] = 'mock';
    ikaSdk._mockReset();
    ({ market } = await bootstrapFreshMarket(program, provider.wallet.publicKey));
  });

  it('runs the full submit → match → request_settlement → finalize loop', async () => {
    // ── 1. dWallets ─────────────────────────────────────────────────────
    const alice = await ikaSdk.createDWallet('bitcoin-signet');
    const bob = await ikaSdk.createDWallet('bitcoin-signet');
    await ikaSdk.lockPolicy(alice.id, {
      controller: program.programId.toBase58(),
      maxAmountSats: 1_000_000_000n,
      expirySlots: DEFAULT_ORDER_EXPIRY_SLOTS,
      rules: [],
    });
    await ikaSdk.lockPolicy(bob.id, {
      controller: program.programId.toBase58(),
      maxAmountSats: 1_000_000_000n,
      expirySlots: DEFAULT_ORDER_EXPIRY_SLOTS,
      rules: [],
    });

    // Convert mock 32-byte hex dWallet ids back into Solana Pubkeys so the
    // program can store them in MatchRecord.{seller,buyer}_dwallet.
    const aliceDwPk = new PublicKey(Buffer.from(alice.id, 'hex'));
    const bobDwPk = new PublicKey(Buffer.from(bob.id, 'hex'));

    // ── 2. Encrypted orders ─────────────────────────────────────────────
    const sellerBlob = await encryptOrder('ask', 70_000_000_000n, 10_000_000n);
    const buyerBlob = await encryptOrder('bid', 70_000_000_000n, 10_000_000n);
    expect(sellerBlob.side_ct.length).to.eq(CT_ID_LEN);

    const slot = await provider.connection.getSlot();
    const expirySlot = new BN(slot + 1_000_000);

    const [sellerOrder] = PublicKey.findProgramAddressSync(
      [Buffer.from('order'), market.toBuffer(), Buffer.from(sellerBlob.nonce)],
      program.programId,
    );
    const [buyerOrder] = PublicKey.findProgramAddressSync(
      [Buffer.from('order'), market.toBuffer(), Buffer.from(buyerBlob.nonce)],
      program.programId,
    );

    await program.methods
      .submitOrder(
        Buffer.from(sellerBlob.side_ct),
        Buffer.from(sellerBlob.price_ct),
        Buffer.from(sellerBlob.size_ct),
        expirySlot,
        [...sellerBlob.nonce] as never,
        aliceDwPk,
      )
      .accountsPartial({ market, order: sellerOrder, owner: provider.wallet.publicKey })
      .rpc({ commitment: 'confirmed' });

    await program.methods
      .submitOrder(
        Buffer.from(buyerBlob.side_ct),
        Buffer.from(buyerBlob.price_ct),
        Buffer.from(buyerBlob.size_ct),
        expirySlot,
        [...buyerBlob.nonce] as never,
        bobDwPk,
      )
      .accountsPartial({ market, order: buyerOrder, owner: provider.wallet.publicKey })
      .rpc({ commitment: 'confirmed' });

    // ── 3. try_match + request_settlement ───────────────────────────────
    const stateBeforeMatch = await program.account.marketState.fetch(market);
    const matchId = stateBeforeMatch.matchCount.add(new BN(1));
    const matchIdLeBytes = matchId.toArrayLike(Buffer, 'le', 8);
    const [matchIntent] = PublicKey.findProgramAddressSync(
      [Buffer.from('match_intent'), market.toBuffer(), matchIdLeBytes],
      program.programId,
    );
    await program.methods
      .tryMatch(matchId)
      .accountsPartial({
        market,
        // order_a = seller leg per program convention.
        orderA: sellerOrder,
        orderB: buyerOrder,
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
        orderA: sellerOrder,
        orderB: buyerOrder,
        payer: provider.wallet.publicKey,
      })
      .rpc({ commitment: 'confirmed' });

    const pending = await program.account.matchRecord.fetch(matchRecord);
    expect(pending.settleStatus).to.deep.eq({ pending: {} });
    expect(pending.btcTxProof.length).to.eq(0);
    expect(pending.sellerDwallet.toBase58()).to.eq(aliceDwPk.toBase58());
    expect(pending.buyerDwallet.toBase58()).to.eq(bobDwPk.toBase58());

    // ── 4. Keeper run ───────────────────────────────────────────────────
    // The validator persists state across test runs, so there may be
    // stale MatchRecords from prior failed runs. We only assert that OUR
    // matchRecord (the one this test just created) flows correctly through
    // the keeper — other records are out of scope for this test.
    const matchRecordB58 = matchRecord.toBase58();
    const report = await pollOnce(program as never, {
      keeperId: 'e2e',
      feerateSatPerVB: 4,
      utxoProvider: mockUtxoProvider,
      btcNetwork: 'signet',
      broadcastMode: 'mock',
      // Inject this test's SDK namespaces so the keeper sees the SAME
      // mock dWallet store we just populated.
      ikaSdk,
      btcSdk,
    });
    const oursAttempted = report.attempted.find((r) => r.matchRecord === matchRecordB58);
    expect(oursAttempted, 'our matchRecord should be in the attempted set').to.not.be
      .undefined;
    const oursSettled = report.settled.find((r) => r.matchRecord === matchRecordB58);
    expect(oursSettled, 'our matchRecord should be settled').to.not.be.undefined;
    expect(oursSettled!.matchId).to.eq(matchId.toString());

    // ── 5. Final state ──────────────────────────────────────────────────
    const finalRec = await program.account.matchRecord.fetch(matchRecord);
    expect(finalRec.settleStatus).to.deep.eq({ settled: {} });
    // Proof is the 32-byte broadcast txid (real signet txid in real mode,
    // sha-256 of the signed hex in mock/fallback mode). UI renders it as
    // mempool.space/<network>/tx/<hex>.
    expect(finalRec.btcTxProof.length).to.eq(32, 'proof = 32-byte txid');
    expect(finalRec.finalizedAt.gt(new BN(0))).to.eq(true);
    expect(Buffer.from(finalRec.btcTxProof).toString('hex')).to.match(/^[0-9a-f]{64}$/);

    // Idempotency: a second poll should NOT re-process our (now Settled) record.
    const second = await pollOnce(program as never, {
      keeperId: 'e2e',
      feerateSatPerVB: 4,
      utxoProvider: mockUtxoProvider,
      btcNetwork: 'signet',
      broadcastMode: 'mock',
    });
    const oursSecond = second.attempted.find((r) => r.matchRecord === matchRecordB58);
    expect(oursSecond, 'settled record should not appear in second poll').to.be.undefined;

    // Use the random nonces so unused-import warnings stay quiet.
    void randomBytes;
  });
});
