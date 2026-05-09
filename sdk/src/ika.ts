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
import {
  attachExternalEcdsaSig,
  bip143SighashForP2WPKH,
  finalizePsbt,
  fromWIF,
  generateP2wpkh,
  p2wpkhAddressFromPublicKey,
  signAndFinalize,
  type BtcUnsignedTx,
} from './btc.ts';
import { VendorSDKUnavailableError } from './errors.ts';
import { defaultMockStore, type MockEntry, type MockStore } from './mock-store.ts';
import { resolveMode, tryReal, type Mode, type ResolvedMode } from './mode.ts';
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

/**
 * Tri-state Ika mode (`mock` | `real` | `auto`). `auto` (the default) tries
 * real first and falls back to mock on transient failure — see sdk/src/mode.ts.
 *
 * Legacy `IkaMode` alias preserved for code that already destructured it;
 * `currentMode()` now returns the unioned tri-state value.
 */
export type IkaMode = Mode;

export function currentMode(): IkaMode {
  return resolveMode('ika');
}

// ────────────────────────────────────────────────────────────────────────────
// File-backed key store. Closes enough of gap I2 to let the Next.js deposit
// page and the keeper container share dWallets across processes — both ends
// open the same `~/.obsidian-mock-keys.json` (or whatever
// `OBSIDIAN_MOCK_STORE_PATH` points to).
//
// Tests can swap the store via `setStoreForTesting()` so they don't pollute
// the real default file.
// ────────────────────────────────────────────────────────────────────────────

let store: MockStore = defaultMockStore();

/** Test seam — replace the default store with a temp-file-backed instance. */
export function setStoreForTesting(s: MockStore): void {
  store = s;
}

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

/**
 * `createDWallet` — try real Ika DKG first (in `auto` mode); fall back to a
 * locally-synthesised P2WPKH key if the pre-alpha network is unreachable.
 * The returned `mode` field tells the caller which path produced the dWallet
 * so the UI can badge it.
 */
export interface CreateDWalletResult extends DWallet {
  mode: ResolvedMode;
}

export async function createDWallet(
  chain: Chain,
  options: { creator?: string } = {},
): Promise<CreateDWalletResult> {
  const network = chainToBtcNetwork(chain);
  const mode = currentMode();

  // Real mode requires a creator binding; mock will use the caller's
  // creator only if provided (legacy callers may omit it).
  if (mode === 'real' && !options.creator) {
    throw new VendorSDKUnavailableError(
      'ika',
      'real-mode createDWallet requires a creator wallet pubkey',
    );
  }

  const r = await tryReal<DWallet>({
    surface: 'ika',
    op: 'createDWallet',
    mode,
    timeoutMs: 15_000, // DKG runs an MPC ceremony — give it more headroom.
    real: async () => {
      // `creator` is required in real mode; throw before we hit the network
      // so the error is logical (not transient → no fallback in auto mode
      // either, since it's our bug not the network's).
      if (!options.creator) {
        throw new VendorSDKUnavailableError(
          'ika',
          'real createDWallet: creator wallet pubkey missing',
        );
      }
      const senderPubkey = solanaPubkeyToBytes(options.creator);
      const client = await ikaRealClient();
      const dkg = await client.requestDKG(senderPubkey);
      const id = bytesToHex(dkg.publicKey);
      const address = p2wpkhAddressFromPublicKey(dkg.publicKey, network);
      store.set(id, {
        chain,
        address,
        creator: options.creator,
        publicKey: dkg.publicKey,
      });
      return { id, chain, address };
    },
    mock: async () => {
      const { wif, address } = generateP2wpkh(network);
      const id = newDwalletId();
      store.set(id, { wif, chain, address, creator: options.creator });
      return { id, chain, address };
    },
  });

  return { ...r.value, mode: r.mode };
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
  if (b58.length === 0) throw new Error('invalid base58: empty string');
  let n = 0n;
  for (const c of b58) {
    const idx = ALPHA.indexOf(c);
    if (idx < 0) throw new Error('invalid base58 char');
    n = n * 58n + BigInt(idx);
  }
  // A Solana pubkey is exactly 32 bytes; any decode that overflows is not a
  // valid pubkey. Reject explicitly rather than silently truncating high bits
  // in the byte-write loop below — base58 alphabets accept arbitrary lengths
  // so a typo or wrong-length input would otherwise produce 32 bytes of
  // unrelated value.
  if (n >> 256n !== 0n) {
    throw new Error('invalid base58: decoded value exceeds 32 bytes');
  }
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

/**
 * `lockPolicy` — same surface in mock + real today (the pre-alpha Ika gRPC
 * doesn't yet expose a LockPolicy op; the policy intent is persisted locally
 * and the on-chain enforcement is gap I3). Both paths perform the same
 * creator-binding check and write a deterministic policy-account placeholder
 * — so `tryReal` would just route to the same code. We skip the wrapper
 * here and surface a static `mode` derived from the env, but still log
 * structured.
 */
export async function lockPolicy(
  dwalletId: string,
  policy: Policy,
  options: { caller?: string } = {},
): Promise<{ policyAccountOnSolana: string; mode: ResolvedMode }> {
  const entry = store.get(dwalletId);
  if (!entry) {
    throw new VendorSDKUnavailableError(
      'ika',
      `lockPolicy: dWallet not found in store at ${store.path()} ` +
        `(gap I2 — was it created from a process pointing at this same store?)`,
    );
  }
  if (entry.creator !== undefined && entry.creator !== options.caller) {
    throw new VendorSDKUnavailableError(
      'ika',
      'lockPolicy: caller is not the dWallet creator',
    );
  }
  const mode = currentMode();
  const isReal = mode === 'real';
  const prefix = isReal ? 'ika_pending_' : 'mock_policy_';
  const hash = crypto
    .createHash('sha256')
    .update(`${dwalletId}|${policy.controller}|${policy.maxAmountSats.toString()}`)
    .digest();
  const policyAccountOnSolana = `${prefix}${hash.subarray(0, 16).toString('hex')}`;
  store.set(dwalletId, { ...entry, policy, policyAccountOnSolana });
  // Logical mode marker: the operation is "real-ok" when env is real, mock
  // otherwise. This is purely informational since both code paths are
  // identical until gap I3 closes.
  return {
    policyAccountOnSolana,
    mode: isReal ? 'real-ok' : 'mock',
  };
}

/**
 * `requestSign` — produces a signed, broadcast-ready BTC tx hex for `btcTx`,
 * spending from the `dwalletId` dWallet to the recipient(s) embedded in
 * the PSBT.
 *
 * Modes:
 *   - `mock`: bitcoinjs-lib single-key signs with the WIF in the store.
 *   - `real`: requestPresign → requestSign against the pre-alpha Ika gRPC,
 *             with the BIP-143 sighash as the message digest. The returned
 *             64-byte (r||s) is normalised to low-s, DER-encoded, attached
 *             to the PSBT as a partial sig, then finalised. Local sig
 *             verification gates the attach — if the network applied an
 *             unexpected hash_scheme, we throw rather than emitting a
 *             tx signet would reject.
 *   - `auto` (default): try real, fall back to mock on transient failure.
 *
 * Both paths enforce the locked policy's `maxAmountSats` ceiling client-side
 * (gap I3 will move this to on-chain enforcement).
 */
export async function requestSign(
  dwalletId: string,
  btcTx: BtcUnsignedTx,
  solanaProof: { txSignature: string; matchId: bigint },
): Promise<{ signedTxHex: string; broadcastTxid?: string; mode: ResolvedMode }> {
  const entry = store.get(dwalletId);
  if (!entry) {
    throw new VendorSDKUnavailableError(
      'ika',
      `requestSign: dWallet not found in store at ${store.path()} (gap I2)`,
    );
  }
  if (!entry.policy) {
    throw new VendorSDKUnavailableError(
      'ika',
      `requestSign: dWallet ${dwalletId.slice(0, 16)}… has no locked policy`,
    );
  }
  // Policy enforcement (client-side; gap I3 will move on-chain).
  for (const out of btcTx.outputs) {
    if (out.valueSats > entry.policy.maxAmountSats) {
      throw new VendorSDKUnavailableError(
        'ika',
        `requestSign: output value ${out.valueSats} exceeds policy.maxAmountSats ${entry.policy.maxAmountSats}`,
      );
    }
  }

  const r = await tryReal<{ signedTxHex: string }>({
    surface: 'ika',
    op: 'requestSign',
    mode: currentMode(),
    timeoutMs: 25_000, // presign + sign is two MPC rounds; give them headroom.
    real: async () => {
      if (!entry.publicKey) {
        // Logical: the dWallet was created in mock mode, so we have no Ika
        // network identity for it. Throw — auto-fallback won't help.
        throw new VendorSDKUnavailableError(
          'ika',
          'real requestSign: dWallet has no publicKey (created in mock mode)',
        );
      }
      if (!entry.creator) {
        throw new VendorSDKUnavailableError(
          'ika',
          'real requestSign: dWallet has no creator binding',
        );
      }
      const senderPubkey = solanaPubkeyToBytes(entry.creator);
      const dwalletAddrBytes = entry.publicKey;
      const client = await ikaRealClient();

      // BIP-143 sighash for input 0. The keeper's buildSpendTx always emits
      // a single-input PSBT against the seller's dWallet; multi-input would
      // require iterating + multi-message MessageApproval (gap I1+).
      const sighash = bip143SighashForP2WPKH(btcTx.psbt, 0, btcTx.network);

      const presignId = await client.requestPresign(senderPubkey, dwalletAddrBytes);
      const txSignatureBytes = hexToBytes(
        solanaProof.txSignature.padStart(128, '0').slice(0, 128),
      );
      const sigBytes = await client.requestSign(
        senderPubkey,
        dwalletAddrBytes,
        Uint8Array.from(sighash),
        presignId,
        txSignatureBytes,
      );

      if (sigBytes.length !== 64) {
        throw new Error(
          `real requestSign: expected 64B (r||s) from Ika, got ${sigBytes.length}`,
        );
      }

      // Attach + verify (throws if the network's signature doesn't bind to
      // our BIP-143 sighash + dwallet pubkey). Then finalise.
      const updatedPsbt = attachExternalEcdsaSig(
        btcTx.psbt,
        0,
        entry.publicKey,
        sigBytes,
        btcTx.network,
      );
      const signedTxHex = finalizePsbt(updatedPsbt, btcTx.network);
      return { signedTxHex };
    },
    mock: async () => {
      if (!entry.wif) {
        throw new VendorSDKUnavailableError(
          'ika',
          'mock requestSign: dWallet has no WIF (created in real mode? auto fallback may be impossible here)',
        );
      }
      const key = fromWIF(entry.wif, btcTx.network);
      const signedTxHex = signAndFinalize(btcTx, key);
      return { signedTxHex };
    },
  });

  // solanaProof is consumed by Ika's `Sign` request (`approval_proof`); for
  // mock paths we ignore it. Either way, the keeper uses matchId on-chain
  // when calling `finalize_settlement`.
  void solanaProof;

  return { signedTxHex: r.value.signedTxHex, mode: r.mode };
}

// ────────────────────────────────────────────────────────────────────────────
// Test-only inspection / management helpers (mock mode only)
// ────────────────────────────────────────────────────────────────────────────

/** Number of dWallets currently in the store (reads from disk). */
export function _mockSize(): number {
  return store.size();
}

/** Drop the persisted store file — call between tests for isolation. */
export function _mockReset(): void {
  store.reset();
}

/** Return the BTC address for a mock dWallet without exposing the WIF. */
export function _mockAddressOf(dwalletId: string): string | undefined {
  return store.get(dwalletId)?.address;
}
