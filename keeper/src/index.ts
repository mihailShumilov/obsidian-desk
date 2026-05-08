/**
 * ObsidianDesk keeper — long-running daemon.
 *
 * - Polls Solana for `MatchRecord` PDAs with `settle_status = Pending` every
 *   `KEEPER_POLL_MS` (default 3000 ms).
 * - For each, asks the Ika SDK to sign a BTC spend tx from seller to buyer
 *   (mock mode by default — see sdk/src/ika.ts).
 * - Calls `finalize_settlement` (or `fail_settlement` on error) on the
 *   obsidian-core program.
 *
 * Exposes a tiny HTTP `/status` endpoint on `KEEPER_PORT` (default 13001).
 *
 * Env:
 *   ANCHOR_PROVIDER_URL        Solana RPC (default http://127.0.0.1:18899)
 *   ANCHOR_WALLET              Keeper keypair path (default ~/.config/solana/id.json)
 *   OBSIDIAN_PROGRAM_ID        Program address (default H25y…beLp from Anchor.toml)
 *   OBSIDIAN_IKA_MODE          'mock' | 'real' (SDK default is 'mock')
 *   KEEPER_POLL_MS             Polling interval (default 3000)
 *   KEEPER_PORT                HTTP status port (default 13001 — non-standard)
 *   KEEPER_FEERATE             BTC feerate sat/vB (default 4)
 */

import {
  AnchorProvider,
  Program,
  Wallet,
  type Idl,
} from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  btc as btcSdk,
  DEFAULT_OBSIDIAN_PROGRAM_ID,
  assertNotMockOnMainnet,
  resolveMode,
  setModeLogger,
  type ResolvedMode,
} from '@obsidian-desk/sdk';
import { pollOnce, type PollReport, type UtxoProvider } from './poll.ts';
import { loadKeypair } from './anchor-shims.ts';

const POLL_MS = Number(process.env['KEEPER_POLL_MS'] ?? 3_000);
const PORT = Number(process.env['KEEPER_PORT'] ?? 13_001);
const FEERATE = Number(process.env['KEEPER_FEERATE'] ?? 4);
const RPC = process.env['ANCHOR_PROVIDER_URL'] ?? 'http://127.0.0.1:18899';
const WALLET_PATH =
  process.env['ANCHOR_WALLET'] ?? join(homedir(), '.config', 'solana', 'id.json');
const PROGRAM_ID_STR =
  process.env['OBSIDIAN_PROGRAM_ID'] ?? DEFAULT_OBSIDIAN_PROGRAM_ID;

interface ModeCounters {
  realOk: number;
  realFailedFallback: number;
  mock: number;
}

type SurfaceCounters = Record<'encrypt' | 'ika' | 'btc', ModeCounters>;

interface MetricsSnapshot {
  bootedAt: string;
  ticks: number;
  attempted: number;
  settled: number;
  failed: number;
  lastTickAt: string | null;
  lastError: string | null;
  /** Per-surface counts of which path real-mode dispatches took. Lets ops
   *  see at a glance which subsystems are healthy on the live networks. */
  modeCounts: SurfaceCounters;
  /** Last 20 settled matches, with the BTC mode + txid for each. */
  recentSettlements: Array<{
    matchId: string;
    btcTxid: string;
    broadcastMode: ResolvedMode;
    settledAt: string;
  }>;
}

function emptyCounters(): ModeCounters {
  return { realOk: 0, realFailedFallback: 0, mock: 0 };
}

function loadIdl(): Idl {
  const p = join(process.cwd(), 'target', 'idl', 'obsidian_core.json');
  return JSON.parse(readFileSync(p, 'utf8')) as Idl;
}

/**
 * UTXO provider — calls esplora when BTC mode is `real` or `auto`, falls back
 * to a synthesised 1-BTC UTXO if esplora is unreachable (or mode is `mock`).
 * The auto-fallback is what lets the demo keep running when mempool.space
 * blips, while still preferring real UTXOs by default.
 *
 * Empty array → keeper marks the match as failed with "no funded UTXOs".
 * Operationally: pre-fund the seller dWallet from a signet faucet before
 * the demo, otherwise every match fails until funding lands.
 */
const BTC_NETWORK: 'signet' | 'testnet' = 'signet';
const BTC_MODE = resolveMode('btc');

const utxoProvider: UtxoProvider = async (address) => {
  const r = await btcSdk.getAddressUtxos(address, BTC_NETWORK, BTC_MODE);
  if (r.fallbackReason) {
    console.warn(
      `[keeper] esplora UTXO fetch fell back to synthetic for ` +
        `${address.slice(0, 16)}…: ${r.fallbackReason}`,
    );
  }
  // Sort by value descending so the spend tx picks the largest UTXO first
  // (minimises change-output count for small fills).
  return [...r.value].sort((a, b) => Number(b.valueSats - a.valueSats));
};

function bumpMetrics(metrics: MetricsSnapshot, report: PollReport, err?: unknown): void {
  metrics.ticks += 1;
  metrics.lastTickAt = new Date().toISOString();
  metrics.attempted += report.attempted.length;
  metrics.settled += report.settled.length;
  metrics.failed += report.failed.length;
  if (err) metrics.lastError = err instanceof Error ? err.message : String(err);

  // Append every settlement's mode + txid to the rolling window. /positions
  // can read this to badge each row with its real/fallback path without
  // requiring a separate per-match log scrape.
  for (const s of report.settled) {
    metrics.recentSettlements.unshift({
      matchId: s.matchId,
      btcTxid: s.btcTxid,
      broadcastMode: s.broadcastMode,
      settledAt: new Date().toISOString(),
    });
  }
  if (metrics.recentSettlements.length > 20) {
    metrics.recentSettlements.length = 20;
  }
}

async function main(): Promise<void> {
  assertNotMockOnMainnet({
    encryptMode: process.env['OBSIDIAN_ENCRYPT_MODE'],
    ikaMode: process.env['OBSIDIAN_IKA_MODE'],
    rpc: RPC,
    network: process.env['NEXT_PUBLIC_NETWORK'],
  });
  const wallet = new Wallet(loadKeypair(WALLET_PATH));
  const connection = new Connection(RPC, 'confirmed');
  const provider = new AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  });
  const idl = loadIdl();
  const program = new Program(idl, provider);

  if (program.programId.toBase58() !== PROGRAM_ID_STR) {
    console.warn(
      `[keeper] IDL program ID ${program.programId.toBase58()} does not match ` +
        `env OBSIDIAN_PROGRAM_ID=${PROGRAM_ID_STR}. Using IDL's value.`,
    );
  }

  // Validate program ID parses (catches obvious misconfiguration before RPC).
  new PublicKey(PROGRAM_ID_STR);

  const metrics: MetricsSnapshot = {
    bootedAt: new Date().toISOString(),
    ticks: 0,
    attempted: 0,
    settled: 0,
    failed: 0,
    lastTickAt: null,
    lastError: null,
    modeCounts: {
      encrypt: emptyCounters(),
      ika: emptyCounters(),
      btc: emptyCounters(),
    },
    recentSettlements: [],
  };

  // Wire the SDK's mode-event logger to also bump per-surface counters.
  // Default behaviour (one-line JSON to stderr) is preserved by re-emitting
  // the same line through the default sink.
  setModeLogger((event) => {
    const counters = metrics.modeCounts[event.surface];
    if (event.mode === 'real-ok') counters.realOk += 1;
    else if (event.mode === 'real-failed-fallback') counters.realFailedFallback += 1;
    else counters.mock += 1;
    process.stderr.write(`[obsidian-mode] ${JSON.stringify({ t: new Date().toISOString(), ...event })}\n`);
  });

  const server = createServer((req, res) => {
    if (req.url === '/status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(metrics, null, 2));
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(PORT, () => {
    console.log(
      `[keeper] status endpoint on http://127.0.0.1:${PORT}/status — ` +
        `polling every ${POLL_MS}ms against ${RPC}`,
    );
  });

  // Prom-style metrics dump every 30s — covers the case where someone
  // is tailing the keeper logs but doesn't have curl access to /status.
  // Format mirrors what /status returns so the two sources stay aligned.
  const metricsTick = setInterval(() => {
    console.log(
      `[keeper:metrics] ticks=${metrics.ticks} ` +
        `attempted=${metrics.attempted} settled=${metrics.settled} ` +
        `failed=${metrics.failed} ` +
        `lastError=${metrics.lastError ?? 'none'}`,
    );
  }, 30_000);
  metricsTick.unref();

  let stopping = false;
  const shutdown = (): void => {
    if (stopping) return;
    stopping = true;
    console.log('[keeper] shutdown signal received');
    clearInterval(metricsTick);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  while (!stopping) {
    try {
      const report = await pollOnce(program as never, {
        keeperId: 'devnet-local',
        feerateSatPerVB: FEERATE,
        utxoProvider,
        btcNetwork: BTC_NETWORK,
        broadcastMode: BTC_MODE,
      });
      bumpMetrics(metrics, report);
    } catch (err) {
      bumpMetrics(metrics, { attempted: [], settled: [], failed: [] }, err);
      console.error('[keeper] poll error', err);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((err) => {
  console.error('[keeper] fatal', err);
  process.exit(1);
});
