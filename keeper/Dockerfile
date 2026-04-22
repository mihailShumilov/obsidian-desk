# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────
# ObsidianDesk keeper bot — Node.js daemon (TS 5.9 → tsc → dist).
#
# Build context MUST be the repo root so we can copy sdk/ + lockfile.
#   docker build -f keeper/Dockerfile -t obsidian-keeper .
#
# Runtime requires:
#   - ANCHOR_PROVIDER_URL  (Solana RPC URL)
#   - ANCHOR_WALLET        (path to keypair file inside the container)
#   - target/idl/obsidian_core.json  (mounted or baked at /app/keeper/target/idl/)
# ─────────────────────────────────────────────────────────────────────

ARG NODE_VERSION=24.0-alpine
ARG PNPM_VERSION=9.15.4

# ── Stage 1: builder ─────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS builder
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo

# Workspace skeleton for `pnpm install`
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY app/package.json     ./app/package.json
COPY sdk/package.json     ./sdk/package.json
COPY keeper/package.json  ./keeper/package.json

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Source for the two packages we actually compile
COPY sdk     ./sdk
COPY keeper  ./keeper

RUN pnpm -F @obsidian-desk/sdk    build && \
    pnpm -F @obsidian-desk/keeper build

# `pnpm deploy` resolves only the keeper subgraph and produces a
# self-contained directory with workspace deps inlined as concrete
# folders (not symlinks). Drops the rest of the monorepo entirely.
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm deploy --filter @obsidian-desk/keeper --prod /out

# ── Stage 2: runner ──────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner

# tini for proper PID 1 signal handling
RUN apk add --no-cache tini

WORKDIR /app

ENV NODE_ENV=production \
    KEEPER_PORT=3001 \
    KEEPER_POLL_MS=3000 \
    KEEPER_FEERATE=4

# Non-root user
RUN addgroup -S -g 1001 nodejs && \
    adduser  -S -u 1001 -G nodejs keeper

# The deployed bundle has its OWN node_modules with prod-only deps.
COPY --from=builder --chown=keeper:nodejs /out ./

USER keeper
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/status >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]

LABEL org.opencontainers.image.source="https://github.com/mihailShumilov/obsidian-desk" \
      org.opencontainers.image.title="obsidian-keeper" \
      org.opencontainers.image.description="ObsidianDesk matching + settlement keeper"
