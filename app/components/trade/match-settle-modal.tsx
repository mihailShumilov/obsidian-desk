'use client';

/**
 * MatchSettleModal — full §5.3 choreography (UI_DESIGN.md).
 *
 * Stage 1 — Beacon (800ms):     concentric rings + "MATCH DETECTED"
 * Stage 2 — Reveal (1200ms):    two cards slide in with anonymized counterparties
 * Stage 3 — Settlement (4000ms): split Solana ↔ Bitcoin panels w/ live progress
 *                                 + SettleThread shimmer between them
 * Stage 4 — Sealed (500ms):     compact top notification "Match #N settled"
 *
 * No real chain calls — the parent only mounts the modal when a match is
 * "detected" (debug button or future keeper events). The component owns
 * the timing and resolves via `onComplete(matchId)`.
 */

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChainBadge } from '@/components/obsidian/chain-badge';
import { SettleThread } from '@/components/obsidian/settle-thread';
import { cn } from '@/lib/utils';

export interface MatchInfo {
  matchId: number;
  buyer: { tag: string; dwallet: string };
  seller: { tag: string; dwallet: string };
  priceUsdc: number;
  sizeBtc: number;
}

type Stage = 'beacon' | 'reveal' | 'settle' | 'sealed' | 'done';

const SETTLE_STEPS_SOL = ['initiated', '33%', '66%', 'confirmed'];
const SETTLE_STEPS_BTC = ['signing', 'signed (1/T)', 'broadcast', '1 conf'];

export function MatchSettleModal({
  match,
  onComplete,
}: {
  match: MatchInfo;
  onComplete: (matchId: number) => void;
}): JSX.Element | null {
  const [stage, setStage] = useState<Stage>('beacon');

  useEffect(() => {
    const t1 = setTimeout(() => setStage('reveal'), 800);
    const t2 = setTimeout(() => setStage('settle'), 800 + 1200);
    const t3 = setTimeout(() => setStage('sealed'), 800 + 1200 + 4000);
    const t4 = setTimeout(() => {
      setStage('done');
      onComplete(match.matchId);
    }, 800 + 1200 + 4000 + 500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, [match.matchId, onComplete]);

  if (stage === 'done') return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="match settlement"
      className="fixed inset-0 z-50 bg-obsidian-950/90 backdrop-blur-md"
    >
      <AnimatePresence mode="wait">
        {stage === 'beacon' && <BeaconStage key="beacon" />}
        {stage === 'reveal' && <RevealStage key="reveal" match={match} />}
        {stage === 'settle' && <SettleStage key="settle" match={match} />}
        {stage === 'sealed' && <SealedStage key="sealed" match={match} />}
      </AnimatePresence>
    </div>
  );
}

/* ────────────────────────────── stages ────────────────────────────── */

function BeaconStage(): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="flex h-full flex-col items-center justify-center"
    >
      <div className="relative flex size-40 items-center justify-center">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="absolute size-40 rounded-full border-2 border-match-gold animate-beacon-expand"
            style={{ animationDelay: `${delay}ms` }}
            aria-hidden="true"
          />
        ))}
        <span className="relative size-4 rounded-full bg-match-gold shadow-[0_0_36px_rgba(255,209,102,0.8)]" />
      </div>
      <p className="mt-12 text-2xl uppercase text-match-gold" style={{ letterSpacing: '0.2em' }}>
        Match detected
      </p>
    </motion.div>
  );
}

function RevealStage({ match }: { match: MatchInfo }): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="flex h-full flex-col items-center justify-center px-6"
    >
      <div className="grid w-full max-w-5xl gap-6 lg:grid-cols-[1fr_auto_1fr]">
        <CounterpartyCard
          align="left"
          role="Bidder"
          tag={match.buyer.tag}
          dwallet={match.buyer.dwallet}
          chain="solana"
        />
        <MatchCenter match={match} />
        <CounterpartyCard
          align="right"
          role="Asker"
          tag={match.seller.tag}
          dwallet={match.seller.dwallet}
          chain="bitcoin"
        />
      </div>
    </motion.div>
  );
}

function MatchCenter({ match }: { match: MatchInfo }): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="flex min-w-[260px] flex-col items-center justify-center rounded-lg border border-cipher-cyan/40 bg-obsidian-900/80 px-6 py-4 text-center shadow-cipher"
    >
      <p className="text-xs uppercase tracking-widest text-cipher-cyan-dim">
        Match · #{match.matchId}
      </p>
      <p className="mt-3 font-mono text-2xl text-foreground">
        {match.sizeBtc.toFixed(3)} BTC
      </p>
      <p className="font-mono text-sm text-muted">
        @ ${match.priceUsdc.toLocaleString(undefined, { minimumFractionDigits: 2 })} USDC
      </p>
    </motion.div>
  );
}

function CounterpartyCard({
  align,
  role,
  tag,
  dwallet,
  chain,
}: {
  align: 'left' | 'right';
  role: string;
  tag: string;
  dwallet: string;
  chain: 'bitcoin' | 'solana';
}): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, x: align === 'left' ? -32 : 32 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-lg border border-obsidian-700 bg-obsidian-900 p-5 ring-inset-subtle"
    >
      <p className="text-xs uppercase tracking-widest text-muted">{role}</p>
      <p className="mt-2 font-mono text-lg text-foreground">{tag}</p>
      <div className="mt-4 flex items-center gap-2">
        <ChainBadge chain={chain} />
        <span className="font-mono text-xs text-muted">
          {dwallet.slice(0, 8)}…{dwallet.slice(-6)}
        </span>
      </div>
    </motion.div>
  );
}

function SettleStage({ match }: { match: MatchInfo }): JSX.Element {
  const [solStep, setSolStep] = useState(0);
  const [btcStep, setBtcStep] = useState(0);
  const [topMsg, setTopMsg] = useState('Ika is signing…');

  useEffect(() => {
    const ids = [
      setTimeout(() => {
        setSolStep(1);
        setBtcStep(1);
        setTopMsg('Encrypt revealed fill.');
      }, 900),
      setTimeout(() => {
        setSolStep(2);
        setBtcStep(2);
        setTopMsg('Bitcoin broadcasting…');
      }, 1900),
      setTimeout(() => {
        setSolStep(3);
        setBtcStep(3);
        setTopMsg('Confirmed.');
      }, 3000),
    ];
    return () => ids.forEach(clearTimeout);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="flex h-full flex-col items-center justify-center px-6"
    >
      <p className="mb-6 text-xs uppercase tracking-widest text-cipher-cyan-dim">
        {topMsg}
      </p>
      <div className="grid w-full max-w-5xl items-center gap-6 lg:grid-cols-[1fr_auto_1fr]">
        <SettlementPanel
          chain="solana"
          glow="rgba(168,85,247,0.18)"
          steps={SETTLE_STEPS_SOL}
          current={solStep}
          headline="USDC transferring"
        />
        <div className="flex h-px items-center justify-center lg:h-auto lg:w-32">
          <SettleThread />
        </div>
        <SettlementPanel
          chain="bitcoin"
          glow="rgba(255,138,0,0.18)"
          steps={SETTLE_STEPS_BTC}
          current={btcStep}
          headline="BTC settling"
        />
      </div>
      <p className="mt-8 font-mono text-xs text-muted">
        Match #{match.matchId} · {match.sizeBtc.toFixed(3)} BTC @ $
        {match.priceUsdc.toLocaleString(undefined, { minimumFractionDigits: 2 })}
      </p>
    </motion.div>
  );
}

function SettlementPanel({
  chain,
  glow,
  steps,
  current,
  headline,
}: {
  chain: 'bitcoin' | 'solana';
  glow: string;
  steps: ReadonlyArray<string>;
  current: number;
  headline: string;
}): JSX.Element {
  return (
    <div
      className="rounded-lg border border-obsidian-700 bg-obsidian-900/80 p-5 ring-inset-subtle"
      style={{ boxShadow: `0 0 80px ${glow}, inset 0 0 0 1px rgba(255,255,255,0.05)` }}
    >
      <ChainBadge chain={chain} />
      <p className="mt-3 text-xs uppercase tracking-widest text-muted">{headline}</p>
      <ul className="mt-3 space-y-1.5 text-sm">
        {steps.map((s, i) => (
          <li
            key={s}
            className={cn(
              'flex items-center gap-2 font-mono transition-colors duration-200 ease-snappy',
              i <= current ? 'text-foreground' : 'text-muted/50',
            )}
          >
            <span
              className={cn(
                'inline-block size-1.5 rounded-full',
                i < current
                  ? 'bg-cipher-cyan'
                  : i === current
                    ? 'bg-cipher-cyan animate-pulse-cipher'
                    : 'bg-obsidian-600',
              )}
              aria-hidden="true"
            />
            {s}
          </li>
        ))}
      </ul>
      {current >= steps.length - 1 && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="mt-3 inline-flex items-center gap-1.5 text-xs text-cipher-cyan"
        >
          <CheckIcon /> sealed
        </motion.div>
      )}
    </div>
  );
}

function SealedStage({ match }: { match: MatchInfo }): JSX.Element {
  return (
    <motion.div
      key="sealed"
      initial={{ y: -40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="absolute inset-x-0 top-0 mx-auto mt-4 w-fit rounded-md border border-cipher-cyan/40 bg-obsidian-900/95 px-4 py-2 text-sm shadow-cipher"
    >
      <span className="font-mono text-foreground">
        Match #{match.matchId} settled.
      </span>
      <span className="ml-3 text-cipher-cyan">View ↗</span>
    </motion.div>
  );
}

function CheckIcon(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M2 6.5 L5 9 L10 3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
