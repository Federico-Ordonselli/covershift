# Covershift API image. Build context: the repository root.
#   docker build -f apps/api/Dockerfile -t covershift-api .
# Runs as a non-root user and writes nothing at runtime, so the root filesystem can be
# mounted read-only (ECS: readonlyRootFilesystem). Same image, two commands:
#   (default)               node dist/main.js     the API
#   node dist/migrate.js    one-off migration task (needs DATABASE_MIGRATION_URL)

# --- build: install, compile, prune to production dependencies -----------------------------
FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS build
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
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:c1326ce1aad4b976dce3a3da8b7eb5c8328e635e312309a7a0e5319d1470be0d
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /out/package.json ./
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
USER nonroot
EXPOSE 3000
# The distroless entrypoint is node itself.
CMD ["dist/main.js"]
