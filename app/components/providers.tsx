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
// Imported from the per-wallet package (not the umbrella
// `@solana/wallet-adapter-wallets`) — the umbrella drags in Ledger
// hardware wallet deps which need libusb / node-gyp / python at install
// time, and doubles the production node_modules tree. We can add other
// adapters one-by-one if needed.
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import '@solana/wallet-adapter-react-ui/styles.css';
import { useDwalletPoller } from '@/stores/dwallet';

const RPC_ENDPOINT =
  process.env['NEXT_PUBLIC_SOLANA_RPC'] ?? 'http://127.0.0.1:18899';

export function Providers({ children }: { children: ReactNode }): JSX.Element {
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);
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
        <WalletProvider wallets={wallets} autoConnect={false}>
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
