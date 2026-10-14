# ADR 001: Enforce Postgres RLS for requests that go through NestJS

- Status: accepted
- Date: 2026-10-14

## Context

Covershift is multi-tenant: every domain row belongs to an organization, and a user must
never see or change another organization's data. The API is NestJS + TypeORM talking to
Supabase Postgres. Users authenticate with Supabase Auth and send its JWT to the API.

The common shortcut is to connect as a privileged role and filter by `organization_id`
in application code. Then a single missing `where` clause leaks a tenant. We want
the database to be the final authority on row visibility, even for requests that go through
our own backend. Application code adds domain rules on top but is never the only guard.

Constraints:

- TypeORM owns the schema and is the data-access layer (role requirement).
- Many queries per request, some needing a multi-statement transaction (approve a swap and
  reassign the shift atomically).
- Production will run behind Supabase's pooler (Supavisor, transaction mode) from ECS
  Fargate tasks, so session state cannot be relied on.

## Options considered

### A. Supabase client (PostgREST) per request with the user's JWT

RLS applies natively. But it bypasses TypeORM entirely, and multi-statement
transactions need to be pushed into SQL functions (RPC). It also exposes the schema
through the Data API, which is a second entry point that skips our service-layer rules.
**Rejected.**

### B. Privileged connection, authorization in application code only

Simplest, and the most common. RLS becomes decoration, and correctness depends on
every query in every service being right forever. **Rejected.**

### C. TypeORM connection, impersonate the user inside a transaction (chosen)

For each request:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', $1, true);  -- verified JWT payload, tx-local
-- ... all queries of the request ...
commit;  -- or rollback; both reset role and claims
```

Supabase's `auth.uid()` reads `request.jwt.claims`, so policies are written exactly as they
would be for PostgREST.

`SET LOCAL` and `set_config(..., true)` are **transaction-scoped**. This is the property
that makes the approach safe with a connection pool and with Supavisor in transaction mode. The
identity cannot leak to the next request that reuses the connection. A session-level `SET`
would leak it and is therefore never used.

How to wire it into Nest was its own decision:

| Wiring                                                                                                                                    | Verdict                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1. `Scope.REQUEST` providers holding a QueryRunner                                                                                       | Request scope bubbles up: every service and controller that depends on it is re-instantiated per request. Slower, and it changes the lifecycle of unrelated code. Rejected. |
| C2. Global interceptor opens the tx, stores the `EntityManager` in AsyncLocalStorage (`nestjs-cls`); services read it through `TxManager` | **Chosen** for HTTP. Singleton DI graph, one place that owns the transaction, impossible to forget per endpoint.                                                            |
| C3. Explicit `rls.run(claims, fn)` in each service method                                                                                 | Explicit, but easy to forget. Kept as **the primitive C2 is built on**, and exposed for non-HTTP work (jobs, phase-5 LLM tasks).                                            |

## Decision

Option C with C2 wiring on top of a C3 primitive.

1. **JWT verification.** A global guard verifies the Supabase access token with `jose`
   against the project's JWKS (`/auth/v1/.well-known/jwks.json`). It checks the signature
   (asymmetric only: ES256/RS256, never HS256), `iss`, `aud = authenticated`, and `exp`.
   There is no shared JWT secret in the API process, and key rotation works without a deploy.
   Only the verified payload is ever written to `request.jwt.claims`.

2. **Connection role.** The API connects as `covershift_api`: `LOGIN NOINHERIT`, member of
   `authenticated`, **no grants of its own**. Because of `NOINHERIT` it has no privileges
   until it runs `SET ROLE authenticated`. A query issued outside the RLS wrapper (a
   forgotten code path, a misconfigured module) fails with `permission denied` instead of
   silently running with broad rights. The system fails closed, and an integration test asserts it.

   Migrations and the seed use a separate privileged URL (`DATABASE_MIGRATION_URL`) that
   the API process never receives.

3. **Transaction per request.** `RlsTransactionInterceptor` runs after the guard, takes a
   `QueryRunner`, opens the transaction, sets role and claims, and stores the manager in
   CLS. It commits when the handler's observable completes and rolls back on error.
   Services call `txManager.get()`, so they never inject `Repository<T>` from the
   global `DataSource`. That repository would run outside the transaction, and the
   connection role would make it fail anyway.

4. **Tables live in schema `app`**, which is not exposed through Supabase's Data API.
   Otherwise any authenticated user could `POST /rest/v1/shifts` directly. RLS would still
   stop cross-tenant access, but the service-layer rules (certifications, overlaps) would
   be bypassed. NestJS is the only door.

## Policy model

Helpers (in `app`, `SECURITY DEFINER`, `STABLE`, `set search_path = ''`):

- `app.is_member(org_id)`: the caller has any membership in the org.
- `app.has_role(org_id, roles[])`: the caller has one of the roles in the org.

These have to be `SECURITY DEFINER`. A policy on `memberships` that queries
`memberships` would otherwise recurse into its own policy.

| Table                                                       | Read                                | Write                                                                                                             |
| ----------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| organizations, positions, certification types, requirements | members of the org                  | none in phase 1 (seed only)                                                                                       |
| memberships                                                 | members of the same org             | none in phase 1                                                                                                   |
| profiles                                                    | self, or users sharing an org       | self (name only)                                                                                                  |
| user_certifications                                         | self, or managers/admins of the org | none in phase 1                                                                                                   |
| shifts                                                      | members of the org                  | managers/admins of the org                                                                                        |
| swap_requests                                               | members of the org                  | insert: staff for a shift assigned to themselves; update: participants and managers, by narrow per-actor policies |

**Admin is a superset of manager** in every shift/swap policy. In a later phase,
membership, position and certification-type management will be **admin-only**.

## Defense in depth

Each rule is enforced by the layer that can explain it best, and backed by a layer that can't be skipped:

| Rule                                  | Service layer (readable error)                                        | Database (backstop)                                 |
| ------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------- |
| Tenant isolation                      | queries scoped by org                                                 | RLS policies; composite `(id, organization_id)` FKs |
| Who may create shifts / approve swaps | role check → 403                                                      | RLS `with check`                                    |
| Certification eligibility             | `CertificationEligibilityService` → 422                               | none (needs time-dependent joins, see below)        |
| No overlapping assignments            | overlap query → 409 `SHIFT_OVERLAP`                                   | exclusion constraint, `23P01` mapped to 409         |
| One active swap per shift             | lookup → 409 `SWAP_ALREADY_ACTIVE`                                    | partial unique index, `23505` mapped to 409         |
| Concurrent claim of an open offer     | conditional `update ... where status = 'pending'` → 409 for the loser | row lock taken by the update                        |

The certification rule stays in the service layer only. A trigger could enforce it, but it
would have to re-evaluate on certification changes too, and it would surface as an opaque
error. The rule is covered by unit and integration tests instead.

## Consequences

- **One pooled connection is held for the whole request.** Pool size caps concurrent
  in-flight requests per task (`DATABASE_POOL_SIZE`). Handlers must not do slow I/O inside
  the transaction. Phase-5 LLM calls will run outside it and use `rls.run()` only around
  the DB work.
- **Streaming responses** don't fit "commit when the handler completes". None are planned.
- **Two extra round-trips per request** (`set local role`, `set_config`). They're cheap
  compared with the queries themselves. They could be folded into one statement if needed.
- Every request that touches the DB is a transaction, including reads. In return, reads
  within a request are consistent.
- RLS controls _who_ may write _which rows_, not _which transitions_ are valid. A
  participant could, in principle, write a valid-for-RLS but nonsensical status change if a
  service bug let it through. Transition validity is enforced in the service. A
  `BEFORE UPDATE` transition trigger is a possible hardening step.
- On hosted Supabase the pooler user is `covershift_api.<project-ref>`. The role and its
  password are provisioned outside the app (Terraform/secret manager, phase 4). The
  migration only creates the role and its membership.
