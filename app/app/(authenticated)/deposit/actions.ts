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
  ika,
  DEFAULT_ORDER_EXPIRY_SLOTS,
  DEFAULT_OBSIDIAN_PROGRAM_ID,
  assertNotMockOnMainnet,
} from '@obsidian-desk/sdk';

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
}

/**
 * `walletPubkey` is the Phantom-connected Solana pubkey from the client.
 * In mock mode it acts as the creator-binding token: subsequent
 * `lockPolicyAction` calls must pass the same pubkey or be rejected.
 *
 * This is NOT a signature check — anyone could pass any pubkey. Real
 * ownership verification arrives with Ika MPC (gap I1, closure plan in
 * docs/gaps.md). Until then, the binding limits grief to "attacker who
 * knows both the dwallet id AND the original creator's wallet pubkey".
 */
export async function createDWalletAction(
  walletPubkey: string,
): Promise<CreateDWalletResult> {
  if (typeof walletPubkey !== 'string' || walletPubkey.length === 0) {
    throw new Error('createDWalletAction: walletPubkey is required');
  }
  const dw = await ika.createDWallet('bitcoin-signet', { creator: walletPubkey });
  return { id: dw.id, chain: dw.chain, address: dw.address };
}

export interface LockPolicyResult {
  policyAccountOnSolana: string;
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
  return { policyAccountOnSolana: result.policyAccountOnSolana };
}

export interface AddressBalance {
  /** Confirmed sats. */
  confirmedSats: string;
  /** Unconfirmed (mempool) sats. */
  unconfirmedSats: string;
  /** Combined (confirmed + unconfirmed). */
  totalSats: string;
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
 */
export async function getAddressBalanceAction(
  address: string,
): Promise<AddressBalance> {
  if (!SIGNET_BECH32_RE.test(address)) return ZERO_BALANCE;
  try {
    const res = await fetch(`${ESPLORA_URL}/address/${encodeURIComponent(address)}`, {
      next: { revalidate: 10, tags: [`esplora:${address}`] },
      // Esplora can be slow; cap the wait so a hung request doesn't hang
      // the wizard's 15s polling loop.
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return ZERO_BALANCE;
    const json = (await res.json()) as EsploraAddress;
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
    };
  } catch {
    return ZERO_BALANCE;
  }
}
