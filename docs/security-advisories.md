# Security advisories

Dependency advisories that reached the project, how each was fixed, and what is still open.
The weekly `Security / Weekly dependency audit` run fails on high or critical advisories in
production dependencies; every such failure gets an entry here.

## Open workarounds

| Workaround                                           | Where                 | Remove when                                                      |
| ---------------------------------------------------- | --------------------- | ---------------------------------------------------------------- |
| `'@nestjs/platform-express>multer': ^2.5.0` override | `pnpm-workspace.yaml` | a `@nestjs/platform-express` release depends on `multer >=2.5.0` |

## 2026-10-26: body-parser, multer, fast-uri

- **Found by:** scheduled audit, run
  [40312314003](https://github.com/Federico-Ordonselli/covershift/actions/runs/40312314003)
  (CodeQL in the same run was clean).
- **Fixed in:** #34.

| Advisory                                                                                                                              | Severity       | Package     | Path                                                        | Vulnerable | Fixed |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ----------- | ----------------------------------------------------------- | ---------- | ----- |
| [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828): DoS via trailing bytes after a compressed request body      | high           | body-parser | `@nestjs/platform-express > express > body-parser`          | 2.3.0      | 2.4.0 |
| [GHSA-q7qp-rjg7-q26m](https://github.com/advisories/GHSA-q7qp-rjg7-q26m): DoS via a pending async `fileFilter` after request teardown | high           | multer      | `@nestjs/platform-express > multer`                         | 2.4.0      | 2.5.0 |
| fast-uri (two moderate, two low)                                                                                                      | moderate / low | fast-uri    | `ajv > fast-uri` (Nest CLI, webpack, `@hookform/resolvers`) | 3.1.8      | 3.1.9 |

**Exposure.**

- **body-parser:** parses every JSON request the API receives, so the API was exposed.
- **multer:** never called. The API has no file-upload routes (`FileInterceptor` isn't used),
  so multer was only installed.
- **fast-uri:** reached only through build tooling and through `@hookform/resolvers` in the
  web app. It isn't in the API's production dependencies.

**Fix.**

- **body-parser and fast-uri:** lockfile refresh. The dependents' caret ranges already
  allowed the patched versions. body-parser 2.4.0 also brought `qs` 6.16.0 → 6.16.1.
- **multer:** `@nestjs/platform-express` 12.2.0 (the latest at the time) pins `multer: 2.4.0`
  exactly, so upgrading Nest doesn't help. A pnpm override scoped to that one edge forces
  `^2.5.0`.

**Verified.**

- `pnpm audit`: no known vulnerabilities.
- Typecheck passes.
- All test suites pass, including the 259 API tests with integration against a local Supabase.
- The API builds.
- Every CI check on #34 passes.
