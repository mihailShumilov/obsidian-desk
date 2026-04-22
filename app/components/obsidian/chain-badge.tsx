/**
 * ChainBadge — small pill: colored dot + chain name.
 * Uses bitcoin-ember for "bitcoin", solana-violet for "solana".
 * Per UI_DESIGN.md §4.1.
 */

import { cn } from '@/lib/utils';

export type Chain = 'bitcoin' | 'solana';

const STYLES: Record<Chain, { dot: string; label: string }> = {
  bitcoin: { dot: 'bg-bitcoin-ember', label: 'Bitcoin' },
  solana: { dot: 'bg-solana-violet', label: 'Solana' },
};

export interface ChainBadgeProps {
  chain: Chain;
  className?: string;
  /** Override the displayed label; defaults to "Bitcoin" / "Solana". */
  label?: string;
}

export function ChainBadge({
  chain,
  className,
  label,
}: ChainBadgeProps): JSX.Element {
  const s = STYLES[chain];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-obsidian-700 bg-obsidian-900/60 px-2 py-0.5 text-xs font-medium text-foreground',
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', s.dot)} aria-hidden="true" />
      {label ?? s.label}
    </span>
  );
}
