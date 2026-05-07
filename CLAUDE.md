# ObsidianDesk — Claude Code context

## Authoritative docs (always consult before planning any work)
- docs/ARCHITECTURE.md               — system design, components, data flow
- docs/DEVELOPMENT.md                — daily-driver developer playbook
- docs/DEPLOYMENT.md                 — deploy runbook (program, frontend, keeper, VPS+Cloudflare)
- docs/DEMO.md                       — shoot script for the submission video
- docs/UI_DESIGN.md                  — visual language, wow-moments, tokens
- docs/INSTRUCTIONS.md               — 6-week roadmap, deliverables, acceptance per week
- docs/PROMPTS.md                    — tuned scaffolding prompts P1..P11
- docs/gaps.md                       — known SDK + program gaps with workarounds (closure status authoritative)
- docs/vendor/ika-pre-alpha.md       — Ika Network SDK + dWallet reference
- docs/vendor/encrypt-pre-alpha.md   — Encrypt SDK + FHE primitives reference

Before generating ANY code, re-read the relevant prompt from docs/PROMPTS.md and the matching week in docs/INSTRUCTIONS.md, then check docs/gaps.md for the current closure status of any vendor-SDK feature you're touching. Do not invent APIs — use what's in docs/vendor/*.

## Non-negotiables
- Final hackathon submission must NOT be plaintext-only. FHE comparison (Encrypt) and native BTC settlement via dWallet (Ika) are required by Week 6.
- Week 1 intentionally uses plaintext scaffolding to prove the data flow — that is expected and not a violation of the above.
- Native BTC (no bridge), encrypted orderbook (no leakage), and dark-UI polish are the differentiators — never cut them.

## Current state (post-Scope-B work, 2026-05-07)
- **Tri-state mode** (`mock` | `real` | `auto`): every real-network call goes through `tryReal()` in `sdk/src/mode.ts`. Default is `auto` — try real, fall back to mock on transient/network failure (8s timeout). Logical errors throw without fallback. Each call emits structured JSON to stderr (`[obsidian-mode]`).
- **File-backed dWallet store** (gap I2 CLOSED): `sdk/src/mock-store.ts::MockStore` persists to `~/.obsidian-mock-keys.json` (overridable via `OBSIDIAN_MOCK_STORE_PATH`). Atomic temp+rename writes, 0600 perms, BigInt+Uint8Array round-trip via tagged objects. Docker compose mounts a shared `obsidian-keys` named volume across `app` + `keeper` so the deposit page and the keeper see the same dWallets.
- **Real signet broadcast**: `sdk/src/btc.ts::broadcastTx` POSTs to `mempool.space/<network>/api/tx` with auto-fallback. `getAddressUtxos` fetches real esplora UTXOs. The keeper feeds the returned 32-byte txid into `btc_tx_proof` so `/positions` renders a mempool.space link that resolves on real broadcasts.
- **Gap I1 sign-surface CLOSED**: `sdk/src/ika.ts::requestSign` real-mode now extracts the BIP-143 sighash, calls Ika gRPC `requestPresign` + `requestSign` with the sighash as digest, normalises the returned `(r||s)` to low-s (BIP-62), DER-encodes, **verifies locally before attaching** (catches hash_scheme mismatches), and finalises the PSBT into broadcast-ready hex. Unit test `external-sig path produces the same finalised tx as single-key signAndFinalize` proves byte-equivalence with the bitcoinjs-lib internal flow.
- Real-mode Encrypt + Ika SDK still wired against pre-alpha gRPC on devnet (gaps E5 + I0 closed). Smoke test: `node sdk/scripts/devnet-smoke.mjs`.
- `EncryptedOrder` / `MatchIntent` hold 32-byte ciphertext-account refs (E1 closed); settlement is `request_decryption` → `finalize_decryption` with on-chain digest verification (E3 + E4 closed).
- The `#[encrypt_fn] match_orders_graph` DSL dispatches to the deployed Encrypt program at `4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8` on devnet; obsidian-core is at `H25yY5o4emorZ9qMHAUvJhdtrFjDSeYy2MVYurpQbeLp`.
- **Residual upstream blocker — gap E2-residual**: `encrypt-anchor` 0.1.0's `invoke_execute_graph` demotes the outer-tx signer flag on output ciphertext accounts, failing our 6-input/3-output graph at depth 2. **The keeper's match decision runs off-chain in the meantime** (`keeper/src/matching.ts`). Closure path documented in `docs/gaps.md` E2-residual: vendor + patch the helper, repoint Cargo.toml, redeploy.
- **Residual gap I4 (new)**: on-chain `MessageApproval` for keeper-presented Ika auth (currently the keeper authenticates with its own keypair, not the seller's). Documented in `docs/gaps.md` I4. Auto-fallback covers the demo path.

## Pinned versions
- Node.js 24 LTS, pnpm 9+
- Rust **1.94** stable (pinned via `rust-toolchain.toml`); Anchor **1.0.2** (`avm install 1.0.2 && avm use 1.0.2`).
  - The program depends on `encrypt-anchor` from `dwallet-labs/encrypt-pre-alpha` which requires Anchor 1.x; the JS side stays on `@coral-xyz/anchor@^0.32.1` because no v1 JS SDK has shipped yet — 0.32.1 parses the v1 IDL cleanly for our usage (verified by `anchor test` against local validator).
  - `programs/obsidian-core/Cargo.toml` is on `edition = "2021"` (not `"2024"` like upstream) because anchor-cli 1.0.2's manifest parser doesn't yet recognise `2024`.
  - `Anchor.toml` no longer carries `[toolchain] anchor_version` — that field was removed in v1; anchor-cli uses whichever binary is on `$PATH`.
- Solana CLI latest via Anza installer (Agave), solana-validator image: anzaxyz/agave:latest
- Next.js 16.2 (App Router, output: "standalone"), React 19.1+, TypeScript 5.9 strict
  - Next 16 ships React 19.3-canary to the client regardless of the app's declared `react` version. The app MUST be on React 19 — with React 18 declared, `react-reconciler@0.27.0` (pulled by `@react-three/fiber` v8) tries to read `React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentBatchConfig`, which React 19 renamed away, and the whole client crashes to "This page couldn't load".
  - Matching deps: `@react-three/fiber@^9`, `@react-three/drei@^10`, `@types/react@^19`, `@types/react-dom@^19`.
  - React 19 also drops the global `JSX` namespace — `app/global.d.ts` re-exports it from `react` so existing `JSX.Element` annotations still compile.
- Bitcoin: signet via mempool.space

## Workflow
1. User issues a task → locate matching prompt in docs/PROMPTS.md.
2. Confirm the week in docs/INSTRUCTIONS.md and list acceptance criteria in your plan.
3. Implement. Cross-check API calls against docs/vendor/*.
4. Run lints/tests. Report deltas vs. acceptance criteria.

## Repo layout
programs/obsidian-core/   Anchor program
app/                      Next.js 16.2 frontend
sdk/                      shared TS SDK (encrypt + ika adapters)
keeper/                   matching / settlement keeper bot
scripts/                  deploy + test scripts
docs/                     authoritative docs (this folder)
docs/vendor/              vendor SDK references (read-only mirrors)
tests/                    integration + E2E tests

## Memory
Persistent memory lives in THIS FILE (CLAUDE.md). Per-machine memory under ~/.claude/projects/<hash>/memory/ is a cache — anything important must also be reflected here so it travels with the repo.
