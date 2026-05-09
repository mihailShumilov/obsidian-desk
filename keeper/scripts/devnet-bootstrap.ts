#!/usr/bin/env tsx
/**
 * Bootstrap a devnet market with two crossing orders ready for match-pair.
 *
 * Steps:
 *   1. Initialize a fresh market (random base/quote mints).
 *   2. Real-mode encrypt two orders — one BID at $70_000, one ASK at $69_900
 *      — so the FHE comparator's `bid_price >= ask_price` returns true.
 *   3. Submit both via `submit_order`.
 *
 * Outputs the market + order PDAs so the operator can then run:
 *
 *   tsx keeper/scripts/match-pair.ts <market> <orderA> <orderB>
 *
 * Env:
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
 *   ANCHOR_WALLET=~/.config/solana/id.json
 *   OBSIDIAN_KEEPER_AUTHORITY=<base58 pubkey>   (optional — defaults to the
 *     payer pubkey; set this to the VPS keeper bot's pubkey when
 *     bootstrapping a market the production keeper should be able to act on)
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import * as anchor from '@coral-xyz/anchor';
import { Keypair, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import * as encryptSdk from '@obsidian-desk/sdk/encrypt';
import { loadKeypair, type LooseProgram, type LooseProgramMethods } from '../src/anchor-shims.ts';

async function main(): Promise<void> {
  process.env['OBSIDIAN_ENCRYPT_MODE'] = 'real';
  process.env['OBSIDIAN_ENCRYPT_PROGRAM_ID'] =
    process.env['OBSIDIAN_ENCRYPT_PROGRAM_ID'] ??
    'H25yY5o4emorZ9qMHAUvJhdtrFjDSeYy2MVYurpQbeLp'; // our caller program

  const rpcUrl =
    process.env['ANCHOR_PROVIDER_URL'] ?? 'https://api.devnet.solana.com';
  const walletPath =
    process.env['ANCHOR_WALLET'] ??
    join(homedir(), '.config', 'solana', 'id.json');
  const idlPath =
    process.env['OBSIDIAN_IDL'] ??
    join(process.cwd(), 'target', 'idl', 'obsidian_core.json');

  const connection = new anchor.web3.Connection(rpcUrl, 'confirmed');
  const wallet = new anchor.Wallet(loadKeypair(walletPath));
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  });
  anchor.setProvider(provider);

  const idl = JSON.parse(readFileSync(idlPath, 'utf8')) as anchor.Idl;
  const program = new anchor.Program(idl, provider) as unknown as LooseProgram;
  const methods = program.methods as LooseProgramMethods;

  console.log(`[bootstrap] rpc=${rpcUrl}`);
  console.log(`[bootstrap] program=${program.programId.toBase58()}`);
  console.log(`[bootstrap] payer=${wallet.publicKey.toBase58()}`);

  // ── 1. Market ──
  const baseMint = Keypair.generate().publicKey;
  const quoteMint = Keypair.generate().publicKey;
  const settleVault = Keypair.generate().publicKey;
  const ikaPolicy = Keypair.generate().publicKey;
  const [market] = PublicKey.findProgramAddressSync(
    [Buffer.from('market'), baseMint.toBuffer(), quoteMint.toBuffer()],
    program.programId,
  );

  const keeperAuthority = process.env['OBSIDIAN_KEEPER_AUTHORITY']
    ? new PublicKey(process.env['OBSIDIAN_KEEPER_AUTHORITY'])
    : wallet.publicKey;

  console.log(`[bootstrap] market=${market.toBase58()}`);
  console.log(`[bootstrap] keeper_authority=${keeperAuthority.toBase58()}`);
  console.log(`[bootstrap] initializeMarket…`);
  const initSig = await methods['initializeMarket']!(
    baseMint,
    quoteMint,
    keeperAuthority,
  )
    .accountsPartial({
      market,
      settleVault,
      ikaPolicy,
      admin: wallet.publicKey,
    })
    .rpc({ commitment: 'confirmed' });
  console.log(`[bootstrap]   tx=${initSig.slice(0, 16)}…`);

  // ── 2. Encrypt + submit two crossing orders ──
  const dwalletA = Keypair.generate().publicKey;
  const dwalletB = Keypair.generate().publicKey;
  const slot = await connection.getSlot();
  const expirySlot = new BN(slot + 1_000_000);

  const submit = async (
    side: 'bid' | 'ask',
    priceQuote: bigint,
    sizeBase: bigint,
    dwallet: PublicKey,
    label: string,
  ): Promise<PublicKey> => {
    console.log(`[bootstrap] ${label}: encryptOrder real-mode (${side} @ ${priceQuote})…`);
    const blob = await encryptSdk.encryptOrder(side, priceQuote, sizeBase);
    console.log(
      `[bootstrap]   side_ct=${Buffer.from(blob.side_ct).toString('hex').slice(0, 16)}… ` +
        `price_ct=${Buffer.from(blob.price_ct).toString('hex').slice(0, 16)}… ` +
        `size_ct=${Buffer.from(blob.size_ct).toString('hex').slice(0, 16)}…`,
    );
    const [order] = PublicKey.findProgramAddressSync(
      [Buffer.from('order'), market.toBuffer(), Buffer.from(blob.nonce)],
      program.programId,
    );
    const sig = await methods['submitOrder']!(
      [...blob.side_ct],
      [...blob.price_ct],
      [...blob.size_ct],
      expirySlot,
      [...blob.nonce],
      dwallet,
    )
      .accountsPartial({
        market,
        order,
        owner: wallet.publicKey,
      })
      .rpc({ commitment: 'confirmed' });
    console.log(`[bootstrap]   ${label} order=${order.toBase58()} tx=${sig.slice(0, 16)}…`);
    return order;
  };

  // Bid (0) at $70,000 — buyer
  const bidPrice = 70_000_000_000n; // USDC * 1e6
  // Ask (1) at $69,900 — seller, willing to sell lower than bid → crosses
  const askPrice = 69_900_000_000n;
  const size = 10_000_000n; // 0.1 BTC

  const orderA = await submit('bid', bidPrice, size, dwalletA, 'orderA (BID)');
  const orderB = await submit('ask', askPrice, size, dwalletB, 'orderB (ASK)');

  console.log(`\n[bootstrap] DONE\n`);
  console.log(`Run match-pair:`);
  console.log(
    `  ANCHOR_PROVIDER_URL=${rpcUrl} pnpm exec tsx keeper/scripts/match-pair.ts ` +
      `${market.toBase58()} ${orderA.toBase58()} ${orderB.toBase58()}`,
  );
}

main().catch((err) => {
  console.error('\n[bootstrap] FAILED', err?.message ?? err);
  if (err?.logs) console.error('logs:', err.logs.slice(0, 8).join('\n  '));
  process.exit(1);
});
