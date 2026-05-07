'use client';

/**
 * OrderForm — the right-column form on /trade.
 *
 * Side toggle (Bid/Ask), price (USDC), size (BTC), expiry (1h/6h/24h).
 * Submission is delegated to the parent so the 1.8 s encrypt choreography
 * (UI_DESIGN.md §5.2) can wrap the actual SDK call. The form never
 * navigates; it only resets after `onSubmit` resolves.
 */

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Side } from '@/lib/order-state';

const EXPIRIES = [
  { label: '1h', slots: 9_000 },
  { label: '6h', slots: 54_000 },
  { label: '24h', slots: 216_000 },
] as const;

import { randomCipherChar } from '@/lib/cipher-glyphs';

export interface OrderFormSubmit {
  side: Side;
  priceUsdc: number;
  sizeBtc: number;
  expirySlots: number;
}

interface OrderFormProps {
  /** Submit returns once the (mock) Solana tx resolves. */
  onSubmit: (order: OrderFormSubmit) => Promise<void>;
  /** Disable the form when the wallet isn't connected. */
  disabledReason?: string;
}

type Phase = 'idle' | 'scramble' | 'envelope' | 'shoot';

export function OrderForm({ onSubmit, disabledReason }: OrderFormProps): JSX.Element {
  const [side, setSide] = useState<Side>('bid');
  const [price, setPrice] = useState('');
  const [size, setSize] = useState('');
  const [expirySlots, setExpiry] = useState<number>(EXPIRIES[2]!.slots);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  const numericPrice = Number.parseFloat(price);
  const numericSize = Number.parseFloat(size);
  const usdValue = useMemo(() => {
    if (!isFinite(numericPrice) || !isFinite(numericSize)) return null;
    return numericPrice * numericSize;
  }, [numericPrice, numericSize]);

  const valid =
    isFinite(numericPrice) && numericPrice > 0 && isFinite(numericSize) && numericSize > 0;

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!valid || phase !== 'idle' || disabledReason) return;
    setError(null);

    // Choreography per UI_DESIGN.md §5.2.
    setPhase('scramble');
    const tEnv = setTimeout(() => setPhase('envelope'), 800);
    const tShoot = setTimeout(() => setPhase('shoot'), 1200);

    try {
      // SDK call runs *behind* the animation — kicked off immediately so
      // it likely finishes before the 1500ms shoot point on a fast path.
      await onSubmit({
        side,
        priceUsdc: numericPrice,
        sizeBtc: numericSize,
        expirySlots,
      });
    } catch (err) {
      clearTimeout(tEnv);
      clearTimeout(tShoot);
      setPhase('idle');
      setError(err instanceof Error ? err.message : String(err));
      return;
    }

    // Reset after the full 1.8s arc completes.
    setTimeout(() => {
      setPhase('idle');
      setPrice('');
      setSize('');
    }, 1800);
  }

  const animating = phase !== 'idle';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Side toggle */}
      <div className="inline-flex w-full overflow-hidden rounded-md border border-obsidian-700 bg-obsidian-800 p-0.5 text-xs font-medium">
        <SideButton
          active={side === 'bid'}
          activeColor="bg-cipher-cyan text-obsidian-950"
          onClick={() => setSide('bid')}
          label="Bid"
        />
        <SideButton
          active={side === 'ask'}
          activeColor="bg-bitcoin-ember text-obsidian-950"
          onClick={() => setSide('ask')}
          label="Ask"
        />
      </div>

      {/* Inputs — visually scrambled during 800–1100ms phase */}
      <div className="relative">
        <Field label="Price (USDC)">
          <ScrambleInput
            value={price}
            onChange={setPrice}
            scrambling={animating}
            disabled={animating || !!disabledReason}
            placeholder="0.00"
            inputMode="decimal"
          />
        </Field>
        <Field label="Size (BTC)" className="mt-3">
          <ScrambleInput
            value={size}
            onChange={setSize}
            scrambling={animating}
            disabled={animating || !!disabledReason}
            placeholder="0.000"
            inputMode="decimal"
          />
        </Field>
        <ExpiryRow value={expirySlots} onChange={setExpiry} disabled={animating} />

        {/* Envelope overlay — appears at 1100ms, shoots up at 1500ms */}
        <AnimatePresence>
          {(phase === 'envelope' || phase === 'shoot') && (
            <motion.div
              key="envelope"
              initial={{ y: 60, scale: 0.4, opacity: 0 }}
              animate={
                phase === 'shoot'
                  ? { y: '-100vh', scale: 1, opacity: 0 }
                  : { y: 0, scale: 1, opacity: 1 }
              }
              exit={{ opacity: 0 }}
              transition={{
                duration: phase === 'shoot' ? 0.3 : 0.4,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
              aria-hidden="true"
            >
              <EnvelopeIcon />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Live USD value */}
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted">Notional</span>
        <span className="font-mono text-foreground">
          {usdValue === null ? '—' : `$${usdValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
        </span>
      </div>

      {/* Submit */}
      <div className="relative">
        <Button
          type="submit"
          className="w-full"
          disabled={!valid || animating || !!disabledReason}
        >
          {disabledReason
            ? disabledReason
            : phase === 'scramble' || phase === 'envelope'
              ? 'Encrypting…'
              : phase === 'shoot'
                ? 'Sealing…'
                : 'Encrypt & Seal'}
        </Button>
        {animating && <ButtonProgressBar />}
      </div>

      {error && (
        <p className="rounded-md border border-danger-red/40 bg-danger-red/10 p-3 text-xs text-danger-red">
          {error}
        </p>
      )}
    </form>
  );
}

function SideButton({
  active,
  activeColor,
  onClick,
  label,
}: {
  active: boolean;
  activeColor: string;
  onClick: () => void;
  label: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 rounded-[4px] px-3 py-1.5 transition-colors duration-200 ease-snappy',
        active ? activeColor : 'text-muted hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1 block text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}

function ScrambleInput({
  value,
  onChange,
  scrambling,
  disabled,
  placeholder,
  inputMode,
}: {
  value: string;
  onChange: (v: string) => void;
  scrambling: boolean;
  disabled: boolean;
  placeholder: string;
  inputMode: 'decimal' | 'numeric';
}): JSX.Element {
  // While scrambling, render a static cipher mask of the same length so
  // the layout doesn't jitter. The mask refreshes 6 times per second via
  // the parent re-render cycle (motion ticks), which is cheap and
  // intentionally chaotic.
  const display = scrambling
    ? Array.from(value, () => randomCipherChar()).join('')
    : value;
  return (
    <input
      type="text"
      value={display}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder={placeholder}
      inputMode={inputMode}
      autoComplete="off"
      spellCheck={false}
      className={cn(
        'h-11 w-full rounded-md border bg-obsidian-800 px-3 font-mono text-sm tracking-wider',
        scrambling
          ? 'border-cipher-cyan/40 text-cipher-cyan-dim'
          : 'border-obsidian-700 text-foreground focus:border-cipher-cyan focus:outline-none focus:ring-2 focus:ring-cipher-cyan/30',
        'disabled:opacity-90',
      )}
    />
  );
}

function ExpiryRow({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (slots: number) => void;
  disabled: boolean;
}): JSX.Element {
  return (
    <div className="mt-3">
      <p className="mb-1 text-xs text-muted">Expires in</p>
      <div className="inline-flex w-full overflow-hidden rounded-md border border-obsidian-700 bg-obsidian-800 p-0.5 text-xs">
        {EXPIRIES.map((e) => (
          <button
            key={e.label}
            type="button"
            onClick={() => onChange(e.slots)}
            disabled={disabled}
            className={cn(
              'flex-1 rounded-[4px] px-3 py-1.5 transition-colors duration-200 ease-snappy',
              value === e.slots
                ? 'bg-obsidian-700 text-foreground'
                : 'text-muted hover:text-foreground',
              'disabled:opacity-60',
            )}
          >
            {e.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function EnvelopeIcon(): JSX.Element {
  return (
    <motion.svg
      width="48"
      height="36"
      viewBox="0 0 48 36"
      animate={{ scale: [1, 1.08, 1] }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className="drop-shadow-[0_0_24px_rgba(0,245,212,0.5)]"
    >
      <rect x="2" y="2" width="44" height="32" rx="3" fill="#0B0B14" stroke="#00F5D4" strokeWidth="1.5" />
      <path d="M2 4 L24 22 L46 4" stroke="#00F5D4" strokeWidth="1.5" fill="none" />
    </motion.svg>
  );
}

function ButtonProgressBar(): JSX.Element {
  return (
    <motion.div
      initial={{ scaleX: 0 }}
      animate={{ scaleX: 1 }}
      transition={{ duration: 1.5, ease: 'linear' }}
      className="absolute bottom-0 left-0 h-px w-full origin-left bg-cipher-cyan shadow-[0_0_8px_rgba(0,245,212,0.7)]"
    />
  );
}
