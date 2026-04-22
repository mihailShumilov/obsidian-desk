'use client';

/**
 * Solution diagram — five nodes connected by labelled edges:
 *   Trader → Solana Program → Encrypt MPC → Ika MPC → Bitcoin
 *
 * As the section enters the viewport, each edge lights up sequentially via
 * framer-motion's `useInView` + a staggered animation. The lit edge is
 * cipher-cyan with a `shadow-cipher` glow; unlit edges are obsidian-700.
 *
 * Per UI_DESIGN.md §6.1 §3.
 */

import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';

const NODES = [
  { name: 'Trader', sub: 'submit ciphertext' },
  { name: 'Solana', sub: 'PDA writes' },
  { name: 'Encrypt', sub: 'FHE compare' },
  { name: 'Ika', sub: '2PC-MPC sign' },
  { name: 'Bitcoin', sub: 'native UTXO' },
] as const;

const EDGE_LABELS = [
  'encrypted',
  'matched',
  'threshold decrypt',
  'native tx',
] as const;

export function SolutionDiagram(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4, once: true });

  return (
    <section className="border-t border-obsidian-700">
      <div className="mx-auto max-w-7xl px-6 py-24" ref={ref}>
        <p className="text-xs uppercase tracking-widest text-cipher-cyan-dim">
          The solution
        </p>
        <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tightest text-foreground sm:text-4xl">
          Encrypted in. Native out.
        </h2>
        <p className="mt-4 max-w-2xl text-sm text-muted">
          One trip from your terminal to a confirmed Bitcoin UTXO. No
          wrapping, no custodian, no leakage of your intent.
        </p>

        <div className="mt-14 flex flex-col items-stretch gap-2 lg:flex-row lg:items-center lg:gap-0">
          {NODES.map((node, i) => (
            <div
              key={node.name}
              className="flex flex-1 flex-col items-stretch gap-2 lg:flex-row lg:items-center"
            >
              <Node name={node.name} sub={node.sub} index={i} inView={inView} />
              {i < NODES.length - 1 && (
                <Edge label={EDGE_LABELS[i]!} index={i} inView={inView} />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Node({
  name,
  sub,
  index,
  inView,
}: {
  name: string;
  sub: string;
  index: number;
  inView: boolean;
}): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: index * 0.18 }}
      className="flex min-w-[120px] flex-col items-center rounded-lg border border-obsidian-700 bg-obsidian-900 px-4 py-3 ring-inset-subtle"
    >
      <span className="text-xs uppercase tracking-widest text-cipher-cyan-dim">
        {name}
      </span>
      <span className="mt-1 font-mono text-[11px] text-muted">{sub}</span>
    </motion.div>
  );
}

function Edge({
  label,
  index,
  inView,
}: {
  label: string;
  index: number;
  inView: boolean;
}): JSX.Element {
  return (
    <div className="relative flex flex-1 items-center">
      <motion.div
        initial={{ scaleX: 0, opacity: 0.2 }}
        animate={
          inView
            ? { scaleX: 1, opacity: 1 }
            : { scaleX: 0, opacity: 0.2 }
        }
        transition={{
          duration: 0.5,
          ease: [0.16, 1, 0.3, 1],
          delay: 0.5 + index * 0.18,
        }}
        className="h-px flex-1 origin-left bg-cipher-cyan shadow-[0_0_8px_rgba(0,245,212,0.6)]"
      />
      <span className="absolute left-1/2 top-2 -translate-x-1/2 text-[10px] uppercase tracking-widest text-muted">
        {label}
      </span>
    </div>
  );
}
