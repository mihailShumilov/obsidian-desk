/**
 * /positions — Table stub. P9 wires live MatchRecord + EncryptedOrder
 * fetches and the four-state status badges from UI_DESIGN.md §6.4.
 */

import { Card } from '@/components/ui/card';
import { Cipher } from '@/components/obsidian/cipher';

export const metadata = { title: 'Positions · ObsidianDesk' };

const STATUS_BADGES = [
  { label: 'Sealed', cls: 'bg-obsidian-800 text-muted' },
  { label: 'Matched', cls: 'bg-match-gold/15 text-match-gold' },
  { label: 'Settling', cls: 'bg-cipher-cyan/15 text-cipher-cyan animate-pulse-cipher' },
  { label: 'Settled', cls: 'bg-cipher-cyan/15 text-cipher-cyan' },
] as const;

export default function PositionsPage(): JSX.Element {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tightest">Positions</h1>
      <p className="mt-2 text-sm text-muted">
        Your sealed orders and their settlement state.
      </p>

      <Card className="mt-6 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-obsidian-700 text-xs uppercase tracking-widest text-muted">
            <tr>
              <th className="px-4 py-3 text-left">Match</th>
              <th className="px-4 py-3 text-left">Side</th>
              <th className="px-4 py-3 text-right">Price</th>
              <th className="px-4 py-3 text-right">Size</th>
              <th className="px-4 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-obsidian-700">
            {[0, 1, 2, 3].map((i) => (
              <tr key={i} className="hover:bg-obsidian-800/40">
                <td className="px-4 py-3">
                  <Cipher length={8} cadenceMs={1600} className="text-xs" />
                </td>
                <td className="px-4 py-3 font-mono text-muted">—</td>
                <td className="px-4 py-3 text-right font-mono text-muted">—</td>
                <td className="px-4 py-3 text-right font-mono text-muted">—</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs ${STATUS_BADGES[i % STATUS_BADGES.length]!.cls}`}
                  >
                    {STATUS_BADGES[i % STATUS_BADGES.length]!.label}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="mt-3 text-xs text-muted">
        Live data wired in P9 alongside the keeper-driven settlement loop.
      </p>
    </main>
  );
}
