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

Helpers (in `app`, `SECURITY DEFINER`, `STABLE`, `set search_path = ''`). Only
**active** memberships count:

- `app.member_org_ids()`: orgs the caller belongs to.
- `app.scheduler_org_ids()`: orgs where the caller is manager or admin.
- `app.coworker_ids()`: users sharing an org with the caller.
- `app.has_role(org_id, roles[])`: point check, used by the transition triggers.

Policies use the set-returning helpers as uncorrelated subqueries:
`organization_id in (select app.member_org_ids())`. Postgres evaluates that once per
statement as a hashed subplan, instead of calling a function per row. Every `auth.uid()`
is likewise wrapped as `(select auth.uid())` (Supabase's `auth_rls_initplan` guidance). A
catalog test fails the build if any policy contains an unwrapped `auth.*`/`app.*` call. It
also fails if a table in `app` lacks RLS, or if a `SECURITY DEFINER` function doesn't pin
`search_path`.

The helpers have to be `SECURITY DEFINER`. A policy on `memberships` that queries
`memberships` would otherwise recurse into its own policy.

| Table                                                       | Read                                | Write                                                                                   |
| ----------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------- |
| organizations, positions, certification types, requirements | members of the org                  | none in phase 1 (seed only)                                                             |
| memberships                                                 | members of the same org             | none in phase 1                                                                         |
| profiles                                                    | self, or users sharing an org       | self (name only)                                                                        |
| user_certifications                                         | self, or managers/admins of the org | none in phase 1                                                                         |
| shifts                                                      | members of the org                  | managers/admins of the org                                                              |
| swap_requests                                               | members of the org                  | insert: anyone, for a shift assigned to themselves; update: see the state machine below |

**Admin is a superset of manager** in every shift/swap policy. In a later phase,
membership, position and certification-type management will be **admin-only**.

## Swap requests: the transition trigger is required

The first version of the policies tried to encode the swap state machine as one narrow
`UPDATE` policy per actor (requester cancels, target responds, member claims, manager
decides). A security review showed this is **unsound**, and it was reproduced against
the database:

- Postgres ORs permissive policies and evaluates `USING` (old row) and `WITH CHECK` (new
  row) **independently**. The new row may pass a different policy's check from the one whose
  `USING` matched.
- `WITH CHECK` sees only the new row. It cannot tell "this was an open offer" from "this
  was a direct offer to me".
- Result: any coworker could _decline_ someone else's open offer. The claim policy's
  `USING` matched, and the target-respond policy's `WITH CHECK` passed once they set
  themselves as target. Staff could also forge `decided_at`, and a manager could record
  another manager as `decided_by_id`.

Legal transitions depend on old row, new row and actor together, which only a trigger
sees. So:

- **One update policy** decides which rows an actor may _touch_: active members who are
  the requester, the target, anyone (for open offers), or a scheduler.
- **`BEFORE UPDATE` trigger `app.guard_swap_request_update()`** decides which
  _transitions_ are legal for that actor:

  | from             | to        | actor                                                            |
  | ---------------- | --------- | ---------------------------------------------------------------- |
  | pending/accepted | cancelled | requester                                                        |
  | pending          | declined  | direct target                                                    |
  | pending          | accepted  | direct target, or any other active member claiming an open offer |
  | accepted         | approved  | manager/admin who is neither requester nor target                |
  | pending/accepted | rejected  | manager/admin who is neither requester nor target                |

  The trigger also owns the audit fields: it sets `decided_by_id = auth.uid()` and
  `decided_at = now()`. Callers have no `UPDATE` grant on them. `target_user_id` changes
  only when an open offer is claimed. Accepting or approving is refused once the shift
  has started.

- **`AFTER UPDATE` trigger `app.apply_approved_swap()`** reassigns the shift to the target
  in the same statement as the approval, guarded by `assigned_user_id = requester_id`. The
  exclusion constraint, the membership FK and the shifts RLS policy all apply atomically
  with the approval. If the shift was reassigned in the meantime, approval fails with
  `SWAP_CONFLICT`.
- **`BEFORE INSERT` trigger** requires new requests to be `pending`, undecided, created by
  their requester, and for a shift that hasn't started.
- **Timestamps are database-owned on every table.** `app.stamp_timestamps()` (fires first
  among `BEFORE` triggers) sets `created_at` on insert and pins it afterwards, and sets
  `updated_at` on every write, for every role. Whatever the caller sends is overwritten.
- **CHECK `swap_requests_decider_not_participant_check`** is a backstop that holds even for
  maintenance roles: the decider is never the requester or the target.

**Fail closed.** The triggers exempt only an explicit allowlist of maintenance roles
(`postgres`, `supabase_admin`: migrations, seed, platform internals). Every other role,
including `service_role` and any role added later, is held to the state machine.

**What the trigger does not solve:** two members claiming the same open offer at once. The
service claims with a conditional `update ... where id = $1 and status = 'pending' and
target_user_id is null`. The second transaction blocks on the row lock, re-evaluates the
`WHERE` after the first commits, matches 0 rows, and gets a 409.

## Errors: database → HTTP

Services map database outcomes to problem-details responses. Raw driver errors never reach the client:

| Database outcome                                            | HTTP | Notes                                                                   |
| ----------------------------------------------------------- | ---- | ----------------------------------------------------------------------- |
| `42501` insufficient privilege / RLS `WITH CHECK` violation | 403  | the caller may not write this row                                       |
| 0 rows affected by an update/delete                         | 404  | row doesn't exist **or** RLS hides it; deliberately indistinguishable   |
| `CS409` (transition trigger)                                | 409  | message is `<ERROR_CODE>: <reason>`; code and reason are passed through |
| `23P01` exclusion violation                                 | 409  | `SHIFT_OVERLAP`                                                         |
| `23505` on `swap_requests_one_active_per_shift`             | 409  | `SWAP_ALREADY_ACTIVE`                                                   |

**Write path rule:** `swap_requests` is never written with `repository.save()`. `save()`
does a read-then-write and sends every changed column. That conflicts with the column
grants, and it cannot express the conditional `WHERE status = 'pending'` that resolves
claim races. Updates use the query builder with explicit columns and check `affected`.

## Memberships: soft delete vs hard delete

- **Soft delete (the normal path).** Set `memberships.deactivated_at`. The helpers count
  only active memberships, so the user immediately loses all access to the org.
  Shift and swap history keep pointing at a valid row, and coworkers still see
  their name in that history.
- **Hard delete (exceptional, admin-only in a later phase).** `delete from memberships`
  unassigns the user's shifts (`ON DELETE SET NULL (assigned_user_id)`). It is **refused**
  if the user has any swap history, which protects the audit trail.
- **Deleting an organization** cascades everything. The FKs that protect history are
  `NO ACTION DEFERRABLE INITIALLY DEFERRED`. `RESTRICT`, and even immediate `NO ACTION`,
  fire before sibling cascades have run, so they would block deleting the org.

## Defense in depth

Each rule is enforced by the layer that can explain it best, and backed by a layer that can't be skipped:

| Rule                                   | Service layer (readable error)                                                        | Database (backstop)                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Tenant isolation                       | queries scoped by org                                                                 | RLS policies; composite `(id, organization_id)` FKs |
| Who may create shifts                  | role check → 403                                                                      | RLS `with check`                                    |
| Swap transitions and who performs them | none: the trigger is the single source of truth; its `CS409` reason is passed through | transition trigger, column grants                   |
| Decider ≠ requester/target             | none (trigger reason passed through)                                                  | trigger, and CHECK constraint                       |
| Certification eligibility              | `CertificationEligibilityService` → 422 (on assign, accept, approve)                  | none (needs time-dependent joins, see below)        |
| No overlapping assignments             | overlap query → 409 `SHIFT_OVERLAP`                                                   | exclusion constraint, `23P01` mapped to 409         |
| One active swap per shift              | lookup → 409 `SWAP_ALREADY_ACTIVE`                                                    | partial unique index, `23505` mapped to 409         |
| Concurrent claim of an open offer      | conditional `update ... where status = 'pending'` → 409 for the loser                 | row lock taken by the update                        |

The certification rule stays in the service layer only. A trigger could enforce it, but it
would also have to re-run whenever a certification changes, and it would fail with an opaque
error. It's checked at assignment, at accept/claim (fail fast), and again at approval inside
the approving transaction, because certificates can expire in between. It is covered by
unit and integration tests.

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
- The swap state machine lives **only in the trigger**. Its errors already carry a code
  and a readable reason, so a TypeScript copy would add nothing but drift risk. The service
  layer handles what the trigger can't: certification eligibility, the claim race, and
  mapping outcomes to HTTP.
- On hosted Supabase the pooler user is `covershift_api.<project-ref>`. The role and its
  password are provisioned outside the app (Terraform/secret manager, phase 4). The
  migration only creates the role and its membership.
