# ObsidianDesk

> The dark pool where Bitcoin never leaves Bitcoin.

Institutional dark-pool DEX on Solana for BTC / USDC.
Encrypted orderbook (FHE, [Encrypt](https://docs.encrypt.xyz)) + native BTC settlement ([Ika](https://docs.ika.xyz) dWallets). No bridges. No wrapped BTC. No plaintext orderbook.

[![CI](https://github.com/mihailShumilov/obsidian-desk/actions/workflows/ci.yml/badge.svg)](https://github.com/mihailShumilov/obsidian-desk/actions/workflows/ci.yml)
[![License: Proprietary](https://img.shields.io/badge/license-proprietary-cipher.svg)](LICENSE)
[![Solana devnet](https://img.shields.io/badge/solana-devnet-violet.svg)](#whats-deployed-where)

**Devnet program:** `H25yY5o4emorZ9qMHAUvJhdtrFjDSeYy2MVYurpQbeLp`
**Live demo:** <https://obsidiandesk.app> (devnet; see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) §6 for the self-hosted VPS + Cloudflare setup)

## Table of contents

1. [The problem](#the-problem)
2. [Why Ika *and* Encrypt](#why-ika-and-encrypt)
3. [Architecture](#architecture)
4. [Run via Docker (recommended)](#run-via-docker-recommended)
5. [Run locally without Docker](#run-locally-without-docker)
6. [Tests](#tests)
7. [Demo flow](#demo-flow)
8. [Repository layout](#repository-layout)
9. [Environment variables](#environment-variables)
10. [Troubleshooting](#troubleshooting)
11. [Build progress](#build-progress)
12. [Known gaps](#known-gaps)
13. [License](#license)

## The problem

Every crypto dark pool today breaks on one of three axes:

1. **Orders leak.** Every L2 orderbook is a strategy leak. Validators, indexers, MEV searchers — they all see your price, size, and timing. The market front-runs you before you fill.
2. **Bridges break.** Wrapped BTC depends on a custodian or a cross-chain proof you can't audit. Every bridge is a single point of catastrophic failure.
3. **Custodians control.** If a venue holds your keys, it holds your fate. Withdrawal pauses, frozen assets, KYC creep — all downstream of custody.

ObsidianDesk picks the two technologies that fix all three: FHE for the orderbook, and native MPC signing for settlement.

**Target users**

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

```mermaid
flowchart LR
  Trader([Trader])
  subgraph Solana
    Program[obsidian-core program]
    Encrypt[Encrypt MPC<br/>FHE compare]
  end
  subgraph Bitcoin
    Ika[Ika dWallet<br/>2PC-MPC sign]
    UTXO[Native BTC UTXO]
  end
  Keeper((Keeper bot))

  Trader -- encrypt order --> Program
  Program -. ciphertext PDA .-> Program
  Keeper -- poll Pending --> Program
  Program <-- FHE compare --> Encrypt
  Encrypt -- threshold decrypt fill --> Program
  Keeper -- request sign --> Ika
  Ika -- signed BTC tx --> Keeper
  Keeper -- broadcast --> UTXO
  Keeper -- finalize_settlement(tx_proof) --> Program
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design and [`docs/UI_DESIGN.md`](docs/UI_DESIGN.md) for the design system.

**Stack**

| Layer | Tech |
|---|---|
| Solana program | Rust 1.94 + Anchor 1.0.2 (`programs/obsidian-core`) — pulls `encrypt-anchor` for the `#[encrypt_fn]` DSL |
| Shared SDK | TypeScript 5.9 (`sdk/`) — adapters for Encrypt + Ika + bitcoinjs-lib (Encrypt + Ika real-mode wired against pre-alpha gRPC on devnet) |
| Frontend | Next.js 16.2 App Router + React 19.1 + Tailwind 3.4 (`app/`) |
| Keeper bot | Node.js 24 daemon (`keeper/`) — drives `try_match → request_decryption → finalize_decryption → finalize_settlement` |
| Bitcoin | signet via mempool.space esplora; native settlement via Ika 2PC-MPC dWallets (no bridge / no wrapping) |
| Tooling | pnpm 9.15.4 workspaces, Solana CLI (Agave), `anchor-cli@1.0.2` (`cargo install`, not avm) |

## Run via Docker (recommended)

Prereqs: Docker Desktop ≥ 4.25 with Compose v2, ≥ 8 GB free RAM, the Solana CLI for the host validator (Agave's container is amd64-only, so on M-series Macs we run the validator on the host — see [troubleshooting](#docker-compose-up-fails-or-validator-doesnt-start)).

```bash
git clone https://github.com/mihailShumilov/obsidian-desk.git
cd obsidian-desk

# 1. host validator (M-series Macs MUST run this on host; x86 can opt into the
#    in-container validator with `docker compose --profile local-rpc up`)
solana-test-validator --rpc-port 18899 --bind-address 127.0.0.1 --reset

# 2. anchor build so target/idl/obsidian_core.json exists for the keeper mount
anchor build && anchor deploy --provider.cluster http://127.0.0.1:18899

# 3. one-shot bootstrap — generates a keeper keypair if missing,
#    builds + ups the stack, waits for healthchecks
pnpm docker:up
```

After ~30 s:

- App: <http://127.0.0.1:13000>
- Trade terminal: <http://127.0.0.1:13000/trade>
- Trade w/ admin tools: <http://127.0.0.1:13000/trade?admin=1>
- Keeper status JSON: <http://127.0.0.1:13001/status>
- Solana RPC: <http://127.0.0.1:18899>

Seed a demo (one-command bootstrap of market + 2 dWallets + 8 encrypted orders):

```bash
pnpm seed:demo
```

Tear down (removes containers + volumes):

```bash
pnpm docker:down
```

<details>
<summary><strong>Production overlay (pulls images from GHCR, no local validator)</strong></summary>

```bash
cp .env.example .env.production
# edit .env.production:
#   NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com
#   SOLANA_RPC=https://api.devnet.solana.com
#   IMAGE_TAG=v0.1.0
#   KEEPER_KEYPAIR_PATH=/path/to/keeper-keypair.json
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --env-file .env.production up -d
```

Image sizes: `obsidian-app` ≈ 313 MB (Next standalone, three.js dynamically loaded), `obsidian-keeper` ≈ 924 MB (`@coral-xyz/anchor` deps).

Full deployment runbook (rollback, monitoring, security checklist, cost estimates): [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
</details>

## Run locally without Docker

For hot-reload iteration on a single service.

**Prereqs:** Node.js 24+, pnpm 9.15.4, Rust 1.94 stable (pinned via `rust-toolchain.toml`), Solana CLI (Agave), `anchor-cli@1.0.2` — install with `cargo install anchor-cli@1.0.2 --locked`. We do **not** use `avm` — anchor-cli 1.0+ is published directly on crates.io and `avm` historically rate-limits from CI.

```bash
# Install + emit SDK types so workspace deps resolve
pnpm install
pnpm -F @obsidian-desk/sdk build
pnpm typecheck

# In separate terminals:
solana-test-validator --rpc-port 18899 --bind-address 127.0.0.1 --reset
anchor build && anchor deploy --provider.cluster http://127.0.0.1:18899
pnpm dev   # boots app on :13000 + keeper on :13001 in parallel
```

Or open them one-by-one:

```bash
pnpm -F @obsidian-desk/app    dev   # frontend, hot reload
pnpm -F @obsidian-desk/keeper dev   # keeper, ts-node-dev watch
```

Common workspace commands:

| Command | What it does |
|---|---|
| `pnpm typecheck` | recursive `tsc --noEmit` across `sdk/`, `keeper/`, `app/` |
| `pnpm build` | recursive `pnpm build` (sdk → app → keeper) |
| `pnpm test` | recursive `pnpm test` (currently only `sdk/`) |
| `pnpm test:sdk` | 26 SDK unit tests, ~120 ms, no network |
| `pnpm anchor:build` | build the Solana program |
| `pnpm anchor:test` | full anchor + e2e suite (5 tests, ~11 s; needs validator) |
| `pnpm cargo:clippy` | clippy with `-D warnings`. Note: drops `--all-targets` so the `idl-build` cfg never gets compiled — the macro-generated IDL build trips lints we can't fix from outside `encrypt-anchor` / `anchor-lang`. |
| `pnpm seed:demo` | bootstrap a fresh market + dWallets + 8 orders |
| `pnpm docker:up` / `pnpm docker:down` | full-stack docker convenience wrappers |

Detailed per-workspace debugging tips: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## Tests

```bash
# SDK unit tests (~120 ms, zero network)
pnpm -F @obsidian-desk/sdk test

# Anchor + e2e (requires a running validator; anchor build first)
anchor test --skip-local-validator
#   ├─ obsidian-core.ts         — program unit tests
#   ├─ e2e-submit.ts            — encrypt → submit → byte-equality
#   ├─ e2e-settlement.ts        — one-leg mock settlement (P4)
#   └─ e2e-full.ts              — two-leg Alice/Bob settlement (P9)

# Real-mode devnet smoke (hits live Encrypt + Ika gRPC, costs network calls)
pnpm -F @obsidian-desk/sdk build
node sdk/scripts/devnet-smoke.mjs
#   ├─ encryptU64    → 32-byte ciphertext id
#   ├─ encryptOrder  → 3 fresh 32-byte ids (side, price, size)
#   ├─ createDWallet → real DKG'd P2WPKH signet address
#   └─ lockPolicy    → on-chain Solana policy account

# Keeper matching loop against the deployed devnet program
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
  ANCHOR_WALLET=~/.config/solana/keeper.json \
  tsx keeper/scripts/devnet-bootstrap.ts        # create market + 2 opposite-side orders
tsx keeper/scripts/match-pair.ts <market> <a> <b>   # drives try_match → request_decryption → finalize_decryption
```

CI runs `pnpm typecheck` + `pnpm -r build` + `cargo clippy --workspace -- -D warnings` + `anchor build --no-idl --ignore-keys` against every push to `main` — see [`.github/workflows/ci.yml`](.github/workflows/ci.yml) and the badge above. The devnet smoke test is **not** in CI (it costs real network round-trips against the pre-alpha gRPC services).

## Demo flow

1. **Onboard:** visit `/deposit`, click _Generate dWallet_ → step 2 shows a signet address + QR. Fund it, wait for the 15 s esplora poll, then _Lock_ to ObsidianDesk.
2. **Seal:** visit `/trade`, type a price + size, click _Encrypt & Seal_ → watch the 1.8 s choreography (button progress bar → scramble → envelope collapse → shoot-up → toast).
3. **Match:** click _Try Match_ in the header (or _Match all_ in `?admin=1`) → full match/settle modal plays: Beacon → Reveal counterparties → Settlement panels with Solana + Bitcoin progress → Sealed notification.
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
scripts/                  seed-demo, deploy/airdrop helpers, docker-bootstrap
tests/                    Integration + E2E tests (mocha + @coral-xyz/anchor)
docs/                     Authoritative project docs (6 files + DEVELOPMENT + DEPLOYMENT)
docs/vendor/              Vendored Encrypt + Ika SDK references
```

## Environment variables

Copy [`.env.example`](.env.example) — every variable with comments. Summary:

| Variable | Required | Default | Purpose | Used by |
|---|---|---|---|---|
| `NEXT_PUBLIC_SOLANA_RPC` | yes | `http://127.0.0.1:18899` | Browser-side Solana RPC URL (wallet adapter) | app |
| `ANCHOR_PROVIDER_URL` | yes (keeper / scripts) | `http://127.0.0.1:18899` | Server-side Solana RPC URL | keeper, anchor CLI |
| `ANCHOR_WALLET` | yes (keeper / scripts) | `~/.config/solana/id.json` | Keypair the keeper signs `finalize_settlement` with | keeper, anchor CLI |
| `SOLANA_RPC` | docker compose only | `http://solana-validator:8899` | Internal docker-network alias for the keeper to reach the validator | keeper container |
| `OBSIDIAN_PROGRAM_ID` / `NEXT_PUBLIC_OBSIDIAN_PROGRAM_ID` | yes | `H25y…beLp` (devnet) | Pinned program id; must match `Anchor.toml` + `declare_id!()` | app, keeper, scripts |
| `NEXT_PUBLIC_OBSIDIAN_MARKET` | no | unset | Base58 PDA of the `MarketState` to submit orders into. When set, `/trade` bundles `submit_order` + `approve_btc_settlement` into one wallet-adapter-signed tx; when unset, falls back to the local-only stub | app |
| `OBSIDIAN_KEEPER_AUTHORITY` | no | payer pubkey | Override the `keeper_authority` written into `MarketState` at `initialize_market`. Use when bootstrapping a market on a workstation while the production keeper signs from a different machine | `keeper/scripts/devnet-bootstrap.ts` |
| `NEXT_PUBLIC_NETWORK` | no | `devnet` | Label rendered in the header chip | app |
| `OBSIDIAN_ESPLORA_URL` | no | `https://mempool.space/signet/api` | esplora-style API base for the deposit balance poll | app server actions |
| `OBSIDIAN_ENCRYPT_MODE` | no | `mock` | `mock` (offline, deterministic) or `real` (live Encrypt gRPC against Solana devnet) | sdk |
| `OBSIDIAN_IKA_MODE` | no | `mock` | `mock` (local secp256k1 keygen) or `real` (live Ika gRPC, full DKG ceremony) | sdk |
| `OBSIDIAN_ENCRYPT_GRPC_URL` | no | `pre-alpha-dev-1.encrypt.ika-network.net:443` | Override Encrypt gRPC endpoint (real-mode only) | sdk |
| `OBSIDIAN_ENCRYPT_PROGRAM_ID` | no | `4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8` | Encrypt program id on devnet (real-mode only) | sdk |
| `OBSIDIAN_IKA_GRPC_URL` | no | `pre-alpha-dev-1.ika.ika-network.net:443` | Override Ika gRPC endpoint (real-mode only) | sdk |
| `KEEPER_POLL_MS` | no | `3000` | Match-poll interval | keeper |
| `KEEPER_PORT` | no | `13001` (host) / `3001` (container) | `/status` endpoint port | keeper |
| `KEEPER_FEERATE` | no | `4` | BTC fee rate (sat/vB) for settlement txs | keeper |
| `KEEPER_DEBUG` | no | unset | Set to truthy to log mock-store contents on each tick | keeper |
| `KEEPER_KEYPAIR_PATH` | docker | `./scripts/.keeper-keypair.json` | Host path mounted to `/run/secrets/keeper_keypair.json` | docker compose |
| `IMAGE_TAG` | docker prod | `latest` | Tag for GHCR images in the prod overlay | docker compose prod |

## Troubleshooting

<details>
<summary><strong><code>TS2307: Cannot find module '@obsidian-desk/sdk'</code></strong></summary>

The TS workspaces are linked through `sdk/dist/` (built output, not source). Build the SDK once after a fresh clone:

```bash
pnpm -F @obsidian-desk/sdk build
```

CI does this in `.github/workflows/ci.yml` before the workspace-wide `typecheck`.
</details>

<details>
<summary><strong><code>docker compose up</code> fails or validator doesn't start</strong></summary>

The `solana-validator` service is **opt-in** via `--profile local-rpc`. By default `docker compose up` brings only `app` + `keeper`, expecting the validator to be running on the host (`solana-test-validator --rpc-port 18899 --bind-address 127.0.0.1`).

Why: Anza only publishes Agave for `linux/amd64`, and current Agave 3.x panics under qemu emulation on arm64 (`io_uring NOT supported`). On M-series Macs, run the validator on the host. On x86 Linux, opt in:

```bash
docker compose --profile local-rpc up -d
```
</details>

<details>
<summary><strong>Anchor test: <code>Blockhash not found</code> on every RPC call</strong></summary>

Anchor's default commitment is `processed`, which returns blockhashes the validator hasn't finalized. Build the provider explicitly:

```ts
const provider = new anchor.AnchorProvider(connection, wallet, {
  commitment: 'confirmed',
  preflightCommitment: 'confirmed',
});
```

The pattern is in every test file under `tests/`.
</details>

<details>
<summary><strong>Mocha hangs forever during anchor test</strong></summary>

Anchor's WebSocket event listeners hang against a manually-spawned validator. Don't use `program.addEventListener(...)` — instead, fetch the transaction and parse `Program data:` lines from `meta.logMessages`. See `tests/obsidian-core.ts` `eventsFor()` helper for the pattern.
</details>

<details>
<summary><strong><code>Failed to reallocate account data</code></strong></summary>

Historic — when ciphertexts were stored inline as `Vec<u8>`, the three CT slots in `EncryptedOrder` plus the linked-list pointer competed for the 10 240 B CPI realloc cap. Closed by gap E1 — `EncryptedOrder` and `MatchIntent` now hold 32-byte Ciphertext-account refs, so the on-chain account stays well under the cap. If you still hit this, you're touching the singleton `MarketState.total_volume_cipher` blob — check `TOTAL_VOLUME_CT_MAX` in `programs/obsidian-core/src/state.rs`.
</details>

<details>
<summary><strong>Docker build fails on <code>usb</code> / <code>node-gyp</code></strong></summary>

The umbrella `@solana/wallet-adapter-wallets` drags in hardware-wallet (Ledger / Trezor) native deps that need libusb + python at install time. We use the per-wallet packages instead (`@solana/wallet-adapter-phantom`); if you add another adapter, prefer the specific package over the umbrella.
</details>

<details>
<summary><strong>Hydration mismatch in app/ for a persisted-store-backed component</strong></summary>

The persisted zustand store hydrates client-side only. Render a skeleton on first paint, set state in a `useEffect`, only render the real markup after hydration. Pattern: `app/components/shell/dwallet-chip.tsx`.
</details>

<details>
<summary><strong>Real-mode (Encrypt + Ika devnet) — <code>OBSIDIAN_*_MODE=real</code></strong></summary>

Real mode is wired against pre-alpha gRPC on Solana devnet (gaps E5 / I0 closed):

- Encrypt: dispatches via the upstream client to `pre-alpha-dev-1.encrypt.ika-network.net:443`. We `pnpm patch` the published 0.1.1 package's `exports` field + `dist/` import paths — see `patches/@encrypt.xyz__pre-alpha-solana-client@0.1.1.patch`.
- Ika: vendored under `sdk/src/ika-vendor/` (the upstream package ships only `.ts` sources with no compiled `dist/`, so a patch alone wasn't enough). Targets `pre-alpha-dev-1.ika.ika-network.net:443`, secp256k1 / ECDSA params for Bitcoin signing.

```bash
OBSIDIAN_ENCRYPT_MODE=real OBSIDIAN_IKA_MODE=real \
  OBSIDIAN_ENCRYPT_GRPC_URL=pre-alpha-dev-1.encrypt.ika-network.net:443 \
  OBSIDIAN_ENCRYPT_PROGRAM_ID=4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8 \
  OBSIDIAN_IKA_GRPC_URL=pre-alpha-dev-1.ika.ika-network.net:443 \
  pnpm dev
```

Smoke test the live integration (4 green checks: encryptU64, encryptOrder, createDWallet, lockPolicy):

```bash
pnpm -F @obsidian-desk/sdk build
node sdk/scripts/devnet-smoke.mjs
```

The `mock` mode (default) still exists for offline tests. **Note:** in real mode the SDK's gRPC modules are now opt-in via subpath imports — `import * as encrypt from '@obsidian-desk/sdk/encrypt'` and `import * as ika from '@obsidian-desk/sdk/ika'`. They are intentionally NOT re-exported from the barrel because Turbopack's import-graph walker would otherwise bundle `@grpc/grpc-js` into the client. The `btc` namespace stays on the barrel — bitcoinjs-lib is browser-safe.

**One residual upstream blocker:** `try_match → execute_graph` CPI fails at depth 2 with a signer/writable demotion in `encrypt-anchor` 0.1.0's `invoke_execute_graph`. Tracked as **E2-residual** in [`docs/gaps.md`](docs/gaps.md). Closes when upstream ships a CPI variant that propagates the outer-tx signer flag to fresh output ciphertext accounts (or we vendor + adapt the helper). Everything up to and including the on-chain DSL graph and the 22-account instruction shape is in place — `tsx keeper/scripts/match-pair.ts <market> <a> <b>` reaches the CPI cleanly before stopping at the demotion.
</details>

> **Port scheme:** non-standard on purpose so the stack never collides with other local Docker projects. App `:13000`, keeper status `:13001`, Solana validator RPC `:18899`. Mapped consistently across `docker-compose.yml`, `Anchor.toml`, and the local-dev instructions above.

## Build progress

Driven by the eleven prompts in [`docs/PROMPTS.md`](docs/PROMPTS.md), then closed-out gap work after P11.

- [x] **P1** — Monorepo scaffold
- [x] **P2** — Anchor program with FHE-shaped accounts
- [x] **P3** — Encrypt SDK + mock-mode ciphertexts
- [x] **P4** — Ika dWallet adapter + BTC tx builder + keeper + e2e settlement
- [x] **P5** — Next.js shell + obsidian design system
- [x] **P6** — Landing wow hero: 3D cube + 6 sections
- [x] **P7** — Trade terminal + match/settle modal
- [x] **P8** — Deposit wizard polish: persisted state + esplora poll
- [x] **P9** — E2E + keeper metrics + admin mode + seed-demo
- [x] **P10** — Dockerization: app + keeper images, dev compose, prod overlay
- [x] **P11** — Final README + DEVELOPMENT + DEPLOYMENT + LICENSE + CONTRIBUTING

**Post-P11 — gap closures and real-mode integration**

- [x] **E5** — Encrypt real-mode wired (`pnpm patch` on `@encrypt.xyz/pre-alpha-solana-client@0.1.1`)
- [x] **I0** — Ika real-mode wired (vendored `sdk/src/ika-vendor/` from `@ika.xyz` 0.1.1 sources)
- [x] **E1** — `EncryptedOrder` / `MatchIntent` now hold `[u8; 32]` ciphertext-account refs, not inline `Vec<u8>`
- [x] **E2** — Anchor 1.0.2 / Rust 1.94 migration; `match_orders_graph` defined via `#[encrypt_fn]` DSL; on-chain CPI dispatch via `EncryptContext`
- [x] **E2-residual** — Vendored `encrypt-anchor` v0.1.0 into `crates/encrypt-anchor-vendor/` and patched `invoke_execute_graph` so `is_signer` / `is_writable` propagate from the outer tx; the runtime CPI gate is closed (the residual sub-issue is an Encrypt-domain error documented in the table below)
- [x] **E3** — Settlement path split into `request_decryption` + `finalize_decryption` with on-chain digest verification
- [x] **E4** — `MatchIntent` snapshots three independent ciphertext digests (one per fill output)
- [x] **I2** — Mock dWallet store now persists to `~/.obsidian-mock-keys.json` with atomic temp+rename writes and 0600 perms; docker compose mounts a shared `obsidian-keys` volume across `app` + `keeper`
- [x] **I3** — `finalize_settlement` gated by `market.keeper_authority` + on-chain SPV merkle inclusion verifier (`programs/obsidian-core/src/spv.rs`); `MatchRecord.spv_verified` flag set true only when the on-chain verifier accepts the merkle path
- [x] **I4** — On-chain `BtcSettleApproval` PDA + `approve_btc_settlement` (seller-signed) / `consume_btc_approval` (keeper-only) instructions; keeper integration in `keeper/src/poll.ts::consumeBtcApproval`
- [x] **Frontend on-chain submit** — `app/lib/trade/submit-on-chain.ts` + server actions (`prepareEncryptedOrderAction`, `getProgramSetupAction`); `/trade` bundles `submit_order` + `approve_btc_settlement` into one wallet-adapter-signed tx. Gates on `NEXT_PUBLIC_OBSIDIAN_MARKET`; falls back to local-only stub when unset.
- [x] **CI publish-images** — `.github/workflows/ci.yml::publish-images` builds and pushes `linux/amd64` images to GHCR (`obsidian-app`, `obsidian-keeper`) on every push to `main`. Tags: `:latest` + `:<full-sha>`. Packages are public — VPS pulls anonymously.
- [x] **Devnet deploy** — `H25y…beLp` live on Solana devnet; `tsx keeper/scripts/devnet-bootstrap.ts` creates a market + two opposite-side orders backed by real Encrypt ciphertext accounts; `tsx keeper/scripts/match-pair.ts` exercises the full keeper matching loop. Bootstrap accepts `OBSIDIAN_KEEPER_AUTHORITY` env override so a market can be initialised on a workstation while the production keeper signs from the VPS.

## Known gaps

Tracked in [`docs/gaps.md`](docs/gaps.md). High-impact items for reviewers:

| ID | What | Impact | Workaround |
|---|---|---|---|
| **E2-residual (sub)** | After the vendored signer-propagation patch, `execute_graph` dispatches cleanly and Encrypt's program runs — then returns custom error `0x14` (=20). 0x14 is **not in the upstream IDL** (errors 0–17 documented). 1 978 CUs spent before exit; no `msg!` diagnostic. Likely cause: graph-hash registration drift or an undocumented config check past error 17. | No on-chain match settles end-to-end on devnet | Not closeable without an updated Encrypt IDL or upstream source access. The keeper's match decision runs off-chain in the meantime (`keeper/src/matching.ts`). |
| **I1 (residual)** | Keeper authenticates to Ika gRPC with its own keypair, not the seller's. The on-chain `consume_btc_approval` PDA carries the security gate. | Ika gRPC `approval_proof` field still receives the keeper sig until Ika exposes a Solana-PDA-aware approval-proof shape | Upstream-blocked; the on-chain `BtcSettleApproval` PDA is the auditable authorisation today. |
| **I3 (residual)** | SPV verifier accepts any 80-byte header — no proof-of-work check, no header-chain ring buffer | A keeper could in theory submit a header that commits to a real txid without being on the canonical chain | Deliberate scope cut — keeper-authority gate bounds who can submit. Trustless version would verify `sha256d(header) <= target_from_bits` and require `header.prev_hash` matches a recent stored header. |

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for branching, commit conventions, and the local CI checks to run before pushing.

## License

Proprietary — Copyright (c) 2026 Mykhailo Shumilov. All rights reserved. See [`LICENSE`](LICENSE). No use, copying, modification, or redistribution is permitted without prior written permission of the copyright holder.
