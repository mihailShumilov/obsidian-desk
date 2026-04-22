# ObsidianDesk

> The dark pool where Bitcoin never leaves Bitcoin.

Institutional dark-pool DEX on Solana for BTC/USDC.
- **Encrypted orderbook** — orders submitted as FHE ciphertexts via [Encrypt](https://docs.encrypt.xyz). No leakage to validators or indexers.
- **Native BTC settlement** — funds move on Bitcoin via [Ika](https://docs.ika.xyz) dWallets (2PC-MPC). No bridges, no wrapped BTC.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design and [`docs/INSTRUCTIONS.md`](docs/INSTRUCTIONS.md) for the 6-week build plan.

## Stack
- Solana program: Rust 1.93 + Anchor 0.32+ (`programs/obsidian-core`)
- Frontend: Next.js 16.2 (App Router) + React 18.3 + TypeScript 5.9 strict (`app/`)
- SDK: shared TS adapters over Encrypt + Ika (`sdk/`)
- Keeper: Node.js 24 cron poller for matching/settlement (`keeper/`)
- Bitcoin: signet for testnet settlement (mempool.space)
- Tooling: pnpm 9 workspaces, Solana CLI (Agave)

## Prerequisites
- Node.js 24+
- pnpm 9+ (`corepack enable && corepack prepare pnpm@9 --activate`)
- Rust 1.93 stable (`rustup default stable`)
- Solana CLI latest (Agave): `sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"`
- Anchor 0.32+: `avm install 0.32.1 && avm use 0.32.1`

## Quick start (local dev — no Docker)
```bash
pnpm install
pnpm typecheck
pnpm build
anchor build
pnpm dev          # runs app on :13000 + keeper concurrently
```

### Run the e2e test suite
```bash
# 1. start a local validator on the project's non-standard port
solana-test-validator --rpc-port 18899 --bind-address 127.0.0.1 --reset

# 2. in a second terminal, run anchor against the running validator
anchor build && anchor deploy --provider.cluster http://127.0.0.1:18899
anchor test --skip-local-validator
```

> **Port note:** all services bind to non-standard host ports to avoid collision with other local Docker projects. App: `13000`, keeper status: `13001`, Solana validator RPC: `18899`. Full mapping in `docker-compose.yml` once P10 lands.

### Frontend visual QA
The visual test surface (covers every custom component + token) is at <http://127.0.0.1:13000/kitchen>.

## Layout
```
programs/obsidian-core/   Anchor program (Rust)
app/                      Next.js 16.2 frontend
  app/                    routes (/, /trade, /deposit, /positions, /about, /kitchen, /api/health)
  components/obsidian/    custom design-system primitives
  components/ui/          Button + Card (cva variants)
  components/shell/       Header + Footer + Logo + WalletButton
sdk/                      TS SDK (Encrypt + Ika + BTC adapters)
keeper/                   Matching + settlement keeper bot
scripts/                  Deploy / airdrop / seed
tests/                    Integration + E2E tests
docs/                     Authoritative project docs
docs/vendor/              Vendored Encrypt + Ika SDK references
```

## What's running today

**Solana program (`programs/obsidian-core`)** — `MarketState`, `EncryptedOrder` (linked-list of active orders, ciphertext blobs as `Vec<u8>`), `MatchIntent`, `MatchRecord`. Seven instructions: `initialize_market`, `submit_order`, `cancel_order`, `try_match`, `request_settlement`, `finalize_settlement`, `fail_settlement`. P2 mock-CPI adapter at `encrypt_cpi.rs` — gets swapped for real `execute_graph` CPI in a later prompt.

**SDK (`sdk/src`)**
- `encrypt.ts` — mock-mode FHE wrapper. Each ciphertext is a 32-byte tagged blob (`encryptOrder` returns `{side_ct, price_ct, size_ct, nonce}`). Real-mode falls through to `VendorSDKUnavailableError` (gap E5).
- `ika.ts` — mock-mode dWallet store with real P2WPKH key generation, policy locking, and PSBT signing via `bitcoinjs-lib`. Real Ika DKG/gRPC unblocked in P9 (gap I0).
- `btc.ts` — bitcoinjs-lib v7 PSBT builder (signet/testnet). `buildSpendTx` does P2WPKH input/output with vbyte fee estimation, `signAndFinalize`, `scriptForAddress`.
- 26 unit tests via `node --test --experimental-strip-types`.

**Keeper (`keeper/src`)** — `pollOnce(program, options)` pure function fetches `MatchRecord` PDAs with `settle_status = Pending`, builds + signs the BTC tx via the SDK, calls `finalize_settlement` (or `fail_settlement` on error). Daemon entrypoint exposes `/status` JSON on `:13001`. SDK namespaces are dependency-injected so the e2e test can share its in-process mock store.

**Frontend (`app/`)** — full design system per `docs/UI_DESIGN.md`:
- 7 custom obsidian components (`Cipher`, `CipherField`, `ChainBadge`, `DWalletCard`, `MatchBeacon`, `SettleThread`, `OrderbookVoid`)
- 6 routes: `/` (landing stub w/ cube placeholder), `/trade` (3-col stub), `/deposit` (working 3-step wizard via Server Actions), `/positions` (status-badge table stub), `/about`, `/kitchen` (visual QA)
- `/api/health` for Docker
- Phantom wallet adapter wired to local validator (`http://127.0.0.1:18899` by default; override with `NEXT_PUBLIC_SOLANA_RPC`)

## Status
Roadmap is driven by the eleven prompts in [`docs/PROMPTS.md`](docs/PROMPTS.md).

- [x] **P1** — monorepo scaffold, workspace boots, stub program builds (`62d42c4`)
- [x] **P2** — Anchor program with FHE-typed accounts and instructions (`2f7c39a`)
- [x] **P3** — Encrypt SDK integration (client-side encryption, mock mode) (`427d1e5`)
- [x] **P4** — Ika dWallet integration + BTC tx builder + keeper + e2e settlement (`6d9ce5c`)
- [x] **P5** — Next.js shell + obsidian design system (`fe50380`)
- [x] **P6** — Landing wow hero: 3D cube + 6 sections (`99d62e3`)
- [x] **P7** — Trade terminal: book + chart + submit choreography + match modal (`b13dca4`)
- [x] **P8** — Deposit wizard polish: persisted state, esplora poll, header chip (`c990d30`)
- [ ] P9 — Real Ika DKG + SPV proof + keeper hardening + demo script
- [ ] P10 — Dockerization (full stack)
- [ ] P11 — Final README + deployment guide

## Known gaps
Tracked in [`docs/gaps.md`](docs/gaps.md). High-impact items:
- **E0** — `CT_MAX = 3000` (not the spec's 4096) due to Solana's 10240B CPI realloc cap.
- **E1** — ciphertexts are inline `Vec<u8>` on `EncryptedOrder`; real Encrypt models them as 100B keypair accounts. Refactor planned.
- **E5 / I0** — upstream Encrypt + Ika TS clients ship uncompiled `.ts` in their published `exports`, which Node 24 won't strip from `node_modules`. Both adapters force `mock` mode and surface a `VendorSDKUnavailableError` if real mode is requested.
- **I2** — Ika mock store is process-local. The e2e test injects its own SDK namespace into the keeper to share state.

## License
MIT (TBD — confirm before submission).
