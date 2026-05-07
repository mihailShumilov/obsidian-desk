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
import { signAndFinalize, generateP2wpkh, fromWIF, type BtcUnsignedTx } from './btc.ts';
import { VendorSDKUnavailableError } from './errors.ts';

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
  wif: string;
  chain: Chain;
  address: string;
  /** Pubkey (or any opaque token) of the entity that created the dWallet.
   *  `lockPolicy` rejects callers that don't match. Stand-in for the proper
   *  Ika MPC owner check (gap I1). */
  creator?: string;
  policy?: Policy;
  policyAccountOnSolana?: string;
}

const mockStore: Map<string, MockEntry> = new Map();

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
  if (currentMode() === 'real') unsupportedReal('createDWallet');
  const network = chainToBtcNetwork(chain);
  const { wif, address } = generateP2wpkh(network);
  const id = newDwalletId();
  mockStore.set(id, { wif, chain, address, creator: options.creator });
  return { id, chain, address };
}

export async function lockPolicy(
  dwalletId: string,
  policy: Policy,
  options: { caller?: string } = {},
): Promise<{ policyAccountOnSolana: string }> {
  if (currentMode() === 'real') unsupportedReal('lockPolicy');
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
  if (currentMode() === 'real') unsupportedReal('requestSign');
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
