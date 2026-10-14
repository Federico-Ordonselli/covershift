import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * Connection role, grants, RLS helper functions, policies and the swap-request state
 * machine. See ADR 001.
 *
 * Reading guide:
 * - `covershift_api` has no privileges of its own (NOINHERIT). Everything below is granted
 *   to `authenticated`, which the API assumes per transaction with `set local role`.
 * - Grants decide which statements are possible at all; policies decide which rows;
 *   the swap-request triggers decide which *transitions* are legal (policies can't:
 *   WITH CHECK only sees the new row, never the old one).
 * - Admin is a superset of manager: every scheduler check passes for both.
 * - Only *active* memberships (deactivated_at is null) grant anything.
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
    // Column-level: callers may only move status and (when claiming) the target.
    // decided_by_id / decided_at are written by the transition trigger, never by callers.
    await q.query(
      `grant update (status, target_user_id, updated_at) on app.swap_requests to authenticated`,
    );
    await q.query(`grant update (full_name, updated_at) on app.profiles to authenticated`);

    // ---------------------------------------------------------------- helpers
    // Set-returning, so policies can use `organization_id in (select app.member_org_ids())`:
    // an uncorrelated subquery, evaluated once per statement (hashed), instead of a function
    // call per row. auth.uid() is wrapped in (select ...) for the same reason (Supabase's
    // auth_rls_initplan guidance); a test asserts no policy uses the unwrapped form.
    //
    // SECURITY DEFINER so policies on memberships can read memberships without recursing
    // into their own policy. Empty search_path + qualified names: immune to search_path
    // hijacking. Only *active* memberships count.
    await q.query(`
      create function app.member_org_ids()
      returns setof uuid
      language sql
      stable
      security definer
      set search_path = ''
      as $$
        select m.organization_id
        from app.memberships m
        where m.user_id = (select auth.uid())
          and m.deactivated_at is null
      $$`);

    // Orgs where the caller can manage the schedule. Admin is a superset of manager.
    await q.query(`
      create function app.scheduler_org_ids()
      returns setof uuid
      language sql
      stable
      security definer
      set search_path = ''
      as $$
        select m.organization_id
        from app.memberships m
        where m.user_id = (select auth.uid())
          and m.deactivated_at is null
          and m.role in ('admin', 'manager')
      $$`);

    // Users sharing an org with the caller (active caller; the coworker may be deactivated,
    // so names in shift/swap history stay readable).
    await q.query(`
      create function app.coworker_ids()
      returns setof uuid
      language sql
      stable
      security definer
      set search_path = ''
      as $$
        select distinct them.user_id
        from app.memberships me
        join app.memberships them on them.organization_id = me.organization_id
        where me.user_id = (select auth.uid())
          and me.deactivated_at is null
      $$`);

    // Point check for the transition triggers (one org, one row at a time).
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
            and m.deactivated_at is null
            and m.role = any (roles)
        )
      $$`);

    for (const fn of [
      'app.member_org_ids()',
      'app.scheduler_org_ids()',
      'app.coworker_ids()',
      'app.has_role(uuid, app.membership_role[])',
    ]) {
      await q.query(`revoke execute on function ${fn} from public, anon`);
      await q.query(`grant execute on function ${fn} to authenticated`);
    }

    // ---------------------------------------------------------------- read policies
    await q.query(`
      create policy organizations_select_member on app.organizations
        for select to authenticated
        using (id in (select app.member_org_ids()))`);

    await q.query(`
      create policy memberships_select_same_org on app.memberships
        for select to authenticated
        using (organization_id in (select app.member_org_ids()))`);

    await q.query(`
      create policy profiles_select_self_or_coworker on app.profiles
        for select to authenticated
        using (id = (select auth.uid()) or id in (select app.coworker_ids()))`);
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
          using (organization_id in (select app.member_org_ids()))`);
    }

    // Certifications are personal data: visible to the holder and to the org's schedulers.
    await q.query(`
      create policy user_certifications_select_self_or_scheduler on app.user_certifications
        for select to authenticated
        using (
          (user_id = (select auth.uid()) and organization_id in (select app.member_org_ids()))
          or organization_id in (select app.scheduler_org_ids())
        )`);

    // ---------------------------------------------------------------- shifts
    await q.query(`
      create policy shifts_select_member on app.shifts
        for select to authenticated
        using (organization_id in (select app.member_org_ids()))`);
    await q.query(`
      create policy shifts_insert_scheduler on app.shifts
        for insert to authenticated
        with check (organization_id in (select app.scheduler_org_ids()))`);
    // with check also prevents moving a shift into an org where the caller isn't a scheduler.
    await q.query(`
      create policy shifts_update_scheduler on app.shifts
        for update to authenticated
        using (organization_id in (select app.scheduler_org_ids()))
        with check (organization_id in (select app.scheduler_org_ids()))`);
    await q.query(`
      create policy shifts_delete_scheduler on app.shifts
        for delete to authenticated
        using (organization_id in (select app.scheduler_org_ids()))`);

    // ---------------------------------------------------------------- swap_requests: policies
    await q.query(`
      create policy swap_requests_select_member on app.swap_requests
        for select to authenticated
        using (organization_id in (select app.member_org_ids()))`);

    // Anyone (staff or not) may offer only a shift currently assigned to themselves.
    // The subquery runs under the caller's RLS, which is fine: it only needs own-org shifts.
    await q.query(`
      create policy swap_requests_insert_own_shift on app.swap_requests
        for insert to authenticated
        with check (
          requester_id = (select auth.uid())
          and organization_id in (select app.member_org_ids())
          and exists (
            select 1
            from app.shifts s
            where s.id = shift_id
              and s.organization_id = swap_requests.organization_id
              and s.assigned_user_id = (select auth.uid())
          )
        )`);

    // A single update policy: which rows an actor may *touch*. Which transitions are legal
    // for that actor is the trigger's job. (Per-actor WITH CHECKs were tried and are unsound:
    // Postgres ORs permissive policies and evaluates USING and WITH CHECK independently, so
    // a claimer's USING combined with a target's WITH CHECK let any member decline an open
    // offer.)
    await q.query(`
      create policy swap_requests_update_participant_or_scheduler on app.swap_requests
        for update to authenticated
        using (
          organization_id in (select app.member_org_ids())
          and (
            requester_id = (select auth.uid())
            or target_user_id = (select auth.uid())
            or target_user_id is null
            or organization_id in (select app.scheduler_org_ids())
          )
        )
        with check (organization_id in (select app.member_org_ids()))`);

    // ---------------------------------------------------------------- swap_requests: state machine
    // Errors use a dedicated SQLSTATE, CS409, with message '<ERROR_CODE>: <reason>'. The API
    // maps CS409 to HTTP 409 and passes code and reason through.
    await q.query(`
      create function app.raise_swap_error(code text, reason text)
      returns void
      language plpgsql
      set search_path = ''
      as $$
      begin
        raise exception using errcode = 'CS409', message = code || ': ' || reason;
      end;
      $$`);

    // Roles allowed to bypass the state machine: migrations, seed and Supabase internals.
    // An allowlist, not a denylist: any other role (authenticated, service_role, roles
    // added later) is held to the rules. Fail closed.
    await q.query(`
      create function app.is_maintenance_role()
      returns boolean
      language sql
      stable
      set search_path = ''
      as $$
        select current_user in ('postgres', 'supabase_admin')
      $$`);

    await q.query(`
      create function app.guard_swap_request_insert()
      returns trigger
      language plpgsql
      set search_path = ''
      as $$
      declare
        actor uuid := (select auth.uid());
      begin
        if app.is_maintenance_role() then
          return new;
        end if;

        if actor is null or new.requester_id is distinct from actor then
          perform app.raise_swap_error('SWAP_NOT_ALLOWED', 'requests are created by their requester');
        end if;
        if new.status <> 'pending' or new.decided_by_id is not null or new.decided_at is not null then
          perform app.raise_swap_error('SWAP_INVALID_TRANSITION', 'new requests start as pending and undecided');
        end if;
        if exists (
          select 1 from app.shifts s where s.id = new.shift_id and s.starts_at <= now()
        ) then
          perform app.raise_swap_error('SHIFT_ALREADY_STARTED', 'the shift has already started');
        end if;
        -- The FK only proves the membership row exists; it may be deactivated.
        if new.target_user_id is not null and not exists (
          select 1
          from app.memberships m
          where m.organization_id = new.organization_id
            and m.user_id = new.target_user_id
            and m.deactivated_at is null
        ) then
          perform app.raise_swap_error('SWAP_NOT_ALLOWED', 'the target is not an active member');
        end if;

        return new;
      end;
      $$`);

    // Transition table (actor is auth.uid(); "scheduler" = active manager/admin of the org):
    //
    //   from               to         actor
    //   pending|accepted   cancelled  requester
    //   pending            declined   direct target
    //   pending            accepted   direct target, or any other member claiming an open offer
    //                                 (target_user_id becomes the claimer)
    //   accepted           approved   scheduler who is neither requester nor target
    //   pending|accepted   rejected   scheduler who is neither requester nor target
    //
    // decided_by_id / decided_at are set here, never by the caller (timestamps: stamp_timestamps).
    await q.query(`
      create function app.guard_swap_request_update()
      returns trigger
      language plpgsql
      set search_path = ''
      as $$
      declare
        actor uuid := (select auth.uid());
      begin
        if app.is_maintenance_role() then
          return new;
        end if;

        if actor is null then
          perform app.raise_swap_error('SWAP_NOT_ALLOWED', 'no authenticated user');
        end if;

        -- Columns that never change after creation (grants already stop authenticated;
        -- this holds the line for any other non-maintenance role). created_at is pinned by
        -- app.stamp_timestamps, which fires first.
        if (new.id, new.organization_id, new.shift_id, new.requester_id, new.note, new.created_at)
           is distinct from
           (old.id, old.organization_id, old.shift_id, old.requester_id, old.note, old.created_at) then
          perform app.raise_swap_error('SWAP_NOT_ALLOWED', 'only status and target can change');
        end if;

        if new.decided_by_id is distinct from old.decided_by_id
           or new.decided_at is distinct from old.decided_at then
          perform app.raise_swap_error('SWAP_NOT_ALLOWED', 'decision fields are set by the database');
        end if;

        if new.status = old.status then
          if new.target_user_id is distinct from old.target_user_id then
            perform app.raise_swap_error('SWAP_INVALID_TRANSITION', 'target changes only when claiming');
          end if;
          return new;
        end if;

        if old.status not in ('pending', 'accepted') then
          perform app.raise_swap_error('SWAP_INVALID_TRANSITION', format('request is already %s', old.status));
        end if;

        -- Claiming an open offer is the only transition that may set the target.
        if new.target_user_id is distinct from old.target_user_id
           and not (old.target_user_id is null and new.status = 'accepted') then
          perform app.raise_swap_error('SWAP_INVALID_TRANSITION', 'target changes only when claiming');
        end if;

        case new.status
          when 'cancelled' then
            if actor <> old.requester_id then
              perform app.raise_swap_error('SWAP_NOT_ALLOWED', 'only the requester can cancel');
            end if;

          when 'declined' then
            if old.status <> 'pending' or old.target_user_id is null or actor <> old.target_user_id then
              perform app.raise_swap_error('SWAP_NOT_ALLOWED', 'only the target of a direct offer can decline it');
            end if;

          when 'accepted' then
            if old.status <> 'pending' then
              perform app.raise_swap_error('SWAP_INVALID_TRANSITION', format('cannot accept a %s request', old.status));
            end if;
            if old.target_user_id is null then
              if actor = old.requester_id then
                perform app.raise_swap_error('SWAP_NOT_ALLOWED', 'cannot claim your own offer');
              end if;
              if new.target_user_id is distinct from actor then
                perform app.raise_swap_error('SWAP_NOT_ALLOWED', 'a claim assigns the offer to the claimer');
              end if;
            elsif actor <> old.target_user_id then
              perform app.raise_swap_error('SWAP_NOT_ALLOWED', 'only the target can accept');
            end if;

          when 'approved', 'rejected' then
            if not app.has_role(old.organization_id, '{admin,manager}') then
              perform app.raise_swap_error('SWAP_NOT_ALLOWED', 'only managers or admins can decide');
            end if;
            if new.status = 'approved' and old.status <> 'accepted' then
              perform app.raise_swap_error('SWAP_INVALID_TRANSITION', 'only accepted requests can be approved');
            end if;
            if actor = old.requester_id or actor = old.target_user_id then
              perform app.raise_swap_error('SWAP_NOT_ALLOWED', 'the decider cannot be the requester or the target');
            end if;
            new.decided_by_id := actor;
            new.decided_at := now();

          else
            perform app.raise_swap_error('SWAP_INVALID_TRANSITION', format('cannot move to %s', new.status));
        end case;

        if new.status in ('accepted', 'approved') then
          if exists (
            select 1 from app.shifts s where s.id = old.shift_id and s.starts_at <= now()
          ) then
            perform app.raise_swap_error('SHIFT_ALREADY_STARTED', 'the shift has already started');
          end if;
          if not exists (
            select 1
            from app.memberships m
            where m.organization_id = old.organization_id
              and m.user_id = new.target_user_id
              and m.deactivated_at is null
          ) then
            perform app.raise_swap_error('SWAP_NOT_ALLOWED', 'the target is not an active member');
          end if;
        end if;

        return new;
      end;
      $$`);

    // Approval reassigns the shift in the same statement, so the exclusion constraint and
    // the membership FK on shifts are checked atomically with the approval. Runs as the
    // approving manager: the shifts RLS update policy applies too.
    await q.query(`
      create function app.apply_approved_swap()
      returns trigger
      language plpgsql
      set search_path = ''
      as $$
      begin
        update app.shifts
           set assigned_user_id = new.target_user_id,
               updated_at = now()
         where id = new.shift_id
           and organization_id = new.organization_id
           and assigned_user_id = new.requester_id;
        if not found then
          perform app.raise_swap_error('SWAP_CONFLICT', 'the shift is no longer assigned to the requester');
        end if;
        return null;
      end;
      $$`);

    for (const fn of [
      'app.raise_swap_error(text, text)',
      'app.is_maintenance_role()',
      'app.guard_swap_request_insert()',
      'app.guard_swap_request_update()',
      'app.apply_approved_swap()',
    ]) {
      await q.query(`revoke execute on function ${fn} from public, anon`);
      await q.query(`grant execute on function ${fn} to authenticated`);
    }

    await q.query(`
      create trigger swap_requests_guard_insert
        before insert on app.swap_requests
        for each row execute function app.guard_swap_request_insert()`);
    await q.query(`
      create trigger swap_requests_guard_update
        before update on app.swap_requests
        for each row execute function app.guard_swap_request_update()`);
    await q.query(`
      create trigger swap_requests_apply_approval
        after update of status on app.swap_requests
        for each row
        when (new.status = 'approved' and old.status is distinct from 'approved')
        execute function app.apply_approved_swap()`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`drop trigger swap_requests_apply_approval on app.swap_requests`);
    await q.query(`drop trigger swap_requests_guard_update on app.swap_requests`);
    await q.query(`drop trigger swap_requests_guard_insert on app.swap_requests`);
    await q.query(`drop function app.apply_approved_swap()`);
    await q.query(`drop function app.guard_swap_request_update()`);
    await q.query(`drop function app.guard_swap_request_insert()`);
    await q.query(`drop function app.is_maintenance_role()`);
    await q.query(`drop function app.raise_swap_error(text, text)`);

    const policies: Array<[string, string]> = [
      ['swap_requests', 'swap_requests_update_participant_or_scheduler'],
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

    await q.query(`drop function app.has_role(uuid, app.membership_role[])`);
    await q.query(`drop function app.coworker_ids()`);
    await q.query(`drop function app.scheduler_org_ids()`);
    await q.query(`drop function app.member_org_ids()`);

    await q.query(`revoke all on all tables in schema app from authenticated`);
    await q.query(`revoke usage on schema app from authenticated`);

    await q.query(`revoke authenticated from covershift_api`);
    await q.query(`drop role if exists covershift_api`);
  }
}
