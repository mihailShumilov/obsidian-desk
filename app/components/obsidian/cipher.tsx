'use client';

/**
 * Cipher — renders a mono ciphertext block whose glyphs scramble on a
 * fixed cadence (default 800ms, matching the hero cube cadence in
 * UI_DESIGN.md §5.1).
 *
 * Two modes:
 *   - value provided  → render `value` and shimmer in place; the actual
 *                       characters do not change (used when callers want
 *                       to display real bytes but still feel "alive")
 *   - value omitted   → fully synthetic — every cadence tick generates a
 *                       fresh string of `length` glyphs from the cipher
 *                       alphabet (used in OrderbookVoid + hero cube)
 *
 * Honors `prefers-reduced-motion` via globals.css (cadence still runs but
 * the per-glyph animation does not).
 */

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { randomCipherString } from '@/lib/cipher-glyphs';
import { useDocumentVisible } from '@/lib/use-document-visible';

export interface CipherProps {
  /** If omitted, glyphs are generated fresh each tick. */
  value?: string;
  /** Glyph count when value is omitted. Default 32. */
  length?: number;
  /** Mutation cadence in ms. Default 800. Set 0 to freeze. */
  cadenceMs?: number;
  className?: string;
}

export function Cipher({
  value,
  length = 32,
  cadenceMs = 800,
  className,
}: CipherProps): JSX.Element {
  // SSR-safe: deterministic placeholder on first render (server + client
  // hydration agree). The real cipher glyphs replace it on mount.
  const [text, setText] = useState<string>(() => value ?? '·'.repeat(length));
  const visible = useDocumentVisible();

  useEffect(() => {
    if (cadenceMs === 0) {
      setText(value ?? randomCipherString(length));
      return;
    }
    if (value !== undefined) {
      setText(value);
      return;
    }
    setText(randomCipherString(length));
    if (!visible) return;
    const id = setInterval(() => setText(randomCipherString(length)), cadenceMs);
    return () => clearInterval(id);
  }, [cadenceMs, length, value, visible]);

  return (
    <span
      className={cn(
        'font-mono text-cipher-cyan-dim/80',
        // Subtle pulse so the glyphs feel alive even between cadence ticks
        'animate-pulse-cipher',
        className,
      )}
      aria-label="encrypted ciphertext"
    >
      {text}
    </span>
  );
}
