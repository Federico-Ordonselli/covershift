import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * Domain schema. Hand-written SQL (see ADR 002): composite tenant FKs, the exclusion
 * constraint and RLS are not expressible through entity metadata.
 *
 * Tables live in `app`, not `public`: Supabase exposes `public` through the Data API
 * (PostgREST), which would let any authenticated user write rows while skipping the
 * service-layer rules (certifications, overlaps). `app` is reachable only through NestJS.
 *
 * RLS is enabled here with no policies (deny-all), so there is never a window where
 * a table exists without row-level security. Policies arrive in the next migration.
 */
export class InitSchema1791980455093 implements MigrationInterface {
  name = 'InitSchema1791980455093';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`create extension if not exists btree_gist with schema extensions`);

    await q.query(`create schema app`);
    await q.query(`revoke all on schema app from public`);
    await q.query(
      `comment on schema app is 'Covershift domain. Not exposed via the Data API; accessed through the NestJS API only.'`,
    );

    await q.query(`create type app.membership_role as enum ('admin', 'manager', 'staff')`);
    await q.query(`
      create type app.swap_request_status as enum (
        'pending', 'accepted', 'declined', 'approved', 'rejected', 'cancelled'
      )`);

    await q.query(`
      create table app.profiles (
        id          uuid primary key references auth.users (id) on delete cascade,
        full_name   text not null default '',
        created_at  timestamptz not null default now(),
        updated_at  timestamptz not null default now()
      )`);

    await q.query(`
      create table app.organizations (
        id          uuid primary key default gen_random_uuid(),
        name        text not null check (length(trim(name)) > 0),
        slug        text not null unique check (slug ~ '^[a-z0-9-]+$'),
        timezone    text not null default 'UTC',
        created_at  timestamptz not null default now(),
        updated_at  timestamptz not null default now()
      )`);

    await q.query(`
      create table app.memberships (
        id               uuid primary key default gen_random_uuid(),
        organization_id  uuid not null references app.organizations (id) on delete cascade,
        user_id          uuid not null references app.profiles (id) on delete cascade,
        role             app.membership_role not null,
        created_at       timestamptz not null default now(),
        -- one membership per user per org; also the target of every "is a member" FK below
        constraint memberships_organization_user_key unique (organization_id, user_id)
      )`);
    // RLS helpers look memberships up by user on every query.
    await q.query(`create index memberships_user_id_idx on app.memberships (user_id)`);

    await q.query(`
      create table app.certification_types (
        id               uuid primary key default gen_random_uuid(),
        organization_id  uuid not null references app.organizations (id) on delete cascade,
        name             text not null,
        created_at       timestamptz not null default now(),
        constraint certification_types_organization_name_key unique (organization_id, name),
        constraint certification_types_id_organization_key unique (id, organization_id)
      )`);

    await q.query(`
      create table app.positions (
        id               uuid primary key default gen_random_uuid(),
        organization_id  uuid not null references app.organizations (id) on delete cascade,
        name             text not null,
        created_at       timestamptz not null default now(),
        constraint positions_organization_name_key unique (organization_id, name),
        constraint positions_id_organization_key unique (id, organization_id)
      )`);

    // Composite FKs (x_id, organization_id) make cross-tenant references impossible:
    // a position in org A cannot require a certification type from org B.
    await q.query(`
      create table app.position_certification_requirements (
        organization_id        uuid not null,
        position_id            uuid not null,
        certification_type_id  uuid not null,
        primary key (position_id, certification_type_id),
        foreign key (position_id, organization_id)
          references app.positions (id, organization_id) on delete cascade,
        foreign key (certification_type_id, organization_id)
          references app.certification_types (id, organization_id) on delete cascade
      )`);

    await q.query(`
      create table app.user_certifications (
        id                     uuid primary key default gen_random_uuid(),
        organization_id        uuid not null,
        user_id                uuid not null,
        certification_type_id  uuid not null,
        issued_at              timestamptz,
        expires_at             timestamptz, -- null = does not expire
        file_path              text,
        created_at             timestamptz not null default now(),
        updated_at             timestamptz not null default now(),
        foreign key (organization_id, user_id)
          references app.memberships (organization_id, user_id) on delete cascade,
        foreign key (certification_type_id, organization_id)
          references app.certification_types (id, organization_id) on delete cascade,
        constraint user_certifications_validity_check
          check (expires_at is null or issued_at is null or expires_at > issued_at)
      )`);
    await q.query(`
      create index user_certifications_user_type_idx
        on app.user_certifications (user_id, certification_type_id)`);

    await q.query(`
      create table app.shifts (
        id                uuid primary key default gen_random_uuid(),
        organization_id   uuid not null references app.organizations (id) on delete cascade,
        position_id       uuid not null,
        starts_at         timestamptz not null,
        ends_at           timestamptz not null,
        assigned_user_id  uuid,
        created_at        timestamptz not null default now(),
        updated_at        timestamptz not null default now(),
        constraint shifts_time_order_check check (ends_at > starts_at),
        constraint shifts_id_organization_key unique (id, organization_id),
        foreign key (position_id, organization_id)
          references app.positions (id, organization_id) on delete restrict,
        -- the assignee must be a member of the shift's org; leaving the org unassigns
        -- (MATCH SIMPLE: not checked while assigned_user_id is null)
        foreign key (organization_id, assigned_user_id)
          references app.memberships (organization_id, user_id)
          on delete set null (assigned_user_id),
        -- Backstop for the service-layer overlap check. Scoped per organization, so the
        -- constraint never reveals that a shift exists in a tenant the caller can't see.
        -- '[)' makes back-to-back shifts (06-14, 14-22) legal.
        constraint shifts_no_overlap_per_assignee exclude using gist (
          organization_id with =,
          assigned_user_id with =,
          tstzrange(starts_at, ends_at, '[)') with &&
        ) where (assigned_user_id is not null)
      )`);
    await q.query(
      `create index shifts_organization_starts_at_idx on app.shifts (organization_id, starts_at)`,
    );

    await q.query(`
      create table app.swap_requests (
        id               uuid primary key default gen_random_uuid(),
        organization_id  uuid not null,
        shift_id         uuid not null,
        requester_id     uuid not null,
        target_user_id   uuid, -- null = open offer
        status           app.swap_request_status not null default 'pending',
        note             text check (length(note) <= 500),
        decided_by_id    uuid references app.profiles (id) on delete set null,
        decided_at       timestamptz,
        created_at       timestamptz not null default now(),
        updated_at       timestamptz not null default now(),
        foreign key (shift_id, organization_id)
          references app.shifts (id, organization_id) on delete cascade,
        -- restrict: a membership with swap history can't silently erase the audit trail
        foreign key (organization_id, requester_id)
          references app.memberships (organization_id, user_id) on delete restrict,
        foreign key (organization_id, target_user_id)
          references app.memberships (organization_id, user_id) on delete restrict,
        constraint swap_requests_not_self_check
          check (target_user_id is null or target_user_id <> requester_id),
        constraint swap_requests_decision_check
          check (status not in ('approved', 'rejected') or decided_at is not null)
      )`);
    // At most one in-flight request per shift. Doubles as the race guard for creation.
    await q.query(`
      create unique index swap_requests_one_active_per_shift
        on app.swap_requests (shift_id) where status in ('pending', 'accepted')`);
    await q.query(
      `create index swap_requests_organization_status_idx on app.swap_requests (organization_id, status)`,
    );

    for (const table of [
      'profiles',
      'organizations',
      'memberships',
      'certification_types',
      'positions',
      'position_certification_requirements',
      'user_certifications',
      'shifts',
      'swap_requests',
    ]) {
      await q.query(`alter table app.${table} enable row level security`);
    }

    // Profile row for every auth user. SECURITY DEFINER because GoTrue's role can't write
    // to app.profiles; empty search_path + fully qualified names so a malicious object on
    // the caller's search_path can't hijack the function.
    await q.query(`
      create function app.handle_new_user()
      returns trigger
      language plpgsql
      security definer
      set search_path = ''
      as $$
      begin
        insert into app.profiles (id, full_name)
        values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
        return new;
      end;
      $$`);
    await q.query(
      `revoke execute on function app.handle_new_user() from public, anon, authenticated`,
    );
    await q.query(`
      create trigger on_auth_user_created
        after insert on auth.users
        for each row execute function app.handle_new_user()`);
  }

  async down(q: QueryRunner): Promise<void> {
    // Trigger lives on auth.users, outside our schema: drop it explicitly before the function.
    await q.query(`drop trigger if exists on_auth_user_created on auth.users`);
    await q.query(`drop function if exists app.handle_new_user()`);
    await q.query(`drop table app.swap_requests`);
    await q.query(`drop table app.shifts`);
    await q.query(`drop table app.user_certifications`);
    await q.query(`drop table app.position_certification_requirements`);
    await q.query(`drop table app.positions`);
    await q.query(`drop table app.certification_types`);
    await q.query(`drop table app.memberships`);
    await q.query(`drop table app.organizations`);
    await q.query(`drop table app.profiles`);
    await q.query(`drop type app.swap_request_status`);
    await q.query(`drop type app.membership_role`);
    await q.query(`drop schema app`);
    // btree_gist is left installed: extensions are shared and dropping one is not ours to do.
  }
}
