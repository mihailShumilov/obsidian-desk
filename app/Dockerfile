# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────
# ObsidianDesk frontend — Next.js 16.2 standalone, pnpm workspaces.
# Build context MUST be the repo root so we can copy sdk/, lockfile,
# workspace manifest. Build with:
#   docker build -f app/Dockerfile -t obsidian-app .
# ─────────────────────────────────────────────────────────────────────

ARG NODE_VERSION=24.0-alpine
ARG PNPM_VERSION=9.15.4

# ── Stage 1: deps ────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS deps
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo

# Copy lockfile + workspace manifest + each package's package.json so
# pnpm can resolve the dep graph without needing source code yet.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY app/package.json       ./app/package.json
COPY sdk/package.json       ./sdk/package.json
COPY keeper/package.json    ./keeper/package.json
# pnpm verifies the patch hash at install time — copy patches/ here
# (after manifests, before install) so the lockfile entry
# `patchedDependencies['@encrypt.xyz/pre-alpha-solana-client@0.1.1']`
# resolves. Without this, `pnpm install --frozen-lockfile` fails with
# `ENOENT: patches/@encrypt.xyz__pre-alpha-solana-client@0.1.1.patch`.
COPY patches               ./patches

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ── Stage 2: builder ─────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS builder
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo

COPY --from=deps /repo/node_modules         ./node_modules
COPY --from=deps /repo/app/node_modules     ./app/node_modules
COPY --from=deps /repo/sdk/node_modules     ./sdk/node_modules
COPY --from=deps /repo/keeper/node_modules  ./keeper/node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY sdk     ./sdk
COPY app     ./app
# (keeper not needed by the app build, skip to keep context small)

# Build SDK first so its dist/types exist when app typechecks
RUN pnpm -F @obsidian-desk/sdk build && pnpm -F @obsidian-desk/app build

# ── Stage 3: runner ──────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Non-root user per UID/GID convention used in the next official examples
RUN addgroup -S -g 1001 nodejs && \
    adduser  -S -u 1001 -G nodejs nextjs

# `outputFileTracingRoot` is the repo root, so Next emits the standalone
# bundle one level above the app source. Copy the entire tree (small —
# just the things Next traced as needed) and the static chunks.
COPY --from=builder --chown=nextjs:nodejs /repo/app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/app/.next/static     ./app/.next/static

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1 || exit 1

# `server.js` ends up at /app/app/server.js because the workspace root
# (one level above app/) is the trace root.
CMD ["node", "app/server.js"]

LABEL org.opencontainers.image.source="https://github.com/mihailShumilov/obsidian-desk" \
      org.opencontainers.image.title="obsidian-app" \
      org.opencontainers.image.description="ObsidianDesk Next.js frontend"
