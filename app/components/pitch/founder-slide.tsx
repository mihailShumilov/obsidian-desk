'use client';

/**
 * FounderSlide — "Why me" slide. Bio sourced from the LinkedIn export
 * (Mykhailo Shumilov) — see CLAUDE.md user_legal_name memory.
 *
 * Effects: mouse-tracked tilt card with cipher portrait, year-marker
 * timeline that parallaxes on scroll, animated stat counters.
 */

import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
} from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { Cipher } from '@/components/obsidian/cipher';

const TIMELINE = [
  { year: '2006', label: 'First commercial code (Delphi, ArgoSoft)' },
  { year: '2010', label: 'Team lead — high-load video platform' },
  { year: '2013', label: 'Deputy CTO, real-time SMS aggregator' },
  { year: '2014', label: 'CTO / co-founder, Vadimages' },
  { year: '2017', label: 'CTO, MetraExchange' },
  { year: '2021', label: 'CTO / co-founder, Trade Assistant' },
  { year: '2026', label: 'ObsidianDesk — encrypted dark pool on Solana' },
];

const STATS = [
  { n: '18+', l: 'Years engineering', sub: 'Backend, real-time, high-load' },
  { n: '100+', l: 'Software projects led', sub: 'Architected & shipped' },
  { n: '70+', l: 'Senior interviews', sub: 'Built the bench myself' },
  { n: '2', l: 'CTO seats today', sub: 'Vadimages · Trade Assistant' },
];

export function FounderSlide({
  onActivate,
}: {
  onActivate: () => void;
}): JSX.Element {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

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

  const cardRef = useRef<HTMLDivElement>(null);
  const onCardMove = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (reduce || !cardRef.current) return;
    const r = cardRef.current.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    setTilt({ x, y });
  };
  const onCardLeave = (): void => setTilt({ x: 0, y: 0 });

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });
  const railX = useTransform(scrollYProgress, [0, 1], [40, -40]);

  return (
    <section
      ref={ref}
      id="founder"
      className="relative isolate flex min-h-screen w-full flex-col justify-center overflow-hidden border-b border-obsidian-700/60 px-6 py-24"
    >
      <span className="pointer-events-none absolute left-6 top-6 font-mono text-[11px] uppercase tracking-[0.3em] text-muted">
        07 / 08
      </span>

      <div className="relative z-10 mx-auto w-full max-w-6xl">
        <motion.p
          initial={{ y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.5 }}
          className="font-mono text-[11px] uppercase tracking-[0.4em] text-cipher-cyan-dim"
        >
          Why me
        </motion.p>

        <motion.h2
          initial={{ y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.7, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
          className="mt-4 max-w-4xl text-3xl font-semibold leading-[1.1] tracking-tightest text-foreground sm:text-5xl"
        >
          18 years of shipping high-load systems.
          <br />
          <span className="text-muted">
            Two CTO seats. One dark pool to build.
          </span>
        </motion.h2>

        <div className="mt-14 grid items-start gap-12 lg:grid-cols-[1fr_1.2fr]">
          {/* Tilted cipher-portrait card */}
          <motion.div
            ref={cardRef}
            onMouseMove={onCardMove}
            onMouseLeave={onCardLeave}
            initial={{ y: 32 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            style={{
              rotateX: tilt.y * -8,
              rotateY: tilt.x * 10,
              transformPerspective: 900,
            }}
            className="relative mx-auto w-full max-w-sm rounded-xl border border-obsidian-700 bg-obsidian-900/80 p-6 ring-inset-subtle backdrop-blur"
          >
            <div className="relative mx-auto aspect-[4/5] w-full overflow-hidden rounded-lg border border-obsidian-700 bg-obsidian-800">
              <div
                aria-hidden
                className="absolute inset-0"
                style={{
                  backgroundImage:
                    'radial-gradient(circle at 30% 20%, rgba(0,245,212,0.18) 0%, transparent 55%), radial-gradient(circle at 70% 80%, rgba(168,85,247,0.16) 0%, transparent 55%)',
                }}
              />
              <div className="absolute inset-0 flex flex-col gap-2 p-5 leading-tight">
                {Array.from({ length: 14 }).map((_, i) => (
                  <Cipher
                    key={i}
                    length={20 - (i % 5)}
                    cadenceMs={900 + i * 60}
                    className="block text-xs"
                  />
                ))}
              </div>
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-obsidian-950 via-obsidian-950/70 to-transparent p-5">
                <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-cipher-cyan-dim">
                  Founder · CTO
                </p>
                <p className="mt-1 text-xl font-semibold tracking-tightest text-foreground">
                  Mykhailo Shumilov
                </p>
                <p className="text-xs text-muted">Kharkiv → Portland</p>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-2 font-mono text-[11px] uppercase tracking-[0.25em] text-muted">
              <span className="rounded border border-obsidian-700 px-2 py-1">
                High-load
              </span>
              <span className="rounded border border-obsidian-700 px-2 py-1">
                System architecture
              </span>
              <span className="rounded border border-obsidian-700 px-2 py-1">
                Solana / TS / Rust
              </span>
              <span className="rounded border border-obsidian-700 px-2 py-1">
                Real-time fintech
              </span>
            </div>
          </motion.div>

          {/* Right: bio + stats + timeline.
              `min-w-0` lets the column shrink below the timeline's
              `min-w-max` content — without it, the 7×w-56 timeline
              (≈1664px) blows the grid out, squashes the cipher card
              column to a sliver, and pushes the right-edge into the
              fixed StageIndicator rail. */}
          <div className="flex min-w-0 flex-col gap-10">
            <motion.p
              initial={{ y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
              className="text-base leading-relaxed text-muted sm:text-lg"
            >
              I&apos;ve spent eighteen years building systems where{' '}
              <span className="text-foreground">latency, security, and
              correctness</span>{' '}
              all matter at once — high-load SMS aggregators, real-time payment
              rails, video platforms, and a digital-asset exchange. Today I&apos;m
              CTO at{' '}
              <span className="text-foreground">Vadimages</span> and co-founder
              of <span className="text-foreground">Trade Assistant</span>. I&apos;ve
              architected 100+ shipped products and conducted 70+ senior
              technical interviews to build the bench around me.
            </motion.p>
            <motion.p
              initial={{ y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.6, delay: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="text-base leading-relaxed text-muted sm:text-lg"
            >
              ObsidianDesk sits exactly at the intersection of everything I&apos;ve
              done before:{' '}
              <span className="text-foreground">exchange architecture</span>,{' '}
              <span className="text-foreground">multi-chain settlement</span>,
              and an{' '}
              <span className="text-foreground">encrypted matching engine</span>{' '}
              that has to behave like a Bloomberg terminal under load. I can
              build it because I&apos;ve already built every layer of it — just not
              all in the same product, and never with FHE underneath.
            </motion.p>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {STATS.map((s, i) => (
                <motion.div
                  key={s.l}
                  initial={{ y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.4 }}
                  transition={{
                    duration: 0.5,
                    delay: i * 0.08,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  className="rounded-lg border border-obsidian-700 bg-obsidian-900/70 p-4 ring-inset-subtle"
                >
                  <p className="font-mono text-3xl font-semibold tracking-tightest text-cipher-cyan">
                    {s.n}
                  </p>
                  <p className="mt-1 text-xs uppercase tracking-[0.2em] text-foreground">
                    {s.l}
                  </p>
                  <p className="mt-1 text-[11px] text-muted">{s.sub}</p>
                </motion.div>
              ))}
            </div>

            {/* Horizontal parallax timeline */}
            <div className="overflow-x-hidden">
              <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-muted">
                Track record
              </p>
              <motion.ol
                style={{ x: railX }}
                className="mt-4 flex min-w-max items-stretch gap-4"
              >
                {TIMELINE.map((t, i) => (
                  <li
                    key={t.year}
                    className="relative flex w-56 shrink-0 flex-col rounded-lg border border-obsidian-700 bg-obsidian-900/60 p-4"
                  >
                    <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-cipher-cyan-dim">
                      {t.year}
                    </span>
                    <span className="mt-2 text-sm leading-relaxed text-foreground">
                      {t.label}
                    </span>
                    {i < TIMELINE.length - 1 && (
                      <span className="absolute -right-3 top-1/2 hidden h-px w-3 bg-obsidian-700 sm:block" />
                    )}
                  </li>
                ))}
              </motion.ol>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
