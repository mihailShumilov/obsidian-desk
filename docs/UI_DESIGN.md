# ObsidianDesk — UI Design System

> **Design thesis:** Institutional Bloomberg-terminal meets cypherpunk. Dark, precise, alive. The UI itself *is* the marketing. Each screen should feel like you're looking at something classified.

---

## 1. Brand identity

**Name:** ObsidianDesk (brand), Obsidian (product marker)
**Tagline (primary):** *The dark pool where Bitcoin never leaves Bitcoin.*
**Tagline (secondary):** *Encrypted orderbook. Native settlement. Zero leakage.*

**Visual metaphor:**
- Obsidian = volcanic glass = black, sharp, reflective. Ordering data hidden *inside* the glass.
- A trading desk at a bank — but the book is encrypted stone until a match cracks it open.

**Voice:**
- Terse. Confident. Institutional.
- No crypto-bro slang. No "gm". No rockets.
- Examples:
  - ✅ "Order sealed."
  - ❌ "Order submitted! 🚀"
  - ✅ "The book is silent."
  - ❌ "No orders yet, be the first!"

---

## 2. Color system

### Primary palette

| Name | Hex | Usage |
|---|---|---|
| `obsidian-950` | `#05050A` | Page background |
| `obsidian-900` | `#0B0B14` | Card bg |
| `obsidian-800` | `#12121C` | Elevated card, inputs |
| `obsidian-700` | `#1E1E2C` | Border, divider |
| `obsidian-600` | `#2A2A3C` | Hover states |
| `foreground` | `#E4E4E7` | Primary text |
| `muted` | `#71717A` | Secondary text |

### Accent palette

| Name | Hex | Usage |
|---|---|---|
| `cipher-cyan` | `#00F5D4` | Primary accent — "encrypted" state, CTAs, focus |
| `cipher-cyan-dim` | `#00B39A` | Hover dim, secondary |
| `bitcoin-ember` | `#FF8A00` | Bitcoin network markers, BTC side |
| `solana-violet` | `#A855F7` | Solana network markers, SOL side |
| `danger-red` | `#FF3E6A` | Failures, cancellations |
| `match-gold` | `#FFD166` | Match-found flashes (rare, precious) |

**Rule:** only ONE accent visible per screen at a time unless explicitly juxtaposing Solana vs Bitcoin (settlement view).

### Gradients

- `gradient-cipher`: linear `#00F5D4` → `#00B39A` 120deg (for primary CTAs)
- `gradient-glass`: radial from `rgba(0,245,212,0.08)` to transparent (ambient glow on hero)
- `gradient-duality`: linear `#A855F7 0%` → `#FF8A00 100%` (for Solana↔Bitcoin moments only)

---

## 3. Typography

**Display (H1, H2):** `Geist Sans` (or `Space Grotesk` as fallback) — 600 weight, tight tracking `-0.02em`
**Body:** `Geist Sans` — 400/500, 16px base
**Mono (addresses, ciphertext, numbers):** `JetBrains Mono` — 400, tabular-nums

**Scale (rem):**
- `text-6xl` — 4.5rem — hero H1
- `text-4xl` — 2.5rem — page H1
- `text-2xl` — 1.5rem — section H2
- `text-lg` — 1.125rem — emphasized body
- `text-base` — 1rem
- `text-sm` — 0.875rem — secondary
- `text-xs` — 0.75rem — micro, labels

**Numbers** always in mono with `font-variant-numeric: tabular-nums`. Prices/sizes must align vertically.

---

## 4. Component library

Build on **shadcn/ui** (copy-paste, fully customizable). Extend with a custom `/components/obsidian/*` layer.

### 4.1 Core custom components

| Component | Purpose |
|---|---|
| `<Cipher />` | Renders a "encrypted" byte string. Optional prop `scramble` animates the glyphs infinitely. Used for ciphertext previews in the book. |
| `<CipherField />` | Input that visually scrambles characters as you type (then submits plaintext under the hood, encrypts on submit) |
| `<ChainBadge chain="bitcoin"|"solana" />` | Small pill with orange or violet dot + chain name |
| `<DWalletCard />` | Visual of a dWallet — black card, chain icon, truncated address, balance |
| `<MatchBeacon />` | Animated pulse when a match is detected, radial glow in match-gold |
| `<SettleThread />` | Visual connection between two `ChainBadge`s with a shimmering thread, used during settlement |
| `<VaultStack />` | Visualizes liquidity as stacked horizontal bars with cipher-text overlay |
| `<OrderbookVoid />` | The "encrypted orderbook" visual — see §5 |

### 4.2 Buttons

- Primary: `bg-cipher-cyan text-obsidian-950` solid, slight glow on hover (`shadow-[0_0_24px_rgba(0,245,212,0.35)]`)
- Secondary: `border-obsidian-700 text-foreground` ghost, hover fills to `obsidian-800`
- Danger: `text-danger-red` ghost, hover fills to `rgba(255,62,106,0.1)`

Corner radius: `rounded-md` (6px) consistently. No overly rounded elements — we're institutional, not consumer.

### 4.3 Cards

- `bg-obsidian-900` base
- `border border-obsidian-700`
- `backdrop-blur-sm` when over gradient
- `rounded-lg` (8px)
- NO drop-shadows by default; use subtle inner ring `inset-ring-1 inset-ring-white/5`

---

## 5. Wow-moment choreography

Three sustained wow-moments. If any of these are missing, the product is just "another dark pool UI". These are what win the hackathon.

### 5.1 Hero — The Encrypted Book Cube

**Where:** Landing page (`/`)

**What:** Center of hero section — a slowly rotating 3D cube (or 2D isometric fallback) whose 6 faces are each a price-level in the orderbook. Instead of numbers, each face displays a block of **mono ciphertext** — glyphs drawn from `[A-Z0-9]` that subtly scramble every 800ms. The cube casts a faint cipher-cyan glow on the floor.

Behind the cube, a parallax starfield of characters falling Matrix-style but extremely sparse (≤10 glyphs/second visible). Must not distract.

**Tagline appears top-left in Geist Sans 4.5rem:**
> The dark pool where
> **Bitcoin never leaves Bitcoin.**

Sub-line, muted:
> Encrypted orderbook. FHE-matched. Native-settled. On Solana.

Below cube, a live "stats widget" (even if zeroed on devnet):
- `Total volume (encrypted):` `████████` (never revealed, just an encrypted bar)
- `Active orders:` `14`
- `Last match:` `2 min ago`

**Implementation:**
- If time: `@react-three/fiber` with a boxGeometry, custom shader that samples a texture atlas of cipher chars, rotating animation via `useFrame`
- If no time: 2D isometric projection with 3 visible faces, CSS `transform: rotateY()` with keyframes, `SVG` text masks — still looks great

**CTA:** `Launch Terminal` → `/trade`

### 5.2 Submit order — Encryption reveal

**Where:** Trade page (`/trade`) form submission

**What:** After user clicks "Place Order", the form does NOT navigate. It performs a 1.8-second choreography:

1. **0ms** — Button locks. Button text → `Encrypting…`. A thin cipher-cyan line travels across the button's bottom edge.
2. **300ms** — Each character in the user's input fields (price, size) visually *scrambles* into ciphertext. Characters are replaced left-to-right with `[A-Z0-9]` glyphs, using a mutation-style animation (like classic "text decoder" effect).
3. **1100ms** — Scrambled inputs compress/collapse upward into a small "sealed envelope" icon (cipher-cyan, pulses once).
4. **1500ms** — Envelope shoots upward off-screen (moving to a header notification: "Order sealed in book").
5. **1800ms** — Form resets. Toast appears bottom-right: `Order sealed. Waiting for match.` with a small `ChainBadge chain="solana"` and a copyable tx hash.

**Key prop:** the scramble is visual-only — actual encryption happens silently with Encrypt SDK during the animation. The animation masks the real work.

**Libraries:** `framer-motion` for the sequence, text-scramble via simple `setInterval` + char-slot swapping.

### 5.3 Match + settle — The Duality

**Where:** Trade page modal, triggered on match

**What:** When a match happens (either via keeper bot or "Try Match" button), a full-screen modal overlays with a dramatic reveal:

**Stage 1 — Match Beacon (0.8s):**
- Black backdrop, full screen
- Center: `MatchBeacon` component, radial pulse in `match-gold`, 3 concentric rings expanding outward
- Top text: `MATCH DETECTED` in Geist 2xl, letter-spaced `0.2em`

**Stage 2 — Reveal (1.2s):**
- Beacon fades
- Two cards slide in from left and right:
  - Left card (top): Buyer — anonymized user tag `Bidder #A8F3`, revealed match details: price, size, Bidder's dWallet BTC addr (truncated)
  - Right card (top): Seller — `Asker #9B21`, their dWallet, same price/size
- Between them: `MatchInfo` block showing `0.500 BTC @ $69,850.00 USDC`

**Stage 3 — Settlement in motion (4s):**
- Below cards, split-screen emerges:
  - Left half: **Solana** panel, violet ambient glow, live-updating "USDC transferring: 0%, 33%, 100%"
  - Right half: **Bitcoin** panel, ember glow, live-updating "BTC signing: initiated, signed (1/T), broadcast, 1 conf, 3 confs"
- Between the panels: a `SettleThread` — a shimmering line of glowing cipher chars that pulse from left to right and back, representing the cross-chain coordination
- Top text updates: `Ika is signing… Encrypt revealed fill. Bitcoin broadcasting…`

**Stage 4 — Sealed (0.5s):**
- Both panels get a small cipher-cyan checkmark
- Modal collapses to a compact notification bar at top: `Match #42 settled. View ↗`

**This is the clip that wins the demo video.** Rehearse the choreography until it's smooth.

---

## 6. Page-by-page specs

### 6.1 `/` Landing

**Sections (vertical scroll):**
1. **Hero** (fullscreen, 100vh) — encrypted cube + tagline + CTA. See §5.1
2. **The Problem** (80vh) — 3 horizontal cards:
   - "Public orders leak" — illustration of glass orderbook shattering
   - "Bridges break" — stylized wBTC with a crack running through it
   - "Custodians control" — locked vault icon
3. **The Solution** (100vh) — animated diagram of ObsidianDesk flow (Solana program → Encrypt → Ika → Bitcoin), each component illuminates as you scroll (scroll-triggered with GSAP or framer-motion `useInView`)
4. **Why Ika + Encrypt** (60vh) — two-column: left "Remove Encrypt →" with greyed-out diagram showing public orderbook; right "Remove Ika →" with greyed-out showing wrapped BTC. Both broken.
5. **Stats strip** (30vh) — live-from-devnet: orders matched, BTC settled, markets
6. **CTA** (40vh) — final `Launch Terminal` button, generous whitespace, nothing else
7. **Footer** — minimal: links to docs, GitHub, Twitter, Ika, Encrypt credits

### 6.2 `/trade`

**Layout** (three-column desktop, stack on mobile):

```
┌──────────────────────────────────────────────────────────────┐
│ Header: ObsidianDesk | Market: BTC/USDC ▼ | Network: devnet │
├────────────────┬─────────────────────────┬───────────────────┤
│                │                         │                   │
│ OrderbookVoid  │   Price chart           │  Order Form       │
│ (encrypted     │   (real Pyth BTC/USD)   │  ┌─────────────┐ │
│  book viz)     │                         │  │ Buy / Sell  │ │
│                │                         │  ├─────────────┤ │
│ 14 encrypted   │                         │  │ Price       │ │
│ levels, each   │                         │  │ [ ______ ]  │ │
│ shown as       │                         │  │ Size        │ │
│ cipher line    │                         │  │ [ ______ ]  │ │
│                │                         │  │             │ │
│                │                         │  │ [Encrypt &  │ │
│                │                         │  │  Seal]      │ │
│                │                         │  └─────────────┘ │
│                │                         │                   │
│                │                         │  Your dWallet:    │
│                │                         │  bc1q...k8xz 0.7  │
├────────────────┴─────────────────────────┴───────────────────┤
│ Your Orders                                                  │
│ [encrypted list, your ones decrypted locally]               │
└──────────────────────────────────────────────────────────────┘
```

**OrderbookVoid component:**
- Not a classic bid/ask ladder. Instead a vertical stack of 14 horizontal lines, each line = one encrypted order.
- Each line displays:
  - Side indicator: `████` (colored block, but color is DESATURATED to grey — because you don't know if it's bid or ask)
  - Mono ciphertext: `K38JL2M9PQ45RX81ZFHN...` (32 chars, slowly mutating)
  - Small metadata: `owner: ████...████` (also encrypted-looking), `expires: 12m`
- Your OWN orders in the list are rendered with a subtle cipher-cyan left border + real decrypted values (you know your own data)
- A tiny footer: `The book is encrypted on-chain. Your view is the fog.`

### 6.3 `/deposit`

Three-step vertical wizard, each step is a full-width section that scrolls into view:

**Step 1 — Create dWallet**
- Large card: "Your dWallet is a Bitcoin address you control *jointly* with the Ika MPC network."
- Button: `Generate dWallet` → SDK call, result = BTC address + Solana-side policy PDA
- Visual: animated key-shard illustration, 2 pieces coming together

**Step 2 — Fund with BTC**
- Display the generated BTC address, big copy button
- QR code
- Text: "Send Bitcoin testnet to this address. Funds remain yours — the network can only co-sign transactions you authorize, subject to policy."
- Live balance updater (poll bitcoin-rpc every 15s)

**Step 3 — Lock to ObsidianDesk**
- Explanation card: "Authorize ObsidianDesk program to co-sign settlement transactions on your behalf, within these constraints: only to matched counterparties, only for matched amounts, only before expiry."
- Policy-preview in mono:
  ```
  policy: {
    controller: ObsiDesK...
    max_amount_per_tx: your_balance
    allowed_recipients: [dynamic match counterparty]
    expiry_per_order: 24h
  }
  ```
- Button: `Lock` → Ika policy tx

### 6.4 `/positions`

Simple table of your orders + fills + settlements. Each row has a status badge:
- `Sealed` (gray) — encrypted in book
- `Matched` (match-gold) — matched, waiting settle
- `Settling` (cipher-cyan pulse) — cross-chain in flight
- `Settled` (green-ish cipher-cyan) — done
- `Expired` / `Cancelled` (muted)

Each settled row expandable to show BTC tx hash (link to signet explorer) + Solana tx hash (link to devnet explorer).

### 6.5 `/about`

Minimal marketing page — how it works, who's behind, docs link. No fluff.

---

## 7. Animation principles

- **Timing:** use a coherent system. Default `duration: 200ms, ease: [0.16, 1, 0.3, 1]` (snappy, institutional)
- **Scale motion sparingly:** only during the 3 wow-moments (§5). Elsewhere, prefer subtle opacity + position.
- **Never "bounce"** — we're not consumer app. `spring` physics only for the settle-thread, nowhere else.
- **Respect `prefers-reduced-motion`**: disable the cube rotation and scramble effects for users who set this.

---

## 8. Dark-pool specific UX decisions

- **No notification sounds.** Dark pools are silent.
- **No "orders per second" metrics.** We're not bragging about throughput.
- **Time is implied, not displayed.** No timestamps in the public book view.
- **Addresses always truncated** to `abc1q...k8xz` format.
- **Zero default values** in order form — user must explicitly enter price and size. No "suggested" fills.

---

## 9. Responsive strategy

- **Desktop (1440+):** three-column trade page, full 3D hero
- **Laptop (1024–1440):** three-column still, hero cube stays
- **Tablet (768–1024):** two-column trade (book + form, chart goes to collapsed drawer), 2D hero
- **Mobile (<768):** stacked. Trade page: tabs for Book / Chart / Form. Hero: no 3D, static cipher grid.

Mobile demo is NOT a priority for hackathon — record the demo video on desktop. Mobile should just not break.

---

## 10. Reference screenshots (mental models)

Study these before starting (not for copying, for *vibe*):

- Hyperliquid trading interface — density, mono, dark
- Renegade.fi landing page — minimal, ZK-mystique, dark
- Linear.app — motion, type, dark perfection
- Phantom wallet's recent redesign — cypherpunk applied tastefully
- Bloomberg terminal — the density we're channeling
- Stripe's docs — interaction polish

**Don't look at:**
- Uniswap (too consumer)
- dYdX (too dense and flat)
- Aave (too brand-y)

---

## 11. Must-not-ship checks (pre-submission)

- [ ] No placeholder lorem ipsum anywhere
- [ ] No raw "null", "undefined", "NaN" visible
- [ ] All buttons have a hover state and a focus ring (accessibility)
- [ ] All ciphertext displays mutate at the same cadence (visually coherent)
- [ ] No JavaScript errors in console on prod
- [ ] Favicon is a proper obsidian cube glyph (not default Next.js)
- [ ] `og:image` set to a beautiful hero screenshot
- [ ] `<title>` is `ObsidianDesk — The dark pool where Bitcoin never leaves Bitcoin`

---

## 12. Fonts — exact loading

```ts
// app/layout.tsx
import { Geist, JetBrains_Mono } from 'next/font/google'
const geist = Geist({ subsets: ['latin'], variable: '--font-geist' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })
```

Tailwind config:
```js
fontFamily: {
  sans: ['var(--font-geist)', 'system-ui', 'sans-serif'],
  mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
}
```
