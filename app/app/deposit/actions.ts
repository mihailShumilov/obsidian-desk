'use server';

/**
 * Server actions for the /deposit wizard. These run on the Next.js server
 * (Node 24), so they can import the Node-only SDK (which uses bitcoinjs-lib
 * and node:crypto under the hood).
 *
 * In the P4 scaffold the SDK is in mock mode — the dWallet keys live in a
 * process-local Map, so this only "works" within a single Next.js dev
 * server instance. P8 polishes the wizard; P9/P10 swap to a real Ika
 * gRPC + persistent store.
 */

import { ika } from '@obsidian-desk/sdk';

const PROGRAM_ID =
  process.env['NEXT_PUBLIC_OBSIDIAN_PROGRAM_ID'] ??
  'H25yY5o4emorZ9qMHAUvJhdtrFjDSeYy2MVYurpQbeLp';

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
  // ~24h on devnet (~400ms slots).
  const expirySlots = 216_000;
  const result = await ika.lockPolicy(dwalletId, {
    controller: PROGRAM_ID,
    maxAmountSats: BigInt(maxAmountSats),
    expirySlots,
    rules: [],
  });
  return { policyAccountOnSolana: result.policyAccountOnSolana };
}
