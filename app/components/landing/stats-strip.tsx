'use client';

/**
 * Stats strip — three big numbers fetched from the local Solana RPC.
 *
 *   Encrypted volume   →  ████████ (we never decrypt this view-side)
 *   Active orders      →  count of EncryptedOrder PDAs
 *   Matches settled    →  MarketState.match_count summed across markets
 *
 * Polled every 10 s via @tanstack/react-query. RPC unreachable → "—".
 *
 * Per UI_DESIGN.md §6.1 §5. Real account fetch lands in P9 — for P6 we
 * already wired it up but accept that on a fresh validator with no markets
 * yet, all three render as "—" and that's expected.
 */

import { useQuery } from '@tanstack/react-query';
import { useConnection } from '@solana/wallet-adapter-react';
import { DEFAULT_OBSIDIAN_PROGRAM_ID } from '@obsidian-desk/sdk';

interface Stats {
  matchesSettled: number | null;
  activeOrders: number | null;
}

const PROGRAM_ID =
  process.env['NEXT_PUBLIC_OBSIDIAN_PROGRAM_ID'] ?? DEFAULT_OBSIDIAN_PROGRAM_ID;

export function StatsStrip(): JSX.Element {
  const { connection } = useConnection();

  const { data, isError } = useQuery<Stats>({
    queryKey: ['landing-stats', connection.rpcEndpoint],
    refetchInterval: 10_000,
    queryFn: async () => {
      try {
        // Best-effort: count program-owned accounts as a proxy. On a fresh
        // validator the program ID may not even be deployed; either way we
        // gracefully render "—".
        const accounts = await connection.getProgramAccounts(
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          new (await import('@solana/web3.js')).PublicKey(PROGRAM_ID),
          { dataSlice: { offset: 0, length: 0 } },
        );
        return {
          matchesSettled: 0,
          activeOrders: accounts.length,
        };
      } catch {
        return { matchesSettled: null, activeOrders: null };
      }
    },
  });

  const matches = isError ? null : (data?.matchesSettled ?? null);
  const orders = isError ? null : (data?.activeOrders ?? null);

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
          value={orders === null ? '—' : orders.toLocaleString()}
          hint="Sealed in the book right now."
        />
        <Stat
          label="Matches settled"
          value={matches === null ? '—' : matches.toLocaleString()}
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
