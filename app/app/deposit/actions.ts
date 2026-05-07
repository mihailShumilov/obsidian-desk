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

import { ika, DEFAULT_ORDER_EXPIRY_SLOTS } from '@obsidian-desk/sdk';

const PROGRAM_ID =
  process.env['NEXT_PUBLIC_OBSIDIAN_PROGRAM_ID'] ??
  'H25yY5o4emorZ9qMHAUvJhdtrFjDSeYy2MVYurpQbeLp';

const ESPLORA_URL =
  process.env['OBSIDIAN_ESPLORA_URL'] ??
  'https://mempool.space/signet/api';

export interface CreateDWalletResult {
  id: string;
  chain: string;
  address: string;
}

export async function createDWalletAction(): Promise<CreateDWalletResult> {
  const dw = await ika.createDWallet('bitcoin-signet');
  return { id: dw.id, chain: dw.chain, address: dw.address };
}

export interface LockPolicyResult {
  policyAccountOnSolana: string;
}

export async function lockPolicyAction(
  dwalletId: string,
  maxAmountSats: string,
): Promise<LockPolicyResult> {
  const result = await ika.lockPolicy(dwalletId, {
    controller: PROGRAM_ID,
    maxAmountSats: BigInt(maxAmountSats),
    expirySlots: DEFAULT_ORDER_EXPIRY_SLOTS,
    rules: [],
  });
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
 * Fetch address balance from esplora. Returns 0 across the board on any
 * network failure or non-2xx — the wizard surfaces "—" or "0" gracefully
 * rather than crashing the page.
 */
export async function getAddressBalanceAction(
  address: string,
): Promise<AddressBalance> {
  try {
    const res = await fetch(`${ESPLORA_URL}/address/${encodeURIComponent(address)}`, {
      cache: 'no-store',
      // Esplora can be slow; cap the wait so a hung request doesn't hang
      // the wizard's 15s polling loop.
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      return { confirmedSats: '0', unconfirmedSats: '0', totalSats: '0' };
    }
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
    return { confirmedSats: '0', unconfirmedSats: '0', totalSats: '0' };
  }
}
