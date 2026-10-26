# Covershift API image. Build context: the repository root.
#   docker build -f apps/api/Dockerfile -t covershift-api .
# Runs as a non-root user and writes nothing at runtime, so the root filesystem can be
# mounted read-only (ECS: readonlyRootFilesystem). Same image, two commands:
#   (default)               node dist/main.js     the API
#   node dist/migrate.js    one-off migration task (needs DATABASE_MIGRATION_URL)

# --- build: install, compile, prune to production dependencies -----------------------------
FROM node:24.22.0-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS build
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
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:cb606325b7ec4af55462cb0b424a53b452a5b4a894ffe841fcf1048d216fb9f8
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /out/package.json ./
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
USER nonroot
EXPOSE 3000
# The distroless entrypoint is node itself.
CMD ["dist/main.js"]
