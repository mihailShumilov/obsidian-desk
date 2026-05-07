'use client';

/**
 * Compact dWallet status chip for the header. Renders only after the
 * persisted store has hydrated client-side, so SSR markup never differs
 * from CSR (avoids hydration mismatches).
 */

import { useEffect, useState } from 'react';
import { useDwalletStore } from '@/stores/dwallet';
import { formatBtc, truncateAddress } from '@/lib/format';

export function DWalletChip(): JSX.Element | null {
  const dwallet = useDwalletStore((s) => s.dwallet);
  const balanceSats = useDwalletStore((s) => s.balanceSats);
  const policyLocked = useDwalletStore((s) => s.policyLocked);

  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  if (!hydrated || !dwallet) return null;

  return (
    <span
      className="hidden items-center gap-2 rounded-md border border-obsidian-700 bg-obsidian-900/60 px-2.5 py-1 text-xs md:inline-flex"
      title={`${dwallet.address}${policyLocked ? '\n(policy locked)' : ''}`}
    >
      <span
        className={`size-1.5 rounded-full ${
          policyLocked ? 'bg-cipher-cyan' : 'bg-bitcoin-ember'
        }`}
        aria-hidden="true"
      />
      <span className="font-mono text-muted">{truncateAddress(dwallet.address)}</span>
      <span className="font-mono text-foreground">
        {formatBtc(BigInt(balanceSats))}
        <span className="ml-1 text-muted">BTC</span>
      </span>
    </span>
  );
}
