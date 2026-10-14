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
