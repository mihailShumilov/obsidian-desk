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

**Framework:** Anchor 0.31+ (faster to develop than Pinocchio; can switch later).
**Program ID:** `ObsiDesK...` (placeholder, generate at build).

**Accounts:**

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
    pub total_volume_cipher: Vec<u8>, // encrypted total volume (bragging rights)
}

#[account]
pub struct EncryptedOrder {
    pub owner: Pubkey,
    pub dwallet_id: Pubkey,           // BTC dWallet ref on Ika
    // FHE ciphertexts:
    pub side_ct: Vec<u8>,             // 0 = bid, 1 = ask (1-bit encrypted)
    pub price_ct: Vec<u8>,            // u64 encoded as FHE ciphertext
    pub size_ct: Vec<u8>,             // u64 encrypted
    pub expiry_slot: u64,             // plaintext (expiry is not secret)
    pub nonce: [u8; 16],
    pub next: Option<Pubkey>,         // linked-list next
    pub status: OrderStatus,          // Active, Matched, Cancelled, Expired
}
```

**Instructions:**

```rust
submit_order(ct_blob: EncryptedOrderBlob)   // trader encrypts client-side
cancel_order(order: Pubkey)
try_match(order_a: Pubkey, order_b: Pubkey)   // permissionless keeper call
request_settlement(match_id: u64)             // after match, initiates dWallet sign
finalize_settlement(match_id: u64, btc_tx_proof: Vec<u8>)
```

**Matching logic:**

`try_match(a, b)` computes on ciphertext:
1. `a.side != b.side` (opposite sides) — FHE XOR, compare to 1
2. `a.price >= b.price` (if a = buy) or reverse — FHE comparator
3. `min(a.size, b.size)` — FHE min
4. Result: `can_match` bit, `fill_size` ciphertext, `clearing_price` ciphertext

If `can_match` decrypts to 1 (via threshold decrypt trigger), emit `MatchEvent` with decrypted matched fields; remainders stay encrypted.

### 5.2 Encrypt integration

**SDK:** Encrypt TypeScript SDK for client-side encryption, Encrypt on-chain primitives (CPI from `obsidian-core` to `encrypt-core` program).

**Ciphertext types used:**
- `EncU1` — 1-bit (side)
- `EncU64` — 64-bit (price in sats per USDC, size in sats)

**Operations needed on program side:**
- `enc_xor(a, b)`, `enc_eq(a, b)` — side check
- `enc_gte(a, b)` — price comparison
- `enc_min(a, b)` — fill size
- `threshold_decrypt_request(ct, policy)` — reveal matched fields

**Note on FHE performance:** single comparison on ciphertext currently ≈ 50–500ms on MPC network. Keep book depth small (≤16 active orders) for MVP. Matching is triggered permissionlessly by keepers — not on every block.

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

### 5.4 Frontend (Next.js 16.2 app router)

See `UI_DESIGN.md` for full design spec. Technical stack:
- Next.js 16.2 + React 18 + TypeScript 5.9 (strict)
- Tailwind CSS + shadcn/ui (custom cypherpunk theme)
- framer-motion (animations)
- @react-three/fiber + drei (3D hero, optional if time)
- zustand (state)
- @solana/web3.js, @coral-xyz/anchor
- @ika.xyz/sdk, @encrypt.xyz/sdk (placeholder names, see Note below)
- @tanstack/react-query (order polling)

**Note on SDK names:** at time of writing, Ika and Encrypt pre-alpha SDK package names may differ. Resolve from `docs.ika.xyz` and `docs.encrypt.xyz` (pre-alpha docs) at kickoff. All code should isolate SDK calls behind a thin `lib/ika.ts` and `lib/encrypt.ts` adapter to swap if API changes.

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

## 8. Devnet assumptions & mocks

- **Bitcoin:** use Bitcoin testnet (signet preferred for fast blocks); dWallet on Ika operates on testnet.
- **Solana:** devnet for obsidian-core + Encrypt pre-alpha + Ika pre-alpha.
- **Price oracle:** Pyth on Solana for USD price display (not for matching — matching uses user prices only).
- **Keeper:** simple Node.js cron bot; any user can also trigger via UI "Try match" button for demo.

## 9. What ships in MVP (hackathon scope, 6 weeks)

Must-have:
- [x] Solana program with submit/cancel/try_match/settle
- [x] Client-side FHE encryption of orders
- [x] On-chain FHE comparator (at least price_gte + size_min)
- [x] dWallet creation flow for BTC testnet
- [x] Policy-gated settlement of BTC → buyer address
- [x] Next.js app with killer UI (see UI_DESIGN.md)
- [x] E2E demo: A + B submit, match, BTC moves on testnet

Nice-to-have (if time):
- [ ] 3D orderbook visualization
- [ ] Partial fill handling
- [ ] Multiple markets (ETH, SOL variants)
- [ ] SPV-proof verification of BTC tx on Solana (real atomicity)

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

Всё окружение контейнеризовано. Любой разработчик должен уметь поднять full-stack на ноутбуке одной командой `docker compose up`.

### 12.1 Контейнеры

| Сервис | Базовый image | Назначение | Экспонируемые порты |
|---|---|---|---|
| `app` | `node:24-alpine` multi-stage | Next.js 16.2 frontend | 3000 |
| `keeper` | `node:24-alpine` multi-stage | Matching bot (Node.js + TS 5.9) | 3001 (status endpoint) |
| `anchor-builder` | `projectserum/build:v0.31.0` | Build-only, production artifacts | — |
| `solana-validator` | `anzaxyz/agave:latest` | Local test-validator для dev/CI (Agave — преемник Solana Labs client) | 8899, 8900 |
| `encrypt-mock` | custom, из `docker/mock-encrypt/` | Local Encrypt RPC stub для dev | 7000 |
| `ika-mock` | custom, из `docker/mock-ika/` | Local Ika RPC stub для dev | 7001 |
| `btc-signet` | `ruimarinho/bitcoin-core:26` в signet mode | Локальный signet node | 18332 |
| `mempool-space` | `mempool/backend:latest` | Local block explorer API (опционально) | 8999 |

### 12.2 Dockerfile'ы (multi-stage pattern)

**`app/Dockerfile`** (Next.js standalone output):
- Stage 1 `deps`: `pnpm install --frozen-lockfile` + prune dev deps
- Stage 2 `builder`: `pnpm build` → `.next/standalone` + `.next/static`
- Stage 3 `runner`: `node:24-alpine`, non-root user `nextjs:nodejs`, копирует только `standalone/` + `static/` + `public/`, размер ~150 MB
- `next.config.ts`: `output: "standalone"` обязательно
- Healthcheck: `GET /api/health` → 200

**`keeper/Dockerfile`**:
- Build stage компилит TS → JS через `tsc` + `esbuild` bundle
- Runtime `node:24-alpine` с `tini` для graceful SIGTERM
- Env-driven config (см. §12.4)

**`programs/obsidian-core/Dockerfile`** (build-only):
- `projectserum/build:v0.31.0` → `anchor build --verifiable`
- Output: `target/deploy/obsidian_core.so` + IDL копируются в `dist/`
- Используется в CI и для reproducible builds при submission

### 12.3 docker-compose

Два compose-файла:
- `docker-compose.yml` — dev окружение (hot reload, local validators + mocks)
- `docker-compose.prod.yml` — production-like (от devnet RPC, mainnet-ready config)

Dev-compose поднимает: `solana-validator`, `encrypt-mock`, `ika-mock`, `btc-signet`, `app` (в dev mode с bind mount), `keeper` (в watch mode). Named volumes для persistence: `solana-ledger`, `btc-data`.

Prod-compose: только `app` + `keeper`, networking через внешние endpoints (`SOLANA_RPC`, `ENCRYPT_RPC`, `IKA_RPC`), без локальных validators.

### 12.4 Environment variables

Все секреты через `.env` (в `.gitignore`) + `.env.example` (в repo с placeholder'ами):
```
# Solana
SOLANA_RPC=https://api.devnet.solana.com
SOLANA_WS=wss://api.devnet.solana.com
PROGRAM_ID=<deploy-output>
ADMIN_KEYPAIR_PATH=/run/secrets/admin.json

# Encrypt
ENCRYPT_RPC=https://devnet.encrypt.xyz
ENCRYPT_PROGRAM_ID=<from-docs>

# Ika
IKA_RPC=https://devnet.ika.xyz
IKA_PROGRAM_ID=<from-docs>

# Bitcoin
BTC_NETWORK=signet
MEMPOOL_API=https://mempool.space/signet/api

# Keeper
KEEPER_KEYPAIR_PATH=/run/secrets/keeper.json
LOG_LEVEL=info
```

Docker secrets (`/run/secrets/*`) для keypair файлов, не bind-mount плейнтекстом.

### 12.5 Production deploy

| Компонент | Где деплоится |
|---|---|
| Solana program | `anchor deploy --provider.cluster devnet` (через CI job, verifiable build) |
| Next.js app | Vercel (primary, zero-config с Next 16.2) + Docker image на Fly.io как fallback |
| Keeper | Fly.io (`fly launch`) или Railway — 1 экземпляр, 512 MB RAM достаточно |
| Mocks (`encrypt-mock`, `ika-mock`) | Только локально — в prod заменяются реальными Encrypt+Ika devnet |

Для hackathon submission production = Vercel + Fly.io keeper + devnet deployed program. Все три шага автоматизированы через GitHub Actions workflow `deploy.yml` (runs on tag push).

### 12.6 CI/CD

`.github/workflows/ci.yml` запускает в Docker:
- `anchor-builder` образ собирает программу, сравнивает checksum с предыдущим артефактом
- `app` + `keeper` стадии `pnpm typecheck` + `pnpm build` + `pnpm test`
- Integration tests против `solana-validator` + `encrypt-mock` + `ika-mock` контейнеров

`.github/workflows/deploy.yml` на push tag `v*.*.*`:
- Build Docker images → push в GHCR
- Anchor deploy → devnet
- Vercel deploy → production
- Fly.io keeper deploy → production
- Создаёт GitHub Release с changelog
