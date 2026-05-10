/**
 * Route group placeholder. The wallet adapter, react-query, and dWallet
 * poller now live in the root layout so the header `<WalletButton>` (which
 * is rendered globally) sits inside `<WalletModalProvider>` on every route.
 *
 * Kept as a pass-through so we can layer auth gating here later without
 * moving files around.
 */

import type { ReactNode } from 'react';

export default function AuthenticatedLayout({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  return <>{children}</>;
}
