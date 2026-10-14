# ADR 002: TypeORM migrations own the schema; migrations are hand-written SQL

- Status: accepted
- Date: 2026-10-14

## Context

Supabase projects usually manage schema with `supabase/migrations/*.sql`. This project's
requirement is that TypeORM migrations own the schema. RLS policies, grants and the
`auth.users` trigger must live in those migrations too.

## Decision

- `supabase/migrations` is unused, and `[db.migrations]` is disabled in `config.toml`.
- `synchronize` is never enabled, in any environment. `dataSourceOptions()` hard-codes
  `synchronize: false` and `migrationsRun: false`.
- Migrations are TypeORM classes containing **hand-written SQL**. `migration:generate` is
  not used, because entity metadata cannot express much of what the schema relies on:
  composite tenant FKs `(x_id, organization_id)`, `ON DELETE SET NULL (column)`, the
  exclusion constraint, partial unique indexes, RLS, grants, roles and triggers.
  Generated diffs would try to drop those objects.
- Entities are **mappings**, not the source of truth for constraints. Relations declare
  `createForeignKeyConstraints: false`.
- Migrations run through `scripts/migrate.ts` over `DATABASE_MIGRATION_URL` (privileged),
  one transaction per migration. TypeORM's bookkeeping table is `ops.typeorm_migrations`,
  outside `public`, so the Data API never exposes it.
- Every migration has a working `down`. Down migrations of the first two migrations are
  exercised locally (`pnpm db:migrate revert`).

## Consequences

- Entity/schema drift is possible and is not detected automatically. The integration tests
  exercise every entity against the real schema, which catches mapping drift (wrong
  column names or types) at test time.
- Reviewers read SQL, which is what RLS review needs anyway.
