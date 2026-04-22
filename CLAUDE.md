# ObsidianDesk — Claude Code context

## Authoritative docs (always consult before planning any work)
- docs/ARCHITECTURE.md               — system design, components, data flow
- docs/UI_DESIGN.md                  — visual language, wow-moments, tokens
- docs/INSTRUCTIONS.md               — 6-week roadmap, deliverables, acceptance per week
- docs/PROMPTS.md                    — tuned scaffolding prompts P1..P11
- docs/vendor/ika-pre-alpha.md       — Ika Network SDK + dWallet reference
- docs/vendor/encrypt-pre-alpha.md   — Encrypt SDK + FHE primitives reference

Before generating ANY code, re-read the relevant prompt from docs/PROMPTS.md and the matching week in docs/INSTRUCTIONS.md. Do not invent APIs — use what's in docs/vendor/*.

## Non-negotiables
- Final hackathon submission must NOT be plaintext-only. FHE comparison (Encrypt) and native BTC settlement via dWallet (Ika) are required by Week 6.
- Week 1 intentionally uses plaintext scaffolding to prove the data flow — that is expected and not a violation of the above.
- Native BTC (no bridge), encrypted orderbook (no leakage), and dark-UI polish are the differentiators — never cut them.

## Pinned versions
- Node.js 24 LTS, pnpm 9+
- Rust 1.93 stable, Anchor 0.31+
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
