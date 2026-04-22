import Link from 'next/link';
import { ObsidianLogo } from './logo';
import { WalletButton } from './wallet-button';

const NAV = [
  { href: '/trade', label: 'Trade' },
  { href: '/deposit', label: 'Deposit' },
  { href: '/positions', label: 'Positions' },
  { href: '/about', label: 'About' },
] as const;

const NETWORK = process.env['NEXT_PUBLIC_NETWORK'] ?? 'devnet';

export function Header(): JSX.Element {
  return (
    <header className="sticky top-0 z-30 border-b border-obsidian-700 bg-obsidian-950/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-6">
        <Link
          href="/"
          className="flex items-center gap-2 text-foreground transition-colors hover:text-cipher-cyan"
        >
          <ObsidianLogo size={22} />
          <span className="text-sm font-semibold tracking-tightest">
            ObsidianDesk
          </span>
        </Link>

        <nav className="flex items-center gap-5 text-sm text-muted">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="transition-colors duration-200 ease-snappy hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden items-center gap-2 rounded-md border border-obsidian-700 px-2.5 py-1 text-xs uppercase tracking-widest text-muted sm:inline-flex">
            <span className="size-1.5 rounded-full bg-cipher-cyan-dim" />
            {NETWORK}
          </span>
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
