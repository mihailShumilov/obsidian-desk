'use client';

/**
 * SettleThread — thin horizontal line connecting two endpoints (typically
 * a Solana panel and a Bitcoin panel during settlement). A cipher-cyan
 * shimmer travels left→right continuously via the `thread-shimmer`
 * keyframe defined in tailwind.config.ts.
 *
 * Render between two siblings inside a flex container. Spec: §5.3 stage 3.
 */

import { cn } from '@/lib/utils';

export interface SettleThreadProps {
  className?: string;
  /** Visual width — defaults to fill parent */
  height?: number;
}

export function SettleThread({
  className,
  height = 2,
}: SettleThreadProps): JSX.Element {
  return (
    <div
      role="presentation"
      className={cn(
        'relative w-full overflow-hidden rounded-full bg-obsidian-700/60',
        className,
      )}
      style={{ height }}
    >
      <div
        className="thread-bg animate-thread-shimmer absolute inset-0"
        aria-hidden="true"
      />
    </div>
  );
}
