/**
 * Shared bootstrap for the obsidian-core integration suite.
 *
 * Mocha files import these helpers so the provider rebuild + market init
 * pattern lives in exactly one place — duplicating it across four files
 * has historically led to subtle skews (e.g. forgotten `_mockReset` or
 * inconsistent commitment levels).
 */

import * as anchor from '@coral-xyz/anchor';
import type { Program } from '@coral-xyz/anchor';
import { Keypair, PublicKey } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import * as btcSdk from '../sdk/src/btc.ts';
import type { SpendInput } from '../sdk/src/btc.ts';
import type { ObsidianCore } from '../target/types/obsidian_core';

/**
 * Anchor's default `processed` commitment returns blockhashes the validator
 * hasn't finalized yet, which trips a "Blockhash not found" preflight on
 * the first tx after a fresh validator start. We rebuild the env provider
 * with `confirmed` everywhere.
 */
export function setupConfirmedProvider(): {
  provider: anchor.AnchorProvider;
  program: Program<ObsidianCore>;
} {
  const envProvider = anchor.AnchorProvider.env();
  const connection = new anchor.web3.Connection(
    envProvider.connection.rpcEndpoint,
    'confirmed',
  );
  const provider = new anchor.AnchorProvider(connection, envProvider.wallet, {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  });
  anchor.setProvider(provider);
  const program = anchor.workspace.obsidianCore as Program<ObsidianCore>;
  return { provider, program };
}

export interface FreshMarket {
  market: PublicKey;
  marketBump: number;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  settleVault: PublicKey;
  ikaPolicy: PublicKey;
}

/**
 * Generate fresh mint/vault/policy pubkeys, derive the market PDA, and
 * call `initializeMarket`. Returns the resolved accounts so the suite can
 * thread them into subsequent instructions.
 */
export async function bootstrapFreshMarket(
  program: Program<ObsidianCore>,
  admin: PublicKey,
): Promise<FreshMarket> {
  const baseMint = Keypair.generate().publicKey;
  const quoteMint = Keypair.generate().publicKey;
  const settleVault = Keypair.generate().publicKey;
  const ikaPolicy = Keypair.generate().publicKey;
  const [market, marketBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('market'), baseMint.toBuffer(), quoteMint.toBuffer()],
    program.programId,
  );
  await program.methods
    .initializeMarket(baseMint, quoteMint)
    .accountsPartial({
      market,
      settleVault,
      ikaPolicy,
      admin,
    })
    .rpc({ commitment: 'confirmed' });
  return { market, marketBump, baseMint, quoteMint, settleVault, ikaPolicy };
}

/**
 * Synthetic UTXO provider for keeper poll runs in mock mode. Derives the
 * txid deterministically from the address so two test runs that hit the
 * same mock dWallet see the same UTXO; valueSats is hardcoded at 1 BTC
 * which is more than any test settles.
 */
export function mockUtxoProvider(address: string): SpendInput {
  const h = createHash('sha256').update(address).digest('hex');
  return {
    txid: h,
    vout: 0,
    valueSats: 100_000_000n,
    scriptPubKeyHex: btcSdk.scriptForAddress(address, 'signet'),
  };
}
