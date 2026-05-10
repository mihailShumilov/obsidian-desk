/**
 * /positions — live MatchRecord table.
 *
 * Server component: reads MatchRecord PDAs from the deployed obsidian-core
 * program and joins with the keeper /status feed for per-row mode badges.
 * Renders mempool.space links for the 32-byte BTC txid stored in
 * `btc_tx_proof`.
 */

import { Card } from '@/components/ui/card';
import { Cipher } from '@/components/obsidian/cipher';
import { OpenOrders } from '@/components/positions/open-orders';
import { listMatches, type PositionRow } from './actions';

export const metadata = { title: 'Positions · ObsidianDesk' };

// Always render fresh — MatchRecord is dynamic chain state, not cacheable.
export const dynamic = 'force-dynamic';

const STATUS_BADGE: Record<PositionRow['settleStatus'], { label: string; cls: string }> = {
  pending: { label: 'Pending', cls: 'bg-match-gold/15 text-match-gold animate-pulse-cipher' },
  settled: { label: 'Settled', cls: 'bg-cipher-cyan/15 text-cipher-cyan' },
  failed: { label: 'Failed', cls: 'bg-danger-red/15 text-danger-red' },
};

const MODE_BADGE: Record<NonNullable<PositionRow['broadcastMode']>, { label: string; cls: string }> = {
  'real-ok': { label: 'real ✓', cls: 'bg-cipher-cyan/10 text-cipher-cyan border-cipher-cyan/30' },
  'real-failed-fallback': { label: 'fallback ⚠', cls: 'bg-bitcoin-ember/10 text-bitcoin-ember border-bitcoin-ember/30' },
  'mock': { label: 'mock', cls: 'bg-obsidian-700 text-muted border-obsidian-600' },
};

function formatSats(sats: string, scale: 'btc' | 'usdc'): string {
  const n = BigInt(sats);
  if (scale === 'btc') {
    // 8-decimal BTC display.
    const whole = n / 100_000_000n;
    const frac = (n % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '') || '0';
    return `${whole}.${frac}`;
  }
  // 6-decimal USDC display.
  const whole = n / 1_000_000n;
  const frac = (n % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '') || '0';
  return `${whole}.${frac}`;
}

function truncate(s: string, n = 8): string {
  if (s.length <= n * 2 + 1) return s;
  return `${s.slice(0, n)}…${s.slice(-n)}`;
}

export default async function PositionsPage(): Promise<JSX.Element> {
  let rows: PositionRow[] = [];
  let loadError: string | null = null;
  try {
    rows = await listMatches();
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tightest">Positions</h1>
      <p className="mt-2 text-sm text-muted">
        Live <code className="text-foreground">MatchRecord</code> PDAs. Settled rows
        link to the real signet broadcast on mempool.space. The mode badge
        shows whether each settle ran against the live Ika MPC + signet
        relay (<span className="text-cipher-cyan">real ✓</span>), fell back
        to mock when a network blipped (<span className="text-bitcoin-ember">fallback ⚠</span>),
        or was forced mock by env (<span className="text-muted">mock</span>).
      </p>

      <OpenOrders />

      <h2 className="mt-8 text-lg font-semibold tracking-tightest">Settled Matches</h2>
      <p className="mt-1 text-xs text-muted">
        Records below appear only after two crossing orders meet and the keeper
        finalises a <code className="text-foreground">MatchRecord</code> PDA.
      </p>

      {loadError ? (
        <Card className="mt-6 border-danger-red/40 p-4">
          <p className="text-sm text-danger-red">
            Failed to load positions: {loadError}
          </p>
          <p className="mt-2 text-xs text-muted">
            Verify <code>SOLANA_RPC</code> and the IDL bind-mount in docker-compose.
          </p>
        </Card>
      ) : rows.length === 0 ? (
        <Card className="mt-6 p-8 text-center">
          <Cipher length={12} cadenceMs={1600} className="text-xs" />
          <p className="mt-4 text-sm text-muted">
            No matches yet. Place a sealed order on{' '}
            <a className="text-cipher-cyan hover:underline" href="/trade">/trade</a>
            {' '}then click <em className="not-italic">Try Match</em>.
          </p>
        </Card>
      ) : (
        <Card className="mt-6 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-obsidian-700 text-xs uppercase tracking-widest text-muted">
              <tr>
                <th className="px-4 py-3 text-left">Match #</th>
                <th className="px-4 py-3 text-right">Fill (BTC)</th>
                <th className="px-4 py-3 text-right">Clearing (USDC)</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">BTC tx</th>
                <th className="px-4 py-3 text-left">Mode</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-obsidian-700">
              {rows.map((r) => {
                const sb = STATUS_BADGE[r.settleStatus];
                const mb = r.broadcastMode ? MODE_BADGE[r.broadcastMode] : null;
                return (
                  <tr key={r.matchRecord} className="hover:bg-obsidian-800/40">
                    <td className="px-4 py-3 font-mono text-xs text-muted">{r.matchId}</td>
                    <td className="px-4 py-3 text-right font-mono">
                      {formatSats(r.fillSizeSats, 'btc')}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {formatSats(r.clearingPriceSats, 'usdc')}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs ${sb.cls}`}>
                        {sb.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {r.btcTxid && r.btcExplorerUrl ? (
                        <a
                          href={r.btcExplorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-cipher-cyan hover:underline"
                          title={r.btcTxid}
                        >
                          {truncate(r.btcTxid)} ↗
                        </a>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {mb ? (
                        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs ${mb.cls}`}>
                          {mb.label}
                        </span>
                      ) : r.settleStatus === 'settled' ? (
                        <span className="text-xs text-muted">—</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      <p className="mt-3 text-xs text-muted">
        {rows.length > 0 && (
          <>
            {rows.filter((r) => r.settleStatus === 'settled').length} settled,{' '}
            {rows.filter((r) => r.settleStatus === 'pending').length} pending,{' '}
            {rows.filter((r) => r.settleStatus === 'failed').length} failed.
          </>
        )}
      </p>
    </main>
  );
}
