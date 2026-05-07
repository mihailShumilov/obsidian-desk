'use client';

/**
 * CipherField — controlled input that *visually* scrambles each typed
 * character into a cipher glyph after a short delay, while emitting the
 * real plaintext via `onChange`. Used so the user sees the typewriter
 * mutate into ciphertext as they type — the actual encryption still
 * happens later (on submit, via the SDK).
 *
 * The "decoded" mode (focus + first 600ms after a keystroke) shows real
 * characters so the user can verify what they typed; otherwise we show
 * the cipher mask. Pure visual — no plaintext escapes onChange.
 */

import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';
import { randomCipherString } from '@/lib/cipher-glyphs';

const REVEAL_MS = 600;

function maskFor(plain: string): string {
  return randomCipherString(plain.length);
}

export interface CipherFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Plaintext value. Always plaintext — the mask is purely visual. */
  value: string;
  onValueChange?: (next: string) => void;
}

export const CipherField = forwardRef<HTMLInputElement, CipherFieldProps>(
  ({ value, onValueChange, className, onChange, onFocus, onBlur, ...rest }, ref) => {
    const [revealing, setRevealing] = useState(false);
    const [focused, setFocused] = useState(false);
    const [mask, setMask] = useState(() => maskFor(value));
    const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Re-mask whenever the underlying plaintext changes length.
    useEffect(() => {
      setMask(maskFor(value));
    }, [value]);

    // While field is unfocused & not revealing, slowly mutate the mask
    // so it feels alive — same vibe as <Cipher /> at the cube.
    useEffect(() => {
      if (focused || revealing) return;
      const id = setInterval(() => setMask(maskFor(value)), 800);
      return () => clearInterval(id);
    }, [focused, revealing, value]);

    function flashReveal(): void {
      setRevealing(true);
      if (revealTimer.current) clearTimeout(revealTimer.current);
      revealTimer.current = setTimeout(() => setRevealing(false), REVEAL_MS);
    }

    const display = focused || revealing ? value : value.length > 0 ? mask : '';

    return (
      <div className="relative">
        <input
          ref={ref}
          {...rest}
          type="text"
          // We always render the real plaintext in the input itself but
          // overlay the mask via a visually-positioned span. This keeps
          // selection/cursor behavior intact AND lets the mask be styled.
          value={value}
          onChange={(e) => {
            flashReveal();
            onValueChange?.(e.target.value);
            onChange?.(e);
          }}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          className={cn(
            'h-11 w-full rounded-md border border-obsidian-700 bg-obsidian-800 px-3 font-mono text-sm tracking-wider',
            // Hide the real text when a mask is showing — we still need the
            // input to be focusable, so keep it transparent rather than
            // visibility:hidden.
            display === value
              ? 'text-foreground'
              : 'text-transparent caret-cipher-cyan',
            'focus:border-cipher-cyan focus:outline-none focus:ring-2 focus:ring-cipher-cyan/30',
            className,
          )}
          aria-label="cipher field"
          autoComplete="off"
          spellCheck={false}
        />
        {display !== value && value.length > 0 && (
          <span
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-mono text-sm tracking-wider text-cipher-cyan-dim/80"
            aria-hidden="true"
          >
            {display}
          </span>
        )}
      </div>
    );
  },
);
CipherField.displayName = 'CipherField';
