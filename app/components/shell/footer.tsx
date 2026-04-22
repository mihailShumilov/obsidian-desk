import Link from 'next/link';

export function Footer(): JSX.Element {
  return (
    <footer className="mt-24 border-t border-obsidian-700 py-8">
      <div className="mx-auto flex max-w-7xl flex-col items-start gap-4 px-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>
          ObsidianDesk · The dark pool where Bitcoin never leaves Bitcoin.
        </p>
        <ul className="flex items-center gap-5">
          <li>
            <Link
              href="/about"
              className="transition-colors hover:text-foreground"
            >
              About
            </Link>
          </li>
          <li>
            <a
              href="https://github.com/mihailShumilov/obsidian-desk"
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-foreground"
            >
              GitHub
            </a>
          </li>
          <li>
            <a
              href="https://ika.xyz"
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-foreground"
            >
              Ika
            </a>
          </li>
          <li>
            <a
              href="https://encrypt.xyz"
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-foreground"
            >
              Encrypt
            </a>
          </li>
        </ul>
      </div>
    </footer>
  );
}
