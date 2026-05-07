import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { address as btcAddress } from 'bitcoinjs-lib';
import {
  broadcastTx,
  buildSpendTx,
  fromWIF,
  generateP2wpkh,
  getAddressUtxos,
  mempoolSpaceTxUrl,
  networkFor,
  signAndFinalize,
  synthesizeUtxo,
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

describe('btc.synthesizeUtxo', () => {
  it('returns a deterministic 1-BTC UTXO with valid txid format', () => {
    const { address } = generateP2wpkh('signet');
    const a = synthesizeUtxo(address, 'signet');
    const b = synthesizeUtxo(address, 'signet');
    assert.equal(a.txid, b.txid);
    assert.match(a.txid, /^[0-9a-f]{64}$/);
    assert.equal(a.valueSats, 100_000_000n);
    assert.equal(a.vout, 0);
  });

  it('produces different txids for different addresses', () => {
    const a = synthesizeUtxo(generateP2wpkh('signet').address, 'signet');
    const b = synthesizeUtxo(generateP2wpkh('signet').address, 'signet');
    assert.notEqual(a.txid, b.txid);
  });
});

describe('btc.getAddressUtxos', () => {
  it('mock mode returns one synthesised UTXO', async () => {
    const { address } = generateP2wpkh('signet');
    const r = await getAddressUtxos(address, 'signet', 'mock');
    assert.equal(r.mode, 'mock');
    assert.equal(r.value.length, 1);
    assert.equal(r.value[0]!.valueSats, 100_000_000n);
  });

  it('auto mode falls back to mock when esplora is unreachable', async () => {
    const prev = process.env['OBSIDIAN_ESPLORA_SIGNET_URL'];
    // Point at a port that should refuse — triggers ECONNREFUSED → fallback.
    process.env['OBSIDIAN_ESPLORA_SIGNET_URL'] = 'http://127.0.0.1:1';
    try {
      const { address } = generateP2wpkh('signet');
      const r = await getAddressUtxos(address, 'signet', 'auto');
      assert.equal(r.mode, 'real-failed-fallback');
      assert.equal(r.value.length, 1);
      assert.match(r.fallbackReason ?? '', /127\.0\.0\.1|fetch|refused|ECONNREFUSED/i);
    } finally {
      if (prev === undefined) delete process.env['OBSIDIAN_ESPLORA_SIGNET_URL'];
      else process.env['OBSIDIAN_ESPLORA_SIGNET_URL'] = prev;
    }
  });

  it('real mode throws when esplora is unreachable', async () => {
    const prev = process.env['OBSIDIAN_ESPLORA_SIGNET_URL'];
    process.env['OBSIDIAN_ESPLORA_SIGNET_URL'] = 'http://127.0.0.1:1';
    try {
      const { address } = generateP2wpkh('signet');
      await assert.rejects(getAddressUtxos(address, 'signet', 'real'));
    } finally {
      if (prev === undefined) delete process.env['OBSIDIAN_ESPLORA_SIGNET_URL'];
      else process.env['OBSIDIAN_ESPLORA_SIGNET_URL'] = prev;
    }
  });
});

describe('btc.broadcastTx', () => {
  it('mock mode returns a deterministic local txid', async () => {
    const a = await broadcastTx('deadbeef', 'signet', 'mock');
    const b = await broadcastTx('deadbeef', 'signet', 'mock');
    assert.equal(a.value, b.value);
    assert.equal(a.mode, 'mock');
    assert.match(a.value, /^[0-9a-f]{64}$/);
  });

  it('rejects empty / non-hex input', async () => {
    await assert.rejects(broadcastTx('', 'signet', 'mock'), /non-empty hex/);
    await assert.rejects(broadcastTx('zz', 'signet', 'mock'), /non-empty hex/);
  });

  it('auto mode falls back when esplora is unreachable', async () => {
    const prev = process.env['OBSIDIAN_ESPLORA_SIGNET_URL'];
    process.env['OBSIDIAN_ESPLORA_SIGNET_URL'] = 'http://127.0.0.1:1';
    try {
      const r = await broadcastTx('cafe1234', 'signet', 'auto');
      assert.equal(r.mode, 'real-failed-fallback');
      assert.match(r.value, /^[0-9a-f]{64}$/);
    } finally {
      if (prev === undefined) delete process.env['OBSIDIAN_ESPLORA_SIGNET_URL'];
      else process.env['OBSIDIAN_ESPLORA_SIGNET_URL'] = prev;
    }
  });
});

describe('btc.mempoolSpaceTxUrl', () => {
  it('builds a mempool.space url for the given network', () => {
    const txid = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    assert.equal(
      mempoolSpaceTxUrl(txid, 'signet'),
      `https://mempool.space/signet/tx/${txid}`,
    );
    assert.equal(
      mempoolSpaceTxUrl(txid, 'testnet'),
      `https://mempool.space/testnet/tx/${txid}`,
    );
  });
});

import {
  attachExternalEcdsaSig,
  bip143SighashForP2WPKH,
  derEncodeEcdsaSig,
  finalizePsbt,
  normaliseLowS,
  scriptForAddress,
} from '../src/btc.ts';
import * as ecc from 'tiny-secp256k1';

describe('btc.normaliseLowS', () => {
  it('passes through low-s sigs unchanged', () => {
    const rs = new Uint8Array(64);
    rs.fill(0x42); // both r and s well below N/2
    const out = normaliseLowS(rs);
    assert.deepEqual(out, rs);
  });

  it('flips s when above N/2', () => {
    // Construct s = N - 1 (just above N/2). Expected: flipped to 1.
    const rs = new Uint8Array(64);
    // r = 0x42…
    rs.fill(0x42, 0, 32);
    // s = N - 1 (last byte of N is 0x41, so s_last = 0x40)
    const NminusOne = Buffer.from(
      'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364140',
      'hex',
    );
    rs.set(NminusOne, 32);
    const out = normaliseLowS(rs);
    // r unchanged
    assert.deepEqual(out.subarray(0, 32), rs.subarray(0, 32));
    // s flipped to 1 (31 zero bytes + 0x01)
    const flipped = out.subarray(32);
    assert.equal(flipped[31], 0x01);
    for (let i = 0; i < 31; i++) assert.equal(flipped[i], 0x00);
  });

  it('rejects non-64-byte input', () => {
    assert.throws(() => normaliseLowS(new Uint8Array(63)), /64 bytes/);
    assert.throws(() => normaliseLowS(new Uint8Array(65)), /64 bytes/);
  });
});

describe('btc.derEncodeEcdsaSig', () => {
  it('produces the canonical 0x30 ... 0x01 SIGHASH_ALL envelope', () => {
    const rs = new Uint8Array(64);
    rs.fill(0x11, 0, 32);
    rs.fill(0x22, 32, 64);
    const der = derEncodeEcdsaSig(rs);
    assert.equal(der[0], 0x30, 'SEQUENCE marker');
    assert.equal(der[2], 0x02, 'INTEGER marker for r');
    assert.equal(der[der.length - 1], 0x01, 'SIGHASH_ALL appended');
  });

  it('prepends 0x00 when MSB is set (DER positive sign)', () => {
    const rs = new Uint8Array(64);
    rs[0] = 0x80; // r MSB set
    rs[32] = 0x80; // s MSB set
    rs.fill(0x42, 1, 32);
    rs.fill(0x42, 33, 64);
    const der = derEncodeEcdsaSig(rs);
    // r-len = 33 (32 + 1 pad), starts with 0x00 0x80 …
    assert.equal(der[3], 33, 'r length includes the 0x00 pad');
    assert.equal(der[4], 0x00, 'padding byte');
    assert.equal(der[5], 0x80, 'real r MSB');
  });
});

describe('btc.bip143SighashForP2WPKH + attachExternalEcdsaSig', () => {
  it('external-sig path produces the same finalised tx as single-key signAndFinalize', () => {
    const sender = generateP2wpkh('signet');
    const senderKey = fromWIF(sender.wif, 'signet');
    const recipient = generateP2wpkh('signet');
    const utxo = {
      txid: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      vout: 0,
      valueSats: 1_000_000n,
      scriptPubKeyHex: scriptForAddress(sender.address, 'signet'),
    };
    const tx = buildSpendTx(sender.address, recipient.address, 500_000n, 4, [utxo]);

    // Reference path: single-key sign+finalise.
    const refHex = signAndFinalize(tx, senderKey);

    // External-sig path: extract sighash, sign locally with the same key
    // (acting as a fake "external signer"), normalise low-s, attach, finalise.
    const sighash = bip143SighashForP2WPKH(tx.psbt, 0, 'signet');
    assert.equal(sighash.length, 32, 'sighash is 32 bytes');

    const sig64 = ecc.sign(sighash, senderKey.privateKey!);
    const updated = attachExternalEcdsaSig(
      tx.psbt,
      0,
      Uint8Array.from(senderKey.publicKey),
      sig64,
      'signet',
    );
    const externalHex = finalizePsbt(updated, 'signet');

    assert.equal(externalHex, refHex, 'external-sig flow matches single-key flow byte-for-byte');
  });

  it('attach throws on signature that does not verify (catches hash_scheme mismatch)', () => {
    const sender = generateP2wpkh('signet');
    const senderKey = fromWIF(sender.wif, 'signet');
    const recipient = generateP2wpkh('signet');
    const utxo = {
      txid: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      vout: 0,
      valueSats: 1_000_000n,
      scriptPubKeyHex: scriptForAddress(sender.address, 'signet'),
    };
    const tx = buildSpendTx(sender.address, recipient.address, 500_000n, 4, [utxo]);

    // Sign a DIFFERENT message — simulates Ika applying an unexpected hash.
    const wrongDigest = new Uint8Array(32).fill(0xff);
    const sig64 = ecc.sign(wrongDigest, senderKey.privateKey!);
    assert.throws(
      () => attachExternalEcdsaSig(
        tx.psbt, 0, Uint8Array.from(senderKey.publicKey), sig64, 'signet',
      ),
      /does not verify/,
    );
  });

  it('rejects non-P2WPKH inputs explicitly', () => {
    // Hand-roll a PSBT with a non-segwit witnessUtxo script (P2PKH).
    // Easiest reuse: call buildSpendTx but tamper with the script, then
    // expect bip143 helper to refuse.
    const sender = generateP2wpkh('signet');
    const recipient = generateP2wpkh('signet');
    const utxo = {
      txid: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      vout: 0,
      valueSats: 1_000_000n,
      // P2PKH script (25 bytes), not P2WPKH (22 bytes).
      scriptPubKeyHex: '76a914' + '00'.repeat(20) + '88ac',
    };
    const tx = buildSpendTx(sender.address, recipient.address, 500_000n, 4, [utxo]);
    assert.throws(
      () => bip143SighashForP2WPKH(tx.psbt, 0, 'signet'),
      /P2WPKH/,
    );
  });
});
