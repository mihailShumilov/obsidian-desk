/**
 * Layout for routes that need the wallet adapter, react-query, and the
 * dWallet balance poller. Lives in a route group so the URL shape is
 * unchanged ((authenticated) doesn't appear in paths) while the heavier
 * client-side providers stay off the landing page.
 */

import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';

export default function AuthenticatedLayout({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  return <Providers>{children}</Providers>;
}
