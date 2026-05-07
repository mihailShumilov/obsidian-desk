'use client';

/**
 * BtcJourney — concrete five-stage trade-ticket infographic.
 *
 * Replaces the abstract Trader→…→Bitcoin diagram. Built entirely from the
 * existing obsidian/* primitives (Cipher, ember/gold/cyan accents) so the
 * landing page reads as a preview of /trade rather than a separate marketing
 * layer.
 *
 * Rail vocabulary:
 *   ember  (#FF8A00) — real Bitcoin moments (FUND + BROADCAST)
 *   cyan-dim         — encrypted-on-Solana moments (SEAL + COMPARE)
 *   match-gold       — co-sign moment (CO-SIGN)
 *
 * Stages cascade on `useInView`. `useReducedMotion` snaps directly to the
 * settled state (framer-motion ignores the global CSS reduced-motion rule
 * since it animates via requestAnimationFrame).
 */

import { motion, useInView, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { Cipher } from '@/components/obsidian/cipher';
import type { SignetTip } from '@/lib/signet';
import { cn } from '@/lib/utils';

type Accent = 'ember' | 'cyan' | 'gold';

interface Stage {
  n: string;
  label: 'FUND' | 'SEAL' | 'COMPARE' | 'CO-SIGN' | 'BROADCAST';
  above: string;
  accent: Accent;
}

const STAGES: ReadonlyArray<Stage> = [
  {
    n: '01',
    label: 'FUND',
    above: 'Send signet BTC to your dWallet from any wallet.',
    accent: 'ember',
  },
  {
    n: '02',
    label: 'SEAL',
    above: 'Your order is encrypted before it touches Solana.',
    accent: 'cyan',
  },
  {
    n: '03',
    label: 'COMPARE',
    above: 'The keeper finds matches without decrypting either side.',
    accent: 'cyan',
  },
  {
    n: '04',
    label: 'CO-SIGN',
    above: 'You + the Ika network jointly sign a real BTC transaction.',
    accent: 'gold',
  },
  {
    n: '05',
    label: 'BROADCAST',
    above: 'The counterparty receives a native UTXO. No bridge.',
    accent: 'ember',
  },
];

const STEP_MS = 750;

export interface BtcJourneyProps {
  /** Live signet tip — falls back to demo placeholders when null. */
  tip?: SignetTip | null;
}

export function BtcJourney({ tip = null }: BtcJourneyProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.35, once: true });
  const reduced = useReducedMotion();
  const [active, setActive] = useState<number>(-1);

  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      setActive(STAGES.length - 1);
      return;
    }
    setActive(0);
    let i = 0;
    const id = window.setInterval(() => {
      i++;
      if (i >= STAGES.length) {
        window.clearInterval(id);
        return;
      }
      setActive(i);
    }, STEP_MS);
    return () => window.clearInterval(id);
  }, [inView, reduced]);

  const settled = active === STAGES.length - 1;

  return (
    <section ref={ref} className="relative isolate border-t border-obsidian-700">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <Header settled={settled} reduced={!!reduced} tip={tip} />

        {/* DESKTOP — horizontal evidence rail */}
        <div className="mt-16 hidden lg:block">
          <RailDesktop active={active} reduced={!!reduced} tip={tip} />
        </div>

        {/* MOBILE — vertical sequence */}
        <ol className="mt-12 space-y-8 lg:hidden">
          {STAGES.map((stage, i) => (
            <StageMobile
              key={stage.n}
              stage={stage}
              active={i <= active}
              current={i === active}
              reduced={!!reduced}
              tip={tip}
            />
          ))}
        </ol>

        <p className="mt-14 text-center text-xs italic tracking-wide text-muted">
          The chain sees ciphertext. You see the trade.
        </p>
      </div>
    </section>
  );
}

/* ─────────────────────────────── header ─────────────────────────────── */

function Header({
  settled,
  reduced,
  tip,
}: {
  settled: boolean;
  reduced: boolean;
  tip: SignetTip | null;
}): JSX.Element {
  const blockLabel = tip
    ? `BLOCK ${tip.height.toLocaleString()}`
    : 'BLOCK 234,861';
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-cipher-cyan-dim/80">
        OBSIDIANDESK · TICKET 0001 · TRADER-SEALED · SIGNET ·{' '}
        <span className={tip ? 'text-cipher-cyan' : undefined}>{blockLabel}</span>
        {tip && (
          <span
            className="ml-2 inline-block size-1.5 translate-y-[-1px] rounded-full bg-cipher-cyan animate-pulse-cipher align-middle"
            aria-label="live"
          />
        )}
      </p>
      <div className="mt-2 flex h-px w-full items-center bg-obsidian-700">
        <span className="h-px w-32 bg-cipher-cyan-dim/60" />
      </div>

      <p className="mt-10 text-xs uppercase tracking-widest text-cipher-cyan-dim">
        How a Bitcoin trade clears
      </p>
      <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tightest text-foreground sm:text-4xl">
        From any BTC wallet to a confirmed UTXO.
        <br />
        <span className="text-muted">Encrypted the entire way.</span>
      </h2>
      <p className="mt-4 max-w-2xl text-sm text-muted">
        Five steps. The chain only sees ciphertext until the moment a real
        Bitcoin transaction is broadcast — and you sign every byte of that
        transaction with your dWallet.
      </p>

      <motion.span
        initial={{ opacity: 0, y: 4 }}
        animate={settled ? { opacity: 1, y: 0 } : { opacity: 0, y: 4 }}
        transition={{ duration: reduced ? 0 : 0.4 }}
        className="mt-5 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-bitcoin-ember"
        aria-live="polite"
      >
        <span className="size-1.5 rounded-full bg-bitcoin-ember shadow-[0_0_8px_rgba(255,138,0,0.9)]" />
        // SETTLED · NATIVE BTC · NO BRIDGE
      </motion.span>
    </div>
  );
}

/* ─────────────────────────── desktop rail ───────────────────────────── */

function RailDesktop({
  active,
  reduced,
  tip,
}: {
  active: number;
  reduced: boolean;
  tip: SignetTip | null;
}): JSX.Element {
  const progress = active < 0 ? 0 : (active + 1) / STAGES.length;
  const satLeft = active < 0 ? 0 : ((active + 0.5) * 100) / STAGES.length;

  return (
    <div>
      {/* Above-rail row */}
      <div className="grid grid-cols-5 gap-6">
        {STAGES.map((stage, i) => (
          <AboveCell key={stage.n} stage={stage} active={i <= active} reduced={reduced} />
        ))}
      </div>

      {/* The rail itself */}
      <div className="relative mt-8 h-14">
        {/* Static dim hairline */}
        <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-obsidian-700" />

        {/* Lit progress hairline — cyan core, ember leading edge */}
        <motion.div
          className="absolute left-0 top-1/2 h-px origin-left -translate-y-1/2 bg-gradient-to-r from-cipher-cyan via-cipher-cyan to-bitcoin-ember shadow-[0_0_10px_rgba(0,245,212,0.45)]"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: progress }}
          transition={{ duration: reduced ? 0 : 0.55, ease: [0.16, 1, 0.3, 1] }}
          style={{ width: '100%' }}
          aria-hidden="true"
        />

        {/* Stations grid */}
        <div className="absolute inset-0 grid grid-cols-5">
          {STAGES.map((stage, i) => (
            <Plate
              key={stage.n}
              stage={stage}
              active={i <= active}
              current={i === active}
            />
          ))}
        </div>

        {/* Travelling ember sat */}
        {active >= 0 && (
          <motion.span
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
            initial={{ left: `${satLeft}%`, opacity: 0 }}
            animate={{ left: `${satLeft}%`, opacity: 1 }}
            transition={{
              left: { duration: reduced ? 0 : 0.6, ease: [0.16, 1, 0.3, 1] },
              opacity: { duration: 0.2 },
            }}
            aria-hidden="true"
          >
            <span className="block size-2.5 rounded-full bg-bitcoin-ember shadow-[0_0_18px_rgba(255,138,0,0.9)] animate-pulse-cipher" />
          </motion.span>
        )}
      </div>

      {/* Below-rail row */}
      <div className="mt-8 grid grid-cols-5 gap-6">
        {STAGES.map((stage, i) => (
          <BelowCell
            key={stage.n}
            stage={stage}
            active={i <= active}
            reduced={reduced}
            tip={tip}
          />
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────── cells ─────────────────────────────── */

function AboveCell({
  stage,
  active,
  reduced,
}: {
  stage: Stage;
  active: boolean;
  reduced: boolean;
}): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={active ? { opacity: 1, y: 0 } : { opacity: 0.28, y: 6 }}
      transition={{ duration: reduced ? 0 : 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col"
    >
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[28px] font-semibold leading-none tracking-tightest text-foreground">
          {stage.n}
        </span>
        <span
          className={cn(
            'font-mono text-[10px] uppercase tracking-[0.32em]',
            accentText(stage.accent),
          )}
        >
          {stage.label}
        </span>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted">{stage.above}</p>
    </motion.div>
  );
}

function BelowCell({
  stage,
  active,
  reduced,
  tip,
}: {
  stage: Stage;
  active: boolean;
  reduced: boolean;
  tip: SignetTip | null;
}): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: active ? 1 : 0.18 }}
      transition={{ duration: reduced ? 0 : 0.4 }}
      className="font-mono text-[11px] leading-relaxed text-muted"
    >
      <span className="block text-[9px] uppercase tracking-[0.3em] text-muted/60">
        chain sees
      </span>
      <span className="mt-1 block">
        <ChainPayload stage={stage} tip={tip} />
      </span>
    </motion.div>
  );
}

function ChainPayload({
  stage,
  tip,
}: {
  stage: Stage;
  tip: SignetTip | null;
}): JSX.Element {
  switch (stage.label) {
    case 'FUND':
      return (
        <>
          <span className="block text-foreground/85">bc1q…desk</span>
          <span className="block text-bitcoin-ember">+250,000 sat</span>
        </>
      );
    case 'SEAL':
      return (
        <span className="block truncate">
          <Cipher length={16} cadenceMs={1200} />
        </span>
      );
    case 'COMPARE':
      return (
        <span className="flex flex-col gap-1">
          <Cipher length={14} cadenceMs={1100} />
          <span className="text-cipher-cyan-dim/40">↔</span>
          <Cipher length={14} cadenceMs={1300} />
        </span>
      );
    case 'CO-SIGN':
      return (
        <>
          <span className="block">
            <span className="text-match-gold">2 / 2</span> threshold
          </span>
          <span className="block text-muted/70">ika.signet</span>
        </>
      );
    case 'BROADCAST': {
      const txidPrefix = tip ? `${tip.txid.slice(0, 6)}…` : '6f0c…';
      const blockNo = tip ? tip.height.toLocaleString() : '234,861';
      return (
        <>
          <span className="block">
            <span className="text-bitcoin-ember">txid</span> {txidPrefix}
          </span>
          <span className="block text-muted/70">block {blockNo}</span>
        </>
      );
    }
  }
}

/* ─────────────────────────── station plate ─────────────────────────── */

function Plate({
  stage,
  active,
  current,
}: {
  stage: Stage;
  active: boolean;
  current: boolean;
}): JSX.Element {
  return (
    <div className="relative flex items-center justify-center">
      <span
        className={cn(
          'relative z-10 grid size-11 place-items-center rounded-sm border bg-obsidian-950 transition-colors duration-300 ring-inset-subtle',
          active ? accentBorder(stage.accent) : 'border-obsidian-700',
        )}
      >
        <Glyph kind={stage.label} accent={active ? stage.accent : 'mute'} />
      </span>

      {/* Match-beacon ring fires once when the CO-SIGN stage becomes current */}
      {current && stage.label === 'CO-SIGN' && (
        <span
          key={stage.n}
          className="pointer-events-none absolute size-11 rounded-sm border-2 border-match-gold animate-beacon-expand"
          aria-hidden="true"
        />
      )}
    </div>
  );
}

/* ────────────────────────── mobile sequence ────────────────────────── */

function StageMobile({
  stage,
  active,
  current,
  reduced,
  tip,
}: {
  stage: Stage;
  active: boolean;
  current: boolean;
  reduced: boolean;
  tip: SignetTip | null;
}): JSX.Element {
  return (
    <motion.li
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: active ? 1 : 0.3, x: 0 }}
      transition={{ duration: reduced ? 0 : 0.4 }}
      className="relative flex gap-4 pl-2"
    >
      {/* Vertical rail tick */}
      <span
        className={cn(
          'absolute left-0 top-2 h-full w-px',
          active ? accentBg(stage.accent) : 'bg-obsidian-700',
        )}
        aria-hidden="true"
      />
      <Plate stage={stage} active={active} current={current} />
      <div className="flex flex-1 flex-col">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-xl font-semibold leading-none tracking-tightest text-foreground">
            {stage.n}
          </span>
          <span
            className={cn(
              'font-mono text-[10px] uppercase tracking-[0.32em]',
              accentText(stage.accent),
            )}
          >
            {stage.label}
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted">{stage.above}</p>
        <div className="mt-2 font-mono text-[11px] leading-relaxed text-muted">
          <ChainPayload stage={stage} tip={tip} />
        </div>
      </div>
    </motion.li>
  );
}

/* ─────────────────────────────── glyphs ────────────────────────────── */

function Glyph({
  kind,
  accent,
}: {
  kind: Stage['label'];
  accent: Accent | 'mute';
}): JSX.Element {
  const c =
    accent === 'ember'
      ? '#FF8A00'
      : accent === 'gold'
        ? '#FFD166'
        : accent === 'cyan'
          ? '#00B39A'
          : '#3A3A4D';

  const stroke = { stroke: c, strokeWidth: 1.4, fill: 'none' } as const;

  switch (kind) {
    case 'FUND':
      return (
        <svg viewBox="0 0 20 20" className="size-5" {...stroke} aria-hidden="true">
          <rect x="3.5" y="3.5" width="13" height="13" rx="1" />
          <path d="M8 6 v8 M11 6 v8 M7.5 6.5 h4.2 a1.6 1.6 0 0 1 0 3.2 H7.5 M7.5 9.7 h4.6 a1.6 1.6 0 0 1 0 3.2 H7.5" />
        </svg>
      );
    case 'SEAL':
      return (
        <svg viewBox="0 0 20 20" className="size-5" {...stroke} aria-hidden="true">
          <rect x="5" y="9" width="10" height="8" rx="1" />
          <path d="M7.2 9 V6.4 a2.8 2.8 0 0 1 5.6 0 V9" />
          <circle cx="10" cy="13" r="1" fill={c} stroke="none" />
        </svg>
      );
    case 'COMPARE':
      return (
        <svg viewBox="0 0 20 20" className="size-5" {...stroke} aria-hidden="true">
          <line x1="3.5" y1="7" x2="13.5" y2="7" />
          <line x1="3.5" y1="10" x2="11" y2="10" />
          <line x1="3.5" y1="13" x2="13.5" y2="13" />
          <path d="M14.5 4.5 L17 10 L14.5 15.5" />
        </svg>
      );
    case 'CO-SIGN':
      return (
        <svg viewBox="0 0 20 20" className="size-5" {...stroke} aria-hidden="true">
          <circle cx="6" cy="6" r="2.4" />
          <path d="M7.7 7.7 L13 13" />
          <path d="M11.5 13 H13.2 V14.7" />
          <circle cx="14" cy="6" r="2.4" />
          <path d="M12.3 7.7 L7 13" />
          <path d="M8.5 13 H6.8 V14.7" />
        </svg>
      );
    case 'BROADCAST':
      return (
        <svg viewBox="0 0 20 20" className="size-5" {...stroke} aria-hidden="true">
          <path d="M10 7 V16" />
          <path d="M7.5 9 a3.2 3.2 0 0 1 5 0" />
          <path d="M5.5 7 a6 6 0 0 1 9 0" />
          <circle cx="10" cy="6" r="0.9" fill={c} stroke="none" />
        </svg>
      );
  }
}

/* ─────────────────────────────── helpers ────────────────────────────── */

function accentText(a: Accent): string {
  return a === 'ember'
    ? 'text-bitcoin-ember'
    : a === 'gold'
      ? 'text-match-gold'
      : 'text-cipher-cyan-dim';
}

function accentBorder(a: Accent): string {
  return a === 'ember'
    ? 'border-bitcoin-ember/60'
    : a === 'gold'
      ? 'border-match-gold/60'
      : 'border-cipher-cyan/60';
}

function accentBg(a: Accent): string {
  return a === 'ember'
    ? 'bg-bitcoin-ember/60'
    : a === 'gold'
      ? 'bg-match-gold/60'
      : 'bg-cipher-cyan/50';
}
