'use client';

/**
 * YourOrders — the bottom-of-page table of your sealed orders. Because
 * we keep plaintext in the local zustand store at submit time, every
 * row here can render the real price/size; the live encrypted book only
 * shows them as ciphertext.
 *
 * Per UI_DESIGN.md §6.4 status badges (sealed / matched / settling /
 * settled / cancelled). Cancel button calls back into the local store —
 * P9 wires it to the on-chain `cancel_order` instruction.
 */

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  useOrderStore,
  type YourOrder,
  type Status,
} from '@/lib/order-state';
import { cn } from '@/lib/utils';

const STATUS_STYLE: Record<Status, { label: string; cls: string; tip: string }> = {
  sealed: {
    label: 'Sealed',
    cls: 'bg-obsidian-800 text-muted',
    tip: 'Encrypted in the book; awaiting a counterparty.',
  },
  matched: {
    label: 'Matched',
    cls: 'bg-match-gold/15 text-match-gold',
    tip: 'A crossing order was found. Settlement intent emitted.',
  },
  settling: {
    label: 'Settling',
    cls: 'bg-cipher-cyan/15 text-cipher-cyan animate-pulse-cipher',
    tip: 'Ika is signing the BTC tx. Solana will record the proof.',
  },
  settled: {
    label: 'Settled',
    cls: 'bg-cipher-cyan/15 text-cipher-cyan',
    tip: 'BTC tx broadcast and recorded on Solana.',
  },
  cancelled: {
    label: 'Cancelled',
    cls: 'bg-obsidian-800 text-muted line-through',
    tip: 'You cancelled this order before it filled.',
  },
};

export function YourOrders(): JSX.Element {
  const orders = useOrderStore((s) => s.yourOrders);
  const cancel = useOrderStore((s) => s.cancelOrder);

  if (orders.length === 0) {
    return (
      <Card className="mt-8 p-10 text-center">
        <p className="text-sm text-muted">
          Your first match will appear here.
        </p>
      </Card>
    );
  }

  return (
    <Card className="mt-8 overflow-hidden">
      <div className="border-b border-obsidian-700 px-5 py-3">
        <p className="text-xs uppercase tracking-widest text-muted">
          Your Orders
        </p>
      </div>
      <table className="w-full text-sm">
        <thead className="border-b border-obsidian-700 text-xs uppercase tracking-widest text-muted">
          <tr>
            <th className="px-5 py-3 text-left">ID</th>
            <th className="px-5 py-3 text-left">Side</th>
            <th className="px-5 py-3 text-right">Price (USDC)</th>
            <th className="px-5 py-3 text-right">Size (BTC)</th>
            <th className="px-5 py-3 text-left">Status</th>
            <th className="px-5 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-obsidian-700">
          {orders.map((o) => (
            <Row key={o.id} order={o} onCancel={() => cancel(o.id)} />
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Row({
  order,
  onCancel,
}: {
  order: YourOrder;
  onCancel: () => void;
}): JSX.Element {
  const style = STATUS_STYLE[order.status];
  const cancellable = order.status === 'sealed';
  return (
    <tr className="hover:bg-obsidian-800/40">
      <td className="px-5 py-3 font-mono text-xs">{order.id.slice(0, 8)}…</td>
      <td className="px-5 py-3">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 text-xs font-medium',
            order.side === 'bid' ? 'text-cipher-cyan' : 'text-bitcoin-ember',
          )}
        >
          <span
            className={cn(
              'h-3 w-1 rounded-sm',
              order.side === 'bid' ? 'bg-cipher-cyan' : 'bg-bitcoin-ember',
            )}
          />
          {order.side === 'bid' ? 'Bid' : 'Ask'}
        </span>
      </td>
      <td className="px-5 py-3 text-right font-mono">
        {order.priceUsdc.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </td>
      <td className="px-5 py-3 text-right font-mono">
        {order.sizeBtc.toFixed(3)}
      </td>
      <td className="px-5 py-3">
        <span
          title={style.tip}
          className={cn(
            'inline-flex items-center rounded-md px-2 py-0.5 text-xs',
            style.cls,
          )}
        >
          {style.label}
        </span>
      </td>
      <td className="px-5 py-3 text-right">
        {cancellable ? (
          <Button size="sm" variant="danger" onClick={onCancel}>
            Cancel
          </Button>
        ) : (
          <span className="text-xs text-muted">—</span>
        )}
      </td>
    </tr>
  );
}
