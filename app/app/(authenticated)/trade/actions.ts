'use server';

/**
 * Server actions for the /trade page.
 *
 * Encryption runs Node-side (the SDK dynamic-imports the gRPC client
 * which pulls @grpc/grpc-js, marked `serverExternalPackages` in
 * next.config.ts). The page hands plaintext order params here, gets back
 * 32-byte ciphertext-account refs + a 16-byte nonce, then builds the
 * Solana transaction client-side and asks the wallet adapter to sign.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_OBSIDIAN_PROGRAM_ID,
  assertNotMockOnMainnet,
} from '@obsidian-desk/sdk';
import * as encryptSdk from '@obsidian-desk/sdk/encrypt';

assertNotMockOnMainnet({
  encryptMode: process.env['OBSIDIAN_ENCRYPT_MODE'],
  ikaMode: process.env['OBSIDIAN_IKA_MODE'],
  rpc: process.env['NEXT_PUBLIC_SOLANA_RPC'] ?? process.env['SOLANA_RPC'],
  network: process.env['NEXT_PUBLIC_NETWORK'],
});

const PROGRAM_ID =
  process.env['NEXT_PUBLIC_OBSIDIAN_PROGRAM_ID'] ?? DEFAULT_OBSIDIAN_PROGRAM_ID;

const MARKET_PUBKEY = process.env['NEXT_PUBLIC_OBSIDIAN_MARKET'] ?? null;

export interface PreparedOrderBlob {
  /** 32-byte Encrypt Ciphertext-account pubkey, hex-encoded. */
  sideCtHex: string;
  priceCtHex: string;
  sizeCtHex: string;
  /** 16-byte order nonce, hex-encoded — also seeds the order PDA. */
  nonceHex: string;
  /** 'real' if the SDK was in real mode and the gRPC call succeeded, 'mock'
   *  otherwise. Surfaces in the toast so reviewers can see whether the
   *  ciphertext refs are network-resident or synthetic. */
  mode: 'real' | 'mock';
}

export interface PrepareEncryptedOrderInput {
  side: 'bid' | 'ask';
  /** Quote-units bigint serialised as a string (USDC × 1e6). */
  priceQuote: string;
  /** Base-units bigint serialised as a string (sats = BTC × 1e8). */
  sizeBase: string;
}

/**
 * Encrypt the three order fields via the Encrypt gRPC service and return
 * the on-chain Ciphertext-account references + a fresh nonce so the
 * client can derive the order PDA and build `submit_order` locally.
 */
export async function prepareEncryptedOrderAction(
  input: PrepareEncryptedOrderInput,
): Promise<PreparedOrderBlob> {
  const mode = encryptSdk.currentMode();
  const blob = await encryptSdk.encryptOrder(
    input.side,
    BigInt(input.priceQuote),
    BigInt(input.sizeBase),
  );
  return {
    sideCtHex: Buffer.from(blob.side_ct).toString('hex'),
    priceCtHex: Buffer.from(blob.price_ct).toString('hex'),
    sizeCtHex: Buffer.from(blob.size_ct).toString('hex'),
    nonceHex: Buffer.from(blob.nonce).toString('hex'),
    mode,
  };
}

let idlCache: unknown = null;
function loadIdl(): unknown {
  if (idlCache) return idlCache;
  const candidates = [
    process.env['OBSIDIAN_IDL_PATH'],
    '/app/target/idl/obsidian_core.json',
    join(process.cwd(), 'target', 'idl', 'obsidian_core.json'),
    join(process.cwd(), '..', 'target', 'idl', 'obsidian_core.json'),
  ].filter((p): p is string => Boolean(p));
  for (const path of candidates) {
    try {
      const buf = readFileSync(path, 'utf8');
      idlCache = JSON.parse(buf);
      return idlCache;
    } catch {
      continue;
    }
  }
  return null;
}

export interface ProgramSetup {
  programId: string;
  /** Null when `NEXT_PUBLIC_OBSIDIAN_MARKET` env var is not set — the page
   *  falls back to the local-only stub flow in that case. */
  marketPubkey: string | null;
  /** The IDL JSON, or null if it couldn't be loaded (compose mount missing,
   *  laptop without `anchor build` artefacts, etc.). */
  idl: unknown;
}

export async function getProgramSetupAction(): Promise<ProgramSetup> {
  return {
    programId: PROGRAM_ID,
    marketPubkey: MARKET_PUBKEY,
    idl: loadIdl(),
  };
}
