import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { address as btcAddress } from 'bitcoinjs-lib';
import {
  buildSpendTx,
  fromWIF,
  generateP2wpkh,
  networkFor,
  signAndFinalize,
} from '../src/btc.ts';
import { EncryptionError } from '../src/errors.ts';

describe('btc.buildSpendTx', () => {
  // 20-byte zero pubkey-hash → valid-looking P2WPKH script. Fine for tests
  // that only inspect the PSBT structure (no signing).
  const FAKE_SCRIPT_HEX = '0014' + '00'.repeat(20);
  const utxo = {
    txid: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    vout: 0,
    valueSats: 1_000_000n,
    scriptPubKeyHex: FAKE_SCRIPT_HEX,
  };

  it('returns a base64 PSBT with two outputs (recipient + change)', () => {
    const { address: from } = generateP2wpkh('signet');
    const { address: to } = generateP2wpkh('signet');
    const tx = buildSpendTx(from, to, 500_000n, 4, [utxo]);
    assert.equal(tx.network, 'signet');
    assert.equal(tx.inputs.length, 1);
    assert.equal(tx.outputs.length, 2);
    assert.equal(tx.outputs[0]!.address, to);
    assert.equal(tx.outputs[0]!.valueSats, 500_000n);
    assert.equal(tx.outputs[1]!.address, from);
    assert.ok(tx.psbt.length > 0);
  });

  it('omits change output when it would be exactly zero', () => {
    const { address: from } = generateP2wpkh('signet');
    const { address: to } = generateP2wpkh('signet');
    // estVBytes = 1*68 + 2*31 + 11 = 141. fee at feerate=1 = 141 sats.
    // amount = totalIn - fee → change = 0.
    const small = { ...utxo, valueSats: 600n };
    const tx = buildSpendTx(from, to, 459n, 1, [small]);
    assert.equal(tx.outputs.length, 1, 'no change output expected');
    assert.equal(tx.outputs[0]!.address, to);
    assert.equal(tx.outputs[0]!.valueSats, 459n);
  });

  it('rejects non-positive amounts', () => {
    const { address: from } = generateP2wpkh('signet');
    const { address: to } = generateP2wpkh('signet');
    assert.throws(() => buildSpendTx(from, to, 0n, 4, [utxo]), EncryptionError);
    assert.throws(() => buildSpendTx(from, to, -1n, 4, [utxo]), EncryptionError);
  });

  it('rejects zero feerate', () => {
    const { address: from } = generateP2wpkh('signet');
    const { address: to } = generateP2wpkh('signet');
    assert.throws(
      () => buildSpendTx(from, to, 500_000n, 0, [utxo]),
      EncryptionError,
    );
  });

  it('rejects empty inputs', () => {
    const { address: from } = generateP2wpkh('signet');
    const { address: to } = generateP2wpkh('signet');
    assert.throws(() => buildSpendTx(from, to, 100n, 4, []), EncryptionError);
  });

  it('rejects under-funded inputs', () => {
    const { address: from } = generateP2wpkh('signet');
    const { address: to } = generateP2wpkh('signet');
    const small = { ...utxo, valueSats: 100n };
    assert.throws(
      () => buildSpendTx(from, to, 1_000_000n, 4, [small]),
      EncryptionError,
    );
  });
});

describe('btc.signAndFinalize', () => {
  it('signs a UTXO whose script matches the signing key', () => {
    const { wif: senderWif, address: from } = generateP2wpkh('signet');
    const { address: to } = generateP2wpkh('signet');
    const net = networkFor('signet');
    // Real P2WPKH script for `from` so the signature actually verifies.
    // bitcoinjs-lib v7 returns Uint8Array; wrap in Buffer for proper hex.
    const realScript = Buffer.from(btcAddress.toOutputScript(from, net)).toString('hex');
    const utxo = {
      txid: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      vout: 0,
      valueSats: 1_000_000n,
      scriptPubKeyHex: realScript,
    };
    const tx = buildSpendTx(from, to, 500_000n, 4, [utxo]);
    const key = fromWIF(senderWif, 'signet');
    const hex = signAndFinalize(tx, key);
    assert.ok(hex.length > 0);
    assert.match(hex, /^[0-9a-f]+$/);
  });
});
