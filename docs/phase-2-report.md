# Phase 2 report (draft)

Running notes, finished at the end of phase 2.

## Deferred

To phase 4 (deployment):

- **Route-level code-splitting for the web bundle.** The production bundle is one chunk of
  ~730 kB (~215 kB gzipped), mostly supabase-js and zod. Lazy routes (`React.lazy` per
  feature) are the cheap fix once there's a CDN and real latency to measure against.
- **Hosted Supabase auth settings** are configured outside `supabase/config.toml` and must be
  set and verified per environment: signup off, email provider on, JWT expiry, refresh-token
  rotation, redirect URLs. Locally, `[auth.email] enable_signup = false` turned out to disable
  every password login.
- **Reuse `apps/web/security-headers.ts`** for the hosted CSP and companion headers (the
  e2e suite already runs under them), plus `upgrade-insecure-requests` and HSTS once on HTTPS.

## Codex reviews

### #21 (swap screens), `/codex:review --base main`

**Finding (P1):** `apps/web/e2e/fixtures.ts:68`: contexts created with `browser.newContext()`
don't inherit `use.baseURL`, so `page.goto('/login')` in `as(email)` would fail and the
swap-flow, stale-role and deep-link tests couldn't run.

**Outcome: false positive, hardened anyway.**

- _Mechanism._ Inside a test, `@playwright/test` 1.64 registers a `runBeforeCreateBrowserContext`
  instrumentation hook (`playwright/lib/index.js`, lines 122–126) that copies every configured
  context option (`_combinedContextOptions`, which includes `use.baseURL`, lines 290 and 343–344)
  into any browser context created during the test, unless the caller set that key. That
  covers `browser.newContext()` from test code. The finding holds for the plain `playwright`
  library, not for the test runner.
- _Evidence the tests ran._ CI run 38630599423 (head `07bcf16`), E2E job: 14 tests,
  0 skipped. The deep-link test took 566 ms, stale-role 699 ms, and full swap 3.2 s. Earlier
  negative controls (no `/me` refetch after a 403, Approve wired to reject) made these tests
  fail at assertions _after_ sign-in, deep into the flows, which couldn't happen if
  navigation threw.
- _Change._ The fixture now passes `baseURL` explicitly and throws if it's unset, so it
  doesn't depend on runner-internal behavior or on being called inside a test.
