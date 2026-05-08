# ObsidianDesk — Architecture

> **Tagline:** The dark pool where Bitcoin never leaves Bitcoin.
> The first institutional-grade dark pool on Solana with FHE-matched encrypted orderbook and native BTC settlement via dWallets — zero wrapping, zero public order leakage.

---

## 1. Problem

Institutional BTC flow ≈ $10B/day spot. A large fraction still routes OTC because:

1. **Public orderbooks leak.** Any BTC/USDC order visible on a DEX is front-run before fill.
2. **Bridge risk.** To trade BTC on Solana, you must wrap into wBTC/zBTC — $8B+ in bridge-TVL carries exploit risk.
3. **Custody dilemma.** Institutions rely on Fireblocks (centralized MPC) for cross-chain reach.

No product exists today that delivers: **encrypted book + FHE match + native BTC settlement** in one venue.

## 2. Solution (in one paragraph)

ObsidianDesk is a Solana program + FHE-matched limit orderbook for BTC/USDC. Users submit limit orders as Encrypt (REFHE) ciphertexts — price, size, side are never visible. The program runs an FHE-comparator to find crossings and computes clearing on ciphertext. Only when a match occurs does the program request a selective threshold-decrypt of the matched fields. Settlement is triggered via Ika dWallets: the seller's native BTC (held on Bitcoin chain by a dWallet co-controlled by the seller + Ika network) is signed and transferred to the buyer's dWallet address; USDC moves on Solana atomically. No wBTC, no bridge.

## 3. Why Ika AND Encrypt are both essential

| Remove... | ...what breaks |
|---|---|
| **Encrypt** | Orderbook is public → front-run → no dark pool |
| **Ika** | Have to use wBTC → bridge risk → just another Solana DEX |
| **Both** | = Jupiter on Solana with public book |

This is the defining moat. The brief rewards this exactly (Core Integration criterion).

## 4. High-level architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      USER (Trader)                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Next.js App (obsidian UI)                          │   │
│  │  - Client-side FHE encryption (Encrypt SDK)         │   │
│  │  - dWallet creation/management (Ika SDK)            │   │
│  │  - Order submission, position tracking              │   │
│  └──────────────────┬──────────────────────────────────┘   │
└─────────────────────┼───────────────────────────────────────┘
                      │
          encrypted order tx
                      ▼
┌─────────────────────────────────────────────────────────────┐
│           SOLANA PROGRAM (ObsidianDesk core)                │
│  ┌───────────────┬──────────────────┬──────────────────┐   │
│  │ OrderBook     │  Matching Engine │ Settlement Orch  │   │
│  │ (ciphertext   │  (FHE compares   │ (triggers ┐      │   │
│  │  state)       │   via Encrypt)   │  dWallet  │      │   │
│  │               │                  │  signing) │      │   │
│  └───────────────┴──────────────────┴───────────┼──────┘   │
└──────────────────┬─────────────────────────────┬┼──────────┘
                   │ decrypt request             ││
                   ▼                             ▼▼
    ┌──────────────────────────┐   ┌────────────────────────┐
    │  ENCRYPT Network         │   │  IKA Network           │
    │  (threshold FHE nodes)   │   │  (2PC-MPC dWallet)     │
    │  - selective decrypt     │   │  - native BTC sign     │
    │  - match reveal only     │   │  - threshold + user    │
    └──────────────────────────┘   └────────┬───────────────┘
                                            │ signed BTC tx
                                            ▼
                                   ┌────────────────────┐
                                   │ BITCOIN NETWORK    │
                                   │ (native settlement)│
                                   └────────────────────┘
```

## 5. Component spec

### 5.1 Solana Program (`obsidian-core`)

**Framework:** Anchor 1.0.2 on Rust 1.94 (pinned in `rust-toolchain.toml`). The program depends on `encrypt-anchor` from `dwallet-labs/encrypt-pre-alpha`, which requires the Anchor 1.x macro toolchain. The TypeScript side stays on `@coral-xyz/anchor@^0.32.1` because no v1 JS SDK has shipped yet — 0.32.1 parses the v1 IDL cleanly for our usage.
**Program ID (devnet):** `H25yY5o4emorZ9qMHAUvJhdtrFjDSeYy2MVYurpQbeLp`. Pinned in `Anchor.toml [programs.devnet]`, `[programs.localnet]`, and `declare_id!()` in `lib.rs`.

**Accounts (current, post gap E1 closure):**

```rust
#[account]
pub struct MarketState {
    pub admin: Pubkey,
    pub base_mint: Pubkey,       // BTC-reference (cipher-metadata)
    pub quote_mint: Pubkey,      // USDC
    pub orderbook_head: Pubkey,  // linked list of EncryptedOrder accounts
    pub settle_vault: Pubkey,    // USDC vault
    pub ika_policy: Pubkey,      // dWallet policy account on Ika
    pub match_count: u64,
}

#[account]
pub struct EncryptedOrder {
    pub owner: Pubkey,
    pub dwallet_id: Pubkey,           // BTC dWallet ref on Ika
    // Encrypt ciphertext-account references (32 B Pubkey-shaped ids):
    pub side_ct: [u8; 32],            // 0 = bid, 1 = ask (1-bit encrypted)
    pub price_ct: [u8; 32],           // u64 encoded as FHE ciphertext
    pub size_ct: [u8; 32],            // u64 encrypted
    pub expiry_slot: u64,             // plaintext (expiry is not secret)
    pub nonce: [u8; 16],
    pub next: Option<Pubkey>,         // linked-list next
    pub status: OrderStatus,          // Active, Matched, Cancelled, Expired
}
```

The on-chain ciphertexts are *references* to Encrypt-program-owned ciphertext accounts, not inline blobs. Real ciphertext bytes live in `~100 B` accounts owned by the Encrypt program at `4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8` (devnet). This closes gap E1 — gap E0 (the legacy `CT_MAX` blob-size constraint) became obsolete with the same change and the constant has been removed from `state.rs`.

**Instructions:**

```rust
submit_order(ct_blob: EncryptedOrderBlob)              // trader encrypts client-side, passes 3 ct refs
cancel_order(order: Pubkey)
try_match(order_a, order_b, output_ct_a, output_ct_b, output_ct_c)
                                                       // permissionless keeper call; dispatches the
                                                       // #[encrypt_fn] match_orders_graph DSL via
                                                       // EncryptContext to Encrypt's execute_graph CPI
request_decryption(match_id: u64)                      // keeper-only; snapshots the 3 output ct
                                                       // digests onto MatchIntent, emits DecryptionRequested
finalize_decryption(match_id, can_match, fill_size,    // keeper-only; verifies snapshotted digests,
                    clearing_price, seller_is_a)        // writes MatchRecord, closes MatchIntent
finalize_settlement(match_id: u64, btc_tx_proof: Vec<u8>) // keeper-only; verifies BTC settlement
```

The match-then-decrypt-then-settle path is the closure of gaps E2 + E3 + E4. The keeper performs threshold decryption off-chain via gRPC `readCiphertext` between `try_match` and `finalize_decryption`, but the on-chain digest snapshot binds the plaintexts the keeper submits to the exact ciphertext accounts that `try_match` matched — the keeper cannot lie about the result.

**Matching logic** — defined as a `#[encrypt_fn]` DSL graph in `programs/obsidian-core/src/lib.rs`:

```rust
#[encrypt_fn]
fn match_orders_graph(
    a_side: EBool, a_price: EUint64, a_size: EUint64,
    b_side: EBool, b_price: EUint64, b_size: EUint64,
) -> (EBool, EUint64, EUint64) {
    let opp = a_side ^ b_side;
    let a_is_bid = !a_side;
    let bid_price = if a_is_bid { a_price } else { b_price };
    let ask_price = if a_is_bid { b_price } else { a_price };
    let crosses = bid_price >= ask_price;
    let can_match = opp & crosses;
    let fill = a_size.min(b_size);
    let clearing = (a_price + b_price) / 2u64;
    (can_match, fill, clearing)
}
```

`try_match` builds an `EncryptContext` and dispatches `ctx.match_orders_graph(...)` — a real `execute_graph` CPI to the Encrypt program. The Solana program never sees plaintext.

`request_decryption(match_id)` snapshots the three output ciphertext digests onto `MatchIntent`. The keeper performs three independent off-chain `readCiphertext` gRPC calls and submits the verified plaintexts to `finalize_decryption`. `finalize_decryption` refuses if `can_match == false` and writes a `MatchRecord`; both ledger transitions live behind the keeper authority.

### 5.2 Encrypt integration

**SDK side:** the project consumes `@encrypt.xyz/pre-alpha-solana-client@0.1.1` via a `pnpm patch` (the published package's `exports` field still points at uncompiled `./src/grpc.ts`; the patch redirects it to `./dist/...js` and rewrites the extension-less imports). `sdk/src/encrypt.ts` real-mode dispatches `encryptU64`, `encryptSide`, `encryptOrder` to `createEncryptClient(...).createInput(...)`. Each input returns a 32-byte ciphertext-account identifier on Solana — the same `[u8; 32]` shape that `EncryptedOrder.{side,price,size}_ct` stores.

**Program side:** the Anchor program pulls `encrypt-anchor` + `encrypt-solana-dsl` from `dwallet-labs/encrypt-pre-alpha`. The `#[encrypt_fn]` macro expands the matching graph into the bytecode that `EncryptContext::match_orders_graph(...)` dispatches via CPI to the deployed Encrypt program at `4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8` on devnet.

**Ciphertext types used:**
- `EBool` — 1-bit (side)
- `EUint64` — 64-bit (price in sats per USDC, size in sats)

**Operations exercised by `match_orders_graph`:** XOR, NOT, ternary select (`if`), GTE, AND, MIN, ADD, DIV-by-constant.

**Note on FHE performance:** single comparison on ciphertext currently runs ~50–500 ms on the Encrypt MPC network. The whole match graph is dispatched in a single `execute_graph` call; keep book depth small (≤16 active orders) for MVP and keep matching permissionless / keeper-triggered, not per-block.

### 5.3 Ika dWallet integration

**Architecture:** each trader onboards by creating a **dWallet on Ika for Bitcoin chain**. Co-controlled by trader + Ika MPC network. Solana program is authorized as a *policy controller* over the dWallet — meaning specific settlement signatures can be triggered by `obsidian-core` when a match occurs.

**Policy (dWallet Solana-enforced):**

```
When `obsidian-core::finalize_settlement` emits SettleEvent(match_id, to, amount):
  Sign(BTC tx: spend from dWallet_seller to to, amount sats)
  Subject to:
    - to ∈ allowlist (buyer's dWallet address registered in match)
    - amount ≤ match.fill_size (decrypted)
    - deadline not exceeded
    - dual signature: user prior consent + policy consent
```

**Settlement flow:**
1. Match detected on Solana → `MatchEvent` emitted
2. Keeper (anyone) calls `request_settlement(match_id)`
3. Program requests threshold decrypt from Encrypt → gets `fill_size`, `clearing_price` in cleartext
4. Program emits `SettleReady` with decrypted fields + dWallet-ids
5. Ika nodes pick up `SettleReady`, generate 2PC-MPC signature for BTC tx
6. BTC tx broadcast; USDC vault transfers on Solana atomically (via PDA)
7. Program emits `Settled` once BTC-proof verified on-chain (light-client proof or SPV)

**Atomicity caveat:** true atomic cross-chain is hard. For MVP use HTLC-style or timeout-fallback: if BTC tx doesn't confirm in N blocks, USDC refund.

### 5.3.1 Ika integration (SDK side)

`@ika.xyz/pre-alpha-solana-client` ships only `.ts` sources (no compiled `dist/`), so a `pnpm patch` doesn't help. Closure of gap I0: vendored `src/grpc.ts`, `src/bcs-types.ts`, and `src/generated/grpc/ika_dwallet.ts` (~1100 LOC) into `sdk/src/ika-vendor/` with two project-specific edits — `curve: { Secp256k1: true }` and `signature_algorithm: { ECDSASecp256k1: true }` so the dWallet matches Bitcoin's signature scheme. Default gRPC URL is `pre-alpha-dev-1.ika.ika-network.net:443`. License notices preserved verbatim (`BSD-3-Clause-Clear`, `Copyright (c) dWallet Labs, Ltd.`).

`sdk/src/ika.ts` real-mode dispatches `createDWallet → requestDKG`, deriving a P2WPKH signet address from the returned secp256k1 public key. `requestSign` chains `requestPresign → requestSign` against the same client.

### 5.4 Frontend (Next.js 16.2 app router)

See `UI_DESIGN.md` for full design spec. Technical stack:
- Next.js 16.2 + **React 19.1** + TypeScript 5.9 (strict)
- Tailwind CSS + custom obsidian design tokens
- framer-motion (animations)
- @react-three/fiber@^9 + drei@^10 (3D hero — Encrypted Book Cube)
- zustand (state, with persist middleware for the dWallet store)
- @solana/web3.js, @coral-xyz/anchor@^0.32.1
- @obsidian-desk/sdk (workspace package; `encrypt` + `ika` namespaces are subpath imports — `import * as encrypt from '@obsidian-desk/sdk/encrypt'` — to keep gRPC pulling code out of the client bundle)

**React 19 is mandatory.** Next 16 ships React 19.3-canary to the client regardless of the app's declared `react` version; with React 18 declared, `react-reconciler@0.27.0` (pulled by `@react-three/fiber@8`) crashes at module-eval against the renamed `React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentBatchConfig`. Matching deps: `@react-three/fiber@^9`, `@react-three/drei@^10`, `@types/react@^19`, `@types/react-dom@^19`. React 19 also drops the global `JSX` namespace — `app/global.d.ts` re-exports it from `react`.

## 6. Data flow — happy path

**Submit order:**
```
User types "Buy 0.5 BTC @ $70,000" in UI
  → lib/encrypt.ts encrypts {side:0, price:7_000_000, size:50_000_000} client-side
  → tx to obsidian-core::submit_order with ciphertexts
  → program stores EncryptedOrder account, head updated
  → UI shows "Order in book (encrypted)"
```

**Match:**
```
Keeper bot picks two candidate orders (any two; all comparisons are FHE)
  → tx try_match(A, B)
  → program computes FHE can_match bit
  → if bit threshold-decrypts to 1:
     → match recorded, decrypted fill + price emitted
     → both orders state → Matched
```

**Settle:**
```
Anyone calls request_settlement(match_id)
  → program checks both dWallets, requests Ika signing
  → Ika MPC signs BTC spend tx (seller dWallet → buyer dWallet BTC addr)
  → program waits for BTC confirmation (via oracle/relay for MVP)
  → USDC PDA transfer completes
  → both orders → Settled
```

## 7. Sequence diagram (simplified)

```
Trader A    Trader B    Solana Program    Encrypt MPC    Ika MPC    Bitcoin
   │           │             │               │             │           │
   │─ enc ord ─┼────────────▶│               │             │           │
   │           │─ enc ord ──▶│               │             │           │
   │           │             │── try_match ─▶│             │           │
   │           │             │◀─ can_match ──│             │           │
   │           │             │── decrypt ───▶│             │           │
   │           │             │◀─ revealed ───│             │           │
   │           │             │─── sign req ────────────────▶│         │
   │           │             │                             │── BTC ──▶│
   │           │             │◀───────── confirmed ────────┼─────────│
   │◀─ filled ─┼─────────────│                             │           │
```

## 8. Devnet endpoints

- **Bitcoin:** signet via mempool.space esplora API (`https://mempool.space/signet/api`). dWallets live on the Ika network; the BTC leg is recorded against signet for demoability.
- **Solana:** devnet for `obsidian-core` (`H25y…beLp`) + Encrypt program (`4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8`).
- **Encrypt gRPC:** `pre-alpha-dev-1.encrypt.ika-network.net:443` (override via `OBSIDIAN_ENCRYPT_GRPC_URL`).
- **Ika gRPC:** `pre-alpha-dev-1.ika.ika-network.net:443` (override via `OBSIDIAN_IKA_GRPC_URL`).
- **Price oracle:** Pyth on Solana for USD price display (not for matching — matching uses user prices only).
- **Keeper:** Node 24 daemon; `pollOnce` runs every 3 s by default (configurable via `KEEPER_POLL_MS`). The match cycle is also exposed as a one-shot CLI: `tsx keeper/scripts/match-pair.ts <market> <a> <b>`.

## 9. Build status (vs. original 6-week MVP scope)

Must-have — **shipped:**
- [x] Solana program with submit/cancel/try_match/decryption-flow/settle
- [x] Client-side FHE encryption of orders (real-mode against devnet)
- [x] On-chain FHE matching graph (`match_orders_graph` via `#[encrypt_fn]`)
- [x] dWallet creation flow for BTC signet (real DKG via Ika gRPC in `OBSIDIAN_IKA_MODE=real`)
- [x] Policy-gated settlement scaffolding
- [x] Next.js app with killer UI (see UI_DESIGN.md)
- [x] E2E demo (mock-mode end-to-end, `e2e-full.ts`)

Open / residual:
- [ ] **E2-residual** — `execute_graph` CPI fails at depth 2 with a signer demotion in `encrypt-anchor` 0.1.0; tracks closure on upstream (or vendor + adapt the helper)
- [ ] Partial fill handling
- [ ] Multiple markets (ETH, SOL variants)
- [ ] SPV-proof verification of BTC tx on Solana (true atomicity) — gap I3
- [ ] On-chain keeper-authority gate paired with the SPV check (intentionally bundled — see I3)

Explicitly out of scope:
- Mainnet deployment
- Regulatory KYC
- More than 16 concurrent active orders
- Production-grade liquidator economics

## 10. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| FHE too slow to run comparator in a tx | High | Move matching off-chain to Encrypt MPC network with on-chain verifiable result; keep book tiny |
| Ika SDK for Solana pre-alpha is missing features | Medium | Mock dWallet with a 1-of-1 multisig on testnet for demo; narrate the real flow in video |
| Bitcoin testnet congestion during demo | Medium | Use signet with controlled blocks; record a reliable take |
| Team can't finish Rust + UI | High | Parallelize: 1 dev on program+integrations, 1 dev on UI+UX. Spec is ready |
| UI wow isn't wow | Medium | Use UI_DESIGN.md rigorously; don't over-design, polish 3 key screens |

## 11. Team split suggestion

- **Dev 1 (Backend + Rust):** Solana program, Encrypt integration, Ika integration, keeper bot, CI
- **Dev 2 (Frontend + Design):** Next.js app, design system, animations, demo-video polish
- **Dev 3 (optional, Full-stack):** Landing page 3D hero, pitch deck, README, bridging design→impl

If solo: forget 3D hero, stay with 2D wow; cut to 3 screens max.

## 12. Dockerization & deployment

Operational details and runbooks live in [`docs/DEPLOYMENT.md`](DEPLOYMENT.md). This section covers the architecture-level shape of the container layout.

### 12.1 Containers

| Service | Base image | Purpose | Exposed ports (host) |
|---|---|---|---|
| `app` | `node:24-alpine` multi-stage | Next.js 16.2 standalone server | 13000 |
| `keeper` | `node:24-alpine` multi-stage | Matching + settlement daemon (Node 24 + tsx in dev, compiled JS in prod) | 13001 (`/status` endpoint) |
| `solana-validator` | `anzaxyz/agave:latest` | **Opt-in** local test-validator (`docker compose --profile local-rpc up`). Linux/amd64 only — Agave doesn't ship arm64 and panics under qemu emulation. M-series Macs run the validator on the host. | 18899 (RPC), 18900 (WS) |

There is no `encrypt-mock` / `ika-mock` / `btc-signet` container. Encrypt / Ika real-mode hits the upstream pre-alpha gRPC services on devnet; mock-mode is in-process and needs no daemon. Bitcoin is read via mempool.space's public esplora API.

### 12.2 Dockerfiles (multi-stage pattern)

**`app/Dockerfile`** — Next.js 16 standalone output. `pnpm install --frozen-lockfile` → `pnpm build` → copy `standalone/` + `static/` + `public/` into a slim runner. Final image ≈ 313 MB (three.js is dynamically loaded, so it isn't in the initial bundle). `next.config.ts` carries `output: "standalone"`. Healthcheck: `GET /api/health` → 200.

**`keeper/Dockerfile`** — `pnpm -F @obsidian-desk/sdk build` first (workspace types), then `pnpm -F @obsidian-desk/keeper build`. Runtime is `node:24-alpine` with `tini` for graceful SIGTERM. Mounts the keeper keypair via Docker secrets at `/run/secrets/keeper_keypair.json`. Final image ≈ 924 MB (`@coral-xyz/anchor` deps).

**Anchor program** — built directly on the host via `cargo install anchor-cli@1.0.2 --locked`. No dedicated Dockerfile: the Anchor 1 toolchain is small and CI uses the published cargo binary. (We deliberately do NOT use `avm` — it has historically rate-limited from CI runners.)

### 12.3 docker-compose

Two compose files:
- `docker-compose.yml` — dev-friendly defaults. Profile `local-rpc` opts into the in-container validator on x86 Linux.
- `docker-compose.prod.yml` — overlay that pulls images from GHCR (`IMAGE_TAG=v0.x.y`) and removes any local validator.

Bring-up sequence on M-series Macs (the common case for the team):

1. `solana-test-validator --rpc-port 18899 --bind-address 127.0.0.1 --reset` (host process)
2. `anchor build && anchor deploy --provider.cluster http://127.0.0.1:18899`
3. `pnpm docker:up` — wraps `scripts/docker-bootstrap.sh`, generates a keeper keypair if missing, ups the stack, waits for healthchecks.

### 12.4 Environment variables

`.env.example` ships at repo root with every variable annotated. Highlights:

| Variable | Purpose |
|---|---|
| `OBSIDIAN_PROGRAM_ID` / `NEXT_PUBLIC_OBSIDIAN_PROGRAM_ID` | Pinned program id; must match `Anchor.toml` + `declare_id!()` |
| `NEXT_PUBLIC_SOLANA_RPC`, `ANCHOR_PROVIDER_URL`, `SOLANA_RPC` | RPC endpoints (browser, server-side, docker-internal alias) |
| `OBSIDIAN_ENCRYPT_MODE`, `OBSIDIAN_IKA_MODE` | `mock` (default) / `real` (live devnet gRPC) |
| `OBSIDIAN_ENCRYPT_GRPC_URL`, `OBSIDIAN_IKA_GRPC_URL` | Override Encrypt / Ika gRPC endpoints |
| `KEEPER_*` (`POLL_MS`, `PORT`, `FEERATE`, `KEYPAIR_PATH`, `DEBUG`) | Keeper tunables |
| `IMAGE_TAG` | GHCR tag pulled by the prod overlay |

Docker secrets path (`/run/secrets/keeper_keypair.json`) is preferred over bind-mount; never commit real keypairs.

### 12.5 Production deploy

The hackathon submission targets a **single VPS + Cloudflare DNS + Caddy** path (full runbook in `DEPLOYMENT.md` §6). Self-hosting the compose stack on one Hetzner / DigitalOcean / OVH / Vultr box at ~$5/mo lands the live demo on `obsidiandesk.app` without per-service platform accounts.

Vercel / Fly.io are documented as planned alternatives but unused for the submission — the compose stack is portable and the VPS path lets the keeper and the app sit on one machine, which makes incident response simpler at hackathon scale.

### 12.6 CI/CD

`.github/workflows/ci.yml` runs two jobs against every push to `main`:

- `ts` — `pnpm install` → `pnpm -F @obsidian-desk/sdk build` (so workspace types resolve) → `pnpm -r typecheck` → `pnpm -r build`.
- `rust` — pin Rust 1.94 + clippy/rustfmt → install Solana CLI → `cargo install anchor-cli@1.0.2 --locked` → `cargo clippy --workspace -- -D warnings` (no `--all-targets` to avoid the `idl-build` cfg) → `anchor build --no-idl --ignore-keys` (`--ignore-keys` because the program keypair is gitignored; the source-of-truth program id is `declare_id!()`).

The `pnpm patch` for `@encrypt.xyz/pre-alpha-solana-client@0.1.1` is committed under `patches/` and re-applied by pnpm on every install.
