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
