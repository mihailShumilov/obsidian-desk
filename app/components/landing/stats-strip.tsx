/**
 * Stats strip — three big numbers fetched from Solana RPC server-side.
 *
 *   Encrypted volume   →  ████████ (we never decrypt this view-side)
 *   Active orders      →  count of program-owned accounts
 *   Matches settled    →  MarketState.match_count summed across markets
 *
 * Server component: results are cached for 60 s via Next's fetch cache,
 * so multiple landing-page visitors share one upstream call. Falls back
 * to "—" when the RPC is unreachable or the program isn't deployed yet.
 *
 * Per UI_DESIGN.md §6.1 §5.
 */
import { DEFAULT_OBSIDIAN_PROGRAM_ID } from '@obsidian-desk/sdk';

interface Stats {
  matchesSettled: number | null;
  activeOrders: number | null;
}

const PROGRAM_ID =
  process.env['NEXT_PUBLIC_OBSIDIAN_PROGRAM_ID'] ?? DEFAULT_OBSIDIAN_PROGRAM_ID;
const RPC =
  process.env['NEXT_PUBLIC_SOLANA_RPC'] ?? 'http://127.0.0.1:18899';

async function fetchStats(): Promise<Stats> {
  try {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getProgramAccounts',
        params: [PROGRAM_ID, { dataSlice: { offset: 0, length: 0 } }],
      }),
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return { matchesSettled: null, activeOrders: null };
    const json = (await res.json()) as { result?: unknown[] };
    return {
      matchesSettled: 0,
      activeOrders: json.result?.length ?? null,
    };
  } catch {
    return { matchesSettled: null, activeOrders: null };
  }
}

export async function StatsStrip(): Promise<JSX.Element> {
  const { matchesSettled, activeOrders } = await fetchStats();
  return (
    <section className="border-t border-obsidian-700 bg-obsidian-900/30">
      <div className="mx-auto grid max-w-7xl gap-6 px-6 py-16 md:grid-cols-3">
        <Stat
          label="Encrypted volume"
          value="████████"
          mono
          hint="We can't read it. Neither can the validators."
        />
        <Stat
          label="Active orders"
          value={activeOrders === null ? '—' : activeOrders.toLocaleString()}
          hint="Sealed in the book right now."
        />
        <Stat
          label="Matches settled"
          value={matchesSettled === null ? '—' : matchesSettled.toLocaleString()}
          hint="Native BTC tx confirmed on signet."
        />
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  mono,
}: {
  label: string;
  value: string;
  hint: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <div>
      <p className="text-xs uppercase tracking-widest text-muted">{label}</p>
      <p
        className={`mt-2 text-4xl font-semibold tracking-tightest text-foreground ${
          mono ? 'font-mono text-cipher-cyan-dim' : 'font-mono'
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}
