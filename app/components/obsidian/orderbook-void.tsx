'use client';

/**
 * OrderbookVoid — the encrypted-orderbook visual at the heart of /trade.
 *
 * Renders N rows of cipher-line orders. Each row shows:
 *   - a desaturated side block (you can't tell bid from ask),
 *   - a slowly-mutating mono ciphertext (UI_DESIGN.md §6.2),
 *   - a tiny "expires" hint, also encrypted-looking.
 *
 * Rows whose id is in `yourOrderIds` get a cipher-cyan left border + show
 * the *real* decrypted price/size (because you know your own data).
 *
 * Footer: `The book is encrypted on-chain. Your view is the fog.`
 */

import type { Side } from '@obsidian-desk/sdk';
import { Cipher } from './cipher';
import { cn } from '@/lib/utils';

export interface EncryptedOrderView {
  id: string;
  /** Plaintext price/size only when this is one of YOUR orders. */
  yours?: { side: Side; price: string; size: string };
}

export interface OrderbookVoidProps {
  orders: ReadonlyArray<EncryptedOrderView>;
  yourOrderIds?: ReadonlySet<string>;
  className?: string;
}

export function OrderbookVoid({
  orders,
  yourOrderIds,
  className,
}: OrderbookVoidProps): JSX.Element {
  const yours = yourOrderIds ?? new Set<string>();
  return (
    <div className={cn('flex flex-col', className)}>
      <div className="flex flex-col divide-y divide-obsidian-700">
        {orders.map((o) => {
          const isYours = yours.has(o.id) && o.yours !== undefined;
          return (
            <Row
              key={o.id}
              orderId={o.id}
              isYours={isYours}
              yours={o.yours}
            />
          );
        })}
      </div>
      <p className="mt-4 text-xs text-muted">
        The book is encrypted on-chain. Your view is the fog.
      </p>
    </div>
  );
}

function Row({
  orderId,
  isYours,
  yours,
}: {
  orderId: string;
  isYours: boolean;
  yours?: { side: Side; price: string; size: string };
}): JSX.Element {
  return (
    <div
      className={cn(
        'flex items-center gap-3 py-2.5 pl-3 pr-2 text-xs transition-colors',
        isYours
          ? 'border-l-2 border-cipher-cyan bg-cipher-cyan/[0.03]'
          : 'border-l-2 border-transparent',
      )}
    >
      {/* Desaturated side block — when "yours", recolor to its real side */}
      <span
        className={cn(
          'h-4 w-1.5 rounded-sm',
          isYours
            ? yours!.side === 'bid'
              ? 'bg-cipher-cyan'
              : 'bg-bitcoin-ember'
            : 'bg-obsidian-600',
        )}
        aria-hidden="true"
      />
      {isYours ? (
        <>
          <span className="font-mono text-foreground">{yours!.price}</span>
          <span className="font-mono text-muted">×</span>
          <span className="font-mono text-foreground">{yours!.size}</span>
          <span className="ml-auto text-[10px] uppercase tracking-widest text-cipher-cyan-dim">
            yours
          </span>
        </>
      ) : (
        <>
          <Cipher length={24} cadenceMs={1200} />
          <span className="ml-auto font-mono text-[10px] text-muted">
            <Cipher length={6} cadenceMs={1600} className="text-muted/70" />
          </span>
        </>
      )}
    </div>
  );
}
