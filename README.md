# Covershift

Multi-tenant shift scheduling and shift-swap platform for operational teams
(airport security, retail, healthcare).

> Phase 1: API, schema, row-level security. See `docs/adr/` for design decisions.

## Layout

| Path              | What                                                |
| ----------------- | --------------------------------------------------- |
| `apps/api`        | NestJS REST API (TypeORM, Supabase Postgres + Auth) |
| `apps/web`        | React frontend (phase 2)                            |
| `packages/shared` | Zod contracts shared between API and web            |
| `infra`           | Terraform for AWS ECS Fargate (phase 4)             |
| `docs/adr`        | Architecture decision records                       |

## Local development

Requirements: Node 24, pnpm (via Corepack), Docker.

```sh
pnpm install
pnpm db:start   # generates an ES256 JWT signing key on first run, then `supabase start`
```

The Supabase CLI is a pinned devDependency, so no global install is needed.
`supabase/signing_keys.json` is generated locally and git-ignored. Auth signs
tokens with it, and the API verifies them via the JWKS endpoint
(`http://127.0.0.1:54321/auth/v1/.well-known/jwks.json`) rather than a shared secret.

`supabase/migrations` is intentionally unused: the schema is owned by TypeORM
migrations in `apps/api` (see `docs/adr`). Realtime, Storage, Edge Functions
and Analytics are disabled in `supabase/config.toml` until the phases that need them.

## Troubleshooting

### `supabase start` fails with `HealthCheckTimeoutError ... unexpected status 502`

Kong logs show upstreams resolving to `127.0.0.1` (e.g. `upstream: "http://127.0.0.1:9999/health"`)
even though the containers are healthy.

**Cause:** the router pushes a DHCP search domain (seen with TIM routers:
`homenet.telecomitalia.it`) and its DNS answers any name under that domain with
`127.0.0.1`. Kong uses its own DNS client rather than glibc and appends the search
domain before trying the bare container name. So `supabase_auth_<project>` becomes
`supabase_auth_<project>.homenet.telecomitalia.it` → `127.0.0.1` → Kong proxies to itself.

Check with `resolvectl domain`. If it lists the router's domain, you are affected.

**Fix:** stop NetworkManager from taking DNS settings (servers and search domain)
from DHCP, and use public resolvers instead:

```sh
nmcli -t -f NAME con show --active          # find the connection name
sudo nmcli con mod "<connection>" \
  ipv4.ignore-auto-dns yes ipv4.dns "1.1.1.1 9.9.9.9" \
  ipv6.ignore-auto-dns yes ipv6.dns "2606:4700:4700::1111 2620:fe::fe"
sudo nmcli con up "<connection>"
pnpm db:stop && pnpm db:start
```

Setting `"dns-search"` in `/etc/docker/daemon.json` does **not** fix this. It did
not take effect for the Supabase containers' resolver, so don't rely on it.

## Tech choices worth noting

- **NestJS 11, not 12.** Nest 12 is ESM-only and `nestjs-zod` (the zod → DTO/OpenAPI
  bridge) does not support it yet. Moving to 12 is a contained follow-up.
- **TypeORM 1.x**, DataSource API only. `synchronize` is never enabled: the schema is
  owned by migrations.
- **Vitest + unplugin-swc** instead of Jest: faster, native ESM, and SWC emits the
  decorator metadata Nest DI and TypeORM need (Vitest's default esbuild transform can't).
- **Zod contracts in `packages/shared`** are the single source of truth for validation,
  OpenAPI and (later) frontend types.
