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

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';

function randGlyphs(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

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
  const [text, setText] = useState<string>(() =>
    value ?? randGlyphs(length),
  );

  useEffect(() => {
    if (cadenceMs === 0) {
      setText(value ?? randGlyphs(length));
      return;
    }
    if (value !== undefined) {
      setText(value);
      return;
    }
    setText(randGlyphs(length));
    const id = setInterval(() => setText(randGlyphs(length)), cadenceMs);
    return () => clearInterval(id);
  }, [cadenceMs, length, value]);

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
