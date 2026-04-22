'use client';

/**
 * TradeTerminal — client-side orchestrator for /trade.
 *
 * Owns: form submission + encrypt choreography, order-store integration,
 * "Try Match" demo trigger + full MatchSettleModal lifecycle, and the
 * encrypted-book composition from zustand + synthetic filler.
 *
 * Real Anchor `submitOrder` call lands in P9 alongside WS subscriptions;
 * P7 wires the SDK `encryptOrder` so the choreography has real ciphertext
 * to show in the debug toast — but we don't submit to chain yet.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { encrypt } from '@obsidian-desk/sdk';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChainBadge } from '@/components/obsidian/chain-badge';
import { OrderbookVoid } from '@/components/obsidian/orderbook-void';
import { PriceChart } from '@/components/trade/price-chart';
import { OrderForm, type OrderFormSubmit } from '@/components/trade/order-form';
import { YourOrders } from '@/components/trade/your-orders';
import {
  MatchSettleModal,
  type MatchInfo,
} from '@/components/trade/match-settle-modal';
import {
  useOrderStore,
  bookView,
  type YourOrder,
} from '@/lib/order-state';

function rand32(): string {
  return Array.from({ length: 8 }, () =>
    Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, '0'),
  ).join('');
}

function anonTag(prefix: string): string {
  return `${prefix} #${Math.floor(Math.random() * 0xFFFF)
    .toString(16)
    .toUpperCase()
    .padStart(4, '0')}`;
}

function anonAddr(): string {
  return `tb1q${rand32().slice(0, 36)}`;
}

export function TradeTerminal(): JSX.Element {
  const wallet = useWallet();
  const yourOrders = useOrderStore((s) => s.yourOrders);
  const pushOrder = useOrderStore((s) => s.pushOrder);
  const setStatus = useOrderStore((s) => s.setStatus);

  const [toast, setToast] = useState<string | null>(null);
  const [match, setMatch] = useState<MatchInfo | null>(null);
  const matchCounter = useRef(0);

  const yourIds = useMemo(
    () => new Set(yourOrders.map((o) => o.id)),
    [yourOrders],
  );
  const book = useMemo(() => bookView(yourOrders), [yourOrders]);

  async function handleSubmit(form: OrderFormSubmit): Promise<void> {
    // Actual FHE encrypt (mock mode) — returns real CT bytes we can use
    // for the toast. Does not touch Solana yet (P9 wires submitOrder).
    const blob = await encrypt.encryptOrder(
      form.side === 'bid' ? 'bid' : 'ask',
      BigInt(Math.round(form.priceUsdc * 1_000_000)),
      BigInt(Math.round(form.sizeBtc * 100_000_000)),
    );

    const id = Buffer.from(blob.nonce).toString('hex');
    const next: YourOrder = {
      id,
      side: form.side,
      priceUsdc: form.priceUsdc,
      sizeBtc: form.sizeBtc,
      expirySlots: form.expirySlots,
      status: 'sealed',
      createdAt: Date.now(),
      txSignature: undefined,
    };
    pushOrder(next);

    // Stub toast — real tx sig lands in P9.
    setToast(`Order sealed — ${id.slice(0, 12)}…`);
    setTimeout(() => setToast(null), 4000);
  }

  function handleTryMatch(): void {
    const sealed = yourOrders.filter((o) => o.status === 'sealed');
    if (sealed.length === 0) return;
    const target = sealed[0]!;
    setStatus(target.id, 'matched');

    matchCounter.current += 1;
    const me = wallet.publicKey?.toBase58() ?? 'You';
    const info: MatchInfo = {
      matchId: matchCounter.current,
      buyer:
        target.side === 'bid'
          ? { tag: `Bidder ${me.slice(0, 4).toUpperCase()}`, dwallet: anonAddr() }
          : { tag: anonTag('Bidder'), dwallet: anonAddr() },
      seller:
        target.side === 'ask'
          ? { tag: `Asker ${me.slice(0, 4).toUpperCase()}`, dwallet: anonAddr() }
          : { tag: anonTag('Asker'), dwallet: anonAddr() },
      priceUsdc: target.priceUsdc,
      sizeBtc: target.sizeBtc,
    };
    setMatch(info);

    // Transition statuses through the modal arc so the YourOrders table
    // stays in sync with what the modal shows.
    setTimeout(() => setStatus(target.id, 'settling'), 800 + 1200);
    setTimeout(() => setStatus(target.id, 'settled'), 800 + 1200 + 4000);
  }

  const canSubmit = wallet.connected;

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <Header onTryMatch={handleTryMatch} canTry={yourOrders.some((o) => o.status === 'sealed')} />

      <div className="grid gap-6 lg:grid-cols-[minmax(260px,0.9fr)_minmax(480px,1.5fr)_minmax(300px,1fr)]">
        {/* Left — encrypted book */}
        <Card className="p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <p className="text-xs uppercase tracking-widest text-muted">
              Order Book
            </p>
            <span className="text-[10px] uppercase tracking-widest text-cipher-cyan-dim">
              14 encrypted
            </span>
          </div>
          {book.every((r) => !r.yours) && yourOrders.length === 0 ? (
            <p className="px-2 py-6 text-sm text-muted">
              The book is silent. Good traders are patient.
            </p>
          ) : (
            <OrderbookVoid orders={book} yourOrderIds={yourIds} />
          )}
        </Card>

        {/* Center — chart */}
        <Card className="p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <p className="text-xs uppercase tracking-widest text-muted">
              BTC / USDC
            </p>
            <span className="font-mono text-xs text-muted">1m</span>
          </div>
          <PriceChart />
        </Card>

        {/* Right — order form + wallet */}
        <Card className="p-5">
          <p className="mb-4 text-xs uppercase tracking-widest text-muted">
            New Order
          </p>
          <OrderForm
            onSubmit={handleSubmit}
            disabledReason={canSubmit ? undefined : 'Connect wallet'}
          />

          <div className="mt-6 border-t border-obsidian-700 pt-4">
            <p className="mb-2 text-xs uppercase tracking-widest text-muted">
              Your dWallet
            </p>
            {canSubmit ? (
              <div className="flex items-center justify-between text-sm">
                <ChainBadge chain="bitcoin" />
                <span className="font-mono text-xs text-muted">
                  Lock one in /deposit
                </span>
              </div>
            ) : (
              <p className="text-xs text-muted">
                Create your dWallet to trade.
              </p>
            )}
          </div>
        </Card>
      </div>

      <YourOrders />

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-40 max-w-sm rounded-md border border-cipher-cyan/40 bg-obsidian-900/95 px-4 py-3 text-sm shadow-cipher"
        >
          <p className="font-mono text-foreground">{toast}</p>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted">
            <ChainBadge chain="solana" />
            <span>Waiting for match.</span>
          </div>
        </div>
      )}

      {match && (
        <MatchSettleModal
          match={match}
          onComplete={() => setMatch(null)}
        />
      )}
    </main>
  );
}

function Header({
  onTryMatch,
  canTry,
}: {
  onTryMatch: () => void;
  canTry: boolean;
}): JSX.Element {
  return (
    <div className="mb-6 flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tightest">BTC / USDC</h1>
        <p className="text-xs uppercase tracking-widest text-muted">
          Encrypted book · Devnet
        </p>
      </div>
      <Button
        variant={canTry ? 'primary' : 'secondary'}
        onClick={onTryMatch}
        disabled={!canTry}
        title={canTry ? 'Force-match your oldest sealed order' : 'Seal an order first'}
      >
        Try Match
      </Button>
    </div>
  );
}
