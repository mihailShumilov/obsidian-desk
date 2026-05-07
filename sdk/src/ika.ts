/**
 * Client-side adapter for Ika dWallet operations.
 *
 * **Mode selection** — `OBSIDIAN_IKA_MODE` env var:
 *   - `mock` (default) — local single-signer simulation. `createDWallet`
 *     generates a fresh BTC P2WPKH key, the WIF lives in an in-process
 *     `Map` keyed by the dWallet id, `requestSign` looks it up and signs
 *     the PSBT via bitcoinjs-lib. Sufficient for end-to-end tests run in
 *     a single process.
 *   - `real`            — currently unsupported. The upstream
 *                         `@ika.xyz/pre-alpha-solana-client` v0.1.0 ships
 *                         only uncompiled `.ts` source; Node 24 refuses to
 *                         strip TS from `node_modules`
 *                         (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`).
 *                         See `docs/gaps.md` gap I0 for the closure plan.
 *
 * **Never log private keys, WIFs, or the in-memory mock store.**
 */

import * as crypto from 'node:crypto';
import { signAndFinalize, generateP2wpkh, fromWIF, p2wpkhAddressFromPublicKey, type BtcUnsignedTx } from './btc.ts';
import { VendorSDKUnavailableError } from './errors.ts';
// Type-only import keeps the @grpc/grpc-js dependency out of every consumer's
// module graph. The runtime `createIkaClient` lives behind a dynamic import
// in `ikaRealClient()` below — only loaded when real-mode is actually used.
// Without this, Next/Turbopack pulls @grpc/grpc-js into the client bundle
// just because a server component imports a string constant from this barrel.
import type { IkaDWalletClient } from './ika-vendor/grpc.ts';

export type Chain = 'bitcoin' | 'bitcoin-signet' | 'bitcoin-testnet';

export interface DWallet {
  id: string;
  chain: Chain;
  address: string;
}

export interface PolicyRule {
  kind: string;
  [k: string]: unknown;
}

export interface Policy {
  controller: string;
  maxAmountSats: bigint;
  expirySlots: number;
  rules: PolicyRule[];
}

const MODE_ENV = 'OBSIDIAN_IKA_MODE';

export type IkaMode = 'mock' | 'real';
export function currentMode(): IkaMode {
  return process.env[MODE_ENV] === 'real' ? 'real' : 'mock';
}

function unsupportedReal(api: string): never {
  throw new VendorSDKUnavailableError(
    'ika',
    `${api} is unavailable in real mode. The upstream ` +
      `@ika.xyz/pre-alpha-solana-client ships uncompiled .ts in its exports ` +
      `field; Node 24 refuses to strip TS from node_modules ` +
      `(ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING). See docs/gaps.md gap ` +
      `I0 for the closure plan. Run with OBSIDIAN_IKA_MODE=mock for now.`,
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Mock-mode in-process key store. Test/demo only — single process scope.
// Documented as gap I2 in docs/gaps.md.
// ────────────────────────────────────────────────────────────────────────────

interface MockEntry {
  /** Set in mock mode only — real-mode entries don't hold WIFs (the private
   *  share lives in the Ika network). */
  wif?: string;
  chain: Chain;
  address: string;
  /** Pubkey (or any opaque token) of the entity that created the dWallet.
   *  `lockPolicy` rejects callers that don't match. Stand-in for the proper
   *  Ika MPC owner check (gap I1). */
  creator?: string;
  policy?: Policy;
  policyAccountOnSolana?: string;
  /** Real-mode only: secp256k1 compressed dWallet public key from DKG. */
  publicKey?: Uint8Array;
}

const mockStore: Map<string, MockEntry> = new Map();

// Real-mode singleton client (lazy-initialised, env-overridable URL).
let realClientPromise: Promise<IkaDWalletClient> | null = null;
async function ikaRealClient(): Promise<IkaDWalletClient> {
  if (!realClientPromise) {
    realClientPromise = (async () => {
      const m = await import('./ika-vendor/grpc.ts');
      const url = process.env['OBSIDIAN_IKA_GRPC_URL'] ?? m.DEVNET_PRE_ALPHA_GRPC_URL;
      return m.createIkaClient(url);
    })();
  }
  return realClientPromise;
}

/** Decode a 32-byte hex string back to bytes. */
function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('hex length odd');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

function chainToBtcNetwork(chain: Chain): 'signet' | 'testnet' {
  if (chain === 'bitcoin-testnet') return 'testnet';
  // Treat both 'bitcoin' (mainnet) and 'bitcoin-signet' as signet in mock mode
  // — we never want mock to touch mainnet keys, even synthetically.
  return 'signet';
}

/** Canonical dWallet id format. 32 raw bytes hex-encoded — matches the size
 *  of an Ika dWallet PDA pubkey so it can be stored in `EncryptedOrder`'s
 *  `dwallet_id: Pubkey` field on-chain. */
function newDwalletId(): string {
  return crypto.randomBytes(32).toString('hex');
}

// ────────────────────────────────────────────────────────────────────────────
// Public API (matches the prompt-required signatures)
// ────────────────────────────────────────────────────────────────────────────

export async function createDWallet(
  chain: Chain,
  options: { creator?: string } = {},
): Promise<DWallet> {
  const network = chainToBtcNetwork(chain);
  if (currentMode() === 'real') {
    // Bind the DKG to the creator's Solana pubkey so the same caller is
    // identifiable on subsequent presign / sign calls.
    if (!options.creator) {
      throw new VendorSDKUnavailableError(
        'ika',
        'real-mode createDWallet requires a creator wallet pubkey',
      );
    }
    const senderPubkey = solanaPubkeyToBytes(options.creator);
    const client = await ikaRealClient();
    const dkg = await client.requestDKG(senderPubkey);
    // `id` for the dWallet = hex of the secp256k1 public key. This matches
    // the pre-alpha network's dwallet identity surface (the on-chain dwallet
    // PDA is derived from `(curve_u16_le, public_key)` per the docs).
    const id = bytesToHex(dkg.publicKey);
    const address = p2wpkhAddressFromPublicKey(dkg.publicKey, network);
    mockStore.set(id, {
      chain,
      address,
      creator: options.creator,
      publicKey: dkg.publicKey,
    });
    return { id, chain, address };
  }
  const { wif, address } = generateP2wpkh(network);
  const id = newDwalletId();
  mockStore.set(id, { wif, chain, address, creator: options.creator });
  return { id, chain, address };
}

/**
 * Decode a base58 Solana pubkey to its 32-byte form using @solana/web3.js
 * (already a workspace dep via keeper). Lazy-imported so the SDK stays
 * tree-shakable for clients that don't touch real-mode.
 */
function solanaPubkeyToBytes(b58: string): Uint8Array {
  // bs58 alphabet — small inline impl avoids pulling @solana/web3.js into
  // the SDK's import graph just for one decode.
  const ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n;
  for (const c of b58) {
    const idx = ALPHA.indexOf(c);
    if (idx < 0) throw new Error('invalid base58 char');
    n = n * 58n + BigInt(idx);
  }
  // Pad to 32 bytes (Solana pubkeys are exactly 32B; leading zeros encode as '1').
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  // Account for leading-zero pad bytes encoded as '1' chars.
  let zeros = 0;
  for (const c of b58) {
    if (c === '1') zeros++;
    else break;
  }
  if (zeros > 0 && out.slice(0, zeros).some((x) => x !== 0)) {
    // High bytes already non-zero — nothing to do.
  }
  return out;
}

export async function lockPolicy(
  dwalletId: string,
  policy: Policy,
  options: { caller?: string } = {},
): Promise<{ policyAccountOnSolana: string }> {
  if (currentMode() === 'real') {
    // Pre-alpha Ika devnet doesn't yet expose a gRPC `LockPolicy` op — the
    // policy enforcement happens on the Solana Ika program side via the
    // dWallet PDA's authority field. For the real-mode integration we
    // simply persist the policy intent locally; the on-chain Ika program
    // call lives in `programs/obsidian-core` (gap I3 closure plan).
    const entry = mockStore.get(dwalletId);
    if (!entry) {
      throw new VendorSDKUnavailableError(
        'ika',
        'real lockPolicy: dWallet not found in this process — was it created here?',
      );
    }
    if (entry.creator !== undefined && entry.creator !== options.caller) {
      throw new VendorSDKUnavailableError(
        'ika',
        'real lockPolicy: caller is not the dWallet creator',
      );
    }
    // Deterministic placeholder policy account — replaced by the real
    // on-chain account pubkey once the Ika program LockPolicy ix is wired.
    const hash = crypto
      .createHash('sha256')
      .update(`${dwalletId}|${policy.controller}|${policy.maxAmountSats.toString()}`)
      .digest();
    const policyAccountOnSolana = `ika_pending_${hash.subarray(0, 16).toString('hex')}`;
    mockStore.set(dwalletId, { ...entry, policy, policyAccountOnSolana });
    return { policyAccountOnSolana };
  }
  const entry = mockStore.get(dwalletId);
  if (!entry) {
    throw new VendorSDKUnavailableError(
      'ika',
      `mock lockPolicy: dWallet not found in process-local store ` +
        `(was it created in this process? see gap I2)`,
    );
  }
  // Owner-binding check. If the dWallet was created with a `creator` token,
  // only that same token may lock its policy. Stand-in for Ika MPC owner
  // verification (gap I1) — proper closure requires wallet-signed nonce.
  if (entry.creator !== undefined && entry.creator !== options.caller) {
    throw new VendorSDKUnavailableError(
      'ika',
      `mock lockPolicy: caller is not the dWallet creator`,
    );
  }
  // Fake but deterministic policy account address derived from id + controller.
  const hash = crypto
    .createHash('sha256')
    .update(`${dwalletId}|${policy.controller}|${policy.maxAmountSats.toString()}`)
    .digest();
  const policyAccountOnSolana = `mock_policy_${hash.subarray(0, 16).toString('hex')}`;
  mockStore.set(dwalletId, { ...entry, policy, policyAccountOnSolana });
  return { policyAccountOnSolana };
}

export async function requestSign(
  dwalletId: string,
  btcTx: BtcUnsignedTx,
  solanaProof: { txSignature: string; matchId: bigint },
): Promise<{ signedTxHex: string; broadcastTxid?: string }> {
  if (currentMode() === 'real') {
    const entry = mockStore.get(dwalletId);
    if (!entry || !entry.publicKey) {
      throw new VendorSDKUnavailableError(
        'ika',
        'real requestSign: dWallet missing publicKey — was it created in this process?',
      );
    }
    if (!entry.policy) {
      throw new VendorSDKUnavailableError(
        'ika',
        'real requestSign: no locked policy on this dWallet',
      );
    }
    // Real-mode policy enforcement still runs client-side: the Ika network
    // pre-alpha doesn't enforce per-tx limits without the on-chain Ika
    // program LockPolicy ix being committed. Closure tracked under gap I3.
    for (const out of btcTx.outputs) {
      if (out.valueSats > entry.policy.maxAmountSats) {
        throw new VendorSDKUnavailableError(
          'ika',
          'real requestSign: output value exceeds policy.maxAmountSats',
        );
      }
    }
    // The dWallet "address" used by the Ika gRPC isn't the BTC address —
    // it's the secp256k1 public key bytes (which act as the dWallet PDA
    // identity per the docs §pda-seeds). `entry.publicKey` is exactly
    // those bytes.
    const senderPubkey = solanaPubkeyToBytes(entry.creator!);
    const dwalletAddrBytes = entry.publicKey;
    const client = await ikaRealClient();
    const presignId = await client.requestPresign(senderPubkey, dwalletAddrBytes);
    // Hash the BTC tx for ECDSA signing. For now we sign the raw PSBT
    // serialization; production should hash exactly the sighash the BTC
    // network expects (BIP-143 for P2WPKH).
    const message = Buffer.from(btcTx.psbt, 'base64');
    const txSignatureBytes = hexToBytes(solanaProof.txSignature.padStart(128, '0').slice(0, 128));
    const sig = await client.requestSign(
      senderPubkey,
      dwalletAddrBytes,
      message,
      presignId,
      txSignatureBytes,
    );
    // Real-mode mock signatures from pre-alpha Ika are not yet bitcoinjs-lib
    // verifiable, so we surface the raw network signature as the proof and
    // leave PSBT finalization to a later closure step (gap I1 production).
    return { signedTxHex: bytesToHex(sig) };
  }
  const entry = mockStore.get(dwalletId);
  if (!entry) {
    throw new VendorSDKUnavailableError(
      'ika',
      `mock requestSign: dWallet not found in process-local store (gap I2)`,
    );
  }
  if (!entry.policy) {
    throw new VendorSDKUnavailableError(
      'ika',
      `mock requestSign: dWallet ${dwalletId.slice(0, 16)}… has no locked policy`,
    );
  }
  // Soft-enforce the locked policy. Real Ika enforcement is on-chain via
  // dWallet message-approval verification (gap I3).
  for (const out of btcTx.outputs) {
    if (out.valueSats > entry.policy.maxAmountSats) {
      throw new VendorSDKUnavailableError(
        'ika',
        `mock requestSign: output value exceeds policy.maxAmountSats`,
      );
    }
  }
  if (!entry.wif) {
    throw new VendorSDKUnavailableError(
      'ika',
      'mock requestSign: dWallet has no WIF (was it created in real mode?)',
    );
  }
  const key = fromWIF(entry.wif, btcTx.network);
  const signedTxHex = signAndFinalize(btcTx, key);
  // No broadcast in mock mode — pass solanaProof through untouched so the
  // keeper can use matchId/txSignature for on-chain finalize.
  void solanaProof;
  return { signedTxHex };
}

// ────────────────────────────────────────────────────────────────────────────
// Test-only inspection / management helpers (mock mode only)
// ────────────────────────────────────────────────────────────────────────────

/** Number of dWallets currently in the mock store. */
export function _mockSize(): number {
  return mockStore.size;
}

/** Drop all mock dWallets — call between tests for isolation. */
export function _mockReset(): void {
  mockStore.clear();
}

/** Return the BTC address for a mock dWallet without exposing the WIF. */
export function _mockAddressOf(dwalletId: string): string | undefined {
  return mockStore.get(dwalletId)?.address;
}
