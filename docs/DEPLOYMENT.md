# Deployment runbook

The canonical reference for putting ObsidianDesk in front of real users. The README has the 90-second story; this doc has the checklists, rollback procedures, and incident playbooks.

> **Status (P11):** Today we have working dev + prod docker-compose stacks and an `anchor deploy` story for devnet. Vercel/Fly.io specifics are documented as the planned path; wiring real GitHub Actions secrets and pushing to those providers happens manually after the hackathon submission cutoff.

## What's deployed where

| Component | Deploy target | Pinned version / id |
|---|---|---|
| `obsidian-core` Solana program | devnet (manually via `anchor deploy`) | `H25yY5o4emorZ9qMHAUvJhdtrFjDSeYy2MVYurpQbeLp` |
| Frontend (`app/`) | (planned) Vercel; today: local Docker | n/a |
| Keeper (`keeper/`) | (planned) Fly.io; today: local Docker | n/a |
| Validator (dev only) | local container or host process | `anzaxyz/agave:stable` (x86 only) |

## 1. Solana program → devnet

### 1.1 Pre-deploy checklist

- [ ] `cargo clippy --workspace --all-targets -- -D warnings` is clean
- [ ] `anchor test` passes (5 suites, ~11 s)
- [ ] `pnpm -F @obsidian-desk/sdk test` passes (26 cases)
- [ ] The program-id literal in `programs/obsidian-core/src/lib.rs` `declare_id!()` matches `Anchor.toml [programs.devnet] obsidian_core` (CI catches mismatches via `anchor build`'s checksum)
- [ ] You have a backup of the upgrade authority keypair; loss = irreversible loss of the ability to redeploy at the same address
- [ ] Devnet wallet has at least 5 SOL (`solana balance --url devnet`)

### 1.2 Deploy

```bash
anchor build
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
vercel env add NEXT_PUBLIC_NETWORK production
vercel env add OBSIDIAN_ESPLORA_URL production
vercel --prod
```

Vercel detects Next.js 16.2 zero-config. The `output: 'standalone'` in `app/next.config.ts` is required for the Docker fallback below; Vercel itself uses its own runtime.

### Rollback on Vercel

Vercel keeps every prod deployment as an immutable URL. From the dashboard, go to Deployments → pick the previous green one → "Promote to Production". Rollback is instant.

## 3. Frontend → Fly.io (Docker fallback)

Use this when Vercel isn't an option (e.g. you need a longer-lived edge or your own region).

```bash
fly launch --no-deploy --copy-config --dockerfile app/Dockerfile
fly secrets set NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com \
                NEXT_PUBLIC_OBSIDIAN_PROGRAM_ID=H25yY5o4emorZ9qMHAUvJhdtrFjDSeYy2MVYurpQbeLp \
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
- E1, E2, E3, E4: the on-chain program still uses inline `Vec<u8>` ciphertexts
  and a synchronous mock `request_threshold_decrypt`. Real `execute_graph`
  CPI + async `request_decryption` flow is the next milestone.
- I1: lockPolicy doesn't yet write to the on-chain Ika program — it
  stores the policy intent in the SDK process for the keeper to pick up.

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

## 5. Production with docker-compose (Linux/x86)

Use this for self-hosted demos or staging. Pulls images from GHCR rather than building locally.

```bash
cp .env.example .env.production
# edit .env.production:
#   NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com
#   SOLANA_RPC=https://api.devnet.solana.com
#   OBSIDIAN_PROGRAM_ID=H25yY5o4emorZ9qMHAUvJhdtrFjDSeYy2MVYurpQbeLp
#   IMAGE_TAG=v0.1.0
#   KEEPER_KEYPAIR_PATH=/path/to/keeper-keypair.json

docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --env-file .env.production up -d
```

### 5.1 Building & pushing images to GHCR

Until we land a CI workflow that does this, push manually:

```bash
docker login ghcr.io -u <your-github-username>

VERSION=v0.1.0
docker buildx build --platform linux/amd64,linux/arm64 \
  -f app/Dockerfile -t ghcr.io/<org>/obsidian-app:$VERSION \
  --push .

docker buildx build --platform linux/amd64,linux/arm64 \
  -f keeper/Dockerfile -t ghcr.io/<org>/obsidian-keeper:$VERSION \
  --push .
```

Then bump `IMAGE_TAG=$VERSION` in `.env.production` and `docker compose ... up -d`.

## 6. Single-VPS deploy with Cloudflare DNS

Self-host everything on one Linux box: the compose stack from §5 plus a reverse proxy that Cloudflare routes traffic to. Good fit for demos, staging, or a cheap production box — no per-service platform accounts, one IP to firewall, one TLS cert to manage.

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

```bash
su - obsidian
git clone https://github.com/<org>/encrypt-ika-obsidian-desk.git obsidian-desk
cd obsidian-desk
cp .env.example .env.production
```

Edit `.env.production`:

```ini
NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com
SOLANA_RPC=https://api.devnet.solana.com
OBSIDIAN_PROGRAM_ID=H25yY5o4emorZ9qMHAUvJhdtrFjDSeYy2MVYurpQbeLp
NEXT_PUBLIC_NETWORK=devnet
OBSIDIAN_ESPLORA_URL=https://mempool.space/signet/api
IMAGE_TAG=v0.1.0
KEEPER_KEYPAIR_PATH=/home/obsidian/secrets/keeper-keypair.json
```

For anything above a hackathon demo, swap the public `api.devnet.solana.com` for a Helius / Triton / QuickNode devnet endpoint — the public one is heavily rate-limited and will drop the wallet adapter under any real traffic.

### 6.5 Provision keeper signer + IDL

The keeper needs a funded Solana keypair and the Anchor IDL on disk (bind-mounted at `target/idl/obsidian_core.json`, see `docker-compose.yml`).

```bash
# keypair — generate on the VPS, never copy from a shared machine
install -d -m 700 ~/secrets
curl -sSfL https://release.anza.xyz/stable/install | sh
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
solana-keygen new --no-bip39-passphrase -o ~/secrets/keeper-keypair.json
chmod 600 ~/secrets/keeper-keypair.json
solana airdrop 2 --url devnet --keypair ~/secrets/keeper-keypair.json
```

From your workstation, after `anchor build`:

```bash
rsync -av target/idl/ obsidian@<vps-ip>:/home/obsidian/obsidian-desk/target/idl/
```

### 6.6 Start the stack

```bash
# on the VPS as obsidian
cd ~/obsidian-desk
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --env-file .env.production pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --env-file .env.production up -d
docker compose ps   # both services reach "healthy" within ~60 s
```

Smoke test from the VPS loopback before any public DNS flips:

```bash
curl -fsS http://127.0.0.1:13000/api/health
curl -fsS http://127.0.0.1:13001/status | head -c 200
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

```bash
# as obsidian@vps
cd ~/obsidian-desk
git fetch && git checkout v0.2.0
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=v0.2.0/' .env.production
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --env-file .env.production pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --env-file .env.production up -d
```

Rollback is the same commands with the previous `IMAGE_TAG`. Expect ~5 s of 502s during the app container swap; Caddy retries upstream, so most browsers never see it.

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
