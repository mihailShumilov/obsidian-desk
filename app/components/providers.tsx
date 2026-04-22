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
import {
  PhantomWalletAdapter,
  // Backpack has its own adapter package; we keep just Phantom for the
  // P5 scaffold to avoid pulling in another dep. Backpack support lands in
  // P8 alongside the trade-page wallet flow.
} from '@solana/wallet-adapter-wallets';
import '@solana/wallet-adapter-react-ui/styles.css';

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
          <WalletModalProvider>{children}</WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </QueryClientProvider>
  );
}
