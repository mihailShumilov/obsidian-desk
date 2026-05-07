/**
 * DWalletCard — shows a dWallet at a glance: chain badge, truncated
 * address (mono), balance. Subtle inset ring instead of drop shadow.
 *
 * Address truncation pattern: `<6>…<4>` per UI_DESIGN.md §8.
 */

import { ChainBadge, type Chain } from './chain-badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatBtc, truncateAddress } from '@/lib/format';

export interface DWalletCardProps {
  chain: Chain;
  address: string;
  /** Balance in the chain's smallest unit (sats for BTC). Optional. */
  balanceSats?: bigint;
  className?: string;
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
