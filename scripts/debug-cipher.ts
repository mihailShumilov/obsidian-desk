#!/usr/bin/env -S node --experimental-strip-types --no-warnings
/**
 * debug-cipher — read an EncryptedOrder PDA from a Solana cluster and print
 * the three ciphertext fields as base64 + length + mock/real tag.
 *
 * Usage:
 *   pnpm exec tsx scripts/debug-cipher.ts <ORDER_PUBKEY> [--rpc <url>]
 *
 * Defaults to the local validator at http://127.0.0.1:18899. Per the
 * project's zero-leakage rule, this CLI never decodes plaintext — even
 * in mock mode, only the fheType/tag and base64 bytes are printed.
 */

import {
  AnchorProvider,
  BorshAccountsCoder,
  Program,
  Wallet,
} from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeCiphertext } from '../sdk/src/encrypt.ts';

const DEFAULT_RPC = process.env['ANCHOR_PROVIDER_URL'] ?? 'http://127.0.0.1:18899';

function usage(): never {
  console.error(
    'Usage: debug-cipher <ORDER_PUBKEY> [--rpc <url>]\n' +
      '       (default RPC: http://127.0.0.1:18899)',
  );
  process.exit(2);
}

function parseArgs(argv: string[]): { orderKey: string; rpc: string } {
  const args = argv.slice(2);
  if (args.length === 0) usage();
  let rpc = DEFAULT_RPC;
  let orderKey: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--rpc') {
      rpc = args[++i] ?? usage();
    } else if (!orderKey) {
      orderKey = a;
    } else {
      usage();
    }
  }
  if (!orderKey) usage();
  return { orderKey, rpc };
}

async function main(): Promise<void> {
  const { orderKey, rpc } = parseArgs(process.argv);
  const order = new PublicKey(orderKey);

  const connection = new Connection(rpc, 'confirmed');
  // Read-only — synthesize a throwaway wallet so AnchorProvider is happy.
  const wallet = new Wallet(Keypair.generate());
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });

  // Load the IDL produced by `anchor build`.
  const idlPath = join(
    process.cwd(),
    'target',
    'idl',
    'obsidian_core.json',
  );
  const idl = JSON.parse(readFileSync(idlPath, 'utf8')) as Parameters<typeof Program>[0];
  const program = new Program(idl, provider);

  const acct = await connection.getAccountInfo(order, 'confirmed');
  if (!acct) {
    console.error(`Account ${order.toBase58()} not found at ${rpc}`);
    process.exit(1);
  }

  const decoder = new BorshAccountsCoder(idl);
  const decoded = decoder.decode<{
    market: PublicKey;
    owner: PublicKey;
    sideCt: number[] | Buffer;
    priceCt: number[] | Buffer;
    sizeCt: number[] | Buffer;
    expirySlot: bigint | { toString(): string };
    status: Record<string, unknown>;
  }>('encryptedOrder', acct.data);

  const fields: Array<[string, Buffer]> = [
    ['side_ct', Buffer.from(decoded.sideCt)],
    ['price_ct', Buffer.from(decoded.priceCt)],
    ['size_ct', Buffer.from(decoded.sizeCt)],
  ];

  console.log(`order      : ${order.toBase58()}`);
  console.log(`market     : ${decoded.market.toBase58()}`);
  console.log(`owner      : ${decoded.owner.toBase58()}`);
  console.log(`expiry_slot: ${decoded.expirySlot.toString()}`);
  console.log(`status     : ${Object.keys(decoded.status)[0] ?? '?'}`);
  console.log('');
  for (const [name, bytes] of fields) {
    console.log(`${name.padEnd(11)}: ${describeCiphertext(new Uint8Array(bytes))}`);
    console.log(`${''.padEnd(11)}  base64: ${bytes.toString('base64')}`);
  }
}

main().catch((err) => {
  console.error('debug-cipher: fatal', err);
  process.exit(1);
});
