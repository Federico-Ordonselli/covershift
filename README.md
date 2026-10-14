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
pnpm db:start   # ES256 signing key on first run, `supabase start`, then writes apps/api/.env
pnpm db:migrate
pnpm db:seed    # demo org: 1 manager + 3 staff, positions, a week of shifts, one open swap
pnpm --filter @covershift/api dev   # API on :3000, OpenAPI UI at /docs
```

The Supabase CLI is a pinned devDependency, so no global install is needed.
`pnpm db:env` (run by `db:start`) writes `apps/api/.env` from `apps/api/.env.example` plus the
running stack's URLs and API keys (`supabase status`). Local keys are never committed: even
the CLI's fixed defaults match GitHub's secret-scanning patterns.
`supabase/signing_keys.json` is generated locally and git-ignored. Auth signs
tokens with it, and the API verifies them via the JWKS endpoint
(`http://127.0.0.1:54321/auth/v1/.well-known/jwks.json`) rather than a shared secret.

The seed is re-runnable: it resets only the demo organization (`lakeside-security`) and
reuses its users. Log in as `manager@covershift.test`, `sam@…`, `alex@…` or `jo@…` with
password `covershift-demo` (override with `SEED_PASSWORD`). It refuses to run against a
non-local Supabase URL. Every seeded assignment satisfies the certification and overlap
rules, and a test checks that with the API's own eligibility service.

`supabase/migrations` is intentionally unused: the schema is owned by TypeORM
migrations in `apps/api` (see `docs/adr`). Realtime, Storage, Edge Functions
and Analytics are disabled in `supabase/config.toml` until the phases that need them.

## CI & Security

Every push to `main` and every PR runs two workflows. Actions are pinned to commit SHAs
(Dependabot updates them), jobs default to `contents: read`, and superseded runs are cancelled.
Phase 1 uses no repository secrets.

| Gate                                                              | Catches                                                                                                                                                                                                                                                                                           | Does **not** catch                                                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Lint** (`ci.yml`)                                               | Style/correctness rules; **SQL built by interpolation** or `+` (fails the build, ADR 001)                                                                                                                                                                                                         | SQL assembled in another module and passed in as a plain variable (the rule is syntactic)                           |
| **Typecheck**                                                     | Type errors across API and shared contracts                                                                                                                                                                                                                                                       | Anything runtime: SQL, RLS, env                                                                                     |
| **Unit tests**                                                    | JWT verification edge cases, error mapping, zod contracts, the lint rule itself                                                                                                                                                                                                                   | Anything that needs Postgres                                                                                        |
| **Integration tests** (real Supabase: db, auth, kong)             | **Tenant isolation and swap rules through the real RLS role**, and over HTTP with the real app: forged/misused tokens (incl. the stack's own `service_role` key), other tenants' ids in paths/queries/bodies, mass-assignment; JWKS against real GoTrue, commit-time errors, migration round-trip | Load/performance, browser flows (phase 2)                                                                           |
| ↳ **Policy catalog test** (`test/rls/policy-hygiene.int.spec.ts`) | Unwrapped `auth.uid()`/helper calls in policies (Supabase `auth_rls_initplan`), tables without RLS, `SECURITY DEFINER` without pinned `search_path`                                                                                                                                               | Whether a policy's _logic_ is right (that's the RLS suites' job)                                                    |
| **CodeQL** (`security.yml`, also weekly)                          | Injection, unsafe deserialization, path traversal and similar patterns in TS                                                                                                                                                                                                                      | **RLS or authorization logic bugs**: it can't reason about policies or triggers. The RLS suites and catalog test do |
| **gitleaks** (full history)                                       | Committed credentials (default rules, no allowlist: no key-shaped values are tracked)                                                                                                                                                                                                             | Secrets outside git (CI logs, env), or ones in formats no rule recognises                                           |
| **pnpm audit**                                                    | Known advisories: high/critical in prod deps block, everything else is reported                                                                                                                                                                                                                   | Unknown vulnerabilities, malicious-but-unreported packages, vulnerable code paths you don't actually use            |
| **supabase db lint** (plpgsql_check on `app`, `ops`)              | Broken PL/pgSQL: unknown columns/types in triggers and helpers                                                                                                                                                                                                                                    | Logic errors in correct-looking functions; SQL-language functions and policies (catalog test + RLS suites)          |
| **Dependabot** (weekly)                                           | Outdated npm packages and pinned actions                                                                                                                                                                                                                                                          | Anything it can't open a PR for (e.g. a breaking major you haven't reviewed)                                        |

**Deferred to phase 4** (with the Docker image and Terraform): Trivy scan of the API image,
IaC scanning of `infra/` (Checkov or tfsec), Dependabot for Docker and Terraform, and
**GitHub OIDC to AWS** for deploys instead of long-lived access keys.

Run the same gates locally:

```sh
pnpm lint && pnpm format:check && pnpm typecheck
pnpm --filter @covershift/api test           # unit + integration (needs pnpm db:start, pnpm db:migrate)
pnpm supabase db lint --local --schema app,ops --fail-on error
```

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
