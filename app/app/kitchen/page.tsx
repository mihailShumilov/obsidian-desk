'use client';

/**
 * /_kitchen — Storybook-like visual test page covering every state of
 * every custom component, plus typography and color tokens. Used for
 * design QA. Hidden from prod nav (link only here, not in /trade-style
 * header), but reachable directly.
 */

import { useState } from 'react';
import { Cipher } from '@/components/obsidian/cipher';
import { CipherField } from '@/components/obsidian/cipher-field';
import { ChainBadge } from '@/components/obsidian/chain-badge';
import { DWalletCard } from '@/components/obsidian/dwallet-card';
import { MatchBeacon } from '@/components/obsidian/match-beacon';
import { SettleThread } from '@/components/obsidian/settle-thread';
import { OrderbookVoid } from '@/components/obsidian/orderbook-void';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function KitchenSink(): JSX.Element {
  const [showBeacon, setShowBeacon] = useState(false);
  const [price, setPrice] = useState('69850.00');
  const [size, setSize] = useState('0.500');

  return (
    <main className="mx-auto max-w-6xl space-y-12 px-6 py-12">
      <header>
        <h1 className="text-3xl font-semibold tracking-tightest">
          Kitchen Sink
        </h1>
        <p className="mt-2 text-sm text-muted">
          Visual test surface for the obsidian design system.
        </p>
      </header>

      <Section title="Color tokens">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Swatch name="obsidian-950" hex="#05050A" cls="bg-obsidian-950" />
          <Swatch name="obsidian-900" hex="#0B0B14" cls="bg-obsidian-900" />
          <Swatch name="obsidian-800" hex="#12121C" cls="bg-obsidian-800" />
          <Swatch name="obsidian-700" hex="#1E1E2C" cls="bg-obsidian-700" />
          <Swatch name="cipher-cyan" hex="#00F5D4" cls="bg-cipher-cyan" dark />
          <Swatch name="bitcoin-ember" hex="#FF8A00" cls="bg-bitcoin-ember" dark />
          <Swatch name="solana-violet" hex="#A855F7" cls="bg-solana-violet" dark />
          <Swatch name="match-gold" hex="#FFD166" cls="bg-match-gold" dark />
          <Swatch name="danger-red" hex="#FF3E6A" cls="bg-danger-red" dark />
        </div>
      </Section>

      <Section title="Typography">
        <div className="space-y-3">
          <p className="text-6xl font-semibold tracking-tightest">Hero 6xl</p>
          <p className="text-4xl font-semibold tracking-tightest">Page H1 4xl</p>
          <p className="text-2xl font-semibold tracking-tightest">Section H2 2xl</p>
          <p className="text-lg">Emphasized body lg</p>
          <p>Body base</p>
          <p className="text-sm text-muted">Secondary sm muted</p>
          <p className="text-xs uppercase tracking-widest text-muted">
            Micro xs uppercase
          </p>
          <p className="font-mono text-base">
            Mono numbers: 1234567890 · 0.00012345
          </p>
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button size="sm">sm</Button>
          <Button size="md">md</Button>
          <Button size="lg">lg</Button>
        </div>
      </Section>

      <Section title="Card">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Card title</CardTitle>
            <CardDescription>Subtle ring, no drop shadow.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted">
              Cards are `bg-obsidian-900` with a 1px obsidian-700 border and
              an inset white/5 ring.
            </p>
          </CardContent>
        </Card>
      </Section>

      <Section title="ChainBadge">
        <div className="flex gap-3">
          <ChainBadge chain="bitcoin" />
          <ChainBadge chain="solana" />
        </div>
      </Section>

      <Section title="DWalletCard">
        <div className="grid gap-3 sm:grid-cols-2">
          <DWalletCard
            chain="bitcoin"
            address="tb1q3xyzabcd1234567890efghijklmnopqrstuvw"
            balanceSats={123_456_789n}
          />
          <DWalletCard
            chain="solana"
            address="kitchen-sink-mock-address"
          />
        </div>
      </Section>

      <Section title="Cipher (synthetic + value-locked)">
        <div className="space-y-2">
          <p className="text-xs text-muted">Synthetic, 32 glyphs, 800ms cadence:</p>
          <Cipher length={32} />
          <p className="text-xs text-muted">Synthetic, 16 glyphs, 1600ms cadence:</p>
          <Cipher length={16} cadenceMs={1600} />
          <p className="text-xs text-muted">Value-locked (does not mutate):</p>
          <Cipher value="LOCKED-CIPHER-EXAMPLE" cadenceMs={0} />
        </div>
      </Section>

      <Section title="CipherField">
        <div className="grid max-w-md gap-3">
          <CipherField
            value={price}
            onValueChange={setPrice}
            placeholder="Price"
          />
          <CipherField
            value={size}
            onValueChange={setSize}
            placeholder="Size"
          />
          <p className="text-xs text-muted">
            Plaintext is preserved — the mask is purely visual.
          </p>
        </div>
      </Section>

      <Section title="SettleThread">
        <div className="flex items-center gap-3 rounded-lg border border-obsidian-700 bg-obsidian-900 p-4">
          <ChainBadge chain="solana" />
          <SettleThread />
          <ChainBadge chain="bitcoin" />
        </div>
      </Section>

      <Section title="MatchBeacon (overlay)">
        <Button onClick={() => setShowBeacon(true)}>Trigger beacon</Button>
        {showBeacon && <MatchBeacon onComplete={() => setShowBeacon(false)} />}
      </Section>

      <Section title="OrderbookVoid (14 rows, one yours)">
        <Card className="max-w-sm p-4">
          <OrderbookVoid
            orders={Array.from({ length: 14 }, (_, i) => ({
              id: `kitchen-${i}`,
              ...(i === 7
                ? {
                    yours: {
                      side: 'ask' as const,
                      price: '69850.00',
                      size: '0.500',
                    },
                  }
                : {}),
            }))}
            yourOrderIds={new Set(['kitchen-7'])}
          />
        </Card>
      </Section>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section>
      <h2 className="mb-4 text-xs uppercase tracking-widest text-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Swatch({
  name,
  hex,
  cls,
  dark,
}: {
  name: string;
  hex: string;
  cls: string;
  dark?: boolean;
}): JSX.Element {
  return (
    <div className="rounded-lg border border-obsidian-700 ring-inset-subtle">
      <div className={`h-16 rounded-t-[7px] ${cls}`} />
      <div className="flex items-baseline justify-between p-3 text-xs">
        <span className={dark ? 'text-foreground' : 'text-muted'}>{name}</span>
        <span className="font-mono text-muted">{hex}</span>
      </div>
    </div>
  );
}
