/**
 * DWalletCard — shows a dWallet at a glance: chain badge, truncated
 * address (mono), balance. Subtle inset ring instead of drop shadow.
 *
 * Address truncation pattern: `<6>…<4>` per UI_DESIGN.md §8.
 */

import { ChainBadge, type Chain } from './chain-badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface DWalletCardProps {
  chain: Chain;
  address: string;
  /** Balance in the chain's smallest unit (sats for BTC). Optional. */
  balanceSats?: bigint;
  className?: string;
}

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatBtc(sats: bigint): string {
  // Render up to 8 decimals, drop trailing zeros for compactness
  const whole = sats / 100_000_000n;
  const frac = sats % 100_000_000n;
  const fracStr = frac.toString().padStart(8, '0').replace(/0+$/, '');
  return fracStr.length > 0 ? `${whole}.${fracStr}` : `${whole}`;
}

export function DWalletCard({
  chain,
  address,
  balanceSats,
  className,
}: DWalletCardProps): JSX.Element {
  return (
    <Card className={cn('w-full', className)}>
      <CardContent className="flex items-center justify-between gap-4 p-4">
        <div className="space-y-1.5">
          <ChainBadge chain={chain} />
          <p className="font-mono text-sm text-foreground" title={address}>
            {truncateAddress(address)}
          </p>
        </div>
        {balanceSats !== undefined && (
          <div className="text-right">
            <p className="font-mono text-base text-foreground">
              {formatBtc(balanceSats)}
              <span className="ml-1 text-xs text-muted">
                {chain === 'bitcoin' ? 'BTC' : 'SOL'}
              </span>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
