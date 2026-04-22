#!/usr/bin/env bash
# scripts/docker-bootstrap.sh — one-shot local bootstrap for the
# ObsidianDesk docker-compose stack.
#
# What it does:
#   1. Ensures a keeper signing keypair exists (generates one with
#      `solana-keygen new` if missing — falls back to a placeholder
#      if solana CLI isn't on PATH).
#   2. `docker compose build` then `docker compose up -d`.
#   3. Waits for app + keeper healthchecks to go green.
#   4. Prints the access URLs.
#
# Re-runnable: existing keypairs are reused, existing containers are
# recreated by `up -d` only if they need to be.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

KEYPAIR_PATH="${KEEPER_KEYPAIR_PATH:-$REPO_ROOT/scripts/.keeper-keypair.json}"

step() { printf '\n\033[36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m! %s\033[0m\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || die "docker not on PATH"
docker compose version >/dev/null 2>&1 || die "docker compose plugin missing"

# 1. Keypair --------------------------------------------------------------
step "keeper keypair"
if [[ -f "$KEYPAIR_PATH" ]]; then
  ok "exists at $KEYPAIR_PATH"
elif command -v solana-keygen >/dev/null; then
  solana-keygen new --no-bip39-passphrase --silent --outfile "$KEYPAIR_PATH"
  ok "generated $KEYPAIR_PATH"
else
  warn "solana-keygen not found — writing a 64-byte zero placeholder."
  warn "the keeper will refuse to sign txs until you replace it."
  printf '[%s]' "$(printf '0,%.0s' {1..63})0" > "$KEYPAIR_PATH"
fi
export KEEPER_KEYPAIR_PATH="$KEYPAIR_PATH"

# 2. Build + up -----------------------------------------------------------
step "docker compose build"
docker compose build --pull
ok "images built"

step "docker compose up -d"
docker compose up -d
ok "stack started"

# 3. Wait for healthchecks ------------------------------------------------
step "waiting for healthchecks (timeout 120s)"
deadline=$(( $(date +%s) + 120 ))
while :; do
  app_state=$(docker inspect --format '{{ .State.Health.Status }}' obsidian-app 2>/dev/null || echo unknown)
  keeper_state=$(docker inspect --format '{{ .State.Health.Status }}' obsidian-keeper 2>/dev/null || echo unknown)
  printf '  app=%s keeper=%s\n' "$app_state" "$keeper_state"
  if [[ "$app_state" == healthy && "$keeper_state" == healthy ]]; then
    ok "all green"
    break
  fi
  if (( $(date +%s) > deadline )); then
    die "healthchecks didn't pass in 120s — check 'docker compose logs'"
  fi
  sleep 5
done

# 4. Print the URLs -------------------------------------------------------
cat <<EOF

───────────────────────────────────────────────────────────
ObsidianDesk is up.

  app:           http://127.0.0.1:13000
  trade:         http://127.0.0.1:13000/trade
  trade (admin): http://127.0.0.1:13000/trade?admin=1
  keeper status: http://127.0.0.1:13001/status
  solana RPC:    http://127.0.0.1:18899   (ws :18900)

next steps:
  - seed a demo:   pnpm exec tsx scripts/seed-demo.ts
  - tail logs:     docker compose logs -f app keeper
  - shut it down:  docker compose down -v
───────────────────────────────────────────────────────────
EOF
