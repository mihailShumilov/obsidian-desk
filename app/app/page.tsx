/**
 * Landing — full P6 build per UI_DESIGN.md §6.1.
 * Sections: Hero → Problem → Solution → Why-Duality → Stats → CTA.
 * The shared shell (Header + Footer) is provided by app/layout.tsx.
 */

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { BookCube } from '@/components/landing/book-cube';
import { ProblemCards } from '@/components/landing/problem-cards';
import { SolutionDiagram } from '@/components/landing/solution-diagram';
import { WhyDuality } from '@/components/landing/why-duality';
import { StatsStrip } from '@/components/landing/stats-strip';

export default function LandingPage(): JSX.Element {
  return (
    <main>
      <Hero />
      <ProblemCards />
      <SolutionDiagram />
      <WhyDuality />
      <StatsStrip />
      <CtaStrip />
    </main>
  );
}

function Hero(): JSX.Element {
  return (
    <section className="relative isolate min-h-[92vh] overflow-hidden">
      {/* Ambient glow */}
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-glass"
        aria-hidden="true"
      />
      {/* Sparse cipher-rain in background — pure CSS dots, no JS */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        aria-hidden="true"
        style={{
          backgroundImage:
            'radial-gradient(circle, #00F5D4 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />

      <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 pb-20 pt-16 lg:grid-cols-[1.15fr_1fr] lg:gap-16 lg:py-24">
        <div className="flex flex-col">
          <p className="mb-6 inline-flex w-fit items-center gap-2 rounded-md border border-obsidian-700 bg-obsidian-900/60 px-2.5 py-1 text-xs uppercase tracking-widest text-cipher-cyan-dim">
            <span className="size-1.5 rounded-full bg-cipher-cyan animate-pulse-cipher" />
            Built on Solana · Settled on Bitcoin
          </p>
          <h1 className="text-4xl font-semibold leading-[1.05] tracking-tightest text-foreground sm:text-5xl lg:text-6xl">
            The dark pool where
            <br />
            <span className="text-cipher-cyan">Bitcoin</span> never leaves
            Bitcoin.
          </h1>
          <p className="mt-6 max-w-xl text-base text-muted sm:text-lg">
            Encrypted orderbook. FHE-matched. Native-settled. On Solana.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link href="/trade">
              <Button size="lg">Launch Terminal</Button>
            </Link>
            <Link href="/about">
              <Button size="lg" variant="secondary">
                Read the thesis
              </Button>
            </Link>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-md">
          <BookCube />
        </div>
      </div>
    </section>
  );
}

function CtaStrip(): JSX.Element {
  return (
    <section className="border-t border-obsidian-700">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-6 px-6 py-28 text-center">
        <h2 className="text-3xl font-semibold tracking-tightest text-foreground sm:text-4xl">
          Trade Bitcoin in the dark.
        </h2>
        <p className="max-w-xl text-sm text-muted sm:text-base">
          Devnet is open. Try a sealed order. Watch a match settle on
          signet. See a UTXO move without ever touching a bridge.
        </p>
        <Link href="/trade">
          <Button size="lg">Launch Terminal</Button>
        </Link>
      </div>
    </section>
  );
}
