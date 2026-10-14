import { type Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminPool, createTenant, dropTenant, type Tenant } from '../helpers/fixtures';
import { createRlsHarness, type RlsHarness } from '../helpers/rls';

/**
 * Calls in a policy expression that are not directly wrapped in a scalar subquery.
 * Postgres deparses `(select auth.uid())` as `( SELECT auth.uid() AS uid)`, so a wrapped
 * call is always immediately preceded by "SELECT ". Unwrapped calls run once per row
 * (Supabase lint auth_rls_initplan); wrapped, uncorrelated ones once per statement.
 */
export function unwrappedCalls(expression: string): string[] {
  return [...expression.matchAll(/(?<!SELECT )\b((?:auth|app)\.\w+)\(/g)].map((m) => m[1]!);
}

describe('policy hygiene (catalog checks)', () => {
  let admin: Pool;

  beforeAll(() => {
    admin = adminPool();
  });
  afterAll(async () => {
    await admin?.end();
  });

  it('the unwrapped-call detector itself works (negative control)', () => {
    expect(unwrappedCalls('(requester_id = auth.uid())')).toEqual(['auth.uid']);
    expect(unwrappedCalls('app.is_member(organization_id)')).toEqual(['app.is_member']);
    expect(unwrappedCalls('(requester_id = ( SELECT auth.uid() AS uid))')).toEqual([]);
    expect(
      unwrappedCalls('(organization_id IN ( SELECT app.member_org_ids() AS member_org_ids))'),
    ).toEqual([]);
  });

  it('every policy wraps auth.* and app.* calls in (select ...)', async () => {
    const { rows } = await admin.query<{ name: string; qual: string | null; check: string | null }>(
      `select tablename || '.' || policyname as name, qual, with_check as check
       from pg_policies where schemaname = 'app'`,
    );
    expect(rows.length).toBeGreaterThan(10); // precondition: policies exist
    const offenders = rows.flatMap((p) =>
      [...unwrappedCalls(p.qual ?? ''), ...unwrappedCalls(p.check ?? '')].map(
        (call) => `${p.name}: ${call}`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it('every table in schema app has RLS enabled', async () => {
    const { rows } = await admin.query<{ relname: string }>(
      `select c.relname from pg_class c
       where c.relnamespace = 'app'::regnamespace and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows).toEqual([]);
  });

  it('every SECURITY DEFINER function in app pins an empty search_path', async () => {
    const { rows } = await admin.query<{ proname: string; config: string[] | null }>(
      `select p.proname, p.proconfig as config from pg_proc p
       where p.pronamespace = 'app'::regnamespace and p.prosecdef`,
    );
    expect(rows.length).toBeGreaterThan(0);
    const unpinned = rows.filter((r) => !(r.config ?? []).includes('search_path=""'));
    expect(unpinned.map((r) => r.proname)).toEqual([]);
  });
});

describe('database-owned timestamps (all tables, all roles)', () => {
  let admin: Pool;
  let db: RlsHarness;
  let t: Tenant;

  beforeAll(async () => {
    admin = adminPool();
    db = await createRlsHarness();
    t = await createTenant(admin, 'stamps', { manager: 'manager' });
  });
  afterAll(async () => {
    await dropTenant(admin, t);
    await admin?.end();
    await db?.close();
  });

  it('caller-supplied created_at/updated_at are overwritten on insert, created_at is pinned on update', async () => {
    const [shift] = await db.as<{ id: string; created_at: Date; updated_at: Date }>(
      t.users.manager!,
      `insert into app.shifts (organization_id, position_id, starts_at, ends_at, created_at, updated_at)
       values ($1, $2, '2030-05-01T06:00Z', '2030-05-01T14:00Z', '2001-01-01', '2001-01-01')
       returning id, created_at, updated_at`,
      [t.orgId, t.positionId],
    );
    expect(shift!.created_at.getUTCFullYear()).toBeGreaterThan(2001);
    expect(shift!.updated_at.getUTCFullYear()).toBeGreaterThan(2001);

    const [updated] = await db.as<{ created_at: Date }>(
      t.users.manager!,
      `update app.shifts set created_at = '1999-01-01' where id = $1 returning created_at`,
      [shift!.id],
    );
    expect(updated!.created_at).toEqual(shift!.created_at);
  });

  it('applies to privileged roles too', async () => {
    const { rows } = await admin.query<{ created_at: Date }>(
      `insert into app.certification_types (organization_id, name, created_at)
       values ($1, 'Forged', '2001-01-01') returning created_at`,
      [t.orgId],
    );
    expect(rows[0]!.created_at.getUTCFullYear()).toBeGreaterThan(2001);
  });
});
