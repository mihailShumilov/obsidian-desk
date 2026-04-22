/**
 * /about — Minimal marketing page.
 */

import Link from 'next/link';
import { Button } from '@/components/ui/button';

export const metadata = { title: 'About · ObsidianDesk' };

export default function AboutPage(): JSX.Element {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tightest">
        Why we built this
      </h1>

      <section className="mt-8 space-y-4 text-sm leading-relaxed text-muted">
        <p>
          Every existing dark pool runs on someone else's trust. The matching
          engine sees your order. The custodian holds your asset. The bridge
          mints a wrapped IOU and prays.
        </p>
        <p>
          ObsidianDesk replaces all three. The orderbook is encrypted on
          Solana via Encrypt's FHE primitives — even the matching engine
          never sees plaintext until a fill is found. Settlement happens on
          Bitcoin itself, signed by an Ika dWallet that you and the network
          jointly control.
        </p>
        <p>
          The result: a venue where price discovery is private, custody is
          yours, and the BTC that settles is the actual UTXO — not a wrapped
          claim.
        </p>
      </section>

      <h2 className="mt-12 text-lg font-semibold tracking-tightest">
        How it works
      </h2>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-muted">
        <li>You submit an encrypted order from the trade terminal.</li>
        <li>
          The Solana program stores it as a ciphertext PDA — only you can
          read its contents off-chain.
        </li>
        <li>
          The keeper bot tries matches via FHE comparison. When two orders
          cross, the program emits a settlement intent.
        </li>
        <li>
          The Ika network co-signs a BTC transaction from your dWallet to
          the counterparty. The signed tx is broadcast to signet.
        </li>
        <li>
          Solana records the BTC tx hash and marks the match settled. No
          wrapped tokens were involved.
        </li>
      </ol>

      <div className="mt-12 flex items-center gap-3">
        <Link href="/trade">
          <Button>Launch Terminal</Button>
        </Link>
        <Link href="/deposit">
          <Button variant="secondary">Onboard a dWallet</Button>
        </Link>
      </div>
    </main>
  );
}
