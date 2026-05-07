#!/usr/bin/env node
/**
 * Live devnet smoke test for the real-mode SDK paths.
 *
 * Hits both the Encrypt and Ika pre-alpha gRPC endpoints on Solana devnet
 * and asserts the responses look well-formed. Run from the repo root:
 *
 *   OBSIDIAN_ENCRYPT_MODE=real OBSIDIAN_IKA_MODE=real \
 *     node sdk/scripts/devnet-smoke.mjs
 *
 * Override endpoints / program ids via:
 *   OBSIDIAN_ENCRYPT_GRPC_URL=...
 *   OBSIDIAN_ENCRYPT_PROGRAM_ID=...
 *   OBSIDIAN_IKA_GRPC_URL=...
 *
 * Exits non-zero on any failure so this can wedge into CI gated by an env
 * flag (don't run in the standard test loop — costs network calls).
 */

import { Keypair } from '@solana/web3.js';
import { encrypt, ika } from '../dist/index.js';
import { describeCiphertext } from '../dist/encrypt.js';

process.env.OBSIDIAN_ENCRYPT_MODE = 'real';
process.env.OBSIDIAN_IKA_MODE = 'real';

let failed = 0;
function pass(label) { console.log(`  ✓ ${label}`); }
function fail(label, err) {
  failed++;
  console.error(`  ✗ ${label}: ${err?.message ?? err}`);
}

console.log('Encrypt real-mode smoke');
try {
  // 1. encryptU64 → real ciphertext id (32 bytes).
  const id = await encrypt.encryptU64(42n);
  if (!(id instanceof Uint8Array) || id.length !== 32) {
    throw new Error(`expected 32B id, got ${id?.length}`);
  }
  pass(`encryptU64(42) returned ${describeCiphertext(id)}`);
} catch (e) { fail('encryptU64', e); }

try {
  // 2. encryptOrder → 3 distinct ciphertext ids.
  const blob = await encrypt.encryptOrder('bid', 70_000_000_000n, 50_000_000n);
  if (blob.side_ct.length !== 32) throw new Error('side_ct not 32B');
  if (blob.price_ct.length !== 32) throw new Error('price_ct not 32B');
  if (blob.size_ct.length !== 32) throw new Error('size_ct not 32B');
  if (Buffer.compare(Buffer.from(blob.side_ct), Buffer.from(blob.price_ct)) === 0) {
    throw new Error('side_ct == price_ct (no per-input randomness)');
  }
  pass(`encryptOrder(bid, $70k, 0.5BTC) → 3 fresh 32B ids`);
} catch (e) { fail('encryptOrder', e); }

console.log('\nIka real-mode smoke');
const sender = Keypair.generate();
let dw;
try {
  dw = await ika.createDWallet('bitcoin-signet', { creator: sender.publicKey.toBase58() });
  if (!dw.id || dw.id.length === 0) throw new Error('empty dwallet id');
  if (!dw.address.startsWith('tb1')) throw new Error(`unexpected btc address: ${dw.address}`);
  pass(`createDWallet → id=${dw.id.slice(0, 16)}… addr=${dw.address}`);
} catch (e) { fail('createDWallet', e); }

if (dw) {
  try {
    const r = await ika.lockPolicy(
      dw.id,
      {
        controller: 'H25yY5o4emorZ9qMHAUvJhdtrFjDSeYy2MVYurpQbeLp',
        maxAmountSats: 1_000_000_000n,
        expirySlots: 216_000,
        rules: [],
      },
      { caller: sender.publicKey.toBase58() },
    );
    if (!r.policyAccountOnSolana) throw new Error('no policy account returned');
    pass(`lockPolicy → ${r.policyAccountOnSolana}`);
  } catch (e) { fail('lockPolicy', e); }
}

console.log(`\n${failed === 0 ? 'OK' : `FAILED (${failed})`}`);
process.exit(failed === 0 ? 0 : 1);
