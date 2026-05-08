'use server';

/**
 * Server actions for the /positions page.
 *
 * Reads MatchRecord PDAs directly from the Solana program, augmented with
 * the keeper's /status feed (which carries the broadcast `mode` marker
 * that's not stored on-chain).
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program, type Idl } from '@coral-xyz/anchor';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { btc as btcSdk, DEFAULT_OBSIDIAN_PROGRAM_ID } from '@obsidian-desk/sdk';

const RPC =
  process.env['SOLANA_RPC'] ??
  process.env['NEXT_PUBLIC_SOLANA_RPC'] ??
  'https://api.devnet.solana.com';

const PROGRAM_ID =
  process.env['NEXT_PUBLIC_OBSIDIAN_PROGRAM_ID'] ?? DEFAULT_OBSIDIAN_PROGRAM_ID;

const KEEPER_STATUS_URL =
  process.env['OBSIDIAN_KEEPER_STATUS_URL'] ?? 'http://obsidian-keeper:3001/status';

// Lazy-loaded IDL — avoids reading the JSON on every request.
let idlCache: Idl | null = null;
function loadIdl(): Idl {
  if (idlCache) return idlCache;
  // The IDL is bind-mounted into the app container at /app/target/idl by
  // docker-compose; on the laptop dev path it's in the repo's target/.
  const candidates = [
    process.env['OBSIDIAN_IDL_PATH'],
    '/app/target/idl/obsidian_core.json',
    join(process.cwd(), 'target', 'idl', 'obsidian_core.json'),
    join(process.cwd(), '..', 'target', 'idl', 'obsidian_core.json'),
  ].filter((p): p is string => Boolean(p));
  for (const path of candidates) {
    try {
      const buf = readFileSync(path, 'utf8');
      idlCache = JSON.parse(buf) as Idl;
      return idlCache;
    } catch {
      continue;
    }
  }
  throw new Error(
    `obsidian_core.json IDL not found. Tried: ${candidates.join(', ')}`,
  );
}

export type SettleStatus = 'pending' | 'settled' | 'failed';

export interface PositionRow {
  matchId: string;
  matchRecord: string;
  market: string;
  fillSizeSats: string;
  clearingPriceSats: string;
  settleStatus: SettleStatus;
  /** 32-byte BTC txid hex (only set if settled). */
  btcTxid: string | null;
  /** mempool.space URL for the BTC tx (only set if btcTxid is real). */
  btcExplorerUrl: string | null;
  /** Solana broadcast mode for the BTC settle (from keeper /status, optional). */
  broadcastMode: 'real-ok' | 'real-failed-fallback' | 'mock' | null;
  finalizedAtSlot: string;
  createdAtSlot: string;
}

interface KeeperRecentSettlement {
  matchId: string;
  btcTxid: string;
  broadcastMode: 'real-ok' | 'real-failed-fallback' | 'mock';
  settledAt: string;
}

interface KeeperStatus {
  recentSettlements?: KeeperRecentSettlement[];
}

/**
 * Best-effort fetch of the keeper's recent-settlements feed. Returns null
 * on any failure (the keeper may be down, or the URL may be unreachable
 * from this process). Callers fall back to "no mode info" rendering.
 */
async function fetchKeeperRecent(): Promise<KeeperRecentSettlement[] | null> {
  try {
    const res = await fetch(KEEPER_STATUS_URL, {
      signal: AbortSignal.timeout(2_000),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as KeeperStatus;
    return json.recentSettlements ?? [];
  } catch {
    return null;
  }
}

/**
 * Read every MatchRecord PDA the program owns. For a hackathon-scale demo
 * this is fine (under a few hundred records); production would page via
 * memcmp filters on market + per-user index PDA.
 */
export async function listMatches(): Promise<PositionRow[]> {
  const conn = new Connection(RPC, 'confirmed');
  // Read-only provider — we're not signing anything from the page. Anchor's
  // Wallet class isn't reliably re-exported at runtime under Turbopack;
  // construct a minimal-shape dummy that satisfies AnchorProvider.
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
  const idl = loadIdl();
  const program = new Program(idl, provider);

  // Validate the program-id env is consistent with the IDL.
  if (program.programId.toBase58() !== PROGRAM_ID) {
    console.warn(
      `[positions] IDL program ${program.programId.toBase58()} != env ${PROGRAM_ID}`,
    );
  }

  const accountClient = (program.account as Record<string, {
    all(): Promise<unknown>;
  }>)['matchRecord'];
  if (!accountClient) {
    throw new Error('positions: program IDL has no `matchRecord` account');
  }
  const records = (await accountClient.all()) as Array<{
    publicKey: PublicKey;
    account: {
      market: PublicKey;
      matchId: { toString(): string };
      fillSizeDecrypted: { toString(): string };
      clearingPriceDecrypted: { toString(): string };
      settleStatus: Record<string, unknown>;
      btcTxProof: Buffer | number[];
      finalizedAt: { toString(): string };
      createdAt: { toString(): string };
    };
  }>;

  const recent = await fetchKeeperRecent();
  const recentByMatchId = new Map<string, KeeperRecentSettlement>();
  for (const r of recent ?? []) recentByMatchId.set(r.matchId, r);

  const rows: PositionRow[] = records.map(({ publicKey, account }) => {
    const status: SettleStatus =
      'settled' in account.settleStatus ? 'settled'
      : 'failed' in account.settleStatus ? 'failed'
      : 'pending';

    let btcTxid: string | null = null;
    if (status === 'settled') {
      const proofBytes = Buffer.isBuffer(account.btcTxProof)
        ? account.btcTxProof
        : Buffer.from(account.btcTxProof);
      if (proofBytes.length === 32) {
        btcTxid = proofBytes.toString('hex');
      }
    }

    const matchIdStr = account.matchId.toString();
    const recentEntry = recentByMatchId.get(matchIdStr);

    return {
      matchId: matchIdStr,
      matchRecord: publicKey.toBase58(),
      market: account.market.toBase58(),
      fillSizeSats: account.fillSizeDecrypted.toString(),
      clearingPriceSats: account.clearingPriceDecrypted.toString(),
      settleStatus: status,
      btcTxid,
      btcExplorerUrl: btcTxid ? btcSdk.mempoolSpaceTxUrl(btcTxid, 'signet') : null,
      broadcastMode: recentEntry?.broadcastMode ?? null,
      finalizedAtSlot: account.finalizedAt.toString(),
      createdAtSlot: account.createdAt.toString(),
    };
  });

  // Newest first, settled rows on top — settled is what users care about
  // when they open the page.
  rows.sort((a, b) => {
    const ra = a.settleStatus === 'settled' ? 0 : 1;
    const rb = b.settleStatus === 'settled' ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return Number(BigInt(b.matchId) - BigInt(a.matchId));
  });

  return rows;
}
