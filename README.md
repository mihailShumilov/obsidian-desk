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
pnpm dev   # runs app on :13000 + keeper concurrently
```

> **Port note:** all services bind to non-standard host ports to avoid collision with other local Docker projects. App: `13000`, keeper status (P9+): `13001`, Solana validator (P10): `18899`. Full mapping in `docker-compose.yml` once P10 lands.

## Layout
```
programs/obsidian-core/   Anchor program (Rust)
app/                      Next.js 16.2 frontend
sdk/                      TS SDK (Encrypt + Ika adapters)
keeper/                   Matching keeper bot
scripts/                  Deploy / airdrop / seed
tests/                    Integration + E2E tests
docs/                     Authoritative project docs
docs/vendor/              Vendored Encrypt + Ika SDK references
```

## Status
Roadmap is driven by the eleven prompts in [`docs/PROMPTS.md`](docs/PROMPTS.md).

- [x] **P1** — monorepo scaffold, workspace boots, stub program builds
- [ ] P2 — Anchor program with FHE-typed accounts and instructions
- [ ] P3 — Encrypt SDK integration (client-side encryption)
- [ ] P4 — Ika dWallet integration (Bitcoin settlement)
- [ ] P5 — Next.js shell + design system
- [ ] P6 — Landing page wow hero
- [ ] P7 — Trade page (encrypted orderbook UI)
- [ ] P8 — Order submission + dWallet onboarding
- [ ] P9 — E2E integration + keeper + demo
- [ ] P10 — Dockerization (full stack)
- [ ] P11 — Final README + deployment guide

## License
MIT (TBD — confirm before submission).
