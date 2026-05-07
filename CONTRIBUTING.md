# Contributing to ObsidianDesk

Thanks for your interest. This is a small hackathon-era codebase organized around the eleven prompts in [`docs/PROMPTS.md`](docs/PROMPTS.md); contributions that fit that grain are easiest to land.

## Branching model

- `main` is the only long-lived branch and is always green (CI passes, all builds reproducible).
- Feature work goes on a short-lived branch off `main`: `feat/<scope>`, `fix/<scope>`, `docs/<scope>`. Merge via squash PR.
- No release branches, no GitFlow. The project is small enough that trunk-based development is the right cadence.

## Commit messages

Conventional Commits, lowercase scope:

```
P9: e2e harness, seed-demo, admin mode, keeper metrics
fix(keeper): IDL mount path matches process.cwd
docs(readme): mark P10 done in roadmap
```

Prefix with the prompt id (`P1`–`P11`) when the change implements one of the source-of-truth prompts. For incidental fixes, use `fix(scope):`, `feat(scope):`, `docs(scope):`, `chore(scope):`.

Avoid AI/Claude/Anthropic attribution lines (`Co-Authored-By: Claude` etc.) per project policy.

## Toolchain pins

Match these or the program/build will diverge:

- Rust **1.94** stable (pinned in `rust-toolchain.toml`)
- Anchor **1.0.2** — install via `cargo install anchor-cli@1.0.2 --locked`. Do **not** use `avm` (rate-limit'ed from CI; we removed the avm install path).
- `programs/obsidian-core/Cargo.toml` is on `edition = "2021"` (not `"2024"` like upstream) because anchor-cli 1.0.2's manifest parser doesn't yet recognise `2024`.
- Node.js 24 LTS, pnpm 9.15.4
- The app must be on **React 19.1+** (see CLAUDE.md "Pinned versions" for the React 18 incompatibility with Next 16).

## Local CI checks

Run these before pushing — they mirror what `.github/workflows/ci.yml` runs against your PR:

```bash
# typecheck across all 3 ts workspaces (sdk + app + keeper)
pnpm -F @obsidian-desk/sdk build      # build SDK first so types resolve
pnpm typecheck

# next.js production build
pnpm -F @obsidian-desk/app build

# anchor + clippy
cargo clippy --workspace -- -D warnings   # NB: no --all-targets — that pulls in
                                          # the idl-build cfg which trips macro-
                                          # generated lints we can't fix locally.
anchor build --no-idl --ignore-keys       # --ignore-keys: program keypair file
                                          # is gitignored; declare_id!() is the
                                          # source of truth.
```

For full anchor tests you'll need a local validator:

```bash
solana-test-validator --rpc-port 18899 --bind-address 127.0.0.1 --reset
anchor deploy --provider.cluster http://127.0.0.1:18899
anchor test --skip-local-validator
```

For real-mode (Encrypt + Ika devnet) smoke:

```bash
pnpm -F @obsidian-desk/sdk build
node sdk/scripts/devnet-smoke.mjs
# expect 4 green checks; this hits live pre-alpha gRPC and is NOT in CI.
```

## PR checklist

Before opening a PR:

- [ ] `pnpm typecheck` is green
- [ ] `pnpm -F @obsidian-desk/app build` succeeds
- [ ] `cargo clippy --workspace -- -D warnings` is clean
- [ ] If you touched `programs/`, `anchor test` passes
- [ ] If you touched the SDK, `pnpm -F @obsidian-desk/sdk test` passes
- [ ] If you touched the SDK's encrypt or ika modules, `node sdk/scripts/devnet-smoke.mjs` is green (real-mode)
- [ ] You did NOT introduce any backwards-compat shim, fallback, or dead-code path "just in case"
- [ ] You did NOT mock data at boundaries that already work — match what the existing tests do
- [ ] Commit message starts with a P-prompt id or a `fix/feat/docs/chore` scope
- [ ] No AI attribution lines in commits or files

In the PR description, link to the docs you changed (or note "no doc changes needed because…").

## Working with the prompt system

Most non-trivial changes ought to fit one of the eleven prompts in [`docs/PROMPTS.md`](docs/PROMPTS.md). When implementing a prompt:

1. Re-read the prompt verbatim (it tells you the acceptance criteria).
2. Re-read the matching week in [`docs/INSTRUCTIONS.md`](docs/INSTRUCTIONS.md) (it tells you what the broader deliverable looks like).
3. Cross-check API calls against [`docs/vendor/`](docs/vendor/) (the Encrypt + Ika SDK references).
4. Implement, run the local CI checks above, commit with the `P<n>:` prefix.

If the upstream vendor SDKs differ from what the prompt assumes, prefer adapting the implementation to the real API (and updating the adapter in `sdk/src/`) over forcing the wrong API into the program. The adapter is what insulates us from vendor breakage — keep its shape stable so callers don't churn.

## Adding a new prompt

If a feature genuinely doesn't fit P1–P11, that's fine — open an issue first to discuss whether to extend `docs/PROMPTS.md` (preferred for hackathon-coherent work) or land the change as a one-off PR.

## Code style

- TypeScript: project uses strict mode. No `any`. Prefer named functions over arrows for top-level exports (cleaner stack traces).
- React: server components by default; only opt into `'use client'` when you need browser globals or hooks.
- Comments: only the WHY, not the WHAT. If a future reader can derive it from the code, leave it out.
- Animations: respect `prefers-reduced-motion`; default `200ms ease [0.16, 1, 0.3, 1]`; no spring physics outside the explicit `<SettleThread>` use.

## Reporting bugs / requesting features

Open a GitHub issue with:

- What you expected.
- What actually happened.
- The minimal repro (paste relevant logs, screenshots if visual).
- Your environment (OS, node version, docker version).

For security-sensitive issues (signer leakage, ciphertext exposure, anything that could compromise a real dWallet), please email the maintainers directly rather than opening a public issue.
