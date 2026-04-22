'use client';

/**
 * MatchBeacon — fullscreen overlay rendered when a match is detected.
 * Three concentric rings expand outward in match-gold and the component
 * fires `onComplete` after 800ms (per UI_DESIGN.md §5.3 stage 1).
 *
 * Caller controls mounting; once you mount it, it auto-resolves.
 */

import { useEffect } from 'react';
import { cn } from '@/lib/utils';

export interface MatchBeaconProps {
  onComplete?: () => void;
  className?: string;
}

export function MatchBeacon({
  onComplete,
  className,
}: MatchBeaconProps): JSX.Element {
  useEffect(() => {
    if (!onComplete) return;
    const id = setTimeout(onComplete, 800);
    return () => clearTimeout(id);
  }, [onComplete]);

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center bg-obsidian-950/90 backdrop-blur-sm',
        className,
      )}
      role="status"
      aria-label="match detected"
    >
      <div className="relative flex size-32 items-center justify-center">
        {/* Three concentric rings, staggered start so they read as a pulse */}
        {[0, 120, 240].map((delay) => (
          <span
            key={delay}
            className="absolute size-32 rounded-full border-2 border-match-gold animate-beacon-expand"
            style={{ animationDelay: `${delay}ms` }}
            aria-hidden="true"
          />
        ))}
        <span className="relative size-3 rounded-full bg-match-gold shadow-[0_0_24px_rgba(255,209,102,0.7)]" />
      </div>
      <p className="absolute bottom-[40%] text-xs uppercase tracking-[0.4em] text-match-gold">
        Match detected
      </p>
    </div>
  );
}
