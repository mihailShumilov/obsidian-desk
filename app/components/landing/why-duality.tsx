/**
 * Why Ika+Encrypt — two-column "broken" diagrams.
 *
 * Left:  Remove Encrypt → public orderbook leak (red overlay)
 * Right: Remove Ika → wBTC bridge with crack (red overlay)
 * Bottom: "Neither alone is enough."
 *
 * Per UI_DESIGN.md §6.1 §4.
 */

export function WhyDuality(): JSX.Element {
  return (
    <section className="border-t border-obsidian-700">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <p className="text-xs uppercase tracking-widest text-cipher-cyan-dim">
          Why both
        </p>
        <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tightest text-foreground sm:text-4xl">
          Encrypt without Ika is half a system. Ika without Encrypt is too.
        </h2>

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          <BrokenColumn
            heading="Remove Encrypt →"
            subhead="The orderbook becomes public again."
            visual={<PublicBookLeak />}
            caption="Without FHE, every PDA is plaintext on chain. Watchers replay your strategy in real time."
          />
          <BrokenColumn
            heading="Remove Ika →"
            subhead="Settlement collapses back to a bridge."
            visual={<BrokenBridge />}
            caption="Without dWallets, BTC has to be wrapped. The custodian is back, the bridge is back, the trust assumptions are back."
          />
        </div>

        <p className="mt-12 text-center text-lg text-foreground">
          Neither alone is enough.
        </p>
      </div>
    </section>
  );
}

function BrokenColumn({
  heading,
  subhead,
  visual,
  caption,
}: {
  heading: string;
  subhead: string;
  visual: React.ReactNode;
  caption: string;
}): JSX.Element {
  return (
    <div className="rounded-lg border border-obsidian-700 bg-obsidian-900 p-6 ring-inset-subtle">
      <h3 className="text-lg font-semibold tracking-tightest text-danger-red">
        {heading}
      </h3>
      <p className="mt-1 text-sm text-muted">{subhead}</p>
      <div className="my-6 flex h-44 items-center justify-center rounded-md border border-obsidian-700 bg-obsidian-800/50">
        {visual}
      </div>
      <p className="text-sm text-muted">{caption}</p>
    </div>
  );
}

function PublicBookLeak(): JSX.Element {
  // Ladder of plaintext numbers leaking through, with red overlay
  return (
    <svg viewBox="0 0 200 100" className="h-32 w-full" aria-hidden="true">
      <g
        fontFamily="JetBrains Mono, ui-monospace, monospace"
        fontSize="10"
        fill="#71717A"
      >
        <text x="20" y="22">69850.00 × 0.500</text>
        <text x="20" y="38">69845.00 × 1.250</text>
        <text x="20" y="54">69840.00 × 0.300</text>
        <text x="20" y="70">69835.00 × 2.000</text>
      </g>
      {/* Red diagonal slash + leak arrows */}
      <path
        d="M120 10 L180 90"
        stroke="#FF3E6A"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.85"
      />
      <g stroke="#FF3E6A" strokeWidth="1.2" fill="none" opacity="0.85">
        <path d="M150 22 L172 18" />
        <path d="M150 38 L172 36" />
        <path d="M150 54 L172 54" />
        <path d="M150 70 L172 72" />
      </g>
    </svg>
  );
}

function BrokenBridge(): JSX.Element {
  return (
    <svg viewBox="0 0 200 100" className="h-32 w-full" aria-hidden="true">
      {/* Two coins */}
      <circle cx="40" cy="50" r="20" stroke="#71717A" strokeWidth="1.4" fill="none" />
      <text
        x="40"
        y="55"
        textAnchor="middle"
        fontFamily="JetBrains Mono, ui-monospace, monospace"
        fontSize="14"
        fontWeight="700"
        fill="#71717A"
      >
        ₿
      </text>
      <circle cx="160" cy="50" r="20" stroke="#71717A" strokeWidth="1.4" fill="none" />
      <text
        x="160"
        y="55"
        textAnchor="middle"
        fontFamily="JetBrains Mono, ui-monospace, monospace"
        fontSize="11"
        fontWeight="700"
        fill="#71717A"
      >
        wBTC
      </text>
      {/* Bridge line broken in middle */}
      <line x1="60" y1="50" x2="92" y2="50" stroke="#71717A" strokeWidth="1.5" />
      <line x1="108" y1="50" x2="140" y2="50" stroke="#71717A" strokeWidth="1.5" />
      <path
        d="M88 36 L102 50 L92 60 L106 70"
        stroke="#FF3E6A"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
