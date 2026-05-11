'use server';

/**
 * Server actions for the /deposit wizard. These run on the Next.js server
 * (Node 24), so they can import the Node-only SDK (which uses bitcoinjs-lib
 * and node:crypto under the hood).
 *
 * In the P4/P8 scaffold the SDK is in mock mode — the dWallet keys live
 * in a process-local Map, so this only "works" within a single Next.js
 * dev server instance. P9 swaps to a persistent Ika gRPC backend.
 *
 * Esplora calls real signet to fetch live balances. Override the endpoint
 * with `OBSIDIAN_ESPLORA_URL` (defaults to mempool.space's signet API).
 */

import {
  DEFAULT_ORDER_EXPIRY_SLOTS,
  DEFAULT_OBSIDIAN_PROGRAM_ID,
  assertNotMockOnMainnet,
} from '@obsidian-desk/sdk';
// Subpath import keeps the gRPC-pulling code out of the barrel's reachable
// graph (Turbopack would otherwise try to bundle it for the client).
import * as ika from '@obsidian-desk/sdk/ika';

// Trip the safety guard at module-evaluation time. If the deployed Next
// server is mis-pointed at a mainnet RPC while still in mock mode, the
// first import of this module crashes the worker rather than serving
// any deposit traffic.
assertNotMockOnMainnet({
  encryptMode: process.env['OBSIDIAN_ENCRYPT_MODE'],
  ikaMode: process.env['OBSIDIAN_IKA_MODE'],
  rpc: process.env['NEXT_PUBLIC_SOLANA_RPC'] ?? process.env['SOLANA_RPC'],
  network: process.env['NEXT_PUBLIC_NETWORK'],
});

const PROGRAM_ID =
  process.env['NEXT_PUBLIC_OBSIDIAN_PROGRAM_ID'] ?? DEFAULT_OBSIDIAN_PROGRAM_ID;

const ESPLORA_URL =
  process.env['OBSIDIAN_ESPLORA_URL'] ??
  'https://mempool.space/signet/api';

export interface CreateDWalletResult {
  id: string;
  chain: string;
  address: string;
  /** Solana pubkey of the wallet that created this dWallet — bound at
   *  creation time so the UI can refuse to surface it under a different
   *  connected wallet. Same value the client passed in; round-tripped so
   *  the client doesn't need to remember it separately. */
  creator: string;
  /** 'real-ok' if the dWallet was created via Ika MPC DKG, 'real-failed-fallback'
   *  if Ika was unreachable and we synthesised a local key, 'mock' if explicit
   *  mock mode. UI badges show this so users know whether their dWallet is
   *  network-held or process-local. */
  mode: 'real-ok' | 'real-failed-fallback' | 'mock';
}

/**
 * `walletPubkey` is the Phantom-connected Solana pubkey from the client.
 * It binds the dWallet to the caller: subsequent `lockPolicyAction` calls
 * must pass the same pubkey or be rejected.
 *
 * This is NOT a signature check — anyone could pass any pubkey. Real
 * ownership verification arrives with on-chain MessageApproval (gap I3
 * closure). Until then, the binding limits grief to "attacker who knows
 * both the dwallet id AND the original creator's wallet pubkey".
 */
export async function createDWalletAction(
  walletPubkey: string,
): Promise<CreateDWalletResult> {
  if (typeof walletPubkey !== 'string' || walletPubkey.length === 0) {
    throw new Error('createDWalletAction: walletPubkey is required');
  }
  const dw = await ika.createDWallet('bitcoin-signet', { creator: walletPubkey });
  return {
    id: dw.id,
    chain: dw.chain,
    address: dw.address,
    creator: walletPubkey,
    mode: dw.mode,
  };
}

export interface LockPolicyResult {
  policyAccountOnSolana: string;
  mode: 'real-ok' | 'real-failed-fallback' | 'mock';
}

export async function lockPolicyAction(
  dwalletId: string,
  maxAmountSats: string,
  walletPubkey: string,
): Promise<LockPolicyResult> {
  if (typeof walletPubkey !== 'string' || walletPubkey.length === 0) {
    throw new Error('lockPolicyAction: walletPubkey is required');
  }
  const result = await ika.lockPolicy(
    dwalletId,
    {
      controller: PROGRAM_ID,
      maxAmountSats: BigInt(maxAmountSats),
      expirySlots: DEFAULT_ORDER_EXPIRY_SLOTS,
      rules: [],
    },
    { caller: walletPubkey },
  );
  return {
    policyAccountOnSolana: result.policyAccountOnSolana,
    mode: result.mode,
  };
}

export interface AddressBalance {
  /** Confirmed sats. */
  confirmedSats: string;
  /** Unconfirmed (mempool) sats. */
  unconfirmedSats: string;
  /** Combined (confirmed + unconfirmed). */
  totalSats: string;
  /** UNIX seconds of the latest signet block. Used by the UI to compute
   *  a "next block in ~Xm" ETA next to pending balances. Undefined when
   *  the tip lookup failed (caller renders without ETA). */
  tipTimestamp?: number;
}

interface EsploraStats {
  funded_txo_sum: number;
  spent_txo_sum: number;
}
interface EsploraAddress {
  chain_stats: EsploraStats;
  mempool_stats: EsploraStats;
}

/**
 * Signet bech32 P2WPKH (`tb1q…` 42 chars) or P2TR (`tb1p…` 62 chars).
 * Reject anything else so the action can't be used to amplify load against
 * mempool.space with arbitrary path segments.
 */
const SIGNET_BECH32_RE = /^tb1[02-9ac-hj-np-z]{38,62}$/;

const ZERO_BALANCE: AddressBalance = {
  confirmedSats: '0',
  unconfirmedSats: '0',
  totalSats: '0',
};

/**
 * Fetch address balance from esplora. Returns 0 across the board on any
 * network failure or non-2xx — the wizard surfaces "—" or "0" gracefully
 * rather than crashing the page. The fetch uses Next's revalidate cache
 * keyed on URL so concurrent tabs viewing the same dWallet share one
 * upstream call (TTL 10s, shorter than the client's 15s poll).
 *
 * Also fetches the chain tip timestamp (best-effort, no failure path) so
 * the UI can render an ETA next to pending balances.
 */
export async function getAddressBalanceAction(
  address: string,
): Promise<AddressBalance> {
  if (!SIGNET_BECH32_RE.test(address)) return ZERO_BALANCE;
  try {
    const [balanceRes, tipTs] = await Promise.all([
      fetch(`${ESPLORA_URL}/address/${encodeURIComponent(address)}`, {
        next: { revalidate: 10, tags: [`esplora:${address}`] },
        signal: AbortSignal.timeout(8_000),
      }),
      fetchSignetTipTimestamp(),
    ]);
    if (!balanceRes.ok) return { ...ZERO_BALANCE, tipTimestamp: tipTs };
    const json = (await balanceRes.json()) as EsploraAddress;
    const confirmed = BigInt(
      json.chain_stats.funded_txo_sum - json.chain_stats.spent_txo_sum,
    );
    const unconfirmed = BigInt(
      json.mempool_stats.funded_txo_sum - json.mempool_stats.spent_txo_sum,
    );
    return {
      confirmedSats: confirmed.toString(),
      unconfirmedSats: unconfirmed.toString(),
      totalSats: (confirmed + unconfirmed).toString(),
      tipTimestamp: tipTs,
    };
  } catch {
    return ZERO_BALANCE;
  }
}

/**
 * Best-effort fetch of the latest signet block's UNIX timestamp via two
 * sequential esplora calls (`/blocks/tip/hash` → `/block/<hash>`). Cached
 * via Next's revalidate so concurrent balance polls share one upstream
 * roundtrip. Returns undefined on any failure — caller renders without
 * the ETA chip rather than crashing.
 */
async function fetchSignetTipTimestamp(): Promise<number | undefined> {
  try {
    const hashRes = await fetch(`${ESPLORA_URL}/blocks/tip/hash`, {
      next: { revalidate: 30, tags: ['esplora:tip'] },
      signal: AbortSignal.timeout(5_000),
    });
    if (!hashRes.ok) return undefined;
    const hash = (await hashRes.text()).trim();
    if (!/^[0-9a-f]{64}$/.test(hash)) return undefined;
    const blockRes = await fetch(`${ESPLORA_URL}/block/${hash}`, {
      next: { revalidate: 30, tags: [`esplora:block:${hash}`] },
      signal: AbortSignal.timeout(5_000),
    });
    if (!blockRes.ok) return undefined;
    const block = (await blockRes.json()) as { timestamp?: number };
    return typeof block.timestamp === 'number' ? block.timestamp : undefined;
  } catch {
    return undefined;
  }
}
