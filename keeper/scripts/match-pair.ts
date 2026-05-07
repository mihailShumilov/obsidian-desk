#!/usr/bin/env tsx
/**
 * Run one keeper matching cycle for a given pair of orders.
 *
 * Usage:
 *   tsx keeper/scripts/match-pair.ts <market> <order_a> <order_b>
 *
 * Env (defaults shown):
 *   ANCHOR_PROVIDER_URL=http://127.0.0.1:18899
 *   ANCHOR_WALLET=~/.config/solana/id.json
 *
 * Exits non-zero on any cycle failure. Each phase logs progress so the
 * operator can see exactly where things stopped:
 *
 *   try_match           → execute_graph CPI to Encrypt program
 *   wait verified       → polls 3 output ct accounts until status=VERIFIED
 *   request_decryption  → snapshots digests onto MatchIntent
 *   readCiphertext gRPC → decrypts the 3 outputs off-chain (assumes public)
 *   finalize_decryption → writes MatchRecord
 *
 * Settlement-to-BTC continues via the daemon's `pollOnce` loop.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { runMatchCycle, ensureEncryptDeposit } from '../src/matching.ts';
import { loadKeypair, type LooseProgram } from '../src/anchor-shims.ts';

async function main(): Promise<void> {
  const [marketArg, orderAArg, orderBArg] = process.argv.slice(2);
  if (!marketArg || !orderAArg || !orderBArg) {
    console.error('usage: tsx keeper/scripts/match-pair.ts <market> <order_a> <order_b>');
    process.exit(2);
  }

  const rpcUrl =
    process.env['ANCHOR_PROVIDER_URL'] ?? 'http://127.0.0.1:18899';
  const walletPath =
    process.env['ANCHOR_WALLET'] ??
    join(homedir(), '.config', 'solana', 'id.json');
  const idlPath =
    process.env['OBSIDIAN_IDL'] ??
    join(process.cwd(), 'target', 'idl', 'obsidian_core.json');

  const connection = new Connection(rpcUrl, 'confirmed');
  const wallet = new anchor.Wallet(loadKeypair(walletPath));
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  });
  anchor.setProvider(provider);

  const idl = JSON.parse(readFileSync(idlPath, 'utf8')) as anchor.Idl;
  const program = new anchor.Program(idl, provider) as unknown as LooseProgram;

  const market = new PublicKey(marketArg);
  const orderA = new PublicKey(orderAArg);
  const orderB = new PublicKey(orderBArg);

  // The keeper signer + payer are both the loaded wallet for this CLI.
  // Production keeper splits these into separate Fly secrets.
  const signer = (wallet as unknown as { payer: Keypair }).payer;

  console.log(`[match-pair] rpc=${rpcUrl} program=${program.programId.toBase58()}`);
  console.log(`[match-pair] market=${market.toBase58()}`);
  console.log(`[match-pair] orderA=${orderA.toBase58()}`);
  console.log(`[match-pair] orderB=${orderB.toBase58()}`);

  await ensureEncryptDeposit(connection, signer, program.programId, 'cli');

  const result = await runMatchCycle(
    program,
    market,
    { orderA, orderB },
    signer,
    signer,
    { keeperId: 'cli', executorTimeoutMs: 90_000 },
  );

  console.log(`\n[match-pair] success`);
  console.log(`  matchId       = ${result.matchId}`);
  console.log(`  matchIntent   = ${result.matchIntent.toBase58()} (closed)`);
  console.log(`  matchRecord   = ${result.matchRecord.toBase58()}`);
  console.log(`  can_match_ct  = ${result.canMatchOut.toBase58()}`);
  console.log(`  fill_size_ct  = ${result.fillSizeOut.toBase58()}`);
  console.log(`  clearing_ct   = ${result.clearingPriceOut.toBase58()}`);
}

main().catch((err) => {
  console.error('\n[match-pair] FAILED', err?.message ?? err);
  if (err?.logs) console.error('logs:', err.logs.slice(0, 8).join('\n  '));
  process.exit(1);
});
