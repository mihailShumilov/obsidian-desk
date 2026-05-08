# Deployment runbook

The canonical reference for putting ObsidianDesk in front of real users. The README has the 90-second story; this doc has the checklists, rollback procedures, and incident playbooks.

> **Status:** Solana program live on devnet at `H25y…beLp` (Anchor 1.0.2 / Rust 1.94 build). Real-mode Encrypt + Ika SDK wired against pre-alpha gRPC. Production deployment runs the docker-compose stack on a single VPS behind Cloudflare DNS + Caddy (§6) — that path serves `obsidiandesk.app`. Vercel / Fly.io are documented alternatives but unused for the live demo.

## What's deployed where

| Component | Deploy target | Pinned version / id |
|---|---|---|
| `obsidian-core` Solana program | Solana **devnet** | `H25yY5o4emorZ9qMHAUvJhdtrFjDSeYy2MVYurpQbeLp` |
| Encrypt program (vendor) | Solana devnet | `4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8` |
| Encrypt gRPC | Encrypt pre-alpha | `pre-alpha-dev-1.encrypt.ika-network.net:443` |
| Ika gRPC | Ika pre-alpha | `pre-alpha-dev-1.ika.ika-network.net:443` |
| Frontend (`app/`) | self-hosted VPS + Cloudflare (§6); also runs locally via Docker | <https://obsidiandesk.app> |
| Keeper (`keeper/`) | self-hosted VPS; also runs locally via Docker | n/a |
| Validator (dev only) | local container (`--profile local-rpc`, x86 only) or host process | `anzaxyz/agave:latest` |

## 1. Solana program → devnet

### 1.1 Pre-deploy checklist

- [ ] `cargo clippy --workspace -- -D warnings` is clean (we deliberately drop `--all-targets` to skip the `idl-build` cfg — see CI rationale)
- [ ] `anchor test` passes (4 e2e suites + program tests)
- [ ] `pnpm -F @obsidian-desk/sdk test` passes (offline, ~120 ms)
- [ ] The program-id literal in `programs/obsidian-core/src/lib.rs` `declare_id!()` matches `Anchor.toml [programs.devnet] obsidian_core`
- [ ] You have a backup of the upgrade authority keypair; loss = irreversible loss of the ability to redeploy at the same address
- [ ] Devnet wallet has at least 5 SOL (`solana balance --url devnet`)
- [ ] `anchor-cli` installed at 1.0.2 (`anchor --version` → `anchor-cli 1.0.2`). Install via `cargo install anchor-cli@1.0.2 --locked`; do **not** use avm.

### 1.2 Deploy

```bash
anchor build --no-idl --ignore-keys
# `--no-idl` because v1's IDL build is a separate `anchor idl build` step.
# `--ignore-keys` because target/deploy/obsidian_core-keypair.json is gitignored
# per-developer; the source-of-truth program id is the declare_id!() in lib.rs.

anchor deploy --provider.cluster devnet
# capture the printed Program ID — should equal the declare_id!()
```

If the program is already deployed at that ID, this becomes an upgrade (same upgrade authority required). Anchor tells you which.

### 1.3 Post-deploy verification

```bash
solana program show H25yY5o4emorZ9qMHAUvJhdtrFjDSeYy2MVYurpQbeLp --url devnet
# should print: Last Deployed In Slot: <recent>, Data Length, Authority

# upload the IDL so frontends can fetch it
anchor idl init --provider.cluster devnet --filepath target/idl/obsidian_core.json \
  H25yY5o4emorZ9qMHAUvJhdtrFjDSeYy2MVYurpQbeLp

# smoke test against devnet
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
  ANCHOR_WALLET=~/.config/solana/id.json \
  pnpm exec tsx scripts/seed-demo.ts
```

### 1.4 Rollback

Anchor program IDs are stable for the lifetime of the upgrade authority. To "roll back" you redeploy the previous binary:

```bash
git checkout <previous-tag>
anchor build
anchor deploy --provider.cluster devnet
```

There is no instant rollback; the deploy itself takes ~30 s on devnet. In an incident, prefer pushing a forward-fix to a buffer account (`solana program write-buffer`) and then `anchor upgrade`-ing in one transaction so users see the bug for the minimum window.

### 1.5 Migrating to mainnet

Out of scope for the hackathon. The path is the same as devnet but:

- A separate upgrade-authority keypair lives in cold storage (don't reuse the dev one).
- Fund the deployer wallet from a custodial source — never from a hot wallet that ever held devnet SOL.
- Add an entry to `Anchor.toml [programs.mainnet]` and bump the `declare_id!()` literal to the mainnet program id.

## 2. Frontend → Vercel (planned)

```bash
cd app
vercel link              # one-time, picks an org + project
vercel env add NEXT_PUBLIC_SOLANA_RPC production
vercel env add NEXT_PUBLIC_OBSIDIAN_PROGRAM_ID production
vercel env add NEXT_PUBLIC_OBSIDIAN_MARKET production   # optional — see below
vercel env add NEXT_PUBLIC_NETWORK production
vercel env add OBSIDIAN_ESPLORA_URL production
vercel --prod
```

`NEXT_PUBLIC_OBSIDIAN_MARKET` is the base58 PDA of the `MarketState` to submit orders into. When set, the /trade page bundles `submit_order` + `approve_btc_settlement` into a single wallet-adapter-signed transaction; when unset, the page falls back to the local-only stub flow (orders only exist in the user's tab). Initialize a market with `tsx keeper/scripts/devnet-bootstrap.ts` and copy the `[bootstrap] market=…` line into the env.

Vercel detects Next.js 16.2 zero-config. The `output: 'standalone'` in `app/next.config.ts` is required for the Docker fallback below; Vercel itself uses its own runtime.

### Rollback on Vercel

Vercel keeps every prod deployment as an immutable URL. From the dashboard, go to Deployments → pick the previous green one → "Promote to Production". Rollback is instant.

## 3. Frontend → Fly.io (Docker fallback)

Use this when Vercel isn't an option (e.g. you need a longer-lived edge or your own region).

```bash
fly launch --no-deploy --copy-config --dockerfile app/Dockerfile
fly secrets set NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com \
                NEXT_PUBLIC_OBSIDIAN_PROGRAM_ID=H25yY5o4emorZ9qMHAUvJhdtrFjDSeYy2MVYurpQbeLp \
                NEXT_PUBLIC_OBSIDIAN_MARKET=<market-pda-base58> \
                NEXT_PUBLIC_NETWORK=devnet \
                OBSIDIAN_ESPLORA_URL=https://mempool.space/signet/api
fly deploy
```

Resource floor: 256 MB RAM is enough for a single Next instance under modest traffic.

## 3.5 Real-mode SDK (Encrypt + Ika devnet)

`sdk/src/encrypt.ts` and `sdk/src/ika.ts` ship two modes:

| Mode | Effect |
|---|---|
| `mock` (default) | In-process FHE / DKG simulation. Plaintext-recoverable from the mock ciphertexts. Suitable for offline tests. |
| `real` | Routes to the upstream gRPC services on Solana devnet. Real ciphertext IDs from Encrypt; real secp256k1 dWallet keys from Ika DKG. |

Flip via env vars:

```bash
OBSIDIAN_ENCRYPT_MODE=real OBSIDIAN_IKA_MODE=real \
  OBSIDIAN_ENCRYPT_GRPC_URL=pre-alpha-dev-1.encrypt.ika-network.net:443 \
  OBSIDIAN_ENCRYPT_PROGRAM_ID=4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8 \
  OBSIDIAN_IKA_GRPC_URL=pre-alpha-dev-1.ika.ika-network.net:443 \
  pnpm dev
```

Smoke test the live integration:

```bash
pnpm -F @obsidian-desk/sdk build
node sdk/scripts/devnet-smoke.mjs
```

Expected output: 4 green checks (encryptU64, encryptOrder, createDWallet,
lockPolicy). Each line shows the real-mode artifact (ciphertext id,
btc address) returned by devnet.

**What's still pending in real mode** (tracked in `docs/gaps.md`):
- **E2-residual** — `try_match → execute_graph` CPI fails at depth 2 with a
  signer/writable demotion in `encrypt-anchor` 0.1.0's `invoke_execute_graph`.
  The on-chain DSL graph (`match_orders_graph` via `#[encrypt_fn]`) and the
  22-account instruction shape are complete; closure is upstream-blocked or
  needs a vendored CPI helper.
- **I1** — `lockPolicy` doesn't yet write to the on-chain Ika program; it
  stores the policy intent in the SDK process for the keeper to pick up.
- **I3** — `finalize_settlement` is permissionless (no keeper-authority
  PDA gate). Will land paired with SPV proof verification.

E1, E3, E4, E5, I0 are **closed** — `EncryptedOrder` holds 32-byte ciphertext refs, settlement is split into `request_decryption` + `finalize_decryption` with on-chain digest verification, and the upstream Encrypt + Ika gRPC clients run via `pnpm patch` + vendoring respectively.

The `assertNotMockOnMainnet` boot guard remains the backstop against
running mock mode against any mainnet RPC.

## 3.6 Keeper matching loop (try_match → request_decryption → finalize_decryption)

The keeper drives matching against the on-chain Encrypt program via
`execute_graph` CPI. Two surfaces ship today:

**`runMatchCycle(program, market, pair, keeperAuthority, payer, opts)`** —
exported from `keeper/src/matching.ts`. Runs one full cycle for a chosen
pair of order PDAs. Allocates 3 fresh ciphertext keypair accounts, builds
the 22-account `try_match` instruction (market + 2 orders + match_intent
+ 6 input cts + 3 output cts + 7 EncryptContext PDAs + keeper_authority +
payer + system_program), waits for the executor to flip each output to
`status=VERIFIED`, calls `request_decryption` (snapshots digests), reads
the 3 plaintexts off-chain via gRPC, and submits `finalize_decryption`.

**`tsx keeper/scripts/match-pair.ts <market> <orderA> <orderB>`** — CLI
wrapper around `runMatchCycle`. Run against devnet to exercise the full
flow end-to-end:

```bash
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
  ANCHOR_WALLET=~/.config/solana/keeper.json \
  pnpm exec tsx keeper/scripts/match-pair.ts \
    <MARKET_PDA> <ORDER_A_PDA> <ORDER_B_PDA>
```

The script logs each phase (try_match, executor wait, request_decryption,
gRPC reads, finalize_decryption) so an operator can pinpoint failures.
Local-validator runs fail at "Encrypt config not found" because the
Encrypt program is only deployed on devnet — that is the expected
behaviour for local testing.

**Settlement-to-BTC** still flows through `pollOnce` in `keeper/src/poll.ts`,
which the daemon (`keeper/src/index.ts`) calls every 3 seconds. The
matching cycle and the settlement cycle are decoupled: a `MatchRecord`
written by `finalize_decryption` lands in the same memcmp-filtered
`pollOnce` queue the daemon already drives.

## 4. Keeper → Fly.io (planned)

```bash
cd keeper
fly launch --no-deploy --copy-config --dockerfile keeper/Dockerfile
fly secrets set ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
                OBSIDIAN_PROGRAM_ID=H25yY5o4emorZ9qMHAUvJhdtrFjDSeYy2MVYurpQbeLp \
                OBSIDIAN_IKA_MODE=mock
fly secrets set ANCHOR_WALLET_JSON="$(cat ~/.config/solana/keeper.json)"
fly deploy
fly scale count 1 --vm-size shared-cpu-1x --vm-memory 512
```

Mount the keypair into the container at `/data/keeper.json` via a Fly secret + an entrypoint script that writes `$ANCHOR_WALLET_JSON` to disk on boot. Single instance — the keeper is idempotent at the per-MatchRecord level (settled records are skipped) but two parallel instances will both fight to call `finalize_settlement` and pay for losing transactions.

## 5. Run the prod stack locally, pointed at Solana devnet

Use this **before** §6 — it's the dry run. Same compose files, same images, same env shape, just running on your laptop with a public Solana devnet RPC instead of a host validator. The whole point of this section is: if §5 works on your laptop, §6 (the VPS) is the same recipe with a Caddy + Cloudflare wrapper around it. Anything that breaks at §5 will break at §6 too — fix it here first.

The dev compose file (`docker-compose.yml`) defaults to `localhost:18899` (host validator). The prod overlay (`docker-compose.prod.yml`) drops the validator entirely and pulls all RPCs from environment variables. We run **both** files together so the overlay's strict env-required defaults override the dev file's localhost defaults.

### 5.1 Prereqs (laptop)

- Docker Desktop ≥ 4.25 with Compose v2 (`docker compose version` → v2.x)
- A funded Solana keypair on devnet (the keeper will sign with it). Quickest path:
  ```bash
  solana-keygen new --no-bip39-passphrase -o ./scripts/.keeper-keypair.json
  solana airdrop 2 --url devnet --keypair ./scripts/.keeper-keypair.json
  solana balance --url devnet --keypair ./scripts/.keeper-keypair.json   # ≥ 1 SOL
  ```
- The Anchor IDL on disk at `target/idl/obsidian_core.json`. The keeper bind-mounts this read-only — without it, the keeper container crash-loops with "missing IDL". Build once on the host:
  ```bash
  anchor build --no-idl --ignore-keys
  # then explicitly request the v1 IDL artifact:
  anchor idl build > target/idl/obsidian_core.json
  ```
  (If you already have a built IDL committed somewhere or pulled from CI, a manual copy works equally well.)

### 5.2 Image source — local build OR GHCR pull

Pick one. The compose overlay defaults to `ghcr.io/mihailshumilov/obsidian-{app,keeper}:${IMAGE_TAG:-latest}`.

**Option A — pull from GHCR** (matches the VPS path exactly, fewer moving parts on your laptop):

```bash
docker login ghcr.io -u <your-github-username>   # only needed if the package is private
# .env.local-devnet sets IMAGE_TAG; the overlay does the pull on `up`.
```

**Option B — build locally** (faster iteration when you're changing app/keeper code):

```bash
docker compose build app keeper
# overrides the GHCR pull for THIS compose run; `pull_policy: always` in the
# overlay still tries to pull on `up`, so add --pull=never to keep the local
# images.
```

If you build locally, append `--pull=never` to the `up` command below; otherwise compose will pull and replace your fresh build.

### 5.3 Write `.env.local-devnet`

```bash
cp .env.example .env.local-devnet
```

Then edit it to point at devnet:

```ini
# RPC — both vars must be the same URL, both must be reachable from your
# laptop. The browser hits NEXT_PUBLIC_SOLANA_RPC; the keeper hits SOLANA_RPC.
NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com
SOLANA_RPC=https://api.devnet.solana.com

# Pinned program. Do NOT change unless you've redeployed obsidian-core to
# devnet under a different declare_id!() — and updated Anchor.toml + lib.rs
# in lockstep.
OBSIDIAN_PROGRAM_ID=H25yY5o4emorZ9qMHAUvJhdtrFjDSeYy2MVYurpQbeLp
NEXT_PUBLIC_NETWORK=devnet
OBSIDIAN_ESPLORA_URL=https://mempool.space/signet/api

# Image tag — only consulted if you went with §5.2 Option A (GHCR pull).
# `latest` floats; pin to a sha or semver in production.
IMAGE_TAG=latest

# Keeper signer — absolute path on the laptop. The compose `secrets` block
# reads the file from this path and mounts it at /run/secrets/keeper_keypair.json
# inside the container.
KEEPER_KEYPAIR_PATH=/Users/<you>/path/to/encrypt-ika-obsidian-desk/scripts/.keeper-keypair.json
```

For anything resembling real traffic, replace the public `api.devnet.solana.com` with a Helius / Triton / QuickNode devnet endpoint — the public RPC is heavily rate-limited and the wallet adapter will drop connections under load. Do this **here**, on your laptop, so you discover the rate limit before the VPS does.

The `assertNotMockOnMainnet` guard inside the SDK refuses to boot if `OBSIDIAN_*_MODE=mock` is paired with a mainnet RPC. Real-mode (`OBSIDIAN_*_MODE=real`) is also wired and works against devnet — see §3.5. The compose overlay currently hardcodes `mock` for the demo path; flip via env override on the `up` command if you want the live integration.

### 5.4 Start the stack

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --env-file .env.local-devnet up -d
docker compose ps        # both services should reach `healthy` within ~60 s
docker compose logs -f --tail 50 keeper   # watch the first match-poll cycle
```

If you opted for Option B (local build), the command is:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --env-file .env.local-devnet up -d --pull=never
```

### 5.5 Smoke checks

Run these before declaring the local devnet run "good". Each one corresponds to a class of failure that's much cheaper to debug on a laptop than on a VPS at 3 AM.

```bash
# 1. health endpoints respond on the host ports (note the project's offset port scheme)
curl -fsS http://127.0.0.1:13000/api/health           # → 200 {"ok":true}
curl -fsS http://127.0.0.1:13001/status | jq          # → keeper /status JSON

# 2. the keeper actually reaches devnet (look for "[keeper] poll cycle" lines without errors)
docker compose logs keeper --tail 30

# 3. the app proxies devnet RPC through the wallet adapter — open the browser
open http://127.0.0.1:13000   # macOS; or use your browser
#    → connect Phantom (devnet selected)
#    → /trade should render the depth card without console errors
#    → /deposit wizard should reach step 2 (signet address rendered)

# 4. the keeper's signer has SOL on devnet
solana balance --url devnet --keypair "$KEEPER_KEYPAIR_PATH"

# 5. the program is reachable from the laptop's Solana CLI
solana program show H25yY5o4emorZ9qMHAUvJhdtrFjDSeYy2MVYurpQbeLp --url devnet
```

If `curl /status` returns the keeper JSON but `attempted` stays at 0 forever, see §8 "Match never settles". If the browser console shows ECONNREFUSED on the wallet RPC, the `NEXT_PUBLIC_SOLANA_RPC` value is wrong — env vars prefixed `NEXT_PUBLIC_` are inlined into the build, so a hard-refresh after editing `.env.local-devnet` is required. (For locally-built images, that means `docker compose build app` again.)

### 5.6 Tear down

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --env-file .env.local-devnet down
# add `-v` to also drop the solana-ledger volume (only matters if you ever
# enabled the `local-rpc` profile during this run).
```

### 5.7 (Optional) Build & push images to GHCR

Skip this if you're staying with `IMAGE_TAG=latest` from CI. When you want to pin the VPS to a specific build, push it explicitly:

```bash
docker login ghcr.io -u <your-github-username>

VERSION=v0.2.0
docker buildx build --platform linux/amd64,linux/arm64 \
  -f app/Dockerfile -t ghcr.io/mihailshumilov/obsidian-app:$VERSION \
  --push .

docker buildx build --platform linux/amd64,linux/arm64 \
  -f keeper/Dockerfile -t ghcr.io/mihailshumilov/obsidian-keeper:$VERSION \
  --push .
```

Then set `IMAGE_TAG=v0.2.0` in `.env.local-devnet`, re-run the §5.4 `up -d`, and verify `docker compose images` shows the digest you just pushed.

Once §5.5's smoke checks all pass on your laptop, you have a working devnet deployment. **§6 is the same compose command on a different host, plus Caddy + Cloudflare in front.**

## 6. Move the same stack to a VPS (Cloudflare DNS in front)

The compose stack from §5 is portable: the VPS runs the *exact same* `docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production up -d` command. What changes is the host environment around it:

| Concern | Local laptop (§5) | VPS (§6) |
|---|---|---|
| Where the stack runs | Docker Desktop | Docker Engine on Linux |
| Inbound traffic | nothing — you `curl 127.0.0.1` | Caddy on `:80/:443` reverse-proxies to `127.0.0.1:13000` |
| TLS | none | Let's Encrypt via Caddy (or Cloudflare Origin CA — §6.8) |
| DNS | none | Cloudflare A record, proxied (orange cloud) |
| Keeper signer | a keypair file at `KEEPER_KEYPAIR_PATH` | same shape, generated **on the VPS** (never copied across machines) |
| RPC | public devnet from your ISP | public devnet from the VPS — same URL, different egress |
| Process supervision | `docker compose` in the foreground | `docker compose ... -d` + Docker daemon's restart policy |
| Logs | `docker compose logs -f` | `journalctl -u docker` for the daemon, `docker compose logs` for the services |
| Failure mode | "fix it on your laptop" | "ssh in, fix it, restart" — every minute is a downtime minute |

Because §5 and §6 are the same compose recipe, the most useful debugging move on the VPS is to fall back to running §5.4 from the project root *on the VPS itself* (no Caddy, no DNS) and `curl 127.0.0.1:13000/api/health` from the VPS shell. If that works, the bug is in Caddy / Cloudflare / DNS. If it doesn't, the bug is in env / RPC / image — same diagnostic flow as on your laptop.

The §6 sub-sections walk through provisioning the host, putting the same compose stack on it, then layering TLS + DNS.

### 6.1 Minimum requirements

Mock-mode Encrypt/Ika keeps the footprint small; the app is a standalone Next.js 16 server and the keeper is a thin Node process.

| Resource | Minimum | Recommended | Notes |
|---|---|---|---|
| vCPU | 1 | 2 | idles under 10 %; spikes during match bursts |
| RAM | 1 GB | 2 GB | compose limits: app 512 MB, keeper 256 MB → leave ~1 GB for OS + reverse proxy |
| Disk | 10 GB SSD | 20 GB | images ≈ 500 MB total; bulk is logs + IDL |
| Arch | `x86_64` | `x86_64` | GHCR images are multi-arch (amd64 + arm64) — arm64 works, amd64 is the tested path |
| OS | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS | Debian 12 also fine |
| Network | 1 public IPv4, ports 22 / 80 / 443 | + IPv6 | outbound to Solana RPC + `mempool.space` |
| Domain | Cloudflare-managed zone | — | nameservers on Cloudflare so DNS + proxy + cert tools line up |

Providers that fit at this size (all ≤ $5 / mo): Hetzner CX22, DigitalOcean 1 GB droplet, OVH VPS Starter, Vultr Cloud Compute 1 GB.

### 6.2 Provision and harden the host

```bash
# as root on a fresh Ubuntu 24.04 LTS VPS:
apt update && apt upgrade -y
apt install -y curl ca-certificates ufw fail2ban

# deploy user
adduser --gecos '' obsidian
usermod -aG sudo obsidian
install -d -m 700 -o obsidian -g obsidian /home/obsidian/.ssh
cp ~/.ssh/authorized_keys /home/obsidian/.ssh/
chown obsidian:obsidian /home/obsidian/.ssh/authorized_keys
chmod 600 /home/obsidian/.ssh/authorized_keys

# SSH: key-only, no root
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/'        /etc/ssh/sshd_config
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh

# firewall: only SSH + HTTP(S) on the public edge
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

The compose stack binds `13000` and `13001` but we will **not** open those in `ufw` — Caddy reverse-proxies to them over loopback.

### 6.3 Install Docker Engine + compose plugin

```bash
# as root
curl -fsSL https://get.docker.com | sh
usermod -aG docker obsidian
docker compose version   # expect v2.x
```

### 6.4 Clone the repo and write `.env.production`

Push any local commits to GitHub first — the VPS will clone from the remote, not from your laptop. This is the implicit checkpoint between §5 and §6: whatever code §5 was running locally must be on `main` (or the tag you intend to deploy).

```bash
# on your laptop
git push origin main

# on the VPS as obsidian
git clone https://github.com/mihailShumilov/obsidian-desk.git obsidian-desk
cd obsidian-desk
cp .env.example .env.production
```

`.env.production` is the **VPS twin** of `.env.local-devnet` from §5.3 — same variables, same values, different `KEEPER_KEYPAIR_PATH` (the VPS path), and `IMAGE_TAG` is pinned (don't ship `latest` to a public host):

```ini
NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com
SOLANA_RPC=https://api.devnet.solana.com
OBSIDIAN_PROGRAM_ID=H25yY5o4emorZ9qMHAUvJhdtrFjDSeYy2MVYurpQbeLp
NEXT_PUBLIC_NETWORK=devnet
OBSIDIAN_ESPLORA_URL=https://mempool.space/signet/api
IMAGE_TAG=v0.2.0
KEEPER_KEYPAIR_PATH=/home/obsidian/secrets/keeper-keypair.json
```

If §5 used a Helius / Triton / QuickNode endpoint, copy the same URL here — the rate limit you fixed at §5.3 does not heal itself on the VPS.

### 6.5 Provision keeper signer + IDL

The keeper needs a funded Solana keypair and the Anchor IDL on disk (bind-mounted at `target/idl/obsidian_core.json`, see `docker-compose.yml`).

**Keypair — generate ON the VPS.** Never copy a keypair off your laptop; if it leaks once, the laptop's filesystem snapshots, Time Machine backups, and shell history all become incident-response surface.

```bash
# on the VPS as obsidian
install -d -m 700 ~/secrets
curl -sSfL https://release.anza.xyz/stable/install | sh
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
solana-keygen new --no-bip39-passphrase -o ~/secrets/keeper-keypair.json
chmod 600 ~/secrets/keeper-keypair.json
solana airdrop 2 --url devnet --keypair ~/secrets/keeper-keypair.json
```

**IDL — copy from your workstation** after a fresh `anchor build` (the VPS doesn't need the Rust toolchain just to consume an IDL):

```bash
# on your laptop
anchor build --no-idl --ignore-keys
anchor idl build > target/idl/obsidian_core.json
rsync -av target/idl/ obsidian@<vps-ip>:/home/obsidian/obsidian-desk/target/idl/
```

If you'd rather avoid `rsync`, commit a built IDL into a release artifact and `wget` it on the VPS — the only requirement is that `target/idl/obsidian_core.json` exists at the path the compose file bind-mounts.

### 6.6 Start the stack

This is the same compose command from §5.4 — only the env file name and the working directory change.

```bash
# on the VPS as obsidian
cd ~/obsidian-desk
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --env-file .env.production pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --env-file .env.production up -d
docker compose ps   # both services reach "healthy" within ~60 s
```

Run the §5.5 smoke checks **on the VPS loopback** before any public DNS flips. If any of these fail, you have a §5-class bug, not a §6-class bug — fix it here without involving Caddy or Cloudflare:

```bash
curl -fsS http://127.0.0.1:13000/api/health
curl -fsS http://127.0.0.1:13001/status | jq
docker compose logs --tail 50 keeper
solana balance --url devnet --keypair ~/secrets/keeper-keypair.json
solana program show H25yY5o4emorZ9qMHAUvJhdtrFjDSeYy2MVYurpQbeLp --url devnet
```

### 6.7 Reverse proxy with Caddy

Caddy is the shortest path to TLS: one file, one directive per host, auto-issued Let's Encrypt certs.

```bash
# as root
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | \
  gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | \
  tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

`/etc/caddy/Caddyfile`:

```caddyfile
obsidiandesk.app {
    encode zstd gzip
    reverse_proxy 127.0.0.1:13000
}

# Optional — expose the keeper /status JSON on its own subdomain.
# Leave commented-out if you want the keeper strictly internal.
# keeper.obsidiandesk.app {
#     reverse_proxy 127.0.0.1:13001
# }
```

```bash
systemctl reload caddy
journalctl -u caddy -n 50 | grep -i 'certificate obtained'
```

### 6.8 Cloudflare DNS + SSL mode

In the Cloudflare dashboard for the `obsidiandesk.app` zone:

1. **DNS → Records**
   - `A` record: name `@` (apex), IPv4 = VPS public IP, **Proxy status: Proxied** (orange cloud). Cloudflare will serve the site at `obsidiandesk.app`.
   - `CNAME` record: name `www`, target `obsidiandesk.app`, Proxied — for the `www.obsidiandesk.app` redirect handled at the Caddy site block.
   - `AAAA` record (if your VPS has IPv6): name `@`, same proxy setting.
   - `A`/`AAAA` record: name `keeper`, same IP, Proxied — only if you exposed the keeper subdomain in step 6.7. Otherwise leave the keeper strictly internal.
2. **SSL/TLS → Overview** → set mode to **Full (strict)**. Never ship `Flexible` — it terminates TLS at the edge and talks to your origin in plaintext.
3. **SSL/TLS → Edge Certificates** → enable `Always Use HTTPS` and `Automatic HTTPS Rewrites`.
4. **Caching → Cache Rules** → add a rule that bypasses cache for `/api/*` and any path containing `_next/data` — server-rendered content and the health endpoint must not be edge-cached.

Optional lockdown — swap Let's Encrypt for a **Cloudflare Origin CA** cert if you want the VPS to reject any non-Cloudflare traffic:

- Cloudflare → SSL/TLS → **Origin Server → Create Certificate** (15-year validity).
- Save the PEM + key at `/etc/caddy/origin.pem` / `/etc/caddy/origin.key` (root-owned, `0600`).
- Replace the Caddyfile site with:

  ```caddyfile
  obsidiandesk.app {
      tls /etc/caddy/origin.pem /etc/caddy/origin.key
      reverse_proxy 127.0.0.1:13000
  }
  ```

- Optionally add an IP allowlist that rejects anything not in [Cloudflare's published IP range](https://www.cloudflare.com/ips/). Direct IP scanners now get a TLS handshake error instead of your app.

### 6.9 Verify end-to-end

```bash
# DNS resolves through Cloudflare (expect CF edge IPs, not the VPS IP)
dig +short obsidiandesk.app

# TLS terminates cleanly, CF proxy stamps cf-ray
curl -I https://obsidiandesk.app/api/health
# expected: HTTP/2 200, cf-ray: <hex>-<airport-code>
```

Browser check: open `https://obsidiandesk.app`, connect a Phantom wallet on devnet, confirm the network chip reads `devnet`, the Depth card renders, the deposit wizard opens.

### 6.10 Updates and rollback

The release flow is **always laptop-first** — verify against §5 before the VPS sees it. Skipping the laptop step here is how you ship a regression that 3 AM-you has to debug.

```bash
# 1. on your laptop: pull & smoke-test against devnet (§5.4 + §5.5)
git checkout v0.2.0
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --env-file .env.local-devnet pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --env-file .env.local-devnet up -d
# run the §5.5 smoke checks. If anything fails, this release does NOT
# go to the VPS.

# 2. push the tag
git push origin v0.2.0

# 3. on the VPS: same compose command, against .env.production
ssh obsidian@<vps-ip>
cd ~/obsidian-desk
git fetch && git checkout v0.2.0
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=v0.2.0/' .env.production
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --env-file .env.production pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --env-file .env.production up -d

# 4. verify (§6.6 + §6.9)
curl -fsS http://127.0.0.1:13000/api/health
curl -I  https://obsidiandesk.app/api/health
```

Rollback is the same flow with the previous `IMAGE_TAG`. Expect ~5 s of 502s during the app container swap; Caddy retries upstream, so most browsers never see it. If the rollback itself doesn't recover within a minute, fall back to `docker compose stop app keeper && docker compose ... up -d` to force a fresh container start; the volumes are stateless and survive that.

### 6.11 Alternative — Cloudflare Tunnel (no open inbound ports)

If you'd rather not expose the VPS IP at all, swap Caddy + the DNS `A` record for `cloudflared`:

```bash
# on the VPS
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb \
  -o cloudflared.deb
sudo dpkg -i cloudflared.deb
cloudflared tunnel login                          # browser auth
cloudflared tunnel create obsidian-desk
cloudflared tunnel route dns obsidian-desk obsidiandesk.app
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: <tunnel-uuid>
credentials-file: /home/obsidian/.cloudflared/<tunnel-uuid>.json
ingress:
  - hostname: obsidiandesk.app
    service: http://127.0.0.1:13000
  - hostname: keeper.obsidiandesk.app
    service: http://127.0.0.1:13001
  - service: http_status:404
```

```bash
sudo cloudflared service install   # systemd unit
```

With the tunnel you can tighten `ufw` further — no port 80 / 443 inbound, only `22/tcp` — and remove the DNS `A` record entirely. Cloudflare routes the hostname to the tunnel instead.

## 7. Monitoring

Today the keeper exposes a single `/status` JSON endpoint and a `[keeper:metrics]` stdout tick every 30 s. To wire that into a real monitoring stack:

```yaml
# Prometheus scrape (when we add a /metrics endpoint in a future P-prompt)
scrape_configs:
  - job_name: obsidian-keeper
    metrics_path: /metrics
    static_configs:
      - targets: ['keeper.internal:3001']
```

Sample alerts to start with (PromQL once we expose Prometheus metrics):

| Alert | Condition | Severity |
|---|---|---|
| Keeper down | `up{job="obsidian-keeper"} == 0` for 5m | page |
| Settlement error rate | `rate(obsidian_keeper_failed_total[10m]) > 0.05` | warn |
| Match queue stalled | `obsidian_keeper_attempted_total` flat for 30m AND active orders > 0 | page |
| BTC confirmation lag | `histogram_quantile(0.95, obsidian_btc_confirmation_seconds) > 600` | warn |

The keeper's `/status` already exposes `attempted/settled/failed/lastError`; converting those into Prometheus counters is a small `prom-client` integration.

## 8. Incident playbooks

### Keeper crashes in a loop

1. `docker compose logs --tail 200 keeper` (or `fly logs`)
2. Most common cause: the IDL on disk doesn't match the deployed program. Re-run `anchor build && anchor deploy` to regenerate `target/idl/obsidian_core.json` and restart the keeper container.
3. Second-most-common: bad `ANCHOR_WALLET` (file missing, wrong format). Verify with `solana balance --keypair $ANCHOR_WALLET`.

### Encrypt or Ika devnet outage

While we're in mock mode, this can't happen. Once we go to real backends:

1. Confirm the outage on the vendor's status page.
2. Set `OBSIDIAN_ENCRYPT_MODE=mock` (or `OBSIDIAN_IKA_MODE=mock`) on the keeper + app and restart. The system stays available; ciphertexts created during the outage will need to be re-submitted once real mode is restored (mock blobs aren't compatible with real verification).
3. Post a banner in the UI (TODO: needs a server-driven kill-switch flag — file an issue).

### "Match never settles" but the keeper looks healthy

1. `curl http://<keeper>/status` — does `attempted` increment? If yes, but `settled` doesn't, look at `lastError`.
2. Most common cause: the dWallet for one of the legs isn't in the keeper's mock store (gap I2). The e2e tests inject the same SDK instance into the keeper to share state — that's not possible across separate processes today.
3. Workaround for the demo: use the `?admin=1` "Match all" / "Fast" buttons on `/trade` to drive the matching from the browser instead.

### Frontend works but the wallet button does nothing

1. Check the browser console — `ConnectionProvider` failures show up as ECONNREFUSED on the configured RPC.
2. Verify `NEXT_PUBLIC_SOLANA_RPC` is reachable from the browser (NOT from the server). Browsers can't resolve docker network aliases like `solana-validator:8899`.
3. Hard-refresh after changing env vars — they're inlined into the build.

## 9. Security checklist

- [ ] Upgrade authority keypair lives in a hardware wallet or cold storage; never on the deploy machine
- [ ] `OBSIDIAN_PROGRAM_ID` is the same in `Anchor.toml`, `lib.rs declare_id!()`, and every `.env*` file (CI verifies)
- [ ] Keeper signing keypair is provisioned via secrets manager (Fly secrets / Vercel env scoped to "production"), never committed
- [ ] No `console.log` of plaintext order data in production builds (`grep -r 'plaintext\|priceUsdc\|sizeBtc' app/.next/server/` after `pnpm build`)
- [ ] `app/Dockerfile` runs as non-root (`USER nextjs`); keeper does the same (`USER keeper`)
- [ ] `.dockerignore` excludes `.env*` (verified — `.env.example` is the only exception, and it has no secrets)
- [ ] CSP headers set in `app/middleware.ts` to lock down inline scripts (TODO — open issue)

## 10. Cost estimates

For the hackathon-scale demo (1 prod instance per service, ≈ 50 unique visitors / day):

| Provider | Service | Plan | Monthly |
|---|---|---|---|
| Vercel | Next.js Hobby | free | $0 |
| Fly.io | Keeper (256 MB shared-cpu-1x) | hobby | ~$2 |
| Solana devnet | Program rent + tx fees | n/a | <$5 in airdropped SOL |
| mempool.space | Signet esplora | public, rate-limited | $0 |
| GHCR | Image storage (≤ 5 GB) | free under 500 MB | $0 |
| Single VPS (alt. to Vercel + Fly) | 1 vCPU / 2 GB (Hetzner, DO, OVH, Vultr) | basic | $4–6 |
| Cloudflare | DNS + proxy + TLS for 1 zone | Free plan | $0 |

Total: **~$2–5/mo** on the Vercel + Fly path, or **~$5–7/mo** on the single-VPS path (§6), while we stay on devnet + signet. Mainnet adds Solana rent + real BTC for fees and is materially different — re-cost when crossing that line.

## 11. Where else to look

- [`README.md`](../README.md) — quick start + project overview
- [`docs/DEVELOPMENT.md`](DEVELOPMENT.md) — daily-driver developer playbook
- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — full system design
- [`docs/gaps.md`](gaps.md) — known SDK + program gaps with workarounds
