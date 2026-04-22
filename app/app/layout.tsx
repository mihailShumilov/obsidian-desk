import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ObsidianDesk — The dark pool where Bitcoin never leaves Bitcoin',
  description:
    'Institutional dark-pool DEX on Solana. FHE-matched encrypted orderbook (Encrypt) with native BTC settlement via Ika dWallets. No bridges, no leakage.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-obsidian-950 text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
