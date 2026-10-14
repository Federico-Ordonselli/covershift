import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * Connection role, grants, RLS helper functions and policies. See ADR 001.
 *
 * Reading guide:
 * - `covershift_api` has no privileges of its own (NOINHERIT). Everything below is granted
 *   to `authenticated`, which the API assumes per transaction with `set local role`.
 * - Grants decide which statements are possible at all; policies decide which rows.
 * - Admin is a superset of manager: every scheduler check passes for both.
 */
export class RlsPolicies1791980455094 implements MigrationInterface {
  name = 'RlsPolicies1791980455094';

  async up(q: QueryRunner): Promise<void> {
    // ---------------------------------------------------------------- connection role
    // Created without a password: deployed environments set it out of band, and
    // scripts/migrate.ts sets it locally from COVERSHIFT_API_DB_PASSWORD.
    await q.query(`
      do $$
      begin
        if not exists (select from pg_catalog.pg_roles where rolname = 'covershift_api') then
          create role covershift_api login noinherit;
        end if;
      end
      $$`);
    // inherit false: no privileges until `set role authenticated`; a query outside the RLS
    // transaction fails with "permission denied" instead of running with broad rights.
    await q.query(`grant authenticated to covershift_api with inherit false, set true`);

    // ---------------------------------------------------------------- grants
    await q.query(`grant usage on schema app to authenticated`);
    // Read access to every table; RLS decides which rows.
    await q.query(`grant select on all tables in schema app to authenticated`);
    await q.query(`grant insert, update, delete on app.shifts to authenticated`);
    // No delete on swap_requests: they are an audit trail, terminal states are kept.
    await q.query(`grant insert on app.swap_requests to authenticated`);
    // Column-level: nobody can rewrite which shift, org or requester a request belongs to.
    await q.query(`
      grant update (status, target_user_id, decided_by_id, decided_at, updated_at)
        on app.swap_requests to authenticated`);
    await q.query(`grant update (full_name, updated_at) on app.profiles to authenticated`);

    // ---------------------------------------------------------------- helpers
    // SECURITY DEFINER so policies on memberships can consult memberships without
    // recursing into their own policy. STABLE: same answer within a statement.
    // Empty search_path + qualified names: immune to search_path hijacking.
    await q.query(`
      create function app.is_member(org_id uuid)
      returns boolean
      language sql
      stable
      security definer
      set search_path = ''
      as $$
        select exists (
          select 1
          from app.memberships m
          where m.organization_id = org_id
            and m.user_id = (select auth.uid())
        )
      $$`);

    await q.query(`
      create function app.has_role(org_id uuid, roles app.membership_role[])
      returns boolean
      language sql
      stable
      security definer
      set search_path = ''
      as $$
        select exists (
          select 1
          from app.memberships m
          where m.organization_id = org_id
            and m.user_id = (select auth.uid())
            and m.role = any (roles)
        )
      $$`);

    // Coworker visibility for profiles: the caller and `other_user` share at least one org.
    await q.query(`
      create function app.shares_org(other_user uuid)
      returns boolean
      language sql
      stable
      security definer
      set search_path = ''
      as $$
        select exists (
          select 1
          from app.memberships me
          join app.memberships them on them.organization_id = me.organization_id
          where me.user_id = (select auth.uid())
            and them.user_id = other_user
        )
      $$`);

    for (const fn of [
      'app.is_member(uuid)',
      'app.has_role(uuid, app.membership_role[])',
      'app.shares_org(uuid)',
    ]) {
      await q.query(`revoke execute on function ${fn} from public, anon`);
      await q.query(`grant execute on function ${fn} to authenticated`);
    }

    // ---------------------------------------------------------------- read policies
    await q.query(`
      create policy organizations_select_member on app.organizations
        for select to authenticated
        using (app.is_member(id))`);

    await q.query(`
      create policy memberships_select_same_org on app.memberships
        for select to authenticated
        using (app.is_member(organization_id))`);

    await q.query(`
      create policy profiles_select_self_or_coworker on app.profiles
        for select to authenticated
        using (id = (select auth.uid()) or app.shares_org(id))`);
    await q.query(`
      create policy profiles_update_self on app.profiles
        for update to authenticated
        using (id = (select auth.uid()))
        with check (id = (select auth.uid()))`);

    for (const table of [
      'certification_types',
      'positions',
      'position_certification_requirements',
    ]) {
      await q.query(`
        create policy ${table}_select_member on app.${table}
          for select to authenticated
          using (app.is_member(organization_id))`);
    }

    // Certifications are personal data: visible to the holder and to the org's schedulers.
    await q.query(`
      create policy user_certifications_select_self_or_scheduler on app.user_certifications
        for select to authenticated
        using (
          user_id = (select auth.uid())
          or app.has_role(organization_id, '{admin,manager}')
        )`);

    // ---------------------------------------------------------------- shifts
    await q.query(`
      create policy shifts_select_member on app.shifts
        for select to authenticated
        using (app.is_member(organization_id))`);
    await q.query(`
      create policy shifts_insert_scheduler on app.shifts
        for insert to authenticated
        with check (app.has_role(organization_id, '{admin,manager}'))`);
    // with check also prevents moving a shift into an org where the caller isn't a scheduler.
    await q.query(`
      create policy shifts_update_scheduler on app.shifts
        for update to authenticated
        using (app.has_role(organization_id, '{admin,manager}'))
        with check (app.has_role(organization_id, '{admin,manager}'))`);
    await q.query(`
      create policy shifts_delete_scheduler on app.shifts
        for delete to authenticated
        using (app.has_role(organization_id, '{admin,manager}'))`);

    // ---------------------------------------------------------------- swap_requests
    await q.query(`
      create policy swap_requests_select_member on app.swap_requests
        for select to authenticated
        using (app.is_member(organization_id))`);

    // Anyone (staff or not) may offer only a shift currently assigned to themselves.
    // The subquery runs under the caller's RLS, which is fine: it only needs own-org shifts.
    await q.query(`
      create policy swap_requests_insert_own_shift on app.swap_requests
        for insert to authenticated
        with check (
          requester_id = (select auth.uid())
          and status = 'pending'
          and decided_by_id is null
          and decided_at is null
          and exists (
            select 1
            from app.shifts s
            where s.id = shift_id
              and s.organization_id = swap_requests.organization_id
              and s.assigned_user_id = (select auth.uid())
          )
        )`);

    // Update policies are narrow per actor. Postgres ORs permissive policies and checks
    // USING and WITH CHECK independently (the new row may pass a different policy's check
    // than the one whose USING matched), so each WITH CHECK must be safe on its own:
    // staff-reachable checks pin the actor column to auth.uid(), allow only that actor's
    // target statuses, and forbid decision fields. 'approved'/'rejected' pass only the
    // scheduler policy.

    // Requester withdraws: pending|accepted -> cancelled.
    await q.query(`
      create policy swap_requests_update_requester_cancel on app.swap_requests
        for update to authenticated
        using (requester_id = (select auth.uid()) and status in ('pending', 'accepted'))
        with check (
          requester_id = (select auth.uid())
          and status = 'cancelled'
          and decided_by_id is null
        )`);

    // Direct target responds: pending -> accepted|declined.
    await q.query(`
      create policy swap_requests_update_target_respond on app.swap_requests
        for update to authenticated
        using (target_user_id = (select auth.uid()) and status = 'pending')
        with check (
          target_user_id = (select auth.uid())
          and status in ('accepted', 'declined')
          and decided_by_id is null
        )`);

    // Any other member claims an open offer: pending (target null) -> accepted (target = me).
    await q.query(`
      create policy swap_requests_update_claim_open_offer on app.swap_requests
        for update to authenticated
        using (
          target_user_id is null
          and status = 'pending'
          and requester_id <> (select auth.uid())
          and app.is_member(organization_id)
        )
        with check (
          target_user_id = (select auth.uid())
          and status = 'accepted'
          and decided_by_id is null
        )`);

    // Managers/admins decide (approve/reject). Transition validity lives in the service.
    await q.query(`
      create policy swap_requests_update_scheduler on app.swap_requests
        for update to authenticated
        using (app.has_role(organization_id, '{admin,manager}'))
        with check (app.has_role(organization_id, '{admin,manager}'))`);
  }

  async down(q: QueryRunner): Promise<void> {
    const policies: Array<[string, string]> = [
      ['swap_requests', 'swap_requests_update_scheduler'],
      ['swap_requests', 'swap_requests_update_claim_open_offer'],
      ['swap_requests', 'swap_requests_update_target_respond'],
      ['swap_requests', 'swap_requests_update_requester_cancel'],
      ['swap_requests', 'swap_requests_insert_own_shift'],
      ['swap_requests', 'swap_requests_select_member'],
      ['shifts', 'shifts_delete_scheduler'],
      ['shifts', 'shifts_update_scheduler'],
      ['shifts', 'shifts_insert_scheduler'],
      ['shifts', 'shifts_select_member'],
      ['user_certifications', 'user_certifications_select_self_or_scheduler'],
      ['position_certification_requirements', 'position_certification_requirements_select_member'],
      ['positions', 'positions_select_member'],
      ['certification_types', 'certification_types_select_member'],
      ['profiles', 'profiles_update_self'],
      ['profiles', 'profiles_select_self_or_coworker'],
      ['memberships', 'memberships_select_same_org'],
      ['organizations', 'organizations_select_member'],
    ];
    for (const [table, policy] of policies) {
      await q.query(`drop policy ${policy} on app.${table}`);
    }

    await q.query(`drop function app.shares_org(uuid)`);
    await q.query(`drop function app.has_role(uuid, app.membership_role[])`);
    await q.query(`drop function app.is_member(uuid)`);

    await q.query(`revoke all on all tables in schema app from authenticated`);
    await q.query(`revoke usage on schema app from authenticated`);

    await q.query(`revoke authenticated from covershift_api`);
    await q.query(`drop role if exists covershift_api`);
  }
}
