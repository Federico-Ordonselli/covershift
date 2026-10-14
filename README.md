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
| `apps/web`        | React frontend (Vite, React Router, TanStack Query) |
| `packages/shared` | Zod contracts shared between API and web            |
| `infra`           | Terraform for AWS ECS Fargate (phase 4)             |
| `docs/adr`        | Architecture decision records                       |

## Local development

Requirements: Node 24, pnpm (via Corepack), Docker.

```sh
pnpm install
pnpm db:start   # ES256 signing key on first run, `supabase start`, then writes the env files
pnpm db:migrate
pnpm db:seed    # demo org: 1 manager + 3 staff, positions, a week of shifts, one open swap
pnpm --filter @covershift/api dev   # API on :3000, OpenAPI UI at /docs
pnpm --filter @covershift/web dev   # web app on http://127.0.0.1:5173 (proxies /api to :3000)
```

**Web app.** The browser talks to the API same-origin under `/api` (Vite proxies it in dev and
preview; hosting will route it the same way), so the API has no CORS policy. Supabase is used
for authentication only; all data goes through the API with the user's access token.
`pnpm db:env` also writes `apps/web/.env.local` with the public values the bundle needs
(Supabase URL and publishable key, never the secret key). Public signup is disabled in
`supabase/config.toml`; accounts come from the seed (later: invitations).

**Security headers.** `apps/web/security-headers.ts` defines the Content-Security-Policy
(no inline scripts or styles, no `eval`, `connect-src` limited to self and the Supabase URL,
`frame-ancestors 'none'`) and companion headers. `vite preview` serves them, so the e2e suite
runs under the real policy and fails on any violation; phase 4 hosting reuses the module.
The session lives in `localStorage` (survives reloads, shared across tabs); this CSP is the
XSS mitigation that choice relies on.

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
| `GET /me`                                                 | anyone signed in: profile + active memberships, roles  |
| `GET /organizations`                                      | anyone signed in: organizations they're active in      |
| `GET /organizations/:id/positions`, `/members`            | members of that organization (active members only)     |
| `GET /shifts`, `GET /shifts/:id`                          | members of the shift's organization                    |
| `POST /shifts`, `PATCH /shifts/:id`, `DELETE /shifts/:id` | managers and admins                                    |
| `GET /swap-requests`, `GET /swap-requests/:id`            | members                                                |
| `POST /swap-requests`                                     | the assignee of the shift (direct or open offer)       |
| `POST /swap-requests/:id/accept`                          | the direct target, or any other member for open offers |
| `POST /swap-requests/:id/decline`                         | the direct target                                      |
| `POST /swap-requests/:id/cancel`                          | the requester (pending or accepted)                    |
| `POST /swap-requests/:id/approve`, `/reject`              | managers and admins who are not part of the swap       |

**Lists** (`GET /shifts`, `GET /swap-requests`) are keyset-paginated: `?limit=` (1–100,
default 50) and `?cursor=`, answering `{ items, nextCursor }`. Pass `nextCursor` back verbatim;
`null` means the end. Shifts come in start-time order and take `from`/`to` (overlapping
`[from, to)`), `organizationId` and `assignedUserId`. Swap requests come newest first and take
`organizationId`, `shiftId`, `status`, `requesterId`, `targetUserId` and `open` (`true` = no
target). The committed contract is [`docs/openapi.json`](docs/openapi.json); a test fails when
it drifts from the code (`pnpm --filter @covershift/api openapi:update` to refresh it).

`GET /organizations/:id/positions` and `/members` are not paginated; they return at most
**500** rows (`LIST_HARD_CAP` in `packages/shared`), ordered by name, and log a warning when an
organization exceeds it.

**Every** error is [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) `application/problem+json`
with a required, stable `code`, including errors raised outside our services (auth guard,
id parsing, body parsing, unknown routes, unexpected failures). `docs/openapi.json` lists, per
endpoint, the statuses and codes it can return. Clients branch on `code`, never on `detail`:

- **400**: `VALIDATION_FAILED` (invalid input or id, with `errors[]` per field) or `MALFORMED_REQUEST` (body isn't valid JSON, or a broken URL encoding).
- **401**: `UNAUTHORIZED`, missing or invalid token.
- **403**: `FORBIDDEN` or `SWAP_NOT_ALLOWED`, you can see it but it's not your action.
- **404**: `NOT_FOUND`, it doesn't exist _or_ you can't see it (deliberately indistinguishable), or the route doesn't exist.
- **409**: a state or conflict problem (`SHIFT_OVERLAP`, `SWAP_ALREADY_ACTIVE`, invalid transition, lost race).
- **413** `PAYLOAD_TOO_LARGE` (body over 100 kB), **415** `UNSUPPORTED_MEDIA_TYPE` (body charset).
- **422**: a rule violation (`CERTIFICATION_MISSING`, `CERTIFICATION_EXPIRES_BEFORE_SHIFT_END`, `NOT_A_MEMBER`).
- **500**: `INTERNAL_ERROR`, with no details.

## Tests

```sh
pnpm --filter @covershift/api test:unit   # no database needed
pnpm --filter @covershift/api test:int    # needs pnpm db:start && pnpm db:migrate
pnpm --filter @covershift/web test        # component tests (Vitest, Testing Library, MSW)
pnpm --filter @covershift/api build && pnpm --filter @covershift/web build
pnpm --filter @covershift/web e2e         # Playwright on the real stack (seeds first)
```

| Suite (`apps/api`)                                            | What it proves                                                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/**/*.spec.ts`                                            | Eligibility rule edge cases, JWT verification, database-error mapping                                  |
| `test/rls/`                                                   | Tenant isolation and the swap state machine **at the SQL level**, as the real API role                 |
| `test/database/`                                              | The RLS transaction unit: fails closed, no identity leak across pooled connections, commit-time errors |
| `test/certifications/`, `test/shifts/`, `test/swap-requests/` | Services under real RLS, incl. concurrent claims                                                       |
| `test/e2e/`                                                   | The real app over HTTP: forged tokens, cross-tenant ids, mass assignment, all five transitions         |
| `test/lint/`, `test/seed/`                                    | The SQL-interpolation lint rule fires; seeded data satisfies the domain rules                          |

| Suite (`apps/web`)    | What it proves                                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/**/*.test.ts(x)` | API client (single-flight token refresh, error envelope, contract checks), error-code copy, forms, org layout, schedule, open-redirect guard |
| `test/msw/`           | Every mocked response is parsed with the shared zod schemas, so mocks can't drift from the API                                               |
| `e2e/` (Playwright)   | Login, session persistence and expiry, sign-out, schedule in the org's time zone, org switching, CSP and axe (WCAG 2.1 AA) on every run      |

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
| **Integration tests** (real Supabase: db, auth, kong)                        | **Tenant isolation and swap rules through the real RLS role**, and over HTTP with the real app: forged/misused tokens (incl. the stack's own `service_role` key), other tenants' ids in paths/queries/bodies, mass-assignment; JWKS against real GoTrue, commit-time errors, migration round-trip | Load/performance, browser flows (E2E job)                                                                           |
| ↳ **Policy catalog test** (`test/rls/policy-hygiene.int.spec.ts`)            | Unwrapped `auth.uid()`/helper calls in policies (Supabase `auth_rls_initplan`), tables without RLS, `SECURITY DEFINER` without pinned `search_path`                                                                                                                                               | Whether a policy's _logic_ is right (that's the RLS suites' job)                                                    |
| **E2E** (Playwright: built API + `vite preview` on real Supabase)            | Login, session expiry, schedule, org switching through a real browser; **any CSP violation** or **axe WCAG 2.1 AA violation** fails the run                                                                                                                                                       | Browsers other than Chromium; visual regressions                                                                    |
| **CodeQL** (`security.yml`, also weekly)                                     | Injection, unsafe deserialization, path traversal and similar patterns in TS                                                                                                                                                                                                                      | **RLS or authorization logic bugs**: it can't reason about policies or triggers. The RLS suites and catalog test do |
| **gitleaks** (full history)                                                  | Committed credentials (default rules, no allowlist: no key-shaped values are tracked)                                                                                                                                                                                                             | Secrets outside git (CI logs, env), or ones in formats no rule recognises                                           |
| **pnpm audit**                                                               | Known advisories: high/critical in prod deps block, everything else is reported                                                                                                                                                                                                                   | Unknown vulnerabilities, malicious-but-unreported packages, vulnerable code paths you don't actually use            |
| **supabase db lint** (plpgsql_check on `app`, `ops`; in the integration job) | Broken PL/pgSQL: unknown columns/types in triggers and helpers                                                                                                                                                                                                                                    | Logic errors in correct-looking functions; SQL-language functions and policies (catalog test + RLS suites)          |
| **Dependabot** (weekly)                                                      | Outdated npm packages and pinned actions                                                                                                                                                                                                                                                          | Anything it can't open a PR for (e.g. a breaking major you haven't reviewed)                                        |

**Dependabot policy** (`.github/dependabot.yml`): all `@nestjs/*` updates arrive as one PR,
majors included, because Nest moves as a unit. Other minors and patches are grouped, other
majors (e.g. TypeScript) get one PR each, and `@types/node` majors are ignored so the types
track `.nvmrc`. Closing a Dependabot PR makes it ignore that version. To bring it back,
comment `@dependabot unignore <dependency> <version>` on any Dependabot PR (or
`@dependabot show <dependency> ignore conditions` to list them).

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

- **NestJS 12 on an undeclared `nestjs-zod` peer.** Nest 12 is ESM-only; the CJS API loads it
  through Node 24's `require(esm)`. `nestjs-zod` 5.5.0 (the zod → DTO/OpenAPI bridge) still
  declares `@nestjs/common ^10 || ^11` and `@nestjs/swagger … || ^11`: Nest 12 support is
  tracked upstream in [nestjs-zod#471](https://github.com/BenLorantfy/nestjs-zod/issues/471)
  and not released. The upgrade was accepted after checking the production build
  (`nest build` + `node dist/main.js`): it boots, `/docs-json` is identical to Nest 11's, and
  a battery of crafted requests (bad tokens, invalid bodies and params, cross-tenant and
  hidden ids, wrong-role writes and transitions) returns identical status codes and bodies.
  The exception is explicit in `pnpm-workspace.yaml` (`peerDependencyRules`); remove it once
  a `nestjs-zod` release declares Nest 12.
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
