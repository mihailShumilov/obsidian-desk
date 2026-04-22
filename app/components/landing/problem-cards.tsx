/**
 * Problem section — 3 horizontally-aligned cards (stacked on mobile).
 * Each card has a small SVG illustration in cipher-cyan, a 1.5rem title,
 * and a one-sentence body in muted.
 *
 * Per UI_DESIGN.md §6.1 §2.
 */

import type { ReactNode } from 'react';

export function ProblemCards(): JSX.Element {
  return (
    <section className="border-t border-obsidian-700">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <p className="text-xs uppercase tracking-widest text-cipher-cyan-dim">
          The problem
        </p>
        <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tightest text-foreground sm:text-4xl">
          Three things break in every other dark pool.
        </h2>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          <Card
            title="Orders leak."
            body="Every L2 orderbook is a strategy leak. Watchers see your price, size, and timing — the market front-runs you before you fill."
            illustration={<ShatteringGlass />}
          />
          <Card
            title="Bridges break."
            body="Wrapped BTC depends on a custodian or a cross-chain proof you can't audit. Every bridge is a single point of catastrophic failure."
            illustration={<CrackedBridge />}
          />
          <Card
            title="Custodians control."
            body="If a venue holds your keys, it holds your fate. Withdrawal pauses, frozen assets, KYC creep — all downstream of custody."
            illustration={<LockedVault />}
          />
        </div>
      </div>
    </section>
  );
}

function Card({
  title,
  body,
  illustration,
}: {
  title: string;
  body: string;
  illustration: ReactNode;
}): JSX.Element {
  return (
    <div className="group relative overflow-hidden rounded-lg border border-obsidian-700 bg-obsidian-900 p-6 ring-inset-subtle transition-colors duration-200 ease-snappy hover:border-cipher-cyan/30">
      <div className="mb-5 flex h-20 items-center text-cipher-cyan-dim">
        {illustration}
      </div>
      <h3 className="text-2xl font-semibold tracking-tightest text-foreground">
        {title}
      </h3>
      <p className="mt-3 text-sm text-muted">{body}</p>
    </div>
  );
}

/* ────────────────────────────── illustrations ────────────────────────────── */

function ShatteringGlass(): JSX.Element {
  // Stylized orderbook ladder with a crack running through it
  return (
    <svg viewBox="0 0 80 80" className="size-20" fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
        <line x1="14" y1="20" x2="56" y2="20" opacity="0.85" />
        <line x1="14" y1="28" x2="48" y2="28" opacity="0.7" />
        <line x1="14" y1="36" x2="62" y2="36" opacity="0.85" />
        <line x1="14" y1="44" x2="40" y2="44" opacity="0.6" />
        <line x1="14" y1="52" x2="56" y2="52" opacity="0.85" />
        <line x1="14" y1="60" x2="46" y2="60" opacity="0.7" />
      </g>
      {/* Crack — bright zigzag */}
      <path
        d="M30 12 L46 26 L34 38 L52 50 L36 62 L54 70"
        stroke="#FF3E6A"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function CrackedBridge(): JSX.Element {
  // wBTC-ish coin with a crack and chain links
  return (
    <svg viewBox="0 0 80 80" className="size-20" fill="none" aria-hidden="true">
      <circle cx="40" cy="40" r="22" stroke="currentColor" strokeWidth="1.5" />
      <text
        x="40"
        y="46"
        textAnchor="middle"
        fontFamily="JetBrains Mono, ui-monospace, monospace"
        fontSize="14"
        fontWeight="700"
        fill="currentColor"
      >
        ₿
      </text>
      <path
        d="M22 18 L34 32 L26 42 L40 50 L30 60 L46 70"
        stroke="#FF3E6A"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity="0.9"
      />
      <circle cx="62" cy="22" r="3" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
      <circle cx="68" cy="14" r="3" stroke="currentColor" strokeWidth="1.2" opacity="0.3" />
    </svg>
  );
}

function LockedVault(): JSX.Element {
  return (
    <svg viewBox="0 0 80 80" className="size-20" fill="none" aria-hidden="true">
      <rect
        x="14"
        y="20"
        width="52"
        height="44"
        rx="4"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="40" cy="42" r="10" stroke="currentColor" strokeWidth="1.5" />
      <line x1="40" y1="32" x2="40" y2="36" stroke="currentColor" strokeWidth="1.5" />
      <line x1="40" y1="48" x2="40" y2="52" stroke="currentColor" strokeWidth="1.5" />
      <line x1="30" y1="42" x2="34" y2="42" stroke="currentColor" strokeWidth="1.5" />
      <line x1="46" y1="42" x2="50" y2="42" stroke="currentColor" strokeWidth="1.5" />
      <rect
        x="36"
        y="56"
        width="8"
        height="6"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}
