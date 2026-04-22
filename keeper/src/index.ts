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
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SpendInput } from '@obsidian-desk/sdk';
import { btc as btcSdk } from '@obsidian-desk/sdk';
import { pollOnce, type PollReport } from './poll.ts';
import { createHash } from 'node:crypto';

const POLL_MS = Number(process.env['KEEPER_POLL_MS'] ?? 3_000);
const PORT = Number(process.env['KEEPER_PORT'] ?? 13_001);
const FEERATE = Number(process.env['KEEPER_FEERATE'] ?? 4);
const RPC = process.env['ANCHOR_PROVIDER_URL'] ?? 'http://127.0.0.1:18899';
const WALLET_PATH =
  process.env['ANCHOR_WALLET'] ?? join(homedir(), '.config', 'solana', 'id.json');
const PROGRAM_ID_STR =
  process.env['OBSIDIAN_PROGRAM_ID'] ?? 'H25yY5o4emorZ9qMHAUvJhdtrFjDSeYy2MVYurpQbeLp';

interface MetricsSnapshot {
  bootedAt: string;
  ticks: number;
  attempted: number;
  settled: number;
  failed: number;
  lastTickAt: string | null;
  lastError: string | null;
}

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function loadIdl(): Idl {
  const p = join(process.cwd(), 'target', 'idl', 'obsidian_core.json');
  return JSON.parse(readFileSync(p, 'utf8')) as Idl;
}

/**
 * In mock mode the keeper can't fetch real UTXOs, so we synthesize one per
 * dWallet address on demand. Deterministic txid = sha256-style digest of
 * the address so repeated calls for the same address produce the same UTXO.
 * In real mode P9 replaces this with an esplora API call.
 */
function mockUtxoProvider(address: string): SpendInput {
  const h = createHash('sha256').update(address).digest('hex');
  return {
    txid: h,
    vout: 0,
    // 1 BTC — enough to cover any reasonable mock fill with change.
    valueSats: 100_000_000n,
    // Real script for `address` so the SDK's requestSign can produce a
    // valid signature instead of failing with "non-segwit script".
    scriptPubKeyHex: btcSdk.scriptForAddress(address, 'signet'),
  };
}

function bumpMetrics(metrics: MetricsSnapshot, report: PollReport, err?: unknown): void {
  metrics.ticks += 1;
  metrics.lastTickAt = new Date().toISOString();
  metrics.attempted += report.attempted.length;
  metrics.settled += report.settled.length;
  metrics.failed += report.failed.length;
  if (err) metrics.lastError = err instanceof Error ? err.message : String(err);
}

async function main(): Promise<void> {
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
  };

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
        mockUtxoProvider,
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
