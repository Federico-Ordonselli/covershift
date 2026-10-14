import { randomUUID } from 'node:crypto';
import { type Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminPool, createTenant, dropTenant, insertShift, type Tenant } from '../helpers/fixtures';
import { createRlsHarness, expectDbError, type RlsHarness } from '../helpers/rls';

/**
 * Tenant isolation at the SQL level: whatever SQL the API sends, the database only
 * returns or changes rows the caller is entitled to. "Crafted" queries name other
 * tenants' ids explicitly, as an attacker who guessed or leaked them would.
 */
describe('RLS: tenant isolation', () => {
  let admin: Pool;
  let db: RlsHarness;
  let a: Tenant;
  let b: Tenant;
  let shiftA: string;
  let shiftB: string;
  let shiftA2: string;

  beforeAll(async () => {
    admin = adminPool();
    db = await createRlsHarness();
    a = await createTenant(admin, 'iso-a', {
      admin: 'admin',
      manager: 'manager',
      staff: 'staff',
      coworker: 'staff',
    });
    b = await createTenant(admin, 'iso-b', { manager: 'manager', staff: 'staff' });

    shiftA = await insertShift(admin, a, {
      startsAt: '2030-03-01T06:00:00Z',
      endsAt: '2030-03-01T14:00:00Z',
      assignedUserId: a.users.staff!.id,
    });
    shiftA2 = await insertShift(admin, a, {
      startsAt: '2030-03-02T06:00:00Z',
      endsAt: '2030-03-02T14:00:00Z',
      assignedUserId: a.users.coworker!.id,
    });
    shiftB = await insertShift(admin, b, {
      startsAt: '2030-03-01T06:00:00Z',
      endsAt: '2030-03-01T14:00:00Z',
      assignedUserId: b.users.staff!.id,
    });

    const certType = randomUUID();
    await admin.query(
      `insert into app.certification_types (id, organization_id, name) values ($1, $2, 'X-ray')`,
      [certType, a.orgId],
    );
    await admin.query(
      `insert into app.user_certifications (organization_id, user_id, certification_type_id)
       values ($1, $2, $3), ($1, $4, $3)`,
      [a.orgId, a.users.staff!.id, certType, a.users.coworker!.id],
    );
    await admin.query(
      `insert into app.swap_requests (organization_id, shift_id, requester_id)
       values ($1, $2, $3)`,
      [b.orgId, shiftB, b.users.staff!.id],
    );
  });

  afterAll(async () => {
    await dropTenant(admin, a);
    await dropTenant(admin, b);
    await admin?.end();
    await db?.close();
  });

  describe('reads', () => {
    it('a member sees only their own organization’s shifts', async () => {
      const rows = await db.as<{ id: string }>(a.users.staff!, 'select id from app.shifts');
      expect(rows.map((r) => r.id).sort()).toEqual([shiftA, shiftA2].sort());
    });

    it('a crafted read of another tenant’s shift by id returns nothing', async () => {
      const rows = await db.as(a.users.staff!, 'select * from app.shifts where id = $1', [shiftB]);
      expect(rows).toEqual([]);
    });

    it('a crafted read filtered by another tenant’s organization_id returns nothing', async () => {
      for (const sql of [
        'select * from app.shifts where organization_id = $1',
        'select * from app.swap_requests where organization_id = $1',
        'select * from app.memberships where organization_id = $1',
        'select * from app.positions where organization_id = $1',
      ]) {
        expect(await db.as(a.users.manager!, sql, [b.orgId]), sql).toEqual([]);
      }
      expect(
        await db.as(a.users.manager!, 'select * from app.organizations where id = $1', [b.orgId]),
      ).toEqual([]);
    });

    it('other tenants’ users are invisible (profiles)', async () => {
      const rows = await db.as(a.users.manager!, 'select * from app.profiles where id = $1', [
        b.users.staff!.id,
      ]);
      expect(rows).toEqual([]);
    });

    it('certifications: staff see only their own, managers see the org’s', async () => {
      const own = await db.as<{ user_id: string }>(
        a.users.staff!,
        'select user_id from app.user_certifications',
      );
      expect(own.map((r) => r.user_id)).toEqual([a.users.staff!.id]);

      const all = await db.as(a.users.manager!, 'select user_id from app.user_certifications');
      expect(all).toHaveLength(2);
    });

    it('a token for a user with no membership sees nothing at all', async () => {
      const stranger = { id: randomUUID() };
      for (const sql of [
        'select * from app.organizations',
        'select * from app.shifts',
        'select * from app.swap_requests',
        'select * from app.memberships',
        'select * from app.profiles',
      ]) {
        expect(await db.as(stranger, sql), sql).toEqual([]);
      }
    });
  });

  describe('writes', () => {
    it('staff cannot create shifts', async () => {
      await expectDbError(
        db.as(
          a.users.staff!,
          `insert into app.shifts (organization_id, position_id, starts_at, ends_at)
           values ($1, $2, '2030-04-01T06:00Z', '2030-04-01T14:00Z')`,
          [a.orgId, a.positionId],
        ),
        '42501',
        /row-level security/,
      );
    });

    it.each(['manager', 'admin'])('a %s can create shifts in their organization', async (who) => {
      const rows = await db.as(
        a.users[who]!,
        `insert into app.shifts (organization_id, position_id, starts_at, ends_at)
         values ($1, $2, '2030-04-01T06:00Z', '2030-04-01T14:00Z') returning id`,
        [a.orgId, a.positionId],
      );
      expect(rows).toHaveLength(1);
    });

    it('a manager cannot create a shift in another organization', async () => {
      await expectDbError(
        db.as(
          a.users.manager!,
          `insert into app.shifts (organization_id, position_id, starts_at, ends_at)
           values ($1, $2, '2030-04-01T06:00Z', '2030-04-01T14:00Z')`,
          [b.orgId, b.positionId],
        ),
        '42501',
      );
    });

    it('updates and deletes of another tenant’s rows silently match nothing', async () => {
      const updated = await db.as(
        a.users.manager!,
        `update app.shifts set ends_at = ends_at + interval '1 hour' where id = $1 returning id`,
        [shiftB],
      );
      expect(updated).toEqual([]);
      const deleted = await db.as(
        a.users.manager!,
        `delete from app.shifts where id = $1 returning id`,
        [shiftB],
      );
      expect(deleted).toEqual([]);
      const [still] = (
        await admin.query(`select count(*)::int as n from app.shifts where id = $1`, [shiftB])
      ).rows as Array<{ n: number }>;
      expect(still!.n).toBe(1);
    });

    it('a manager cannot move a shift into another organization', async () => {
      await expectDbError(
        db.as(a.users.manager!, `update app.shifts set organization_id = $1 where id = $2`, [
          b.orgId,
          shiftA2,
        ]),
        // WITH CHECK fails for the target org (the composite FK would also refuse it)
        '42501',
      );
    });

    it('staff may open a swap only for a shift assigned to themselves', async () => {
      const insert = (user: { id: string }, org: string, shift: string) =>
        db.as(
          user,
          `insert into app.swap_requests (organization_id, shift_id, requester_id)
           values ($1, $2, $3) returning id`,
          [org, shift, user.id],
        );

      // someone else's shift in their own org
      await expectDbError(insert(a.users.staff!, a.orgId, shiftA2), '42501');
      // another tenant's shift, claiming either org
      await expectDbError(insert(a.users.staff!, b.orgId, shiftB), '42501');
      await expectDbError(insert(a.users.staff!, a.orgId, shiftB), '42501');
      // their own shift: allowed (committed, so removed again below)
      const [created] = await insert(a.users.staff!, a.orgId, shiftA);
      expect(created).toBeDefined();
      await admin.query(`delete from app.swap_requests where shift_id = $1`, [shiftA]);
    });

    it('nobody can open a swap on someone else’s behalf, not even a manager', async () => {
      // BEFORE INSERT triggers fire before RLS WITH CHECK, so the trigger's clearer error wins.
      await expectDbError(
        db.as(
          a.users.manager!,
          `insert into app.swap_requests (organization_id, shift_id, requester_id)
           values ($1, $2, $3)`,
          [a.orgId, shiftA, a.users.staff!.id],
        ),
        'CS409',
        /^SWAP_NOT_ALLOWED: requests are created by their requester/,
      );
    });
  });

  /**
   * Not RLS: these hold for every role, including privileged ones (verified by running the
   * suite without impersonation). They complete the isolation story: even ids that RLS
   * would let through can't be combined across tenants.
   */
  describe('constraints that hold for every role (composite tenant FKs)', () => {
    it('a manager cannot point their shift at another tenant’s position (composite FK)', async () => {
      await expectDbError(
        db.as(
          a.users.manager!,
          `insert into app.shifts (organization_id, position_id, starts_at, ends_at)
           values ($1, $2, '2030-04-01T06:00Z', '2030-04-01T14:00Z')`,
          [a.orgId, b.positionId],
        ),
        '23503',
      );
    });

    it('a manager cannot assign someone outside the organization (composite FK)', async () => {
      await expectDbError(
        db.as(a.users.manager!, `update app.shifts set assigned_user_id = $1 where id = $2`, [
          b.users.staff!.id,
          shiftA2,
        ]),
        '23503',
      );
    });
  });

  describe('deactivated members (soft delete)', () => {
    it('lose all access immediately, while their history stays visible to others', async () => {
      await admin.query(
        `update app.memberships set deactivated_at = now() where organization_id = $1 and user_id = $2`,
        [a.orgId, a.users.coworker!.id],
      );
      try {
        expect(await db.as(a.users.coworker!, 'select * from app.shifts')).toEqual([]);
        expect(await db.as(a.users.coworker!, 'select * from app.organizations')).toEqual([]);

        const visible = await db.as(a.users.manager!, 'select id from app.profiles where id = $1', [
          a.users.coworker!.id,
        ]);
        expect(visible).toHaveLength(1);
      } finally {
        await admin.query(
          `update app.memberships set deactivated_at = null where organization_id = $1 and user_id = $2`,
          [a.orgId, a.users.coworker!.id],
        );
      }
    });
  });
});
