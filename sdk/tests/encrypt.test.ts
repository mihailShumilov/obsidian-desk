import { strict as assert } from 'node:assert';
import { before, describe, it } from 'node:test';
import {
  CT_ID_LEN,
  FheType,
  MOCK_TAG,
  describeCiphertext,
  encryptOrder,
  encryptSide,
  encryptU64,
  requestThresholdDecrypt,
} from '../src/encrypt.ts';
import {
  DecryptionError,
  EncryptionError,
  VendorSDKUnavailableError,
} from '../src/errors.ts';

describe('encrypt (mock mode)', () => {
  before(() => {
    process.env['OBSIDIAN_ENCRYPT_MODE'] = 'mock';
  });

  it('encryptU64 round-trips a known value', async () => {
    const ct = await encryptU64(500_000_000n);
    assert.equal(ct.length, CT_ID_LEN);
    assert.equal(ct[0], MOCK_TAG, 'first byte should carry MOCK_TAG');
    assert.equal(ct[1], FheType.EUint64, 'second byte should be EUint64 type id');
    const value = await requestThresholdDecrypt(ct, 'mock-tx-sig');
    assert.equal(value, 500_000_000n);
  });

  it('encryptU64 produces fresh salt per call (so identical plaintexts diverge)', async () => {
    const a = await encryptU64(42n);
    const b = await encryptU64(42n);
    assert.notDeepEqual(a, b, 'two encryptions of the same plaintext must differ');
    // But both decrypt to the same plaintext.
    assert.equal(await requestThresholdDecrypt(a, ''), 42n);
    assert.equal(await requestThresholdDecrypt(b, ''), 42n);
  });

  it('encryptSide encodes bid=0, ask=1 as EBool', async () => {
    const bid = await encryptSide('bid');
    const ask = await encryptSide('ask');
    assert.equal(bid[1], FheType.EBool);
    assert.equal(ask[1], FheType.EBool);
    assert.equal(await requestThresholdDecrypt(bid, ''), 0n);
    assert.equal(await requestThresholdDecrypt(ask, ''), 1n);
  });

  it('encryptOrder returns 3 cts + 16-byte nonce', async () => {
    const blob = await encryptOrder('bid', 70_000_000_000n, 50_000_000n);
    assert.equal(blob.side_ct.length, CT_ID_LEN);
    assert.equal(blob.price_ct.length, CT_ID_LEN);
    assert.equal(blob.size_ct.length, CT_ID_LEN);
    assert.equal(blob.nonce.length, 16);
    assert.equal(await requestThresholdDecrypt(blob.side_ct, ''), 0n);
    assert.equal(await requestThresholdDecrypt(blob.price_ct, ''), 70_000_000_000n);
    assert.equal(await requestThresholdDecrypt(blob.size_ct, ''), 50_000_000n);
  });

  it('encryptU64 rejects out-of-range values', async () => {
    await assert.rejects(() => encryptU64(-1n), EncryptionError);
    await assert.rejects(() => encryptU64(1n << 65n), EncryptionError);
  });

  it('rejects EncryptionError messages should not leak the offending value', async () => {
    try {
      await encryptU64(-12_345n);
      assert.fail('expected throw');
    } catch (err) {
      assert.ok(err instanceof EncryptionError);
      assert.doesNotMatch(err.message, /12_?345|12345/, 'message must not echo plaintext');
    }
  });

  it('requestThresholdDecrypt rejects ciphertexts without the mock tag', async () => {
    await assert.rejects(
      () => requestThresholdDecrypt(new Uint8Array(CT_ID_LEN), ''),
      DecryptionError,
    );
  });

  it('requestThresholdDecrypt rejects wrong-length blobs', async () => {
    await assert.rejects(() => requestThresholdDecrypt(new Uint8Array(16), ''), DecryptionError);
  });

  it('describeCiphertext leaks length+tag+fheType only', async () => {
    const ct = await encryptU64(987_654_321n);
    const desc = describeCiphertext(ct);
    assert.equal(desc, `ct(${CT_ID_LEN}B, mock, fheType=4)`);
    assert.doesNotMatch(desc, /987|654|321/, 'description must not echo plaintext');
  });
});

describe('encrypt (real mode unsupported)', () => {
  before(() => {
    process.env['OBSIDIAN_ENCRYPT_MODE'] = 'real';
  });

  it('throws VendorSDKUnavailableError pointing to gap E5', async () => {
    try {
      await encryptU64(1n);
      assert.fail('expected throw');
    } catch (err) {
      assert.ok(err instanceof VendorSDKUnavailableError);
      assert.match(err.message, /gap E5|OBSIDIAN_ENCRYPT_MODE=mock/);
    }
    // Reset for subsequent suites in the same process.
    process.env['OBSIDIAN_ENCRYPT_MODE'] = 'mock';
  });
});
