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

## 6. Monitoring

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

## 7. Incident playbooks

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

## 8. Security checklist

- [ ] Upgrade authority keypair lives in a hardware wallet or cold storage; never on the deploy machine
- [ ] `OBSIDIAN_PROGRAM_ID` is the same in `Anchor.toml`, `lib.rs declare_id!()`, and every `.env*` file (CI verifies)
- [ ] Keeper signing keypair is provisioned via secrets manager (Fly secrets / Vercel env scoped to "production"), never committed
- [ ] No `console.log` of plaintext order data in production builds (`grep -r 'plaintext\|priceUsdc\|sizeBtc' app/.next/server/` after `pnpm build`)
- [ ] `app/Dockerfile` runs as non-root (`USER nextjs`); keeper does the same (`USER keeper`)
- [ ] `.dockerignore` excludes `.env*` (verified — `.env.example` is the only exception, and it has no secrets)
- [ ] CSP headers set in `app/middleware.ts` to lock down inline scripts (TODO — open issue)

## 9. Cost estimates

For the hackathon-scale demo (1 prod instance per service, ≈ 50 unique visitors / day):

| Provider | Service | Plan | Monthly |
|---|---|---|---|
| Vercel | Next.js Hobby | free | $0 |
| Fly.io | Keeper (256 MB shared-cpu-1x) | hobby | ~$2 |
| Solana devnet | Program rent + tx fees | n/a | <$5 in airdropped SOL |
| mempool.space | Signet esplora | public, rate-limited | $0 |
| GHCR | Image storage (≤ 5 GB) | free under 500 MB | $0 |

Total: **~$2–5/mo** while we stay on devnet + signet. Mainnet adds Solana rent + real BTC for fees and is materially different — re-cost when crossing that line.

## 10. Where else to look

- [`README.md`](../README.md) — quick start + project overview
- [`docs/DEVELOPMENT.md`](DEVELOPMENT.md) — daily-driver developer playbook
- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — full system design
- [`docs/gaps.md`](gaps.md) — known SDK + program gaps with workarounds
