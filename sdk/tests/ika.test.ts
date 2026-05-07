import { strict as assert } from 'node:assert';
import { afterEach, before, describe, it } from 'node:test';
import {
  _mockAddressOf,
  _mockReset,
  _mockSize,
  createDWallet,
  currentMode,
  lockPolicy,
  requestSign,
} from '../src/ika.ts';
import { address as btcAddress } from 'bitcoinjs-lib';
import { buildSpendTx, networkFor } from '../src/btc.ts';
import { VendorSDKUnavailableError } from '../src/errors.ts';
import { DEFAULT_ORDER_EXPIRY_SLOTS } from '../src/slots.ts';

function realScriptFor(addr: string): string {
  // bitcoinjs-lib v7 returns Uint8Array; wrap in Buffer for hex serialization.
  return Buffer.from(btcAddress.toOutputScript(addr, networkFor('signet'))).toString('hex');
}

const PROGRAM_ID = 'H25yY5o4emorZ9qMHAUvJhdtrFjDSeYy2MVYurpQbeLp';

describe('ika (mock mode)', () => {
  before(() => {
    process.env['OBSIDIAN_IKA_MODE'] = 'mock';
    _mockReset();
  });
  afterEach(() => _mockReset());

  it('createDWallet returns 32-byte hex id + signet address', async () => {
    const dw = await createDWallet('bitcoin-signet');
    assert.equal(dw.chain, 'bitcoin-signet');
    assert.equal(dw.id.length, 64, '32-byte hex id');
    assert.match(dw.id, /^[0-9a-f]{64}$/, 'lowercase hex');
    // Signet bech32 addresses use the 'tb' prefix (per UI_DESIGN convention).
    assert.match(dw.address, /^tb1q/, 'signet P2WPKH bech32 prefix');
    assert.equal(_mockAddressOf(dw.id), dw.address);
    assert.equal(_mockSize(), 1);
  });

  it('createDWallet generates fresh keys per call', async () => {
    const a = await createDWallet('bitcoin-signet');
    const b = await createDWallet('bitcoin-signet');
    assert.notEqual(a.id, b.id);
    assert.notEqual(a.address, b.address);
    assert.equal(_mockSize(), 2);
  });

  it('lockPolicy persists policy + returns deterministic policy account id', async () => {
    const dw = await createDWallet('bitcoin-signet');
    const policy = {
      controller: PROGRAM_ID,
      maxAmountSats: 10_000_000n,
      expirySlots: DEFAULT_ORDER_EXPIRY_SLOTS,
      rules: [],
    };
    const r1 = await lockPolicy(dw.id, policy);
    const r2 = await lockPolicy(dw.id, policy);
    assert.equal(r1.policyAccountOnSolana, r2.policyAccountOnSolana, 'deterministic');
    assert.match(r1.policyAccountOnSolana, /^mock_policy_[0-9a-f]{32}$/);
  });

  it('lockPolicy rejects unknown dWallet ids', async () => {
    await assert.rejects(
      () =>
        lockPolicy('00'.repeat(32), {
          controller: PROGRAM_ID,
          maxAmountSats: 1n,
          expirySlots: 1,
          rules: [],
        }),
      VendorSDKUnavailableError,
    );
  });

  it('requestSign signs a P2WPKH PSBT for the seller', async () => {
    const seller = await createDWallet('bitcoin-signet');
    const buyer = await createDWallet('bitcoin-signet');
    await lockPolicy(seller.id, {
      controller: PROGRAM_ID,
      maxAmountSats: 1_000_000n,
      expirySlots: 100,
      rules: [],
    });
    const tx = buildSpendTx(
      seller.address,
      buyer.address,
      500_000n,
      4,
      [
        {
          txid: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          vout: 0,
          valueSats: 1_000_000n,
          // Mock script — exact bytes don't matter for signing test, only for
          // chain validation. Use a valid P2WPKH script bytes derived from a
          // known pubkey hash (20 zero bytes) so PSBT serialization succeeds.
          scriptPubKeyHex: realScriptFor(seller.address),
        },
      ],
    );
    // signing succeeds (we don't broadcast — PSBT mismatch with the fake
    // scriptPubKey is expected at network level). Just check we got hex bytes.
    const signed = await requestSign(seller.id, tx, {
      txSignature: 'mock-sol-tx',
      matchId: 1n,
    });
    assert.ok(signed.signedTxHex.length > 0, 'should produce hex output');
    assert.match(signed.signedTxHex, /^[0-9a-f]+$/);
    assert.equal(signed.broadcastTxid, undefined, 'mock mode never broadcasts');
  });

  it('requestSign rejects when policy.maxAmountSats is exceeded', async () => {
    const seller = await createDWallet('bitcoin-signet');
    const buyer = await createDWallet('bitcoin-signet');
    await lockPolicy(seller.id, {
      controller: PROGRAM_ID,
      maxAmountSats: 100n, // very low
      expirySlots: 100,
      rules: [],
    });
    const tx = buildSpendTx(
      seller.address,
      buyer.address,
      500_000n,
      4,
      [
        {
          txid: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          vout: 0,
          valueSats: 1_000_000n,
          scriptPubKeyHex: realScriptFor(seller.address),
        },
      ],
    );
    await assert.rejects(
      () =>
        requestSign(seller.id, tx, { txSignature: 'mock-sol-tx', matchId: 1n }),
      VendorSDKUnavailableError,
    );
  });

  it('requestSign rejects when dWallet has no locked policy', async () => {
    const dw = await createDWallet('bitcoin-signet');
    const buyer = await createDWallet('bitcoin-signet');
    const tx = buildSpendTx(dw.address, buyer.address, 100n, 4, [
      {
        txid: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        vout: 0,
        valueSats: 1_000_000n,
        scriptPubKeyHex: '0014' + '00'.repeat(20),
      },
    ]);
    await assert.rejects(
      () => requestSign(dw.id, tx, { txSignature: 'mock-sol-tx', matchId: 1n }),
      VendorSDKUnavailableError,
    );
  });
});

describe('ika (real mode unsupported)', () => {
  before(() => {
    process.env['OBSIDIAN_IKA_MODE'] = 'real';
  });

  it('throws VendorSDKUnavailableError for createDWallet', async () => {
    try {
      await createDWallet('bitcoin-signet');
      assert.fail('expected throw');
    } catch (err) {
      assert.ok(err instanceof VendorSDKUnavailableError);
      assert.match(err.message, /gap I0|OBSIDIAN_IKA_MODE=mock/);
    }
    process.env['OBSIDIAN_IKA_MODE'] = 'mock';
  });

  it('currentMode() reflects the env var', () => {
    process.env['OBSIDIAN_IKA_MODE'] = 'mock';
    assert.equal(currentMode(), 'mock');
    process.env['OBSIDIAN_IKA_MODE'] = 'real';
    assert.equal(currentMode(), 'real');
    process.env['OBSIDIAN_IKA_MODE'] = 'mock';
  });
});
