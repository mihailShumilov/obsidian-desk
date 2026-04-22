/**
 * / — Landing page. P5 ships the structural stub only — the wow-cube,
 * scroll-triggered diagrams, and stats strip land in P6.
 */

import Link from 'next/link';
import { Cipher } from '@/components/obsidian/cipher';
import { Button } from '@/components/ui/button';

export default function LandingPage(): JSX.Element {
  return (
    <main>
      <Hero />
      <Problem />
      <SolutionStub />
      <CtaStrip />
    </main>
  );
}

function Hero(): JSX.Element {
  return (
    <section className="relative isolate overflow-hidden">
      <div
        className="absolute inset-0 bg-gradient-glass"
        aria-hidden="true"
      />
      <div className="mx-auto grid max-w-7xl gap-10 px-6 py-20 lg:grid-cols-[1.2fr_1fr] lg:py-28">
        <div className="flex flex-col justify-center">
          <p className="mb-5 inline-flex w-fit items-center gap-2 rounded-md border border-obsidian-700 bg-obsidian-900/60 px-2.5 py-1 text-xs uppercase tracking-widest text-cipher-cyan-dim">
            <span className="size-1.5 rounded-full bg-cipher-cyan" />
            Built on Solana · Settled on Bitcoin
          </p>
          <h1 className="text-4xl font-semibold tracking-tightest text-foreground sm:text-5xl lg:text-6xl">
            The dark pool where
            <br />
            <span className="text-cipher-cyan">Bitcoin</span> never leaves Bitcoin.
          </h1>
          <p className="mt-6 max-w-xl text-base text-muted">
            Encrypted orderbook. FHE-matched. Native-settled. On Solana.
          </p>
          <div className="mt-8 flex items-center gap-4">
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

        {/* Cube placeholder — P6 replaces with @react-three/fiber boxGeometry */}
        <div className="relative flex aspect-square items-center justify-center">
          <div className="absolute inset-0 bg-gradient-glass" aria-hidden="true" />
          <CubeStub />
        </div>
      </div>
    </section>
  );
}

function CubeStub(): JSX.Element {
  return (
    <div className="relative grid size-72 grid-cols-1 grid-rows-1">
      <div
        className="rounded-2xl border border-cipher-cyan/30 bg-obsidian-900/80 p-5 shadow-cipher backdrop-blur"
        style={{
          transform: 'perspective(800px) rotateX(18deg) rotateY(-22deg)',
        }}
      >
        <div className="space-y-1 leading-snug">
          {Array.from({ length: 6 }).map((_, i) => (
            <Cipher
              key={i}
              length={20}
              cadenceMs={800 + i * 120}
              className="block text-sm"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Problem(): JSX.Element {
  return (
    <section className="border-t border-obsidian-700">
      <div className="mx-auto max-w-7xl px-6 py-20">
        <h2 className="text-2xl font-semibold tracking-tightest text-foreground">
          Three things break in every other dark pool
        </h2>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          <ProblemCard
            title="Public orders leak"
            body="Every L2 orderbook is a strategy leak. Watchers see your price, size, your timing. The market front-runs you."
          />
          <ProblemCard
            title="Bridges break"
            body="Wrapped BTC depends on a custodian or a cross-chain proof you can't audit. Every bridge is a single point of catastrophic failure."
          />
          <ProblemCard
            title="Custodians control"
            body="If a venue holds your keys, it holds your fate. Withdrawal pauses, frozen assets, KYC creep — all downstream of custody."
          />
        </div>
      </div>
    </section>
  );
}

function ProblemCard({
  title,
  body,
}: {
  title: string;
  body: string;
}): JSX.Element {
  return (
    <div className="rounded-lg border border-obsidian-700 bg-obsidian-900 p-6 ring-inset-subtle">
      <h3 className="text-lg font-semibold tracking-tightest text-foreground">
        {title}
      </h3>
      <p className="mt-3 text-sm text-muted">{body}</p>
    </div>
  );
}

function SolutionStub(): JSX.Element {
  return (
    <section className="border-t border-obsidian-700">
      <div className="mx-auto max-w-7xl px-6 py-20">
        <h2 className="text-2xl font-semibold tracking-tightest text-foreground">
          The solution — encrypted in, settled native
        </h2>
        <p className="mt-3 max-w-2xl text-sm text-muted">
          P6 will animate this diagram. For now, the four pieces in plain
          terms: Solana hosts the matching engine, Encrypt keeps the book
          sealed, Ika co-signs the BTC tx, and Bitcoin records the fill.
        </p>
        <div className="mt-10 grid gap-6 md:grid-cols-4">
          {[
            ['Solana', 'Hosts the program. Orders submitted as ciphertext PDAs.'],
            ['Encrypt', 'FHE-compares bids vs asks. Reveals only the fill.'],
            ['Ika', 'dWallet co-signs the BTC settlement tx. No custodian.'],
            ['Bitcoin', 'Native UTXO settlement. No wrapping, no bridges.'],
          ].map(([name, desc]) => (
            <div
              key={name}
              className="rounded-lg border border-obsidian-700 bg-obsidian-900 p-5 ring-inset-subtle"
            >
              <p className="text-xs uppercase tracking-widest text-cipher-cyan-dim">
                {name}
              </p>
              <p className="mt-2 text-sm text-muted">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CtaStrip(): JSX.Element {
  return (
    <section className="border-t border-obsidian-700">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-6 px-6 py-24 text-center">
        <h2 className="text-3xl font-semibold tracking-tightest text-foreground sm:text-4xl">
          Trade Bitcoin in the dark.
        </h2>
        <p className="max-w-xl text-sm text-muted">
          Devnet is open. Try a sealed order, watch a match settle on
          signet, see a UTXO move without ever touching a bridge.
        </p>
        <Link href="/trade">
          <Button size="lg">Launch Terminal</Button>
        </Link>
      </div>
    </section>
  );
}
