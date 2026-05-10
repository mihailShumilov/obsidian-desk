'use client';

/**
 * Client-side providers — must live in a 'use client' island because
 * @solana/wallet-adapter-react ships browser-only globals (window.solana,
 * etc.) that can't run during Next.js server rendering.
 *
 * Endpoint defaults to the local validator (rpc_port 18899 in Anchor.toml).
 * Override via NEXT_PUBLIC_SOLANA_RPC for devnet/mainnet demos.
 */

import { useMemo, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ConnectionProvider,
  WalletProvider,
} from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import '@solana/wallet-adapter-react-ui/styles.css';
import { useDwalletPoller } from '@/stores/dwallet';

const RPC_ENDPOINT =
  process.env['NEXT_PUBLIC_SOLANA_RPC'] ?? 'http://127.0.0.1:18899';

// Phantom (and most modern Solana wallets) auto-register via the Wallet
// Standard, so passing them explicitly here is redundant — `WalletProvider`
// dedupes against the Standard registration and logs a noisy warning per
// render. Leaving the list empty lets the modal pick up Phantom (and any
// other Standard-compliant wallet) on its own.
const WALLETS: never[] = [];

export function Providers({ children }: { children: ReactNode }): JSX.Element {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false },
        },
      }),
    [],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider endpoint={RPC_ENDPOINT}>
        <WalletProvider wallets={WALLETS} autoConnect>
          <WalletModalProvider>
            <DwalletPollerHost />
            {children}
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </QueryClientProvider>
  );
}

/** Mounts the 15s esplora balance poll without re-rendering the tree. */
function DwalletPollerHost(): null {
  useDwalletPoller();
  return null;
}
