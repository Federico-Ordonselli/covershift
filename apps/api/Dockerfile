# Covershift API image. Build context: the repository root.
#   docker build -f apps/api/Dockerfile -t covershift-api .
# Runs as a non-root user and writes nothing at runtime, so the root filesystem can be
# mounted read-only (ECS: readonlyRootFilesystem). Same image, two commands:
#   (default)               node dist/main.js     the API
#   node dist/migrate.js    one-off migration task (needs DATABASE_MIGRATION_URL)

# --- build: install, compile, prune to production dependencies -----------------------------
FROM node:24.16.0-bookworm-slim@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203 AS build
ENV CI=true PNPM_HOME=/pnpm
RUN corepack enable
WORKDIR /repo

# Manifests first: the dependency layer is cached until the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @covershift/api...

COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @covershift/shared build \
 && pnpm --filter @covershift/api build \
 && pnpm --filter @covershift/api deploy --prod --legacy /out

# --- runtime: distroless, no shell, no package manager -------------------------------------
# debian13: the debian12 variant still ships libssl3 3.0.18 with fixable HIGH/CRITICAL CVEs.
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:9eeb7f5887d0e239e78264b06f7f11d2e14be534050481803a9e4728fcdd278e
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /out/package.json ./
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
USER nonroot
EXPOSE 3000
# The distroless entrypoint is node itself.
CMD ["dist/main.js"]
