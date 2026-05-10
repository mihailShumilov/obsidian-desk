/**
 * Local order state for /trade.
 *
 * Persisted to localStorage so a refresh on /trade preserves the user's
 * sealed/settled tape. The full on-chain hydration (read EncryptedOrder
 * PDAs owned by the connected wallet) is a follow-up — until then the
 * local tape is the only place where "you submitted these orders" lives,
 * so wiping it on refresh just looked broken.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import type { Side } from '@obsidian-desk/sdk';

export type { Side };
export type Status = 'sealed' | 'matched' | 'settling' | 'settled' | 'cancelled';

export interface YourOrder {
  id: string;
  side: Side;
  priceUsdc: number;
  sizeBtc: number;
  expirySlots: number;
  status: Status;
  createdAt: number;
  txSignature?: string;
  /** On-chain order with no local plaintext — submitted from another device
   *  or after a localStorage wipe. The wizard renders "encrypted" instead
   *  of price/size and disables the local cancel button. Status is still
   *  authoritative because it comes from the on-chain enum. */
  encrypted?: boolean;
}

/** Minimal on-chain row shape — mirrors `OnChainOrderRow` from
 *  `app/(authenticated)/trade/actions.ts` to avoid circular imports. */
export interface OnChainOrderHydration {
  nonceHex: string;
  status: 'active' | 'matched' | 'cancelled' | 'expired';
}

export interface BookRow {
  id: string;
  /** Only set when this row is one of YOUR orders. */
  yours?: { side: Side; price: string; size: string };
}

interface OrderState {
  yourOrders: YourOrder[];
  // The "encrypted book" view — 14 mostly-anonymous rows with at most one
  // (or two) of YOUR rows highlighted. We synthesize the count so the book
  // never looks empty in the demo.
  pushOrder(o: YourOrder): void;
  cancelOrder(id: string): void;
  setStatus(id: string, status: Status): void;
  /** Merge the chain's view of the user's orders into the local tape.
   *  - If a row matches an existing local entry by nonce, advance its
   *    status (without clobbering local-only refinements like 'settling').
   *  - If no local entry exists, insert an `encrypted: true` placeholder. */
  hydrateFromChain(rows: OnChainOrderHydration[]): void;
}

function mergeStatus(local: Status, chain: OnChainOrderHydration['status']): Status {
  // Local 'settling'/'settled' carries finer-grained UI state (the demo
  // modal animation) that the chain enum doesn't model — preserve it.
  if (local === 'settled' || local === 'settling') return local;
  if (chain === 'active') return local === 'matched' ? 'matched' : 'sealed';
  if (chain === 'matched') return 'matched';
  return 'cancelled';
}

export const useOrderStore = create<OrderState>()(
  persist(
    (set) => ({
      yourOrders: [],
      pushOrder: (o) =>
        set((s) => ({ yourOrders: [o, ...s.yourOrders].slice(0, 50) })),
      cancelOrder: (id) =>
        set((s) => ({
          yourOrders: s.yourOrders.map((o) =>
            o.id === id ? { ...o, status: 'cancelled' } : o,
          ),
        })),
      setStatus: (id, status) =>
        set((s) => ({
          yourOrders: s.yourOrders.map((o) =>
            o.id === id ? { ...o, status } : o,
          ),
        })),
      hydrateFromChain: (rows) =>
        set((s) => {
          const byNonce = new Map(rows.map((r) => [r.nonceHex.toLowerCase(), r]));
          const merged = s.yourOrders.map((o) => {
            const chain = byNonce.get(o.id.toLowerCase());
            if (!chain) return o;
            byNonce.delete(o.id.toLowerCase());
            return { ...o, status: mergeStatus(o.status, chain.status) };
          });
          // Anything left in byNonce is on-chain but unknown to the local tape.
          const placeholders: YourOrder[] = Array.from(byNonce.values()).map((r) => ({
            id: r.nonceHex,
            // We don't know the side without the plaintext — render as 'ask'
            // by convention (UI clearly shows "encrypted" instead of values).
            side: 'ask' as Side,
            priceUsdc: 0,
            sizeBtc: 0,
            expirySlots: 0,
            status: mergeStatus('sealed', r.status),
            createdAt: 0,
            encrypted: true,
          }));
          return {
            yourOrders: [...placeholders, ...merged].slice(0, 50),
          };
        }),
    }),
    {
      name: 'obsidian:orders:v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ yourOrders: state.yourOrders }),
    },
  ),
);

/** Compose the 14-row encrypted book from your-active-orders + filler. */
export function bookView(yourOrders: YourOrder[]): BookRow[] {
  const active = yourOrders.filter(
    (o) => o.status === 'sealed' || o.status === 'matched',
  );
  const yours: BookRow[] = active.slice(0, 3).map((o) => ({
    id: o.id,
    yours: {
      side: o.side,
      price: o.priceUsdc.toFixed(2),
      size: o.sizeBtc.toFixed(3),
    },
  }));
  const filler: BookRow[] = Array.from(
    { length: Math.max(0, 14 - yours.length) },
    (_, i) => ({ id: `book-${i}` }),
  );
  return [...yours, ...filler];
}
