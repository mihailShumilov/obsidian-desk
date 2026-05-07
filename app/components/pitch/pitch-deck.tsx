'use client';

/**
 * Pitch deck — vertical scroll-driven deck with parallax.
 * Each <Slide/> is full-viewport, animates in on scroll, parallaxes its
 * cipher backdrop, and reports itself to the sticky stage indicator.
 *
 * Built off the same primitives as the landing page (Cipher, BookCube,
 * Tailwind tokens from UI_DESIGN.md §2) so the deck *is* the product.
 */

import Link from 'next/link';
import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from 'framer-motion';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Cipher } from '@/components/obsidian/cipher';
import { BookCube } from '@/components/landing/book-cube';
import { SettleThread } from '@/components/obsidian/settle-thread';
import { FounderSlide } from './founder-slide';

const SLIDES = [
  { id: 'title', label: 'Cover' },
  { id: 'problem', label: 'Problem' },
  { id: 'thesis', label: 'Thesis' },
  { id: 'how', label: 'How' },
  { id: 'duality', label: 'Duality' },
  { id: 'traction', label: 'Live today' },
  { id: 'founder', label: 'Why me' },
  { id: 'close', label: 'Close' },
] as const;

export function PitchDeck(): JSX.Element {
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, {
    stiffness: 80,
    damping: 20,
    mass: 0.4,
  });
  const [active, setActive] = useState<string>(SLIDES[0]!.id);
  const mouse = useMouseParallax(reduce ?? false);

  return (
    <main className="relative bg-obsidian-950 text-foreground">
      <ParallaxBackdrop mouse={mouse} />
      <ScrollRail progress={progress} />
      <StageIndicator active={active} />

      <Title onActivate={() => setActive('title')} mouse={mouse} />
      <Problem onActivate={() => setActive('problem')} />
      <Thesis onActivate={() => setActive('thesis')} />
      <HowItWorks onActivate={() => setActive('how')} />
      <Duality onActivate={() => setActive('duality')} />
      <Traction onActivate={() => setActive('traction')} />
      <FounderSlide onActivate={() => setActive('founder')} />
      <Closing onActivate={() => setActive('close')} />
    </main>
  );
}

// ---------------------------------------------------------------------------
// Background: cipher-dot grid that drifts with the cursor and scroll.

function useMouseParallax(disabled: boolean): { x: number; y: number } {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (disabled) return;
    let frame = 0;
    const onMove = (e: MouseEvent): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const x = (e.clientX / window.innerWidth - 0.5) * 2;
        const y = (e.clientY / window.innerHeight - 0.5) * 2;
        setPos({ x, y });
      });
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(frame);
    };
  }, [disabled]);
  return pos;
}

function ParallaxBackdrop({
  mouse,
}: {
  mouse: { x: number; y: number };
}): JSX.Element {
  const { scrollYProgress } = useScroll();
  const drift = useTransform(scrollYProgress, [0, 1], [0, -240]);
  const hue = useTransform(scrollYProgress, [0, 0.5, 1], [0, 25, 60]);
  return (
    <div className="pointer-events-none fixed inset-0 z-0">
      <motion.div
        aria-hidden
        className="absolute inset-0 bg-gradient-glass"
        style={{
          x: mouse.x * -18,
          y: mouse.y * -18,
        }}
      />
      <motion.div
        aria-hidden
        className="absolute -inset-x-32 -top-40 h-[140vh]"
        style={{
          y: drift,
          backgroundImage:
            'radial-gradient(circle, rgba(0,245,212,0.45) 1px, transparent 1px)',
          backgroundSize: '36px 36px',
          opacity: 0.07,
          filter: useTransform(hue, (h) => `hue-rotate(${h}deg)`),
        }}
      />
      <motion.div
        aria-hidden
        className="absolute left-1/2 top-1/3 h-[40rem] w-[40rem] -translate-x-1/2 rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(0,245,212,0.10) 0%, transparent 60%)',
          x: mouse.x * 36,
          y: mouse.y * 36,
        }}
      />
    </div>
  );
}

// Top-of-viewport progress rail showing how far through the deck you are.
function ScrollRail({
  progress,
}: {
  progress: MotionValue<number>;
}): JSX.Element {
  const width = useTransform(progress, (p) => `${p * 100}%`);
  return (
    <div className="fixed inset-x-0 top-0 z-40 h-[2px] bg-obsidian-900/80">
      <motion.div
        className="h-full bg-gradient-cipher shadow-cipher"
        style={{ width }}
      />
    </div>
  );
}

function StageIndicator({ active }: { active: string }): JSX.Element {
  return (
    <aside className="pointer-events-none fixed right-6 top-1/2 z-30 hidden -translate-y-1/2 lg:block">
      <ul className="flex flex-col gap-3">
        {SLIDES.map((s, i) => {
          const on = s.id === active;
          return (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className={
                  'pointer-events-auto group flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.3em] transition-colors duration-200 ease-snappy ' +
                  (on
                    ? 'text-cipher-cyan'
                    : 'text-muted hover:text-foreground')
                }
              >
                <span
                  className={
                    'inline-block h-px transition-all duration-300 ease-snappy ' +
                    (on
                      ? 'w-10 bg-cipher-cyan shadow-cipher'
                      : 'w-4 bg-obsidian-700 group-hover:w-7 group-hover:bg-obsidian-600')
                  }
                />
                <span className="tabular-nums">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="opacity-80 group-hover:opacity-100">
                  {s.label}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Slide shell — handles intersection, scroll-progress refs, and animations.

function Slide({
  id,
  index,
  onActivate,
  children,
  className,
}: {
  id: string;
  index: number;
  onActivate: () => void;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio >= 0.5) onActivate();
        }
      },
      { threshold: [0.5] },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [onActivate]);
  return (
    <section
      ref={ref}
      id={id}
      className={
        'relative isolate flex min-h-screen w-full flex-col justify-center overflow-hidden border-b border-obsidian-700/60 px-6 py-24 ' +
        (className ?? '')
      }
    >
      <span className="pointer-events-none absolute left-6 top-6 font-mono text-[11px] uppercase tracking-[0.3em] text-muted">
        {String(index + 1).padStart(2, '0')} / {String(SLIDES.length).padStart(2, '0')}
      </span>
      <div className="relative z-10 mx-auto w-full max-w-6xl">{children}</div>
    </section>
  );
}

const fadeUp = {
  hidden: { opacity: 0, y: 32 },
  show: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.6, ease: [0.16, 1, 0.3, 1] },
  }),
};

// ---------------------------------------------------------------------------
// 1 — Title

function Title({
  onActivate,
  mouse,
}: {
  onActivate: () => void;
  mouse: { x: number; y: number };
}): JSX.Element {
  return (
    <Slide id="title" index={0} onActivate={onActivate}>
      <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <motion.p
            initial="hidden"
            animate="show"
            variants={fadeUp}
            className="inline-flex items-center gap-2 rounded-md border border-obsidian-700 bg-obsidian-900/60 px-2.5 py-1 text-xs uppercase tracking-widest text-cipher-cyan-dim"
          >
            <span className="size-1.5 rounded-full bg-cipher-cyan animate-pulse-cipher" />
            Solana × Bitcoin · Encrypt × Ika
          </motion.p>
          <motion.h1
            initial="hidden"
            animate="show"
            custom={1}
            variants={fadeUp}
            className="mt-6 text-5xl font-semibold leading-[1.02] tracking-tightest text-foreground sm:text-6xl lg:text-[5.25rem]"
          >
            ObsidianDesk
          </motion.h1>
          <motion.p
            initial="hidden"
            animate="show"
            custom={2}
            variants={fadeUp}
            className="mt-6 max-w-xl text-lg leading-relaxed text-muted sm:text-xl"
          >
            The dark pool where{' '}
            <span className="text-cipher-cyan">Bitcoin</span> never leaves
            Bitcoin.
          </motion.p>
          <motion.p
            initial="hidden"
            animate="show"
            custom={3}
            variants={fadeUp}
            className="mt-3 max-w-xl font-mono text-sm uppercase tracking-[0.25em] text-muted"
          >
            Encrypted orderbook. FHE-matched. Native-settled.
          </motion.p>

          <motion.div
            initial="hidden"
            animate="show"
            custom={4}
            variants={fadeUp}
            className="mt-12 flex flex-wrap items-center gap-3"
          >
            <Link href="/trade">
              <Button size="lg">Launch Terminal</Button>
            </Link>
            <a href="#problem">
              <Button size="lg" variant="secondary">
                Begin pitch ↓
              </Button>
            </a>
          </motion.div>
        </div>

        <motion.div
          className="relative mx-auto w-full max-w-md"
          style={{
            x: mouse.x * 14,
            y: mouse.y * 14,
            rotate: mouse.x * 2,
          }}
        >
          <BookCube />
          <div className="pointer-events-none absolute inset-x-12 -bottom-6 h-12 rounded-full bg-cipher-cyan/15 blur-3xl" />
        </motion.div>
      </div>
    </Slide>
  );
}

// ---------------------------------------------------------------------------
// 2 — Problem

function Problem({ onActivate }: { onActivate: () => void }): JSX.Element {
  return (
    <Slide id="problem" index={1} onActivate={onActivate}>
      <SectionLabel>The problem</SectionLabel>
      <SectionHeading>
        Bitcoin is the deepest collateral in the world.
        <br />
        <span className="text-muted">
          Trading it costs you privacy, custody, or both.
        </span>
      </SectionHeading>

      <div className="mt-14 grid gap-5 lg:grid-cols-3">
        <ProblemCard
          tag="01"
          title="Public orderbooks leak strategy"
          body="Every quote, size, and cancellation is plaintext on chain. MEV searchers replay your edge before you fill."
          visual={<LeakyBook />}
        />
        <ProblemCard
          tag="02"
          title="Bridges break"
          body="wBTC, tBTC, every wrapper. One custodian failure or one signer compromise and the peg dies."
          visual={<BrokenBridge />}
        />
        <ProblemCard
          tag="03"
          title="Custodians watch everyone"
          body="Centralized dark pools give you privacy from peers. They keep perfect records on you."
          visual={<EyeIcon />}
        />
      </div>
    </Slide>
  );
}

function ProblemCard({
  tag,
  title,
  body,
  visual,
}: {
  tag: string;
  title: string;
  body: string;
  visual: ReactNode;
}): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -6 }}
      className="group relative flex flex-col overflow-hidden rounded-lg border border-obsidian-700 bg-obsidian-900/80 p-6 ring-inset-subtle backdrop-blur"
    >
      <span className="font-mono text-[11px] uppercase tracking-[0.4em] text-cipher-cyan-dim">
        {tag}
      </span>
      <div className="mt-6 flex h-32 items-center justify-center rounded-md border border-obsidian-700 bg-obsidian-800/60">
        {visual}
      </div>
      <h3 className="mt-6 text-lg font-semibold tracking-tightest text-foreground">
        {title}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-cipher opacity-0 transition-opacity duration-300 ease-snappy group-hover:opacity-60" />
    </motion.div>
  );
}

function LeakyBook(): JSX.Element {
  return (
    <svg viewBox="0 0 200 100" className="h-24 w-full" aria-hidden>
      <g
        fontFamily="JetBrains Mono, ui-monospace, monospace"
        fontSize="9"
        fill="#71717A"
      >
        <text x="14" y="22">69850.00 × 0.500</text>
        <text x="14" y="38">69845.00 × 1.250</text>
        <text x="14" y="54">69840.00 × 0.300</text>
        <text x="14" y="70">69835.00 × 2.000</text>
      </g>
      <path d="M120 8 L182 92" stroke="#FF3E6A" strokeWidth="1.5" opacity="0.85" />
      <g stroke="#FF3E6A" strokeWidth="1" fill="none" opacity="0.85">
        <path d="M150 22 L172 18" />
        <path d="M150 38 L172 36" />
        <path d="M150 54 L172 54" />
        <path d="M150 70 L172 72" />
      </g>
    </svg>
  );
}

function BrokenBridge(): JSX.Element {
  return (
    <svg viewBox="0 0 200 100" className="h-24 w-full" aria-hidden>
      <circle cx="40" cy="50" r="20" stroke="#71717A" strokeWidth="1.4" fill="none" />
      <text
        x="40"
        y="56"
        textAnchor="middle"
        fontFamily="JetBrains Mono, ui-monospace, monospace"
        fontSize="14"
        fontWeight="700"
        fill="#71717A"
      >
        ₿
      </text>
      <circle cx="160" cy="50" r="20" stroke="#71717A" strokeWidth="1.4" fill="none" />
      <text
        x="160"
        y="55"
        textAnchor="middle"
        fontFamily="JetBrains Mono, ui-monospace, monospace"
        fontSize="11"
        fontWeight="700"
        fill="#71717A"
      >
        wBTC
      </text>
      <line x1="60" y1="50" x2="92" y2="50" stroke="#71717A" strokeWidth="1.5" />
      <line x1="108" y1="50" x2="140" y2="50" stroke="#71717A" strokeWidth="1.5" />
      <path
        d="M88 36 L102 50 L92 60 L106 70"
        stroke="#FF3E6A"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function EyeIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 200 100" className="h-24 w-full" aria-hidden>
      <path
        d="M30 50 Q100 10 170 50 Q100 90 30 50 Z"
        stroke="#71717A"
        strokeWidth="1.6"
        fill="none"
      />
      <circle cx="100" cy="50" r="14" stroke="#FF3E6A" strokeWidth="1.6" fill="none" />
      <circle cx="100" cy="50" r="5" fill="#FF3E6A" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// 3 — Thesis

function Thesis({ onActivate }: { onActivate: () => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });
  const reveal = useTransform(scrollYProgress, [0.15, 0.55], [0, 1]);
  const cipherOpacity = useTransform(scrollYProgress, [0.2, 0.55], [1, 0]);
  const plainOpacity = useTransform(scrollYProgress, [0.3, 0.6], [0, 1]);

  return (
    <Slide id="thesis" index={2} onActivate={onActivate}>
      <SectionLabel>The thesis</SectionLabel>
      <SectionHeading>
        Match in the dark.
        <br />
        <span className="text-cipher-cyan">Settle in native Bitcoin.</span>
      </SectionHeading>

      <div ref={ref} className="mt-14 grid gap-10 lg:grid-cols-[1.05fr_1fr]">
        <motion.p
          style={{ opacity: reveal }}
          className="max-w-xl text-lg leading-relaxed text-muted sm:text-xl"
        >
          ObsidianDesk is an institutional-grade dark pool for native Bitcoin.
          Orders are encrypted client-side, matched under FHE on Solana, and
          settled directly on the Bitcoin chain — without bridges, custodians,
          or wrapped tokens. The book is silent. The fill is real.
        </motion.p>

        <div className="relative h-56 rounded-lg border border-obsidian-700 bg-obsidian-900/80 ring-inset-subtle">
          <motion.div
            style={{ opacity: cipherOpacity }}
            className="absolute inset-0 flex flex-col justify-center gap-2 p-6"
          >
            {[0, 1, 2, 3].map((i) => (
              <Cipher
                key={i}
                length={28}
                cadenceMs={700 + i * 70}
                className="block"
              />
            ))}
          </motion.div>
          <motion.div
            style={{ opacity: plainOpacity }}
            className="absolute inset-0 flex flex-col justify-center gap-2 p-6 font-mono text-sm tabular-nums text-foreground"
          >
            <span>BUY  0.500 BTC @ 69,850.00 USDC</span>
            <span>BUY  1.250 BTC @ 69,845.00 USDC</span>
            <span>SELL 0.300 BTC @ 69,840.00 USDC</span>
            <span>SELL 2.000 BTC @ 69,835.00 USDC</span>
            <span className="mt-3 text-xs uppercase tracking-[0.3em] text-cipher-cyan">
              ↑ revealed only on match
            </span>
          </motion.div>
        </div>
      </div>
    </Slide>
  );
}

// ---------------------------------------------------------------------------
// 4 — How it works

function HowItWorks({ onActivate }: { onActivate: () => void }): JSX.Element {
  const steps = [
    {
      tag: 'Step 1',
      heading: 'Seal',
      body: 'Trader encrypts price + size client-side with the Encrypt SDK. The on-chain order is a 32-byte ciphertext reference — never plaintext.',
      glyph: 'SOL',
      tone: 'text-solana-violet',
    },
    {
      tag: 'Step 2',
      heading: 'Match under FHE',
      body: 'A Solana program runs the matching graph as a homomorphic computation. Only the resulting fill is decrypted — the rest of the book stays sealed.',
      glyph: 'FHE',
      tone: 'text-cipher-cyan',
    },
    {
      tag: 'Step 3',
      heading: 'Native settle',
      body: 'Ika dWallets co-sign a real Bitcoin transaction. BTC moves on the BTC chain. No wrapper, no bridge, no custodian — just a UTXO.',
      glyph: 'BTC',
      tone: 'text-bitcoin-ember',
    },
  ];
  return (
    <Slide id="how" index={3} onActivate={onActivate}>
      <SectionLabel>How it works</SectionLabel>
      <SectionHeading>
        Three steps. No bridges. No leakage.
      </SectionHeading>

      <div className="mt-14 grid gap-5 lg:grid-cols-3">
        {steps.map((s, i) => (
          <motion.div
            key={s.heading}
            initial={{ opacity: 0, y: 32 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{
              duration: 0.6,
              delay: i * 0.12,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="relative flex flex-col rounded-lg border border-obsidian-700 bg-obsidian-900/80 p-7 ring-inset-subtle backdrop-blur"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.4em] text-muted">
                {s.tag}
              </span>
              <span className={'font-mono text-xs tracking-[0.3em] ' + s.tone}>
                {s.glyph}
              </span>
            </div>
            <h3 className="mt-6 text-3xl font-semibold tracking-tightest text-foreground">
              {s.heading}
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-muted">{s.body}</p>
          </motion.div>
        ))}
      </div>

      <div className="mt-10 flex items-center gap-4">
        <span className="font-mono text-xs uppercase tracking-[0.3em] text-solana-violet">
          Solana
        </span>
        <SettleThread className="flex-1" />
        <span className="font-mono text-xs uppercase tracking-[0.3em] text-bitcoin-ember">
          Bitcoin
        </span>
      </div>
      <p className="mt-3 text-center font-mono text-xs uppercase tracking-[0.3em] text-muted">
        One match, two chains, zero leakage.
      </p>
    </Slide>
  );
}

// ---------------------------------------------------------------------------
// 5 — Duality

function Duality({ onActivate }: { onActivate: () => void }): JSX.Element {
  return (
    <Slide id="duality" index={4} onActivate={onActivate}>
      <SectionLabel>Why both</SectionLabel>
      <SectionHeading>
        Encrypt without Ika is half a system.
        <br />
        <span className="text-muted">Ika without Encrypt is too.</span>
      </SectionHeading>

      <div className="mt-14 grid gap-6 lg:grid-cols-2">
        <DualityCard
          heading="Remove Encrypt →"
          subhead="The orderbook is public again."
          body="Every PDA becomes plaintext. Watchers replay your strategy in real time. Privacy is gone."
          accent="from-danger-red/0 to-danger-red/20"
        />
        <DualityCard
          heading="Remove Ika →"
          subhead="Settlement collapses back to a bridge."
          body="BTC must be wrapped. The custodian is back. The trust assumption is back. Native Bitcoin disappears."
          accent="from-danger-red/0 to-danger-red/20"
        />
      </div>

      <p className="mt-12 text-center text-2xl font-semibold tracking-tightest text-foreground">
        Together: a dark pool that{' '}
        <span className="text-cipher-cyan">settles in real BTC</span>.
      </p>
    </Slide>
  );
}

function DualityCard({
  heading,
  subhead,
  body,
  accent,
}: {
  heading: string;
  subhead: string;
  body: string;
  accent: string;
}): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.4 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden rounded-lg border border-obsidian-700 bg-obsidian-900/80 p-8 ring-inset-subtle"
    >
      <div
        aria-hidden
        className={'pointer-events-none absolute inset-0 bg-gradient-to-br ' + accent}
      />
      <h3 className="relative text-xl font-semibold tracking-tightest text-danger-red">
        {heading}
      </h3>
      <p className="relative mt-2 text-sm uppercase tracking-[0.2em] text-muted">
        {subhead}
      </p>
      <p className="relative mt-6 text-base leading-relaxed text-foreground">
        {body}
      </p>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// 6 — Traction

function Traction({ onActivate }: { onActivate: () => void }): JSX.Element {
  const stats = [
    { k: 'Solana program', v: 'Deployed', mono: 'H25y…beLp · devnet' },
    { k: 'Encrypt program', v: 'Live', mono: '4ebf…rND8 · devnet' },
    { k: 'Ika dWallets', v: 'Real-mode', mono: 'pre-alpha gRPC · signet' },
    { k: 'Encrypt + Ika SDK', v: 'Wired end-to-end', mono: 'devnet smoke ✓' },
  ];
  return (
    <Slide id="traction" index={5} onActivate={onActivate}>
      <SectionLabel>Live today</SectionLabel>
      <SectionHeading>
        Built. Deployed. Trading on devnet.
      </SectionHeading>

      <div className="mt-14 grid gap-4 sm:grid-cols-2">
        {stats.map((s, i) => (
          <motion.div
            key={s.k}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{
              duration: 0.5,
              delay: i * 0.08,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="flex items-baseline justify-between gap-4 rounded-lg border border-obsidian-700 bg-obsidian-900/80 p-6 ring-inset-subtle"
          >
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-muted">
                {s.k}
              </p>
              <p className="mt-2 text-xl font-semibold tracking-tightest text-cipher-cyan">
                {s.v}
              </p>
            </div>
            <p className="font-mono text-xs tabular-nums text-muted">{s.mono}</p>
          </motion.div>
        ))}
      </div>

      <div className="mt-12 grid gap-5 lg:grid-cols-3">
        {[
          {
            n: '6',
            l: 'Inputs in the FHE matching graph',
          },
          {
            n: '32B',
            l: 'Ciphertext-account refs on chain — no plaintext orders',
          },
          {
            n: '2 chains',
            l: 'Coordinated by one match — Solana + native Bitcoin',
          },
        ].map((m, i) => (
          <motion.div
            key={m.n}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{
              duration: 0.5,
              delay: i * 0.1,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="rounded-lg border border-obsidian-700 bg-obsidian-900/60 p-6"
          >
            <p className="font-mono text-4xl font-semibold tracking-tightest text-foreground">
              {m.n}
            </p>
            <p className="mt-3 text-sm text-muted">{m.l}</p>
          </motion.div>
        ))}
      </div>
    </Slide>
  );
}

// ---------------------------------------------------------------------------
// 8 — Closing (slide 7 is FounderSlide imported separately)

function Closing({ onActivate }: { onActivate: () => void }): JSX.Element {
  return (
    <Slide id="close" index={7} onActivate={onActivate} className="items-center">
      <div className="flex flex-col items-center text-center">
        <motion.span
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="font-mono text-[11px] uppercase tracking-[0.4em] text-cipher-cyan-dim"
        >
          The dark pool is open
        </motion.span>
        <motion.h2
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{
            duration: 0.7,
            delay: 0.1,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="mt-6 max-w-3xl text-4xl font-semibold leading-[1.05] tracking-tightest text-foreground sm:text-6xl"
        >
          Trade Bitcoin in the dark.
          <br />
          <span className="text-cipher-cyan">Settle Bitcoin on Bitcoin.</span>
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{
            duration: 0.6,
            delay: 0.2,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="mt-6 max-w-xl text-lg text-muted"
        >
          Devnet is live. Try a sealed order. Watch the UTXO move on signet.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{
            duration: 0.6,
            delay: 0.3,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="mt-12 flex flex-wrap items-center justify-center gap-3"
        >
          <Link href="/trade">
            <Button size="lg">Launch Terminal</Button>
          </Link>
          <Link href="https://obsidiandesk.app" target="_blank" rel="noreferrer">
            <Button size="lg" variant="secondary">
              obsidiandesk.app
            </Button>
          </Link>
        </motion.div>

        <p className="mt-16 font-mono text-[11px] uppercase tracking-[0.4em] text-muted">
          ObsidianDesk · Solana × Bitcoin · Encrypt × Ika
        </p>
      </div>
    </Slide>
  );
}

// ---------------------------------------------------------------------------
// Shared headings

function SectionLabel({ children }: { children: ReactNode }): JSX.Element {
  return (
    <motion.p
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.4 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="font-mono text-[11px] uppercase tracking-[0.4em] text-cipher-cyan-dim"
    >
      {children}
    </motion.p>
  );
}

function SectionHeading({ children }: { children: ReactNode }): JSX.Element {
  return (
    <motion.h2
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.4 }}
      transition={{ duration: 0.7, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
      className="mt-4 max-w-4xl text-3xl font-semibold leading-[1.1] tracking-tightest text-foreground sm:text-5xl"
    >
      {children}
    </motion.h2>
  );
}
