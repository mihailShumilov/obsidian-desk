import type { Metadata } from 'next';
import { Geist, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Header } from '@/components/shell/header';
import { Footer } from '@/components/shell/footer';
import { Providers } from '@/components/providers';

// Loaded per UI_DESIGN.md §12 — variable fonts published as CSS vars
// (--font-geist, --font-mono) and consumed by tailwind.config.ts
// fontFamily.{sans,mono}.
const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist',
  display: 'swap',
});
const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title:
    'ObsidianDesk — The dark pool where Bitcoin never leaves Bitcoin',
  description:
    'Institutional dark-pool DEX on Solana. FHE-matched encrypted orderbook (Encrypt) with native BTC settlement via Ika dWallets. No bridges, no leakage.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  return (
    <html lang="en" className={`${geist.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-obsidian-950 font-sans text-foreground antialiased">
        <Providers>
          <div className="flex min-h-screen flex-col">
            <Header />
            <div className="flex-1">{children}</div>
            <Footer />
          </div>
        </Providers>
      </body>
    </html>
  );
}
