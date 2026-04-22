# ObsidianDesk

> The dark pool where Bitcoin never leaves Bitcoin.

Institutional dark-pool DEX on Solana for BTC / USDC.
Encrypted orderbook (FHE, [Encrypt](https://docs.encrypt.xyz)) + native BTC settlement ([Ika](https://docs.ika.xyz) dWallets). No bridges. No wrapped BTC. No plaintext orderbook.

**Demo URL:** _to be added after Vercel deploy (P10)_
**Devnet program:** `H25yY5o4emorZ9qMHAUvJhdtrFjDSeYy2MVYurpQbeLp`

## The problem

Every crypto dark pool today breaks on one of three axes:

1. **Orders leak.** Every L2 orderbook is a strategy leak. Validators, indexers, MEV searchers — they all see your price, size, and timing. The market front-runs you before you fill.
2. **Bridges break.** Wrapped BTC depends on a custodian or a cross-chain proof you can't audit. Every bridge is a single point of catastrophic failure.
3. **Custodians control.** If a venue holds your keys, it holds your fate. Withdrawal pauses, frozen assets, KYC creep — all downstream of custody.

ObsidianDesk picks the two technologies that fix all three: FHE for the orderbook, and native MPC signing for settlement.

## Target users

- **Institutional OTC desks** moving >$500K at a time who can't broadcast their intent.
- **Bitcoin-native funds** that refuse to touch wrapped BTC for policy reasons.
- **Self-custodial traders** willing to trade a small latency premium for strategy privacy.

## Why Ika *and* Encrypt

Neither alone is enough — and each collapses the other's threat model when removed:

| Remove … | What happens | Resulting product |
|---|---|---|
| **Encrypt** | The orderbook becomes plaintext on chain. Watchers replay strategies in real time. | A Solana DEX with a public book. Uniswap already exists. |
| **Ika** | BTC must be wrapped, bridged, or escrowed. Custodian + trust assumptions come back. | A synthetic-BTC venue. wBTC already exists. |

The combination is where the differentiator lives: **private book + native settlement**.

## Architecture

```
 ┌─────────┐  encrypt order   ┌───────────────┐   FHE compare    ┌─────────┐   co-sign BTC   ┌─────────┐
 │ Trader  │ ───────────────▶ │ Solana program│ ───────────────▶ │ Encrypt │ ──────────────▶ │   Ika   │ ──▶ signed BTC tx
 └─────────┘                  │ (obsidian-core)│                  │  MPC    │                 │ dWallet │
                              └───────────────┘                  └─────────┘                 └─────────┘
                                     │                                                            │
                                     └────────────── MatchRecord + btc_tx_proof ──────────────────┘
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design and [`docs/UI_DESIGN.md`](docs/UI_DESIGN.md) for the design system.

## Stack

| Layer | Tech |
|---|---|
| Solana program | Rust 1.93 + Anchor 0.32.1 (`programs/obsidian-core`) |
| Shared SDK | TypeScript 5.9 (`sdk/`) — adapters for Encrypt + Ika + bitcoinjs-lib |
| Frontend | Next.js 16.2 App Router + React 18.3 + Tailwind 3.4 (`app/`) |
| Keeper bot | Node.js 24 daemon (`keeper/`) |
| Bitcoin | signet via mempool.space esplora |
| Tooling | pnpm 9 workspaces, Solana CLI (Agave), Anchor |

## Prerequisites

- Node.js 24+
- pnpm 9+ (`corepack enable && corepack prepare pnpm@9.15.4 --activate`)
- Rust 1.93 stable (`rustup default stable`)
- Solana CLI latest (Agave): `sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"`
- Anchor 0.32+: `avm install 0.32.1 && avm use 0.32.1`

## Run it locally

```bash
# 1. Install deps across all workspaces
pnpm install

# 2. Typecheck everything
pnpm -F @obsidian-desk/sdk build   # emits sdk/dist so workspace deps resolve
pnpm typecheck

# 3. Boot a local validator on the project's non-standard port
solana-test-validator --rpc-port 18899 --bind-address 127.0.0.1 --reset

# 4. Build + deploy the program against the running validator
anchor build
anchor deploy --provider.cluster http://127.0.0.1:18899

# 5. (Optional) Seed a demo market + dWallets + 8 encrypted orders
ANCHOR_PROVIDER_URL=http://127.0.0.1:18899 \
  ANCHOR_WALLET=~/.config/solana/id.json \
  pnpm exec tsx scripts/seed-demo.ts

# 6. Boot the UI + keeper concurrently
pnpm dev
open http://127.0.0.1:13000         # landing
open http://127.0.0.1:13000/trade   # terminal
open http://127.0.0.1:13000/trade?admin=1   # + Match-all + Fast-forward
```

> **Port scheme:** non-standard on purpose so the stack never collides with other local Docker projects. App `:13000`, keeper status `:13001`, Solana validator RPC `:18899`. Full mapping lands in `docker-compose.yml` with P10.

## Run the tests

```bash
# SDK unit tests (26 tests, ~120ms, zero network)
pnpm -F @obsidian-desk/sdk test

# Anchor + e2e (requires the manually-started validator from step 3 above)
anchor test --skip-local-validator
#   ├─ obsidian-core.ts         — program unit tests
#   ├─ e2e-submit.ts            — encrypt → submit → byte-equality
#   ├─ e2e-settlement.ts        — one-leg mock settlement (P4)
#   └─ e2e-full.ts              — two-leg Alice/Bob settlement (P9)
```

## Demo flow

1. **Onboard:** visit `/deposit`, click _Generate dWallet_ → step 2 shows a signet address + QR. Fund it, wait for the 15 s esplora poll, then _Lock_ to ObsidianDesk.
2. **Seal:** visit `/trade`, type a price + size, click _Encrypt & Seal_ → watch the 1.8 s choreography (button progress bar → scramble → envelope collapse → shoot-up → toast).
3. **Match:** click _Try Match_ in the header (or _Match all_ in `?admin=1`) → full match/settle modal plays: Beacon → Reveal counterparties → Settlement panels w/ Solana + Bitcoin progress → Sealed notification.
4. **Verify:** the `/positions` row flips to _Settled_; keeper logs `[keeper] settled match N at …`.

## Repository layout

```
programs/obsidian-core/   Anchor program (Rust)
sdk/                      Shared TS SDK (encrypt + ika + btc adapters)
app/                      Next.js 16.2 frontend
  app/                    routes: /, /trade, /deposit, /positions, /about, /kitchen, /api/health
  components/obsidian/    design-system primitives (Cipher, OrderbookVoid, …)
  components/landing/     BookCube 3D + landing sections
  components/trade/       PriceChart, OrderForm, YourOrders, MatchSettleModal
  components/deposit/     wizard (ProgressRail, StepShell, KeyShards, …)
  components/shell/       Header + Footer + DWalletChip + WalletButton
  stores/                 dWallet + order-state zustand stores
keeper/                   Matching + settlement keeper bot (daemon)
scripts/                  Deploy / airdrop / seed-demo
tests/                    Integration + E2E tests (mocha + @coral-xyz/anchor)
docs/                     Authoritative project docs (6 files)
docs/vendor/              Vendored Encrypt + Ika SDK references
```

## P-prompt progress

Driven by the eleven prompts in [`docs/PROMPTS.md`](docs/PROMPTS.md).

- [x] **P1** — Monorepo scaffold (`62d42c4`)
- [x] **P2** — Anchor program with FHE-shaped accounts (`2f7c39a`)
- [x] **P3** — Encrypt SDK + mock-mode ciphertexts (`427d1e5`)
- [x] **P4** — Ika dWallet adapter + BTC tx builder + keeper + e2e settlement (`6d9ce5c`)
- [x] **P5** — Next.js shell + obsidian design system (`fe50380`)
- [x] **P6** — Landing wow hero: 3D cube + 6 sections (`99d62e3`)
- [x] **P7** — Trade terminal + match/settle modal (`b13dca4`)
- [x] **P8** — Deposit wizard polish: persisted state + esplora poll (`c990d30`)
- [x] **P9** — E2E + keeper metrics + admin mode + seed-demo (this commit)
- [ ] P10 — Dockerization (full stack)
- [ ] P11 — Final README + deployment guide

## Known gaps

Tracked in [`docs/gaps.md`](docs/gaps.md). High-impact items for reviewers:

| ID | What | Impact | Fix |
|---|---|---|---|
| **E0** | `CT_MAX = 3000` (not 4096) | Solana 10240 B CPI realloc cap forced the smaller blob size | Accepted; real Encrypt uses keypair accounts (gap E1) |
| **E1** | Ciphertexts are inline `Vec<u8>` on `EncryptedOrder` | Real Encrypt models CTs as 100 B keypair accounts owned by the Encrypt program | Refactor when vendor package compiles |
| **E5 / I0** | Upstream Encrypt + Ika TS clients ship uncompiled `.ts` in node_modules | Node 24 won't strip `.ts` from node_modules → real-mode unavailable | `mock` mode used everywhere; wrapper throws `VendorSDKUnavailableError` if you force `real` |
| **I2** | Ika mock store is process-local | Keeper can't see frontend-minted dWallets out of the box | E2E tests inject the same SDK instance into the keeper; real Ika will use a persistent gRPC backend |
| **I3** | `finalize_settlement` is permissionless | Anyone with a signed BTC tx hex can mark a match settled | Fix with SPV proof verification + keeper authority PDA in P9 continuation |

## License

MIT (TBD — confirm before submission).
