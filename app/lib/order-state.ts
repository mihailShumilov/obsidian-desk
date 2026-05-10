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
