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
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program, type Idl } from '@coral-xyz/anchor';
import {
  DEFAULT_OBSIDIAN_PROGRAM_ID,
  assertNotMockOnMainnet,
} from '@obsidian-desk/sdk';
import * as encryptSdk from '@obsidian-desk/sdk/encrypt';

const RPC =
  process.env['SOLANA_RPC'] ??
  process.env['NEXT_PUBLIC_SOLANA_RPC'] ??
  'https://api.devnet.solana.com';

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
  /** Resolved mode: 'real-ok' if the SDK reached the Encrypt gRPC service,
   *  'real-failed-fallback' if it tried real and fell back to mock on
   *  transient failure, 'mock' if the SDK was forced to mock. Surfaces in
   *  the toast so reviewers can see whether the ciphertext refs are
   *  network-resident or synthetic. */
  mode: 'real-ok' | 'real-failed-fallback' | 'mock';
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
  // BigInt() accepts decimal-only strings and throws SyntaxError on anything
  // else. Surface a user-friendly error before that — `"1e5"`, `""`, or
  // accidental whitespace would otherwise leak a SyntaxError stack to the
  // browser response.
  if (input.side !== 'bid' && input.side !== 'ask') {
    throw new Error(`prepareEncryptedOrderAction: side must be 'bid' or 'ask'`);
  }
  if (!/^[1-9]\d*$/.test(input.priceQuote)) {
    throw new Error(
      `prepareEncryptedOrderAction: priceQuote must be a positive integer string`,
    );
  }
  if (!/^[1-9]\d*$/.test(input.sizeBase)) {
    throw new Error(
      `prepareEncryptedOrderAction: sizeBase must be a positive integer string`,
    );
  }
  const blob = await encryptSdk.encryptOrder(
    input.side,
    BigInt(input.priceQuote),
    BigInt(input.sizeBase),
  );
  // blob.mode is the resolved mode (real-ok / real-failed-fallback / mock)
  // — what *actually* happened, not what was requested. Surfaces in the
  // toast so the user can tell a real Encrypt-network commit from a
  // local fallback when auto mode is in play.
  return {
    sideCtHex: Buffer.from(blob.side_ct).toString('hex'),
    priceCtHex: Buffer.from(blob.price_ct).toString('hex'),
    sizeCtHex: Buffer.from(blob.size_ct).toString('hex'),
    nonceHex: Buffer.from(blob.nonce).toString('hex'),
    mode: blob.mode,
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

/**
 * On-chain row for a user's EncryptedOrder PDA. The plaintext `price` and
 * `size` aren't decryptable from this side — the wallet that submitted the
 * order is the only place that holds the plaintext (in localStorage). The
 * frontend cross-references by `nonceHex`: if the local order tape has the
 * same nonce, it merges the on-chain status onto it; if not, it renders an
 * "encrypted" placeholder row so the user knows orders exist on-chain even
 * after a localStorage wipe.
 */
export interface OnChainOrderRow {
  pda: string;
  nonceHex: string;
  market: string;
  expirySlot: string;
  status: 'active' | 'matched' | 'cancelled' | 'expired';
}

const SOLANA_BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Read every EncryptedOrder PDA owned by `walletPubkey`. Filtered server-side
 * via memcmp on the `owner` field at offset 8 (discriminator) + 32 (market) =
 * 40. Returns [] when the IDL is missing (laptop without `anchor build`
 * artefacts) or the RPC fails — the caller renders an empty hydration.
 */
export async function listMyEncryptedOrdersAction(
  walletPubkey: string,
): Promise<OnChainOrderRow[]> {
  if (!SOLANA_BASE58_RE.test(walletPubkey)) {
    throw new Error('listMyEncryptedOrdersAction: invalid walletPubkey');
  }
  const idl = loadIdl();
  if (!idl) return [];

  try {
    const conn = new Connection(RPC, 'confirmed');
    const dummyKeypair = Keypair.generate();
    const dummyWallet = {
      publicKey: dummyKeypair.publicKey,
      signTransaction: async <T>(tx: T): Promise<T> => tx,
      signAllTransactions: async <T>(txs: T[]): Promise<T[]> => txs,
      payer: dummyKeypair,
    };
    const provider = new AnchorProvider(conn, dummyWallet as never, {
      commitment: 'confirmed',
    });
    const program = new Program(idl as Idl, provider);

    const accountClient = (program.account as Record<string, {
      all(filters: unknown[]): Promise<unknown>;
    }>)['encryptedOrder'];
    if (!accountClient) return [];

    const records = (await accountClient.all([
      { memcmp: { offset: 40, bytes: walletPubkey } },
    ])) as Array<{
      publicKey: PublicKey;
      account: {
        market: PublicKey;
        owner: PublicKey;
        nonce: number[] | Buffer | Uint8Array;
        expirySlot: { toString(): string };
        status: Record<string, unknown>;
      };
    }>;

    return records.map(({ publicKey, account }) => {
      const status: OnChainOrderRow['status'] =
        'active' in account.status ? 'active'
        : 'matched' in account.status ? 'matched'
        : 'cancelled' in account.status ? 'cancelled'
        : 'expired';
      const nonceBuf = Buffer.isBuffer(account.nonce)
        ? account.nonce
        : Buffer.from(account.nonce);
      return {
        pda: publicKey.toBase58(),
        nonceHex: nonceBuf.toString('hex'),
        market: account.market.toBase58(),
        expirySlot: account.expirySlot.toString(),
        status,
      };
    });
  } catch (err) {
    console.warn(
      `[trade] listMyEncryptedOrdersAction failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}
