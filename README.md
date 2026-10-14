# Covershift

Multi-tenant shift scheduling and shift-swap API for operational teams (airport security,
retail, healthcare): managers schedule shifts, staff swap them, and nobody works a position
without a certification valid until the shift ends.

> **Phase 1 is complete**: API, schema, row-level security, CI. What was built, what's fragile,
> and what comes next: [`docs/phase-1-report.md`](docs/phase-1-report.md). Design decisions:
> [`docs/adr/`](docs/adr/).

## Architecture in one minute

- **The database is the last line of defense, even for our own backend.** NestJS verifies the
  Supabase JWT against the project's JWKS, then runs every request in one transaction that
  impersonates the user (`set local role authenticated` + `request.jwt.claims`). Postgres RLS
  policies decide which rows exist for that user. The API connects as a role with **no
  privileges of its own**, so a query outside that transaction fails instead of leaking.
  ([ADR 001](docs/adr/001-rls-through-nestjs.md))
- **Each rule lives where it's best explained, with a backstop that can't be skipped.** The
  service layer gives readable errors (certifications, overlaps). The database enforces tenant
  isolation, composite tenant FKs, an exclusion constraint against double-booking, and the
  swap state machine as a trigger.
- **TypeORM migrations own the schema**, including RLS, written as reviewed SQL.
  ([ADR 002](docs/adr/002-schema-ownership-typeorm.md))
- Domain tables live in a schema the Supabase Data API does not expose, so NestJS is the only
  way in.

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

## API

OpenAPI UI at `/docs` (JSON at `/docs-json`), generated from the zod contracts in
`packages/shared`. Every route except `GET /health` needs `Authorization: Bearer <Supabase access token>`.

| Endpoint                                                  | Who                                                    |
| --------------------------------------------------------- | ------------------------------------------------------ |
| `GET /shifts`, `GET /shifts/:id`                          | members of the shift's organization                    |
| `POST /shifts`, `PATCH /shifts/:id`, `DELETE /shifts/:id` | managers and admins                                    |
| `GET /swap-requests`, `GET /swap-requests/:id`            | members                                                |
| `POST /swap-requests`                                     | the assignee of the shift (direct or open offer)       |
| `POST /swap-requests/:id/accept`                          | the direct target, or any other member for open offers |
| `POST /swap-requests/:id/decline`                         | the direct target                                      |
| `POST /swap-requests/:id/cancel`                          | the requester (pending or accepted)                    |
| `POST /swap-requests/:id/approve`, `/reject`              | managers and admins who are not part of the swap       |

Errors are [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) `application/problem+json` with
a stable `code`:

- **400**: invalid input, with `errors[]` per field.
- **401**: missing or invalid token.
- **403**: you can see it but it's not your action.
- **404**: it doesn't exist _or_ you can't see it (deliberately indistinguishable).
- **409**: a state or conflict problem (`SHIFT_OVERLAP`, `SWAP_ALREADY_ACTIVE`, invalid transition, lost race).
- **422**: a rule violation (`CERTIFICATION_MISSING`, `CERTIFICATION_EXPIRES_BEFORE_SHIFT_END`, `NOT_A_MEMBER`).

## Tests

```sh
pnpm --filter @covershift/api test:unit   # no database needed
pnpm --filter @covershift/api test:int    # needs pnpm db:start && pnpm db:migrate
```

| Suite (`apps/api`)                                            | What it proves                                                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/**/*.spec.ts`                                            | Eligibility rule edge cases, JWT verification, database-error mapping                                  |
| `test/rls/`                                                   | Tenant isolation and the swap state machine **at the SQL level**, as the real API role                 |
| `test/database/`                                              | The RLS transaction unit: fails closed, no identity leak across pooled connections, commit-time errors |
| `test/certifications/`, `test/shifts/`, `test/swap-requests/` | Services under real RLS, incl. concurrent claims                                                       |
| `test/e2e/`                                                   | The real app over HTTP: forged tokens, cross-tenant ids, mass assignment, all five transitions         |
| `test/lint/`, `test/seed/`                                    | The SQL-interpolation lint rule fires; seeded data satisfies the domain rules                          |

The suites were checked with **negative controls**: with RLS switched off, a rule removed, or
token verification disabled, the corresponding tests go red. See the report for details.

## CI & Security

Every push to `main` and every PR runs two workflows. `ci.yml` holds every blocking job and ends
in a **`CI gate`** job that needs all of them, runs even when they fail, and passes only if each
one concluded `success` (skipped or cancelled counts as failure). The ruleset requires just
`CI gate` plus the CodeQL code-scanning rule, so a new job is enforced by adding it to the gate's
`needs`. `security.yml` runs CodeQL (also weekly) and a weekly full dependency audit that
gates nothing but goes red on new high/critical advisories in production dependencies.
Actions are pinned to commit SHAs (Dependabot updates them), jobs default to `contents: read`,
and superseded runs are cancelled. No repository secrets are used.

| Gate                                                                         | Catches                                                                                                                                                                                                                                                                                           | Does **not** catch                                                                                                  |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Lint** (`ci.yml`)                                                          | Style/correctness rules; **SQL built by interpolation** or `+` (fails the build, ADR 001)                                                                                                                                                                                                         | SQL assembled in another module and passed in as a plain variable (the rule is syntactic)                           |
| **Typecheck**                                                                | Type errors across API and shared contracts                                                                                                                                                                                                                                                       | Anything runtime: SQL, RLS, env                                                                                     |
| **Unit tests**                                                               | JWT verification edge cases, error mapping, zod contracts, the lint rule itself                                                                                                                                                                                                                   | Anything that needs Postgres                                                                                        |
| **Integration tests** (real Supabase: db, auth, kong)                        | **Tenant isolation and swap rules through the real RLS role**, and over HTTP with the real app: forged/misused tokens (incl. the stack's own `service_role` key), other tenants' ids in paths/queries/bodies, mass-assignment; JWKS against real GoTrue, commit-time errors, migration round-trip | Load/performance, browser flows (phase 2)                                                                           |
| ↳ **Policy catalog test** (`test/rls/policy-hygiene.int.spec.ts`)            | Unwrapped `auth.uid()`/helper calls in policies (Supabase `auth_rls_initplan`), tables without RLS, `SECURITY DEFINER` without pinned `search_path`                                                                                                                                               | Whether a policy's _logic_ is right (that's the RLS suites' job)                                                    |
| **CodeQL** (`security.yml`, also weekly)                                     | Injection, unsafe deserialization, path traversal and similar patterns in TS                                                                                                                                                                                                                      | **RLS or authorization logic bugs**: it can't reason about policies or triggers. The RLS suites and catalog test do |
| **gitleaks** (full history)                                                  | Committed credentials (default rules, no allowlist: no key-shaped values are tracked)                                                                                                                                                                                                             | Secrets outside git (CI logs, env), or ones in formats no rule recognises                                           |
| **pnpm audit**                                                               | Known advisories: high/critical in prod deps block, everything else is reported                                                                                                                                                                                                                   | Unknown vulnerabilities, malicious-but-unreported packages, vulnerable code paths you don't actually use            |
| **supabase db lint** (plpgsql_check on `app`, `ops`; in the integration job) | Broken PL/pgSQL: unknown columns/types in triggers and helpers                                                                                                                                                                                                                                    | Logic errors in correct-looking functions; SQL-language functions and policies (catalog test + RLS suites)          |
| **Dependabot** (weekly)                                                      | Outdated npm packages and pinned actions                                                                                                                                                                                                                                                          | Anything it can't open a PR for (e.g. a breaking major you haven't reviewed)                                        |

**Deferred to phase 4** (with the Docker image and Terraform): Trivy scan of the API image,
IaC scanning of `infra/` (Checkov or tfsec), Dependabot for Docker and Terraform, and
**GitHub OIDC to AWS** for deploys instead of long-lived access keys.

Run the same gates locally:

```sh
pnpm lint && pnpm format:check && pnpm typecheck
pnpm --filter @covershift/api test           # unit + integration (needs pnpm db:start, pnpm db:migrate)
pnpm supabase db lint --local --schema app,ops --fail-on error
```

## Tech choices worth noting

- **NestJS 11, not 12.** Nest 12 is ESM-only and `nestjs-zod` (the zod → DTO/OpenAPI
  bridge) does not support it yet. Moving to 12 is a contained follow-up.
- **TypeORM 1.x**, DataSource API only. `synchronize` is never enabled: the schema is
  owned by migrations.
- **Vitest + unplugin-swc** instead of Jest: faster, native ESM, and SWC emits the
  decorator metadata Nest DI and TypeORM need (Vitest's default esbuild transform can't).
- **Zod contracts in `packages/shared`** are the single source of truth for validation,
  OpenAPI and (later) frontend types.

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
