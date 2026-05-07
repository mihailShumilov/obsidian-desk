# ObsidianDesk — Build Prompts

> **Status:** This file is a **pre-build snapshot** of the scaffolding plan. The eleven prompts below were the source-of-truth at kickoff and most have shipped — but several toolchain / dependency choices in the prompt text are now stale (Anchor 0.31, Rust 1.93, `projectserum/build`, mock-only Encrypt + Ika). For the current code reality, treat **`README.md`** and **`docs/ARCHITECTURE.md`** as authoritative and use this file only when you're trying to understand the historical "what was the original spec" for a prompt P*N*. Toolchain pins live in `rust-toolchain.toml`, `package.json`, and CLAUDE.md.

11 промптов. Каждый самодостаточен (не требует предыдущих). Вставляй в Claude Code / Cursor / Windsurf, предварительно положив рядом `ARCHITECTURE.md` и `UI_DESIGN.md` как context.

**Правило использования:**
- Перед каждым промптом убедись, что в рабочей директории есть актуальные `docs/vendor/ika-pre-alpha.md` и `docs/vendor/encrypt-pre-alpha.md` (скачанные с docs.ika.xyz и docs.encrypt.xyz).
- После каждого промпта: `git commit -m` с осмысленным сообщением.
- Если AI выдаёт что-то, что не компилируется/не работает — делай follow-up prompt: «The code from the previous response fails with [error]. Fix it without restructuring the project.»

---

## P1 — Project Scaffold

```
You are building ObsidianDesk, an institutional dark pool on Solana with native BTC
settlement via Ika dWallets and FHE-matched orderbook via Encrypt.

Initialize a monorepo with this exact structure:

obsidian-desk/
├── programs/
│   └── obsidian-core/          # Anchor program (Rust)
├── app/                         # Next.js 16.2 (App Router) + TypeScript 5.9 + Tailwind
├── sdk/                         # Shared TypeScript SDK (adapters over Ika & Encrypt)
├── keeper/                      # Node.js keeper bot (matching poller)
├── scripts/                     # deploy.ts, airdrop.ts, seed-orders.ts
├── tests/                       # Integration tests (Mocha + @coral-xyz/anchor/utils)
├── docs/
│   └── vendor/                  # vendored Ika/Encrypt docs (gitignored)
├── .github/workflows/ci.yml
├── Anchor.toml
├── Cargo.toml                   # Workspace root
├── package.json                 # pnpm workspaces
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .editorconfig
├── .gitignore
└── README.md

Requirements:
- pnpm workspaces with proper dependency resolution between app/, sdk/, keeper/
- Anchor workspace with programs/obsidian-core/ as sole program
- Anchor.toml targeting devnet (https://api.devnet.solana.com) + Encrypt devnet + Ika devnet
- Next.js 16.2 app/ with TypeScript 5.9 strict mode, Tailwind CSS 3.4, shadcn/ui initialized,
  framer-motion installed, @solana/wallet-adapter-react + @solana/wallet-adapter-wallets
  (Phantom, Backpack). `next.config.ts` must set `output: "standalone"` for Docker builds.
  Pin versions explicitly in package.json: `"next": "16.2.x"`, `"typescript": "5.9.x"`, `"react": "^18.3"`.
- sdk/: library with two files src/ika.ts and src/encrypt.ts, both exporting
  thin adapter functions with TYPED interfaces that throw NotImplementedError —
  we'll fill them in later. Keep the signatures aligned with docs/vendor/.
- keeper/: placeholder index.ts with a cron loop that polls markets and logs.
- CI: run `anchor build`, `pnpm -r build`, `pnpm -r typecheck`, `cargo clippy -- -D warnings`
- .editorconfig enforcing 2-space TS, 4-space Rust, LF endings
- Top-level README documenting the stack and how to run `pnpm dev` (runs app + keeper)

Do NOT write implementation logic yet. This is scaffold only. After generating,
print a single-line summary of what was created.
```

---

## P2 — Solana Program (Anchor) with FHE types

```
Context: You're implementing the core Anchor program for ObsidianDesk at
programs/obsidian-core/. The program manages an encrypted limit orderbook for
BTC/USDC where order fields are FHE ciphertexts produced by the Encrypt SDK.

Read @ARCHITECTURE.md §5.1 for the data model and instructions.
Read @docs/vendor/encrypt-pre-alpha.md for the exact Encrypt on-chain primitives
and ciphertext size constants.

Task:

1. Define account types in state.rs:
   - MarketState (as in §5.1) — use Pubkey for admin, base/quote mints, settle_vault,
     ika_policy; add match_count: u64 + bump seeds
   - EncryptedOrder (as in §5.1) — owner, dwallet_id, side_ct/price_ct/size_ct as
     Vec<u8> with `#[max_len(CT_MAX)]` (read CT_MAX from Encrypt docs; assume 4096 if missing),
     expiry_slot: u64, nonce: [u8;16], next: Option<Pubkey>, status: OrderStatus enum
   - MatchRecord — match_id: u64, order_a/order_b: Pubkey, fill_size_decrypted: u64,
     clearing_price_decrypted: u64, settle_status: SettleStatus, created_at: i64

2. Implement 5 instructions in lib.rs:
   - initialize_market(base_mint, quote_mint): creates MarketState PDA
   - submit_order(side_ct, price_ct, size_ct, expiry_slot, nonce, dwallet_id):
     creates EncryptedOrder PDA keyed by (market, nonce), links into orderbook
     linked list at MarketState.orderbook_head
   - cancel_order(order): verifies signer = owner, marks Cancelled, unlinks
   - try_match(order_a, order_b): reads both EncryptedOrders, calls Encrypt CPI
     primitives enc_opp_sides(a.side_ct, b.side_ct), enc_price_crosses(a, b),
     enc_fill(a.size_ct, b.size_ct). Stores intermediate ciphertexts in a
     MatchIntent account. Does NOT decrypt — emits `MatchProposed` event.
   - request_settlement(match_id): triggers Encrypt threshold decrypt of
     can_match, fill_size, clearing_price; if can_match=1, stores plaintext
     in MatchRecord, emits `SettleReady` event for Ika keeper.

3. All instructions:
   - Use Anchor 0.31 syntax, #[derive(Accounts)] structs for each
   - Include proper #[account(init, seeds, ...)], #[account(mut)], #[account(has_one=...)]
   - Emit well-typed events (#[event])
   - Use ErrorCode enum with specific variants (OrderExpired, AlreadyMatched, etc.)

4. Encrypt CPI: create a thin module encrypt_cpi.rs with strongly-typed wrappers
   over Encrypt program instructions. If Encrypt pre-alpha docs show different
   primitive names, adapt naming accordingly.

5. Add a test in tests/obsidian-core.ts:
   - Deploy program to localnet
   - Initialize market
   - Submit 2 mock-encrypted orders (use zero-ciphertexts as placeholders
     — we'll wire real encryption in P3)
   - Call try_match, assert MatchProposed emitted
   - Call request_settlement (mock Encrypt response for now — return
     can_match=1, fill=plaintext)
   - Assert MatchRecord stored correctly

6. Make it compile cleanly with `anchor build` and pass the test.

Constraints:
- NO unsafe blocks
- Use checked arithmetic everywhere (checked_add, etc.) — this is financial code
- Max 16 active orders per market (compile-time constant MAX_ACTIVE_ORDERS = 16)
- CT_MAX as a constant, set to 4096 as default (override from docs/vendor)
```

---

## P3 — Encrypt SDK Integration (client-side encryption)

```
Context: ObsidianDesk needs client-side FHE encryption of order fields before
submitting to the Solana program. This lives in sdk/src/encrypt.ts.

Read @docs/vendor/encrypt-pre-alpha.md for:
- SDK package name and install instructions
- API for encrypting u1 and u64 types to ciphertext bytes
- Threshold decrypt request API
- Ciphertext serialization (likely base64 or raw Uint8Array)

Task:

1. In sdk/src/encrypt.ts, replace the NotImplementedError stubs with real
   implementations for:

   ```ts
   export async function encryptSide(side: 'bid' | 'ask'): Promise<Uint8Array>
   export async function encryptU64(value: bigint): Promise<Uint8Array>
   export interface EncryptedOrderBlob {
     side_ct: Uint8Array;
     price_ct: Uint8Array;
     size_ct: Uint8Array;
     nonce: Uint8Array; // 16 bytes, random
   }
   export async function encryptOrder(
     side: 'bid' | 'ask',
     priceQuote: bigint,  // USDC price scaled by 1e6
     sizeBase: bigint,    // BTC size in sats
   ): Promise<EncryptedOrderBlob>

   export async function requestThresholdDecrypt(
     ciphertext: Uint8Array,
     txSignature: string, // Solana tx signature that authorizes the decrypt
   ): Promise<bigint>
   ```

2. Write a unit test in sdk/tests/encrypt.test.ts:
   - Round-trip: encryptU64(500_000_000n) → ciphertext → decrypt (only if local
     test keys available per Encrypt docs) → 500_000_000n
   - Assert ciphertext bytes are non-trivial (length matches expected FHE size)

3. Build an end-to-end integration test at tests/e2e-submit.ts:
   - Boot localnet
   - Deploy obsidian-core
   - Using sdk/src/encrypt.ts, encrypt a real order (bid, 70000 USDC, 0.5 BTC)
   - Submit via Anchor client
   - Read back the EncryptedOrder account, verify the ciphertext bytes are stored

4. If the Encrypt pre-alpha SDK lacks any of the needed primitives, DO NOT
   invent — instead, leave a clearly labelled TODO with a fallback that throws
   `UnsupportedOperation` with a message directing the user to file an issue.
   Log which operations are missing in docs/gaps.md.

5. Add a `debug-cipher` CLI at scripts/debug-cipher.ts that:
   - Reads a Solana EncryptedOrder account
   - Prints the base64-encoded ciphertext bytes
   - Shows the ciphertext length in bytes
   This is used in the UI dev pipeline to validate encryption worked.

Constraints:
- Zero leakage: never log plaintext order fields. Only log shapes/lengths.
- Types: strict TypeScript, no `any`. Use `bigint` for u64 values.
- Error handling: custom error classes (EncryptionError, DecryptionError,
  VendorSDKUnavailableError).
```

---

## P4 — Ika dWallet Integration (Bitcoin settlement)

```
Context: ObsidianDesk requires each trader to have a Bitcoin-chain dWallet on
the Ika network, co-controlled by the user and the Ika MPC nodes, with a
Solana-program-enforceable policy. When a match settles, the Solana program
triggers Ika to sign a native BTC tx moving funds between matched dWallets.

Read @docs/vendor/ika-pre-alpha.md for:
- SDK package and init
- dWallet creation API for Bitcoin (testnet / signet)
- Policy attachment API (linking dWallet to a Solana program as controller)
- Signing request API
- Event format for dWallet-signed transactions

Task:

1. In sdk/src/ika.ts, replace stubs with real implementations:

   ```ts
   export type Chain = 'bitcoin' | 'bitcoin-signet' | 'bitcoin-testnet';

   export interface DWallet {
     id: string;          // dWallet ID on Ika
     chain: Chain;
     address: string;     // BTC address derived from dWallet public key
   }

   export async function createDWallet(chain: Chain): Promise<DWallet>;

   export interface Policy {
     controller: string;  // Solana program ID (ObsiDesK...)
     maxAmountSats: bigint;
     expirySlots: number;
     rules: PolicyRule[];
   }

   export async function lockPolicy(
     dwalletId: string,
     policy: Policy,
   ): Promise<{ policyAccountOnSolana: string }>;

   export async function requestSign(
     dwalletId: string,
     btcTx: BtcUnsignedTx,
     solanaProof: { txSignature: string; matchId: bigint },
   ): Promise<{ signedTxHex: string; broadcastTxid?: string }>;
   ```

2. Implement a BTC tx builder at sdk/src/btc.ts using bitcoinjs-lib:
   - buildSpendTx(from: string, to: string, amountSats: bigint, feerateSatPerVB: number)
     returns BtcUnsignedTx (psbt or raw tx based on Ika's expected format)
   - Use signet by default, testnet as option

3. Keeper bot at keeper/src/index.ts:
   - Polls Solana for SettleReady events every 2s (WebSocket subscribe if available)
   - For each event: fetch MatchRecord, build BTC spend tx from seller's dWallet to
     buyer's dWallet for fill_size sats, call requestSign on Ika
   - On signed tx: broadcast to BTC signet via a public RPC (or esplora), wait for
     1 conf, then call Solana program's finalize_settlement(match_id, btc_txid_proof)
   - On failure: emit log + mark MatchRecord as SettleFailed

4. UI onboarding at app/app/deposit/page.tsx (per UI_DESIGN.md §6.3):
   - Step 1: "Generate dWallet" button → sdk.createDWallet('bitcoin-signet')
   - Step 2: Show BTC address + QR, live balance via esplora API
   - Step 3: "Lock to ObsidianDesk" button → sdk.lockPolicy with program ID
     from env var NEXT_PUBLIC_OBSIDIAN_PROGRAM_ID, maxAmountSats = current
     balance, expirySlots = 216000 (~24h)

5. Integration test tests/e2e-settlement.ts:
   - Create 2 dWallets (Alice seller, Bob buyer) on signet
   - Fund both via signet faucet (document the faucet URL in README)
   - Lock both to ObsidianDesk policy
   - Manually insert a MatchRecord on Solana
   - Run keeper loop once
   - Assert BTC moved from Alice's dWallet to Bob's dWallet on signet (query esplora)

Constraints:
- If Ika pre-alpha Solana SDK lacks any needed capability, implement a
  SIMULATED fallback mode (single-node 1-of-1 signing with clear warning
  logs) and document in docs/gaps.md. This keeps the demo working while
  being honest in the README.
- Never log private keys or secret shares.
- BTC amounts always as bigint sats, never floats.
```

---

## P5 — Next.js App Scaffold + Design System

```
Context: Frontend for ObsidianDesk at app/. Read @UI_DESIGN.md comprehensively
before starting. The UI quality is the main differentiator — don't cut corners.

Task:

1. Initialize Next.js 16.2 App Router in app/ if not done, with:
   - TypeScript 5.9 strict mode (`package.json` pins `"typescript": "5.9.x"`, `"next": "16.2.x"`)
   - `next.config.ts` with `output: "standalone"` (required for Docker multi-stage build)
   - Tailwind CSS 3.4 configured per UI_DESIGN.md §2 (colors) + §3 (typography)
   - shadcn/ui with components init
   - framer-motion installed
   - next/font for Geist + JetBrains Mono per UI_DESIGN.md §12
   - @solana/wallet-adapter-react-ui configured with Phantom + Backpack
   - `app/api/health/route.ts` — simple GET returning `{ ok: true, ts: Date.now() }` for Docker healthcheck

2. Create design tokens in app/tailwind.config.ts:
   - Extend colors with EXACT hex values from UI_DESIGN.md §2
   - Extend fontFamily with the Geist and JetBrains Mono variables
   - Add keyframes for `pulse-cipher`, `scramble`, `thread-shimmer`, `beacon-expand`
   - Custom box-shadow utility `shadow-cipher: 0 0 24px rgba(0,245,212,0.35)`

3. Global styles in app/app/globals.css:
   - Set --font-geist, --font-mono CSS vars via next/font
   - Body bg = obsidian-950, color = foreground
   - Selection color = cipher-cyan on obsidian-900

4. Build core components in app/components/obsidian/ per UI_DESIGN.md §4.1:
   - Cipher.tsx — renders mono text that scrambles glyphs on an interval;
     props: value (the actual text or '*' for fully random), scramble boolean,
     cadenceMs default 800
   - CipherField.tsx — input that visually scrambles characters as user types;
     internally holds plaintext, emits plaintext via onChange
   - ChainBadge.tsx — pill with colored dot + chain name, variants:
     bitcoin (ember) + solana (violet)
   - DWalletCard.tsx — card showing chain badge, truncated address, balance,
     with subtle inset ring
   - MatchBeacon.tsx — full-screen overlay component with 3 expanding concentric
     rings in match-gold, auto-resolves after 800ms via onComplete prop
   - SettleThread.tsx — horizontal shimmering line between two points,
     renders glowing cipher-chars traveling left-to-right continuously
   - OrderbookVoid.tsx — renders N=14 rows of encrypted-looking lines,
     accepts `orders: EncryptedOrderView[]` + `yourOrderIds: Set<string>`
     (your orders get left-border + decrypted values)

5. App shell in app/app/layout.tsx:
   - Global providers: WalletAdapter, QueryClient, Tooltip provider
   - Header component with logo (obsidian cube glyph SVG inline), nav, network
     badge, wallet button
   - Footer component (minimal, per UI_DESIGN.md §6.1)

6. Placeholder pages:
   - app/app/page.tsx (landing) — stub with hero section markup, no 3D yet
   - app/app/trade/page.tsx — three-column layout stub
   - app/app/deposit/page.tsx — three-step wizard stub
   - app/app/positions/page.tsx — table stub
   - app/app/about/page.tsx — marketing stub

7. Acceptance:
   - `pnpm -C app dev` runs on localhost:3000
   - Dark theme renders correctly
   - Connecting Phantom works (on devnet)
   - Navigation between all 5 pages works
   - No console errors
   - Storybook-like visual test page at app/app/_kitchen/page.tsx showing all
     custom components in every state

Do NOT implement business logic yet. Just shell + design system + components.
```

---

## P6 — Landing Page Wow Hero

```
Context: Build the landing page hero for ObsidianDesk. This is the most visually
important screen in the product and the opening shot of the demo video.

Read @UI_DESIGN.md §5.1 (Hero), §5 wow-moment principles, and §6.1 (full landing
structure). Use the design tokens and components from P5.

Task:

1. app/app/page.tsx: implement the full landing page per UI_DESIGN.md §6.1:
   - Hero (100vh) — encrypted book cube + tagline + CTA
   - Problem (80vh) — 3 horizontal cards
   - Solution (100vh) — scroll-triggered animated diagram
   - Why Ika+Encrypt (60vh) — two-column broken-states
   - Stats strip (30vh) — live from devnet
   - CTA (40vh) — `Launch Terminal`
   - Footer — minimal

2. Hero implementation — PICK ONE path based on time:

   Path A (preferred) — 3D cube with @react-three/fiber:
   - Create app/components/landing/BookCube.tsx
   - Uses @react-three/fiber + drei
   - BoxGeometry, 6 faces each with a canvas-texture of 8 lines of cipher-text
     (mono, obsidian-800 on cipher-cyan glow)
   - Cipher glyphs re-randomize every 800ms via useRef + texture update
   - Auto-rotates slowly (0.25 rad/s on Y, 0.1 on X)
   - OrbitControls disabled (we don't want user interaction)
   - Ambient cipher-cyan point light
   - Fallback: dynamic import with ssr:false + loading state

   Path B (fallback) — 2D isometric cube:
   - SVG-based, shows 3 visible faces via CSS transforms
   - Each face = div with mono ciphertext, animated via CSS keyframes
   - Rotates via `@keyframes spin`
   - Less magical but still strong

3. Stats strip implementation (section 5 of landing):
   - Fetch from Solana RPC: MarketState.match_count, active order count,
     encrypted total volume (always displayed as ████████ because we can't
     decrypt without policy authorization)
   - Components: three big number displays in mono with labels in muted color
   - Poll every 10s via @tanstack/react-query

4. Problem cards (section 2):
   - 3 horizontally-aligned cards (stacked on mobile)
   - Each card: title in Geist 1.5rem, 1 sentence body in muted, an SVG
     illustration (simple line-art, cipher-cyan with subtle animation)
   - Titles: "Orders leak.", "Bridges break.", "Custodians control."

5. Solution section (3):
   - Canvas-sized illustration showing data flow: Trader → Solana Program →
     Encrypt MPC → Ika MPC → Bitcoin
   - Each node is a rounded card with chain badge
   - Connecting lines light up sequentially as user scrolls through the
     section (use framer-motion's useInView + viewport.amount)
   - Label each edge with what's happening: "encrypted", "threshold decrypt",
     "MPC sign", "native tx"

6. Why Ika+Encrypt section (4):
   - Two columns on desktop, stacked on mobile
   - Left col title: "Remove Encrypt →"; shows a broken version of the
     flow diagram with orderbook exposed to public mempool (red overlay)
   - Right col title: "Remove Ika →"; shows flow but with wBTC bridge
     (red broken-link glyph overlay)
   - Bottom centered text: "Neither alone is enough."

7. Animation orchestration:
   - Use framer-motion with stagger: as hero enters view, cube fades + rotates
     in (200ms), tagline types-in character by character (letter-scramble
     effect, 600ms total)
   - Scroll between sections uses Lenis for smooth scroll
   - Respect prefers-reduced-motion — disable cube rotation + scramble

8. Performance:
   - Cube fallback renders immediately, 3D lazy-loaded
   - Total JS bundle for landing page ≤ 350 KB gzipped
   - Cumulative Layout Shift < 0.05
   - Largest Contentful Paint < 1.5s on throttled 4G

Acceptance: take a screenshot. It should make a non-technical person stop
scrolling. That's the bar.
```

---

## P7 — Trade Page (encrypted orderbook UI)

```
Context: Build the trading interface per UI_DESIGN.md §6.2.

Task:

1. app/app/trade/page.tsx — three-column layout:
   - Left col (30% width): OrderbookVoid rendering live book
   - Center col (40%): price chart (use lightweight-charts with Pyth BTC/USD
     live feed) + market header
   - Right col (30%): OrderForm + DWalletSummary

2. OrderbookVoid live data:
   - Use Anchor's .account.encryptedOrder.all() with filter by market
   - Map each account to EncryptedOrderView { id, sideCtHash, priceCtHash,
     sizeCtHash, owner, expiresInSlots }
   - Render via <OrderbookVoid> component from P5
   - Subscribe to program logs for order add/cancel events, live-update

3. OrderForm component:
   - Side toggle (Bid / Ask) — large radio pills
   - Price input (USDC, with quote-currency suffix)
   - Size input (BTC, with base-currency suffix)
   - Expiry selector (1h, 6h, 24h)
   - Estimated USD value (size × price, live)
   - Submit button: "Encrypt & Seal"

4. Submit choreography — implement the EXACT choreography from UI_DESIGN.md §5.2:
   - onClick: disable form, replace button text with "Encrypting…"
   - 300ms: scramble each character of price and size fields
   - 1100ms: collapse inputs into envelope SVG (cipher-cyan, pulses once)
   - 1500ms: envelope shoots up and off-screen (translate-y -100vh + opacity)
   - BEHIND THE ANIMATION: sdk.encryptOrder(...) resolves, anchor tx sent
   - 1800ms: toast bottom-right: "Order sealed. tx: 5Q1...x9z"
   - Form resets

5. Your Orders section at bottom of page:
   - Table: id (truncated), side, price, size, status badge, expires, actions
   - YOUR data is decrypted (we know it client-side from when we submitted)
   - Others' orders: this section is only your orders, so no issue
   - Cancel button per active order

6. "Try Match" button (hidden debug button or prominent demo button, toggleable):
   - Calls tryMatch(orderA, orderB) on first two active orders in book
   - Shows full-screen MatchBeacon modal on success, then Settle choreography
     from UI_DESIGN.md §5.3

7. Match settlement modal — implement full §5.3 choreography:
   - Stage 1 Beacon (800ms)
   - Stage 2 Reveal (1200ms) — two cards slide in, show anonymized counterparty
     info + match details
   - Stage 3 Settlement panel (4000ms) — split screen Solana/Bitcoin, live
     progress text ("signing…", "broadcasting…", "1/3 conf…")
   - Stage 4 Sealed (500ms) — collapse to top bar notification

8. Data fetching:
   - Use @tanstack/react-query
   - Orders query: 3s poll + invalidate on own tx
   - dWallet balance: 15s poll
   - Pyth price feed: WebSocket subscribe

9. Empty states (per UI_DESIGN.md voice):
   - No orders in book: "The book is silent. Good traders are patient."
   - No dWallet yet: CTA card "Create your dWallet to trade."
   - No fills yet: "Your first match will appear here."

Constraints:
- NEVER display other users' plaintext data (it's encrypted, and shouldn't be
  decryptable anyway — this is a correctness check too)
- Handle wallet disconnect gracefully (show a "Connect wallet" state in the
  right column)
- All mono text uses tabular-nums
- Tooltips on each status badge explaining what it means
```

---

## P8 — Order Submission & dWallet Onboarding Flow

```
Context: Implement the /deposit 3-step wizard per UI_DESIGN.md §6.3 and wire
it to sdk/src/ika.ts from P4.

Task:

1. app/app/deposit/page.tsx — vertical scrollable 3-step wizard:
   - Each step is a full-width card; unreached steps are muted/disabled;
     current step is the only fully-bright one; completed steps collapse to
     a checkmark summary row
   - Progress indicator on the left (sticky): 3 dots, active one pulses

2. Step 1 — Create dWallet:
   - Copy text from UI_DESIGN.md §6.3 step 1 verbatim
   - Button: "Generate dWallet"
   - onClick: calls sdk.createDWallet('bitcoin-signet')
   - During call: button shows spinner + "Generating your dWallet…"
   - Result: display DWalletCard with the new address
   - Store dwalletId + address in zustand global store (persisted to
     localStorage under key `obsidian:dwallet:v1`)
   - Animate: left panel shows 2 key-shard SVGs coming together with spring
     physics (framer-motion) when step completes

3. Step 2 — Fund with BTC:
   - Display BTC address big + copy button
   - QR code (use `qrcode.react`)
   - Instruction text verbatim from UI_DESIGN.md
   - Live balance poll via esplora API (signet endpoint, allow override via env)
   - Show balance in sats and BTC
   - "Next" button disabled until balance > 0
   - Faucet link (signet faucet URL) visible as helpful hint
   - Sub-note: "Funds remain yours — the network can only co-sign the kinds of
     transactions you authorize in step 3."

4. Step 3 — Lock to ObsidianDesk:
   - Explanation block + policy preview (mono, see UI_DESIGN.md §6.3 step 3)
   - Button: "Lock to ObsidianDesk"
   - onClick: calls sdk.lockPolicy(dwalletId, policy) with program ID from env
   - On success: step collapses, header of page shows "Ready to trade" CTA
     → navigates to /trade

5. Global dWallet state (app/stores/dwallet.ts):
   - zustand store: { dwallet: DWallet | null, balanceSats: bigint,
     policyLocked: boolean, refresh() }
   - Persist to localStorage, hydrate on mount
   - Poll balance every 15s when dwallet present

6. Header updates: when dWallet exists, show DWalletCard in header (collapsed
   variant) always visible, with live balance.

7. Edge cases:
   - Handle Ika SDK throwing (network down): show retry UI
   - Handle user disconnect mid-flow: preserve step state in localStorage
   - Handle already-locked dWallet: skip to /trade

Acceptance:
- Full flow completes with real signet BTC (document faucet + rough funding
  steps in app/app/deposit/README.md)
- Coming back to /deposit with dWallet locked shows a completed state
  + CTA to trade
```

---

## P9 — E2E Integration, Keeper, Demo Script Prep

```
Context: Wire everything together and make the full happy path work end-to-end
on devnet + signet. This is the make-or-break prompt.

Prerequisites: P1–P8 completed. Program deployed to devnet. Two test wallets
(Alice, Bob) funded with SOL and each has a signet-funded dWallet locked to
ObsidianDesk.

Task:

1. Keeper bot fleshout (keeper/src/index.ts):
   - Main loop: every 3s, fetch all active EncryptedOrder accounts for all
     markets
   - For each pair (i, j) where i < j: call tryMatch(i, j) with retry logic
     (3 attempts, exponential backoff)
   - On MatchProposed event: immediately call requestSettlement
   - On SettleReady event: call sdk.requestSign + broadcast BTC tx +
     finalizeSettlement
   - Prom-style metrics logged to stdout every 30s: matches attempted,
     matches confirmed, settlement errors

2. Integration test tests/e2e-full.ts:
   - Uses fixtures Alice (bid) and Bob (ask)
   - Sets up fresh market
   - Alice submits bid 70000 USDC for 0.1 BTC
   - Bob submits ask 69500 USDC for 0.1 BTC (both encrypted via sdk)
   - Start keeper
   - Wait for match event (timeout 60s)
   - Wait for BTC 1-conf on signet (timeout 5 min — signet is slow)
   - Assert: Alice's dWallet BTC balance increased by 0.1 BTC
   - Assert: Bob's dWallet BTC balance decreased by 0.1 BTC
   - Assert: Alice's USDC decreased, Bob's USDC increased (on Solana)
   - Assert: MatchRecord.settle_status = Settled

3. Create scripts/seed-demo.ts:
   - Bootstraps a fresh demo: creates market, creates 2 dWallets, funds them
     via scripted signet faucet calls (if available) or prints manual
     funding instructions
   - Submits 8 encrypted orders (4 bids, 4 asks) at staggered prices
   - Prints a demo URL and credentials

4. Add ADMIN feature to Trade page (behind ?admin=1 query flag):
   - "Try Match" button that triggers keeper's match logic manually, shows
     the full reveal/settle choreography in UI
   - "Fast-forward settlement" that simulates BTC conf in 10s instead of
     waiting (for demo reliability)

5. Documentation:
   - README.md: replace stub with the full submission README per hackathon
     spec — problem, target users, how Ika+Encrypt are used, build/test/run
     instructions, deployed program IDs, frontend link, video link
   - Include explicit "Why Ika AND Encrypt" section with the remove-X tables
     from ARCHITECTURE.md §3
   - Include architecture diagram PNG exported from a Mermaid source

6. Deployment:
   - Program deployed to devnet: print program ID; anchor verify
   - Frontend: `vercel deploy --prod` from app/
   - Env vars documented in .env.example (RPC endpoints, program ID,
     esplora base URL, faucet URL, etc.)

7. Demo-reliability prep:
   - Record a full dry-run. Measure: total time from order submit to BTC
     confirmation. Should be < 2 min consistently on signet.
   - Identify 3 failure modes (RPC rate limit, signet block delay, Ika MPC
     timeout) and add graceful UI error states + retry buttons

8. Final checklist:
   - All P1–P9 acceptance criteria passing
   - `pnpm -r typecheck && pnpm -r test` green
   - `anchor test` green
   - `anchor build` reproducible
   - No `console.log`s left in app production build
   - Lighthouse score ≥ 90 on landing page

Output: a final SUMMARY.md at repo root with:
- Program IDs on devnet
- Frontend URL
- Demo credentials (test wallets + signet faucet URLs)
- Links to all integration test runs
- Known limitations (per docs/gaps.md)
```

---

## Как пользоваться промптами

**Порядок:** P1 → P2 → P3 → P4 → P5 → P6 → P7 → P8 → P9 → P10 → P11. P10 (Docker) и P11 (README + deployment) запускаются в самом конце, когда весь функционал уже работает, иначе Docker-слой будет «карго-культом» без реального контекста.

1. **Параллельность:** пока один дев крутит P2+P3+P4 (Rust + SDK), другой может крутить P5+P6 (UI) — они независимы до момента интеграции в P7/P8/P9.
2. **Контекст:** перед каждым промптом добавляй в context все файлы папки `ObsidianDesk/*.md` + `docs/vendor/*.md`. Без этого AI будет галлюцинировать API.
3. **Итерации:** после первого AI-ответа на промпт — ОБЯЗАТЕЛЬНО прогоняй `anchor build`, `pnpm typecheck`, `pnpm dev`. Следующий ход: «<paste errors> — fix without restructuring».
4. **Если SDK не тот:** если vendor docs скажут что SDK имеет иной API чем написано в промпте, скажи AI: «The actual Encrypt SDK API differs — primitive X is named Y. Adapt the implementation accordingly, keep my adapter interface stable.» Адаптер защищает от breaking changes.
5. **Коммиты:** после каждого промпта — atomic commit. Это гарантирует возможность отката.
6. **Rollback:** если P6 выдал плохой hero — `git reset --hard` до P5 и попробуй P6 с более конкретным prompt (скажи AI какие ошибки были и что менять).

**Типичные ошибки и фиксы:**

| Симптом | Фикс-промпт |
|---|---|
| Anchor build падает на `#[max_len]` | "The @max_len macro needs a literal constant. Define CT_MAX = 4096 at the top and use that." |
| Encrypt SDK package not found | "The package @encrypt.xyz/sdk isn't on npm. Use the local tarball path from docs/vendor/encrypt-sdk.tgz, install with pnpm add file:..." |
| Ika pre-alpha signing fails | "Switch to simulated mode: implement a local 1-of-1 signer with bitcoinjs-lib as fallback, clearly label it SIMULATED in logs and the UI." |
| framer-motion SSR error | "Wrap the animated components in 'use client' directive. The cube should be dynamically imported with ssr:false." |

---

## P10 — Dockerization (full stack)

```
Context: ObsidianDesk needs to run locally on any developer laptop with a single
`docker compose up` command, and produce production-ready OCI images for the
Next.js 16.2 app and Node.js keeper. Use multi-stage builds, pin exact versions,
non-root users, and health checks.

Read @ARCHITECTURE.md §12 (Dockerization & deployment) for the full spec. This
prompt turns that spec into working Dockerfiles and compose manifests.

Task:

1. app/Dockerfile (Next.js 16.2 multi-stage):
   - Stage 1 "deps": `node:24.0-alpine`, install `pnpm@9` via corepack, copy
     `package.json` + `pnpm-lock.yaml` + workspace files, run
     `pnpm install --frozen-lockfile --prod=false`
   - Stage 2 "builder": copy source, run `pnpm --filter app build` which
     produces `.next/standalone` thanks to `output: "standalone"` in
     `next.config.ts`
   - Stage 3 "runner": `node:24.0-alpine`, create non-root user
     `nextjs:nodejs` (uid 1001), copy only `.next/standalone`, `.next/static`,
     and `public/`. EXPOSE 3000. CMD ["node", "server.js"].
     HEALTHCHECK `CMD wget -qO- http://localhost:3000/api/health || exit 1`
     interval=30s timeout=5s retries=3
   - Final image size target: ≤ 200 MB

2. keeper/Dockerfile:
   - Stage 1 "builder": `node:24.0-alpine` + pnpm, install, compile with
     `tsc` (TypeScript 5.9) + bundle to single `dist/index.js` with esbuild
     (target node20, format cjs, minify)
   - Stage 2 "runner": `node:24.0-alpine`, add `tini` for PID 1 / signal
     handling, non-root user, CMD ["tini", "--", "node", "dist/index.js"]
     EXPOSE 3001. HEALTHCHECK against `/status` endpoint.

3. programs/obsidian-core/Dockerfile (build artifact producer):
   - Base: custom multi-stage — `rust:1.93-slim` + latest Agave CLI
     (`sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"`) +
     `avm install 0.31.0 && avm use 0.31.0`. (Avoid `projectserum/build` — it
     pins older Rust/Solana; we need modern stable)
   - Runs `anchor build --verifiable`
   - Copies `target/deploy/obsidian_core.so` and `target/idl/obsidian_core.json`
     to `/out/`
   - Used by CI for reproducible builds. Entrypoint: dump artifacts to volume.

4. docker/mock-encrypt/Dockerfile + docker/mock-ika/Dockerfile:
   - Simple `node:24-alpine` images running a tiny Express server that
     implements just enough of the Encrypt/Ika RPC shape to run integration
     tests offline (echo-encrypt, deterministic decrypt, mock dWallet signing
     with bitcoinjs-lib). TS 5.9 strict. ~50 lines each.

5. docker-compose.yml (dev):
   - Services: solana-validator (`anzaxyz/agave:latest` — Agave is the
     post-SL client; run `solana-test-validator` command), encrypt-mock,
     ika-mock, btc-signet
     (`ruimarinho/bitcoin-core:26.0` with `-signet -server -rpcuser/pass`),
     app (built from app/Dockerfile, env pointing to mocks + local validator),
     keeper (built from keeper/Dockerfile)
   - Named volumes: `solana-ledger`, `btc-data`
   - Health-ordered startup: solana-validator + mocks must be healthy before
     app/keeper start (use `depends_on` with `condition: service_healthy`)
   - Bind-mount app/ and keeper/ src for hot reload (override command to
     `pnpm dev` / `pnpm ts-node-dev` respectively)

6. docker-compose.prod.yml (overlay):
   - Drops: solana-validator, encrypt-mock, ika-mock, btc-signet
   - Keeps: app + keeper with resource limits (app: 512M RAM, keeper: 256M)
   - Env vars from external `.env.production` (not committed)
   - Uses pulled images from GHCR (ghcr.io/<org>/obsidian-app:tag) instead of
     local build

7. .dockerignore (repo root + per-service):
   - node_modules, .next, target, .git, docs/vendor, *.md (except per-service
     README), .env*, test artifacts, screenshots

8. .env.example at repo root with ALL required env vars documented with
   comments (grouped: Solana, Encrypt, Ika, Bitcoin, Keeper). Include
   `ADMIN_KEYPAIR_PATH=/run/secrets/admin.json` pattern and document docker
   secrets usage.

9. scripts/docker-bootstrap.sh:
   - One-shot local bootstrap: reads .env.example → prompts for missing
     values → generates admin + keeper keypairs if absent → `docker compose
     build` → `docker compose up -d` → waits for health → prints URLs
     (app: http://localhost:3000, keeper status: http://localhost:3001/status,
     solana rpc: http://localhost:8899)
   - chmod 755

10. .github/workflows/docker-build.yml:
    - On push to main: build all 3 images (app, keeper, obsidian-core
      artifacts), tag with commit sha + `latest`, push to GHCR
    - On tag push (v*.*.*): additionally tag with semver
    - Uses buildx + cache-from/cache-to for GHA cache
    - Runs `docker compose -f docker-compose.yml up -d` + integration smoke
      test (curl app /api/health, keeper /status) before publishing

11. Verification (run from root):
    - `docker compose up --build` completes without errors
    - All services reach healthy state within 90s
    - `curl http://localhost:3000/api/health` → 200 `{ok:true}`
    - `curl http://localhost:3001/status` → 200 keeper metrics JSON
    - `docker compose down -v` cleans up completely

Constraints:
- Pin base images by minor version where possible (`node:24.0-alpine`, not `node:24-alpine`; `rust:1.93-slim`). For Agave validator the `latest` tag is acceptable (auto-updates with Anza releases); document this as intentional in README
- NEVER run as root in runtime images
- Secrets via `docker secrets` or `--env-file`, never baked into image layers
- Multi-arch build: linux/amd64 + linux/arm64 (for M-series Macs)
- Image labels: `org.opencontainers.image.source`, `...revision`, `...version`

Deliver: all Dockerfiles, both compose files, .dockerignore files,
.env.example, bootstrap script, CI workflow. `docker compose up` works from a
fresh clone with nothing but Docker installed.
```

---

## P11 — README & Production Deployment Guide

```
Context: ObsidianDesk needs a comprehensive README that gets a new developer
productive in 10 minutes locally and gives a clear path to production
deployment. Must satisfy hackathon submission requirements AND serve as
reference for future maintainers.

Read @ARCHITECTURE.md and @INSTRUCTIONS.md for the full context. This README
is the single source of truth for anyone cloning the repo.

Task: Generate the following files.

### 1. README.md (repo root) — structure

```markdown
# ObsidianDesk

> The dark pool where Bitcoin never leaves Bitcoin.

[one-sentence elevator pitch] [badges: CI status, license, Solana devnet, demo video link]

[Hero screenshot / GIF of the orderbook cube]

## Table of Contents
1. Overview
2. Why Ika AND Encrypt (defining moat)
3. Architecture at a glance
4. Quick start (local dev with Docker)
5. Detailed local development
6. Testing
7. Deployment
8. Project structure
9. Environment variables reference
10. Troubleshooting
11. Hackathon submission info
12. Team & acknowledgments
13. License

## 1. Overview
[2-paragraph problem + solution. Link to ARCHITECTURE.md for depth.]

## 2. Why Ika AND Encrypt
[The "remove Encrypt" / "remove Ika" table from ARCHITECTURE.md §3.]

## 3. Architecture at a glance
[Embedded Mermaid diagram. High-level flow: client encrypts → Solana program
stores ciphertext → FHE match → threshold decrypt → Ika signs BTC tx. Link
to ARCHITECTURE.md for component-level detail.]

## 4. Quick start (Docker — recommended)

Prerequisites: Docker Desktop ≥ 4.25 with Compose v2, 8 GB RAM free.

```bash
git clone https://github.com/<org>/obsidian-desk.git
cd obsidian-desk
cp .env.example .env     # edit values or accept defaults for local dev
./scripts/docker-bootstrap.sh
```

After ~90 seconds:
- App: http://localhost:3000
- Keeper status: http://localhost:3001/status
- Local Solana validator: http://localhost:8899
- Signet bitcoind RPC: http://localhost:18332

Seed demo orders:
```bash
docker compose exec app pnpm run seed:demo
```

Tear down:
```bash
docker compose down -v
```

## 5. Detailed local development (without Docker)

For hot-reload iteration on a single service.

### Prerequisites
- Node.js 24+ (use `nvm install 24` — LTS-линия)
- pnpm 9+ (`corepack enable && corepack prepare pnpm@9 --activate`)
- Rust 1.93+ stable (`rustup update stable && rustup default stable`)
- Solana CLI latest — Agave installer (`sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"`). Verify: `solana --version` prints `solana-cli x.y.z (src:...; feat:...; client:Agave)`
- Anchor 0.31.0 (`avm install 0.31.0 && avm use 0.31.0`)
- TypeScript 5.9 (dev dependency, auto-installed)
- Next.js 16.2 (dev dependency, auto-installed)

### Setup
```bash
pnpm install
anchor build
cp .env.example .env.local
```

### Run individual services
```bash
# Terminal 1 — local Solana validator
solana-test-validator --reset

# Terminal 2 — Next.js app (hot reload on :3000)
pnpm --filter app dev

# Terminal 3 — keeper bot
pnpm --filter keeper dev

# Terminal 4 — deploy program to local validator
anchor deploy --provider.cluster localnet
```

### Common tasks
[Table: typecheck, test, lint, format, build each workspace]

## 6. Testing

### Unit tests
```bash
pnpm -r test
```

### Anchor program tests
```bash
anchor test
```

### End-to-end integration
Requires Docker running (uses mock Encrypt/Ika in docker-compose):
```bash
pnpm test:e2e
```

### Coverage
```bash
pnpm -r test:coverage
```

## 7. Deployment

### 7.1 Solana program → devnet
Reproducible build via Docker:
```bash
docker compose -f docker-compose.yml run --rm anchor-builder
# Output: target/deploy/obsidian_core.so (sha256 comparable across machines)
anchor deploy --provider.cluster devnet --program-keypair target/deploy/obsidian_core-keypair.json
# Record the program ID in .env.production and README deployed-contracts section
```

### 7.2 Frontend → Vercel (primary)
```bash
cd app
vercel link    # one-time
vercel env add SOLANA_RPC production
vercel env add PROGRAM_ID production
vercel env add ENCRYPT_RPC production
vercel env add IKA_RPC production
vercel --prod
```
Next.js 16.2 deploys zero-config. Ensure `next.config.ts` has
`output: "standalone"` only if also planning Docker image for this service.

### 7.3 Frontend → Fly.io (fallback, uses Docker image)
```bash
fly launch --no-deploy
fly secrets set SOLANA_RPC=... PROGRAM_ID=... ENCRYPT_RPC=... IKA_RPC=...
fly deploy   # uses app/Dockerfile
```

### 7.4 Keeper → Fly.io
```bash
cd keeper
fly launch --no-deploy
fly secrets set KEEPER_KEYPAIR_JSON="$(cat ~/.config/solana/keeper.json)" ...
fly deploy
fly scale count 1 vm-size shared-cpu-1x memory 512
```

### 7.5 Automated deploy (GitHub Actions)
On push of tag `v*.*.*`, `.github/workflows/deploy.yml` will:
1. Build and push Docker images to GHCR
2. Deploy program to devnet (idempotent check)
3. Deploy app to Vercel production
4. Deploy keeper to Fly.io
5. Create GitHub Release with changelog

Required secrets in GitHub repo settings:
[Table: ANCHOR_PROVIDER_KEYPAIR, VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID,
FLY_API_TOKEN, GHCR_TOKEN]

## 8. Project structure
[Tree from ARCHITECTURE.md + per-directory one-liner]

## 9. Environment variables reference
[Full table: NAME, REQUIRED, DEFAULT, PURPOSE, USED_BY services]

## 10. Troubleshooting

### Docker compose up fails on `solana-validator`
[common cause + fix]

### Anchor build fails with "cannot find -lssl"
[common cause + fix]

### Next.js dev server: "Module not found: @solana/wallet-adapter-react"
[common cause + fix]

### Ika pre-alpha signing timeout
[fallback to simulated mode instructions]

### Encrypt SDK: "ciphertext too large"
[CT_MAX adjustment in program + redeploy]

## 11. Hackathon submission info
- Devnet program ID: `<filled after deploy>`
- Frontend URL: `<vercel-url>`
- Demo video: `<youtube-link>`
- GitHub: this repo
- Built for: Encrypt & Ika hackathon — Bridgeless Capital Markets track

## 12. Team
[names, roles, contact]

## 13. License
MIT
```

### 2. docs/DEVELOPMENT.md

Detailed developer playbook — deeper than README §5. Includes:
- Full debug tips per workspace (Rust debugging, Next.js with Chrome DevTools,
  keeper with node --inspect-brk)
- How to regenerate Anchor IDL types for TypeScript
- How to swap out Encrypt/Ika SDK when real pre-alpha releases new version
- How to profile FHE operations (ciphertext size, CPI cost per primitive)
- How to add a new market (initialize_market walkthrough)

### 3. docs/DEPLOYMENT.md

Production deployment runbook — deeper than README §7. Includes:
- Checklist before deploying to devnet (verifiable build, keypair backup,
  Anchor.toml sanity)
- Rollback procedure (program version pinning, Vercel instant rollback, Fly
  release rollback)
- Monitoring stack: how to wire Grafana + Prometheus to keeper's /status
  endpoint; critical alerts (match failures > 5%, settlement errors, BTC
  confirmation delays)
- Runbook for common incidents (keeper crashes, Encrypt devnet outage, Ika
  signing timeout)
- Security checklist (keypair rotation, env var scope, Docker image signing
  with cosign)
- Cost estimates (Vercel, Fly.io, Solana devnet SOL, signet faucet)

### 4. CONTRIBUTING.md

- Branching model (trunk-based, feature branches, PR template)
- Commit message convention (conventional commits)
- How to run CI checks locally before pushing
- Code review checklist
- How to add a new prompt (reference PROMPTS.md)

### 5. Update root package.json scripts

Ensure these top-level scripts exist:
```json
{
  "scripts": {
    "dev": "docker compose up",
    "dev:local": "concurrently \"pnpm --filter app dev\" \"pnpm --filter keeper dev\"",
    "build": "pnpm -r build && anchor build",
    "test": "pnpm -r test && anchor test",
    "test:e2e": "docker compose -f docker-compose.test.yml run --rm e2e",
    "docker:build": "docker compose build",
    "docker:up": "docker compose up -d",
    "docker:down": "docker compose down -v",
    "deploy:devnet": "anchor deploy --provider.cluster devnet",
    "deploy:vercel": "vercel --prod --cwd app",
    "deploy:keeper": "cd keeper && fly deploy",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint",
    "format": "prettier --write \"**/*.{ts,tsx,json,md}\""
  }
}
```

Constraints:
- README must be skimmable — use collapsible `<details>` for deep sections
- All code blocks must actually work if copy-pasted (test each one)
- No placeholder URLs — use real URL templates with `<fill-me-in>` markers
- Mermaid diagrams render on GitHub (test by pushing to a temp branch)
- Dark-mode friendly: avoid light-only screenshots

Deliver: README.md, docs/DEVELOPMENT.md, docs/DEPLOYMENT.md, CONTRIBUTING.md,
updated root package.json. All links resolve. Fresh clone → "quick start"
section gets a new developer to a running app in ≤ 10 min on a clean machine
with only Docker installed.
```
