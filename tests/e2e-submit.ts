import { Keypair, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { expect } from 'chai';
import {
  CT_ID_LEN,
  encryptOrder,
  requestThresholdDecrypt,
} from '../sdk/src/encrypt.ts';
import * as ikaSdk from '../sdk/src/ika.ts';
import { bootstrapFreshMarket, setupConfirmedProvider } from './_setup.ts';

/**
 * P3 e2e: encrypt an order client-side (mock mode), submit to the program,
 * read it back, assert the on-chain ciphertext bytes equal the SDK output.
 */
describe('e2e: encrypt → submit_order → read-back', () => {
  const { provider, program } = setupConfirmedProvider();

  let market: PublicKey;

  before(async () => {
    process.env['OBSIDIAN_ENCRYPT_MODE'] = 'mock';
    ikaSdk._mockReset();
    ({ market } = await bootstrapFreshMarket(program, provider.wallet.publicKey));
  });

  it('round-trips an encrypted bid through the program', async () => {
    // 0.5 BTC bid at 70_000 USDC. Quote is scaled by 1e6 (USDC has 6 decimals);
    // size is in satoshis (BTC has 8 decimals).
    const priceQuote = 70_000n * 1_000_000n; // 70_000_000_000
    const sizeBase = 50_000_000n; //                                 0.5 BTC
    const blob = await encryptOrder('bid', priceQuote, sizeBase);
    expect(blob.side_ct.length).to.eq(CT_ID_LEN);
    expect(blob.price_ct.length).to.eq(CT_ID_LEN);
    expect(blob.size_ct.length).to.eq(CT_ID_LEN);
    expect(blob.nonce.length).to.eq(16);

    const dwallet = Keypair.generate().publicKey;
    const slot = await provider.connection.getSlot();
    const expirySlot = new BN(slot + 1_000_000);

    const [order] = PublicKey.findProgramAddressSync(
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
        dwallet,
      )
      .accountsPartial({
        market,
        order,
        owner: provider.wallet.publicKey,
      })
      .rpc({ commitment: 'confirmed' });

    const stored = await program.account.encryptedOrder.fetch(order);
    expect(Buffer.from(stored.sideCt).equals(Buffer.from(blob.side_ct))).to.eq(
      true,
      'on-chain side_ct should equal the SDK output bytes',
    );
    expect(Buffer.from(stored.priceCt).equals(Buffer.from(blob.price_ct))).to.eq(true);
    expect(Buffer.from(stored.sizeCt).equals(Buffer.from(blob.size_ct))).to.eq(true);
    expect(Buffer.from(stored.nonce).equals(Buffer.from(blob.nonce))).to.eq(true);
    expect(stored.dwalletId.toBase58()).to.eq(dwallet.toBase58());
    expect(stored.status).to.deep.eq({ active: {} });

    // The mock-mode cts are round-trip recoverable. A real keeper would NOT
    // do this — it would request threshold decrypt via Encrypt only after a
    // match is proposed. Here we just confirm the SDK side stays consistent.
    expect(await requestThresholdDecrypt(new Uint8Array(stored.sideCt), 'e2e')).to.eq(0n);
    expect(await requestThresholdDecrypt(new Uint8Array(stored.priceCt), 'e2e')).to.eq(
      priceQuote,
    );
    expect(await requestThresholdDecrypt(new Uint8Array(stored.sizeCt), 'e2e')).to.eq(
      sizeBase,
    );
  });
});
