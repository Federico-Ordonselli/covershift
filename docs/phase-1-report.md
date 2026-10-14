# Phase 1 report

- Scope: monorepo, NestJS API, schema and RLS, JWT + RLS transaction unit, shift and swap
  endpoints, seed, tests, CI and security gates.
- State at the end of phase 1: 30 commits, ~2.7k lines of application code, ~2.7k lines of
  tests, 163 tests (37 unit, 126 integration/e2e against real Supabase), CI and Security
  green on every push since they were added.

## Done

**Tenant isolation enforced by Postgres, even for our own backend** ([ADR 001](adr/001-rls-through-nestjs.md))

- The API verifies Supabase JWTs against the project JWKS. Only ES256/RS256 are accepted,
  checked for `iss`, `aud` and `exp`, and the claims must have the shape of a user token, so
  the stack's own `anon` and `service_role` keys are rejected.
- Every authenticated request runs in one transaction with
  `set local role authenticated` + transaction-local `request.jwt.claims`. This is safe with
  pooling and Supavisor, because nothing outlives the transaction.
- The API's login role `covershift_api` is `NOINHERIT` with no grants, so a query outside the
  wrapper fails with `permission denied`. A test proves it, and another proves that the
  identity never leaks to the next user of a pooled connection.
- Domain tables live in schema `app`, which the Supabase Data API does not expose, so nobody
  can bypass the service-layer rules through PostgREST.
- Policies use set-returning helpers as `(select …)` subqueries, so they're evaluated once per
  statement. A catalog test fails the build on unwrapped `auth.uid()` or helper calls, on
  tables without RLS, and on `SECURITY DEFINER` functions without a pinned `search_path`.

**Domain rules, each with a backstop**

- **Certification eligibility:** a certificate must be valid when the shift _ends_. It's
  checked at assignment, at accept/claim (fail fast), and again at approval inside the
  approving transaction.
- **No double-booking:** a service check gives a readable 409, backed by a per-organization
  exclusion constraint (`'[)'` ranges, so back-to-back shifts are allowed).
- **Swap state machine:** a database trigger is the single source of truth. Audit fields
  (`decided_by_id`, `decided_at`) and all timestamps are set by the database. The approver can
  never be a participant (trigger, plus a CHECK constraint). Approval reassigns the shift in
  the same statement through an `AFTER` trigger. Claims are a conditional update, so of two
  concurrent claims exactly one wins.
- **Composite `(id, organization_id)` foreign keys:** cross-tenant references are impossible
  even with guessed ids.
- **Memberships are soft-deleted:** access is lost immediately, history stays intact.
  Hard deletes are blocked once swap history exists.
- **Uniform HTTP semantics:** hidden 404, visible-but-not-yours 403, wrong state 409, rule
  violation 422, all as RFC 9457 problem details.

**Proof**

- RLS suites at the SQL level as the real API role, service tests under RLS, and HTTP e2e with
  real GoTrue logins and crafted requests: forged tokens, the stack's own keys, cross-tenant
  ids in paths, queries and bodies, mass assignment, and all five transitions.
- Negative controls for every suite, from running without RLS, reverting fixes, or disabling
  verification. One vacuous test was found this way and fixed.
- Regressions for every security-review finding (H1–H4 and the audit-timestamp forgery).

**Delivery**

- CI: lint (including a gate that fails the build on SQL built by interpolation), typecheck,
  unit tests, then integration on a real Supabase stack with a migration down/up round-trip.
- Security: CodeQL, gitleaks over full history (no allowlist, because no key-shaped values are
  tracked), `pnpm audit` (blocking on high in prod dependencies), and plpgsql_check.
- Dependabot for npm and actions. All actions SHA-pinned, least-privilege permissions,
  no secrets.
- A re-runnable seed that validates its own data with the domain rules.

## Fragile

1. **Certificate revocation race at approval and assignment.** Eligibility is read, then the
   write happens. A certificate revoked or shortened in between isn't noticed. That's harmless
   today because certificates are seed-only. **Cheap fix, first item when certificates become
   editable:** `SELECT … FOR SHARE` on the relevant `user_certifications` rows inside the
   approving or assigning transaction, so a concurrent edit waits for the commit or vice versa.
2. **One pooled connection per in-flight request.** Pool size caps concurrency per task, and
   any slow I/O inside a handler holds a connection. Phase-5 LLM calls must run outside the
   transaction.
3. **`request.jwt.claims` is settable from inside the session**, so a SQL injection would mean
   impersonation within RLS. This is an accepted risk (ADR 001). The lint gate is syntactic:
   SQL passed through helpers across modules can escape it.
4. **Maintenance roles (`postgres`, `supabase_admin`) bypass the swap triggers** by design,
   for migrations and the seed. CHECK constraints and FKs still apply to them, and the seed
   validates itself, but a hand-written fix-up script could store an illegal transition.
5. **Entity/schema drift isn't detected automatically.** Migrations are hand-written
   (ADR 002), and the integration tests only catch drift in columns they exercise.
6. **Overlap is checked per organization only.** Someone working for two tenants can be
   double-booked across them. That's deliberate, so as not to reveal rows across tenants, but
   it's a product gap.
7. **Eligibility ignores `issued_at`.** A certificate issued mid-shift counts as held for the
   whole shift.
8. **Deferred FK violations surface at `COMMIT`** as a generic 422 `INVALID_REFERENCE`.
   Service pre-checks cover the known paths, so this is only a backstop.
9. **CI is tied to Supabase CLI internals.** The excluded container names are specific to CLI
   2.120, and cold startup takes 50–70 s, about half of CI wall-clock time.
10. **Ecosystem edges:**
    - NestJS 11, because 12 is ESM-only and `nestjs-zod` doesn't support it yet.
    - The CJS API loads the ESM shared package through Node 24's `require(esm)`.
    - One moderate `js-yaml` advisory (through `@nestjs/swagger`) is open.
    - Dependabot's handling of the pnpm 12 lockfile is unverified until its first PR.
11. **Integration tests share one database and run serially.** Isolation comes from unique
    tenants per file, and a crashed run can leave rows behind (the next `db reset` clears them).

## What I'd do differently

- **Model the swap state machine as a trigger from the start.** My first version used one
  narrow `UPDATE` policy per actor. That's unsound, because Postgres ORs permissive policies
  and checks `USING` and `WITH CHECK` independently. A security review found that any member
  could decline someone else's open offer, which a plan-level review would have caught earlier.
- **Test cascades when writing FKs.** I first chose `RESTRICT` to protect history, which broke
  organization deletion. Then I proposed `NO ACTION`, which also failed, because each cascade
  is its own statement. Only `DEFERRABLE INITIALLY DEFERRED` works.
- **Write negative controls together with the tests**, not afterwards. One test
  (`count = 1` with a single tenant) was green with RLS switched off.
- **Never track key-shaped values, even published local defaults.** GitHub push protection
  blocked the first push, and the fix was a history rewrite of 21 commits.
- **Add CI before feature work.** It arrived after commit 10, so the early commits were only
  verified locally.
- **Sabotage copies, not `git checkout`.** During a negative control, restoring with
  `git checkout` discarded uncommitted work. It was re-applied from a saved script and
  re-verified.
- **Parallelize integration tests with one database per worker** (Postgres template
  databases) instead of serial runs on a shared one.

## Phase 2 backlog

API work the frontend needs:

- `GET /organizations` (mine), `GET /organizations/:id/positions`, `GET /organizations/:id/members`
  with profile names. The UI can't render a schedule without them.
- Pagination and sorting for `GET /shifts` and `GET /swap-requests`.
- `GET /me`: memberships and roles for the logged-in user.

Product and domain:

- **Soft "cancelled" shift status** instead of `DELETE` (decision at checkpoint 3). Swap history
  stays, and the shift leaves the schedule.
- Membership, position and certification management endpoints, **admin-only** (ADR 001).
- `issued_at` in eligibility (fragile #7).
- The certificate `FOR SHARE` fix (fragile #1), as soon as certificates become editable.

Frontend (phase 2 proper):

- React + Vite with Supabase Auth login, a schedule view per organization, and the swap flow
  (offer, claim, accept/decline, manager approve/reject). Problem `code`s map to UI messages.

Engineering:

- Cache Supabase Docker images in CI, or start the stack in parallel with the static jobs.
- Nest 12 once `nestjs-zod` supports it, and resolve the `js-yaml` advisory.
- Rate limiting on the API before any public deployment (phase 4).
