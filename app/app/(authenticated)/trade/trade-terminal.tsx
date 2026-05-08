'use client';

/**
 * TradeTerminal — client-side orchestrator for /trade.
 *
 * Owns: form submission + encrypt choreography, order-store integration,
 * "Try Match" demo trigger + full MatchSettleModal lifecycle, and the
 * encrypted-book composition from zustand + synthetic filler.
 *
 * On-chain submission path: when the connected wallet has a dWallet from
 * the /deposit wizard AND `NEXT_PUBLIC_OBSIDIAN_MARKET` is configured, the
 * form submission goes through the Encrypt gRPC server action +
 * `submit_order` + `approve_btc_settlement` bundled tx via the wallet
 * adapter. When prerequisites are missing or the network call fails, the
 * page falls back to the local-only stub flow so the demo choreography
 * still works.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import {
  useAnchorWallet,
  useConnection,
  useWallet,
} from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import type { Idl } from '@coral-xyz/anchor';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChainBadge } from '@/components/obsidian/chain-badge';
import { OrderbookVoid } from '@/components/obsidian/orderbook-void';
import { OrderForm, type OrderFormSubmit } from '@/components/trade/order-form';
import { useDwalletStore } from '@/stores/dwallet';
import {
  prepareEncryptedOrderAction,
  getProgramSetupAction,
  type ProgramSetup,
} from './actions';
import {
  hexCtTo32,
  hexNonceTo16,
  submitOrderOnChain,
} from '@/lib/trade/submit-on-chain';

// lightweight-charts is ~80-120 KB gzipped and only renders after a layout
// pass — splitting it off the /trade critical path lets the orderbook +
// form paint immediately. SSR is disabled because the chart touches `window`.
const PriceChart = dynamic(
  () => import('@/components/trade/price-chart').then((m) => m.PriceChart),
  {
    ssr: false,
    loading: () => (
      <div className="h-[420px] animate-pulse rounded-md bg-obsidian-800/40" />
    ),
  },
);
import { YourOrders } from '@/components/trade/your-orders';
import {
  MatchSettleModal,
  settleStatusOffsets,
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

/**
 * Convert an Ika dWallet hex id (32 bytes hex-encoded) to a Solana
 * `PublicKey`. The dWallet store holds these as hex; the on-chain
 * `submit_order` ix expects the 32-byte raw form wrapped in a Pubkey.
 */
function dwalletHexToPubkey(hex: string): PublicKey {
  if (hex.length !== 64) {
    throw new Error(`dwallet id: expected 64 hex chars, got ${hex.length}`);
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return new PublicKey(bytes);
}

export function TradeTerminal(): JSX.Element {
  const wallet = useWallet();
  const anchorWallet = useAnchorWallet();
  const { connection } = useConnection();
  const dwallet = useDwalletStore((s) => s.dwallet);
  const yourOrders = useOrderStore((s) => s.yourOrders);
  const pushOrder = useOrderStore((s) => s.pushOrder);
  const setStatus = useOrderStore((s) => s.setStatus);

  const [toast, setToast] = useState<string | null>(null);
  const [match, setMatch] = useState<MatchInfo | null>(null);
  const matchCounter = useRef(0);

  // Lazy-loaded once per session via the server action — caches IDL +
  // market PDA + program ID on the server side. `null` while loading,
  // `{ idl: null }` when the IDL file isn't present on the server (laptop
  // without `anchor build` artefacts) — in that case we fall back to the
  // stub submission path.
  const [programSetup, setProgramSetup] = useState<ProgramSetup | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getProgramSetupAction()
      .then((s) => {
        if (!cancelled) setProgramSetup(s);
      })
      .catch(() => {
        if (!cancelled) setProgramSetup({ programId: '', marketPubkey: null, idl: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ?admin=1 unlocks demo helpers (Match all, Fast-forward).
  // Read once on mount; URL changes after that don't toggle the panel.
  const params = useSearchParams();
  const adminMode = params?.get('admin') === '1';
  const [fastSettle, setFastSettle] = useState(false);
  const matchQueueRef = useRef<string[]>([]);

  const yourIds = useMemo(
    () => new Set(yourOrders.map((o) => o.id)),
    [yourOrders],
  );
  const book = useMemo(() => bookView(yourOrders), [yourOrders]);

  /**
   * Are all the prerequisites in place for an on-chain submission? When
   * any of these are missing we fall through to the local-only stub flow
   * so the demo choreography still resolves.
   */
  const onChainReady =
    !!anchorWallet &&
    !!dwallet &&
    !!programSetup &&
    !!programSetup.idl &&
    !!programSetup.marketPubkey;

  async function handleSubmit(form: OrderFormSubmit): Promise<void> {
    if (onChainReady && anchorWallet && dwallet && programSetup?.marketPubkey && programSetup.idl) {
      try {
        await submitOnChain(form, anchorWallet, programSetup, dwallet.id);
        return;
      } catch (err) {
        // Surface the failure but still keep the local choreography alive
        // — the user shouldn't lose their order from the UI when the
        // network rejects it. Could be a wallet-rejected popup, RPC
        // outage, or expired order.
        const msg = err instanceof Error ? err.message : String(err);
        setToast(`On-chain submit failed — ${msg.slice(0, 80)} (kept locally)`);
        setTimeout(() => setToast(null), 6000);
      }
    }
    submitLocal(form);
  }

  function submitLocal(form: OrderFormSubmit): void {
    const nonce = new Uint8Array(16);
    globalThis.crypto.getRandomValues(nonce);
    const id = Array.from(nonce, (b) => b.toString(16).padStart(2, '0')).join('');
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
    setToast(`Order sealed — ${id.slice(0, 12)}…`);
    setTimeout(() => setToast(null), 4000);
  }

  async function submitOnChain(
    form: OrderFormSubmit,
    aw: NonNullable<typeof anchorWallet>,
    setup: ProgramSetup,
    dwalletHexId: string,
  ): Promise<void> {
    if (!setup.marketPubkey || !setup.idl) {
      throw new Error('on-chain submit: missing market or IDL');
    }
    // USDC → quote-units (×1e6); BTC → sats (×1e8).
    const priceQuote = BigInt(Math.round(form.priceUsdc * 1_000_000));
    const sizeBase = BigInt(Math.round(form.sizeBtc * 100_000_000));

    const blob = await prepareEncryptedOrderAction({
      side: form.side,
      priceQuote: priceQuote.toString(),
      sizeBase: sizeBase.toString(),
    });

    // Resolve the relative form expiry to an absolute slot the program
    // accepts.
    const currentSlot = BigInt(await connection.getSlot('confirmed'));
    const expirySlot = currentSlot + BigInt(form.expirySlots);

    const result = await submitOrderOnChain({
      connection,
      wallet: aw,
      idl: setup.idl as Idl,
      programId: new PublicKey(setup.programId),
      market: new PublicKey(setup.marketPubkey),
      sideCt: hexCtTo32(blob.sideCtHex),
      priceCt: hexCtTo32(blob.priceCtHex),
      sizeCt: hexCtTo32(blob.sizeCtHex),
      nonce: hexNonceTo16(blob.nonceHex),
      expirySlot,
      dwalletId: dwalletHexToPubkey(dwalletHexId),
      maxAmountSats: sizeBase,
    });

    pushOrder({
      id: blob.nonceHex,
      side: form.side,
      priceUsdc: form.priceUsdc,
      sizeBtc: form.sizeBtc,
      expirySlots: form.expirySlots,
      status: 'sealed',
      createdAt: Date.now(),
      txSignature: result.txSignature,
    });
    setToast(
      `Submitted — ${result.txSignature.slice(0, 16)}… (${blob.mode} encrypt)`,
    );
    setTimeout(() => setToast(null), 6000);
  }

  function startMatch(targetId: string): void {
    const target = yourOrders.find((o) => o.id === targetId);
    if (!target || target.status !== 'sealed') return;
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

    const { settlingAt, settledAt } = settleStatusOffsets(fastSettle);
    setTimeout(() => setStatus(target.id, 'settling'), settlingAt);
    setTimeout(() => setStatus(target.id, 'settled'), settledAt);
  }

  function handleTryMatch(): void {
    const sealed = yourOrders.filter((o) => o.status === 'sealed');
    if (sealed.length === 0) return;
    startMatch(sealed[0]!.id);
  }

  function handleMatchAll(): void {
    const sealed = yourOrders.filter((o) => o.status === 'sealed');
    if (sealed.length === 0) return;
    // Drain via the queue: kick off the first now, the rest after each
    // modal closes via onComplete below.
    matchQueueRef.current = sealed.slice(1).map((o) => o.id);
    startMatch(sealed[0]!.id);
  }

  function handleMatchComplete(): void {
    setMatch(null);
    const next = matchQueueRef.current.shift();
    if (next) {
      // Tiny gap so the modal unmount + remount feels intentional.
      setTimeout(() => startMatch(next), 150);
    }
  }

  const canSubmit = wallet.connected;

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <Header
        onTryMatch={handleTryMatch}
        canTry={yourOrders.some((o) => o.status === 'sealed')}
        adminMode={adminMode}
        onMatchAll={handleMatchAll}
        fastSettle={fastSettle}
        onToggleFast={() => setFastSettle((v) => !v)}
      />

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
          onComplete={handleMatchComplete}
          fast={fastSettle}
        />
      )}
    </main>
  );
}

function Header({
  onTryMatch,
  canTry,
  adminMode,
  onMatchAll,
  fastSettle,
  onToggleFast,
}: {
  onTryMatch: () => void;
  canTry: boolean;
  adminMode: boolean;
  onMatchAll: () => void;
  fastSettle: boolean;
  onToggleFast: () => void;
}): JSX.Element {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tightest">BTC / USDC</h1>
        <p className="text-xs uppercase tracking-widest text-muted">
          Encrypted book · Devnet{adminMode ? ' · admin' : ''}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {adminMode && (
          <>
            <button
              type="button"
              onClick={onToggleFast}
              className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs uppercase tracking-widest transition-colors ${
                fastSettle
                  ? 'border-cipher-cyan/60 bg-cipher-cyan/15 text-cipher-cyan'
                  : 'border-obsidian-700 text-muted hover:text-foreground'
              }`}
              title="Compress the §5.3 modal timing (10× faster) for demo runs"
            >
              <span
                className={`size-1.5 rounded-full ${
                  fastSettle ? 'bg-cipher-cyan' : 'bg-obsidian-600'
                }`}
              />
              Fast
            </button>
            <Button
              variant="secondary"
              onClick={onMatchAll}
              disabled={!canTry}
              title="Drain every sealed order through the §5.3 modal back-to-back"
            >
              Match all
            </Button>
          </>
        )}
        <Button
          variant={canTry ? 'primary' : 'secondary'}
          onClick={onTryMatch}
          disabled={!canTry}
          title={canTry ? 'Force-match your oldest sealed order' : 'Seal an order first'}
        >
          Try Match
        </Button>
      </div>
    </div>
  );
}
