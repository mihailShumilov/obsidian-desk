'use client';

/**
 * Thin wrapper around `<WalletMultiButton />` so we can apply our design
 * tokens without forking @solana/wallet-adapter-react-ui's stylesheet.
 *
 * Defaults from the adapter's CSS use a `#512da8` purple — we override
 * to `obsidian-800` with a cipher-cyan accent on hover via the
 * `wallet-adapter-button` selector targeted from globals.
 */

import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

export function WalletButton(): JSX.Element {
  // The adapter button is heavily styled by its own stylesheet. We wrap it
  // in a span and override the few colors that matter via the parent class
  // selector below (see app/globals.css `.wallet-shell .wallet-adapter-button`).
  return (
    <span className="wallet-shell">
      <WalletMultiButton />
    </span>
  );
}
