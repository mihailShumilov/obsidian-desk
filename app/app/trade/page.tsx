/**
 * /trade — Three-column layout stub (book / chart / form). P7 wires
 * live data: real ciphertext PDAs in OrderbookVoid, Pyth chart in the
 * middle column, encrypt+submit choreography in the form.
 */

import { OrderbookVoid } from '@/components/obsidian/orderbook-void';
import { CipherField } from '@/components/obsidian/cipher-field';
import { ChainBadge } from '@/components/obsidian/chain-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export const metadata = { title: 'Trade · ObsidianDesk' };

const STUB_ORDERS = Array.from({ length: 14 }, (_, i) => ({
  id: `stub-${i}`,
  ...(i === 4
    ? { yours: { side: 'bid' as const, price: '69850.00', size: '0.500' } }
    : {}),
}));

export default function TradePage(): JSX.Element {
  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tightest">
          BTC / USDC
        </h1>
        <p className="text-xs uppercase tracking-widest text-muted">
          Encrypted Book · Devnet
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr_320px]">
        <Card className="p-4">
          <p className="mb-3 text-xs uppercase tracking-widest text-muted">
            Order Book
          </p>
          <OrderbookVoid
            orders={STUB_ORDERS}
            yourOrderIds={new Set(['stub-4'])}
          />
        </Card>

        <Card className="flex min-h-[400px] items-center justify-center p-6">
          <p className="text-sm text-muted">
            Price chart lands in P7 (Pyth BTC/USD).
          </p>
        </Card>

        <Card className="p-5">
          <p className="mb-4 text-xs uppercase tracking-widest text-muted">
            New Order
          </p>
          <div className="mb-3 inline-flex rounded-md border border-obsidian-700 bg-obsidian-800 p-0.5 text-xs">
            <button className="rounded-[4px] bg-cipher-cyan px-3 py-1 font-medium text-obsidian-950">
              Buy
            </button>
            <button className="rounded-[4px] px-3 py-1 text-muted">
              Sell
            </button>
          </div>
          <form className="space-y-3" action="">
            <Field label="Price (USDC)">
              <CipherField value="" placeholder="0.00" />
            </Field>
            <Field label="Size (BTC)">
              <CipherField value="" placeholder="0.000" />
            </Field>
            <Button type="button" className="w-full" disabled>
              Encrypt &amp; Seal
            </Button>
            <p className="text-[10px] text-muted">
              Wired in P7 — encryption + Solana submit choreography.
            </p>
          </form>

          <div className="mt-6 border-t border-obsidian-700 pt-4">
            <p className="mb-2 text-xs uppercase tracking-widest text-muted">
              Your dWallet
            </p>
            <div className="flex items-center justify-between text-sm">
              <ChainBadge chain="bitcoin" />
              <span className="font-mono text-xs text-muted">
                Lock one in /deposit
              </span>
            </div>
          </div>
        </Card>
      </div>
    </main>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}
