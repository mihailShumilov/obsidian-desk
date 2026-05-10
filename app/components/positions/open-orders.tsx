'use client';

/**
 * OpenOrders — client island for /positions that lists every EncryptedOrder
 * PDA owned by the connected wallet (active, matched, cancelled, or
 * expired). Lets a user verify "my submit landed on-chain" even when the
 * order hasn't matched yet — the matches table only populates on
 * MatchRecord PDAs, which don't exist until two crossing orders meet.
 */

import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Card } from '@/components/ui/card';
import {
  listMyEncryptedOrdersAction,
  type OnChainOrderRow,
} from '@/app/(authenticated)/trade/actions';

const STATUS_STYLE: Record<OnChainOrderRow['status'], { label: string; cls: string }> = {
  active: { label: 'Open', cls: 'bg-match-gold/15 text-match-gold animate-pulse-cipher' },
  matched: { label: 'Matched', cls: 'bg-cipher-cyan/15 text-cipher-cyan' },
  cancelled: { label: 'Cancelled', cls: 'bg-obsidian-800 text-muted' },
  expired: { label: 'Expired', cls: 'bg-danger-red/15 text-danger-red' },
};

function truncate(s: string, n = 8): string {
  if (s.length <= n * 2 + 1) return s;
  return `${s.slice(0, n)}…${s.slice(-n)}`;
}

export function OpenOrders(): JSX.Element | null {
  const { publicKey, connected } = useWallet();
  const [rows, setRows] = useState<OnChainOrderRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connected || !publicKey) {
      setRows(null);
      return;
    }
    let cancelled = false;
    const wallet58 = publicKey.toBase58();
    setLoading(true);
    setError(null);
    void listMyEncryptedOrdersAction(wallet58)
      .then((r) => {
        if (cancelled) return;
        setRows(r);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    const id = setInterval(() => {
      void listMyEncryptedOrdersAction(wallet58)
        .then((r) => {
          if (!cancelled) setRows(r);
        })
        .catch(() => {});
    }, 20_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [publicKey, connected]);

  if (!connected) {
    return (
      <Card className="mt-6 p-5">
        <p className="text-xs uppercase tracking-widest text-muted">
          Your Open Orders
        </p>
        <p className="mt-2 text-sm text-muted">
          Connect a Solana wallet to see the EncryptedOrder PDAs you own.
        </p>
      </Card>
    );
  }

  if (loading && !rows) {
    return (
      <Card className="mt-6 p-5">
        <p className="text-xs uppercase tracking-widest text-muted">
          Your Open Orders
        </p>
        <div className="mt-3 h-12 animate-pulse rounded-md bg-obsidian-800/40" />
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="mt-6 border-danger-red/40 p-5">
        <p className="text-xs uppercase tracking-widest text-muted">
          Your Open Orders
        </p>
        <p className="mt-2 text-sm text-danger-red">
          Failed to load: {error}
        </p>
      </Card>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <Card className="mt-6 p-5">
        <p className="text-xs uppercase tracking-widest text-muted">
          Your Open Orders
        </p>
        <p className="mt-2 text-sm text-muted">
          No on-chain orders yet for this wallet.
        </p>
      </Card>
    );
  }

  return (
    <Card className="mt-6 overflow-hidden">
      <div className="flex items-baseline justify-between border-b border-obsidian-700 px-5 py-3">
        <p className="text-xs uppercase tracking-widest text-muted">
          Your Open Orders
        </p>
        <span className="text-[10px] uppercase tracking-widest text-muted">
          {rows.length} on-chain
        </span>
      </div>
      <table className="w-full text-sm">
        <thead className="border-b border-obsidian-700 text-xs uppercase tracking-widest text-muted">
          <tr>
            <th className="px-5 py-3 text-left">Nonce</th>
            <th className="px-5 py-3 text-left">PDA</th>
            <th className="px-5 py-3 text-right">Expiry slot</th>
            <th className="px-5 py-3 text-left">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-obsidian-700">
          {rows.map((r) => {
            const sb = STATUS_STYLE[r.status];
            return (
              <tr key={r.pda} className="hover:bg-obsidian-800/40">
                <td className="px-5 py-3 font-mono text-xs text-muted">
                  {truncate(r.nonceHex, 6)}
                </td>
                <td className="px-5 py-3 font-mono text-xs text-muted" title={r.pda}>
                  {truncate(r.pda)}
                </td>
                <td className="px-5 py-3 text-right font-mono text-xs">
                  {r.expirySlot}
                </td>
                <td className="px-5 py-3">
                  <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs ${sb.cls}`}>
                    {sb.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
