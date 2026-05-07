'use client';

/**
 * Renders the right-hand action slot in the shell header.
 *
 * On app routes (`/trade`, `/deposit`, `/positions`) — where the
 * `(authenticated)` layout has mounted `<Providers>` with the Solana wallet
 * adapter — render the real `<WalletButton />`. Everywhere else (landing,
 * `/pitch`, `/about`, `/kitchen`) the wallet adapter context isn't mounted
 * and its stylesheet isn't loaded, so the button rendered as unstyled raw
 * markup. Show a "Launch Terminal" CTA instead.
 */

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';

const APP_PREFIXES = ['/trade', '/deposit', '/positions'];

const WalletButton = dynamic(
  () => import('./wallet-button').then((m) => m.WalletButton),
  { ssr: false },
);

export function HeaderActions(): JSX.Element {
  const pathname = usePathname() ?? '/';
  const isApp = APP_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (isApp) return <WalletButton />;

  return (
    <Link href="/trade">
      <Button size="sm">Launch Terminal</Button>
    </Link>
  );
}
