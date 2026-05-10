'use client';

/**
 * Compact dWallet status chip for the header. Renders only after the
 * persisted store has hydrated client-side, so SSR markup never differs
 * from CSR (avoids hydration mismatches). Click copies the full address.
 */

import { useEffect, useState } from 'react';
import { useDwalletStore } from '@/stores/dwallet';
import { formatBtc, truncateAddress } from '@/lib/format';

export function DWalletChip(): JSX.Element | null {
  const dwallet = useDwalletStore((s) => s.dwallet);
  const balanceSats = useDwalletStore((s) => s.balanceSats);
  const policyLocked = useDwalletStore((s) => s.policyLocked);

  const [hydrated, setHydrated] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => setHydrated(true), []);

  if (!hydrated || !dwallet) return null;

  async function copy(): Promise<void> {
    if (!dwallet) return;
    try {
      await navigator.clipboard.writeText(dwallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard API can reject in non-HTTPS / iframe contexts; silent fail
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="hidden items-center gap-2 rounded-md border border-obsidian-700 bg-obsidian-900/60 px-2.5 py-1 text-xs transition-colors hover:border-cipher-cyan/40 md:inline-flex"
      title={`${dwallet.address}${policyLocked ? '\n(policy locked)' : ''}\nclick to copy`}
    >
      <span
        className={`size-1.5 rounded-full ${
          policyLocked ? 'bg-cipher-cyan' : 'bg-bitcoin-ember'
        }`}
        aria-hidden="true"
      />
      <span className="font-mono text-muted">
        {copied ? 'copied!' : truncateAddress(dwallet.address)}
      </span>
      <span className="font-mono text-foreground">
        {formatBtc(BigInt(balanceSats))}
        <span className="ml-1 text-muted">BTC</span>
      </span>
    </button>
  );
}
