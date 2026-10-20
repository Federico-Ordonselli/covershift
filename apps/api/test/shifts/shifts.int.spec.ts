import { Test } from '@nestjs/testing';
import { type Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigModule } from '../../src/config/config.module';
import { DatabaseModule } from '../../src/database/database.module';
import { RlsTransactionRunner } from '../../src/database/rls/rls-transaction.runner';
import { ShiftsModule } from '../../src/shifts/shifts.module';
import { ShiftsService } from '../../src/shifts/shifts.service';
import {
  addCertificationType,
  adminPool,
  claimsFor,
  createTenant,
  dropTenant,
  grantCertification,
  insertShift,
  requireCertification,
  type Tenant,
} from '../helpers/fixtures';

describe('ShiftsService (real RLS)', () => {
  let admin: Pool;
  let rls: RlsTransactionRunner;
  let shifts: ShiftsService;
  let close: () => Promise<void>;
  let a: Tenant;
  let b: Tenant;

  const u = (key: string) => a.users[key]!;
  const as = <T>(key: string, fn: (s: ShiftsService) => Promise<T>, tenant = a) =>
    rls.run(claimsFor(tenant.users[key]!), () => fn(shifts));

  const day = (d: number, from = 6, to = 14) => ({
    startsAt: `2030-08-${String(d).padStart(2, '0')}T${String(from).padStart(2, '0')}:00:00Z`,
    endsAt: `2030-08-${String(d).padStart(2, '0')}T${String(to).padStart(2, '0')}:00:00Z`,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule, ShiftsModule],
    }).compile();
    const app = await moduleRef.init();
    close = () => app.close();
    rls = moduleRef.get(RlsTransactionRunner);
    shifts = moduleRef.get(ShiftsService);

    admin = adminPool();
    a = await createTenant(admin, 'shifts-a', {
      manager: 'manager',
      admin: 'admin',
      certified: 'staff',
      uncertified: 'staff',
      leaver: 'staff',
    });
    b = await createTenant(admin, 'shifts-b', { manager: 'manager', staff: 'staff' });

    const xray = await addCertificationType(admin, a, 'X-ray screening');
    await requireCertification(admin, a, xray);
    for (const key of ['certified', 'leaver']) {
      await grantCertification(admin, a, u(key).id, xray, '2030-08-10T12:00:00Z');
    }
    await admin.query(
      `update app.memberships set deactivated_at = now() where organization_id = $1 and user_id = $2`,
      [a.orgId, u('leaver').id],
    );
  });

  afterAll(async () => {
    await dropTenant(admin, a);
    await dropTenant(admin, b);
    await admin?.end();
    await close?.();
  });

  const base = () => ({ organizationId: a.orgId, positionId: a.positionId });

  describe('create', () => {
    it.each(['manager', 'admin'])('a %s creates and assigns a certified member', async (who) => {
      const shift = await as(who, (s) =>
        s.create({
          ...base(),
          ...day(who === 'manager' ? 1 : 2),
          assignedUserId: u('certified').id,
        }),
      );
      expect(shift).toMatchObject({ organizationId: a.orgId, assignedUserId: u('certified').id });
    });

    it('staff cannot create shifts (readable 403 before RLS)', async () => {
      await expect(
        as('certified', (s) => s.create({ ...base(), ...day(3), assignedUserId: null })),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    });

    it('a manager cannot create in another organization', async () => {
      await expect(
        as('manager', (s) =>
          s.create({
            organizationId: b.orgId,
            positionId: b.positionId,
            ...day(3),
            assignedUserId: null,
          }),
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    });

    it('rejects another tenant’s position', async () => {
      await expect(
        as('manager', (s) =>
          s.create({
            organizationId: a.orgId,
            positionId: b.positionId,
            ...day(3),
            assignedUserId: null,
          }),
        ),
      ).rejects.toMatchObject({ code: 'INVALID_REFERENCE', status: 422 });
    });

    it('rejects an uncertified assignee', async () => {
      await expect(
        as('manager', (s) =>
          s.create({ ...base(), ...day(3), assignedUserId: u('uncertified').id }),
        ),
      ).rejects.toMatchObject({ code: 'CERTIFICATION_MISSING', status: 422 });
    });

    it('rejects an assignee whose certificate expires before the shift ends', async () => {
      // certificate expires 2030-08-10T12:00Z, shift ends 14:00Z
      await expect(
        as('manager', (s) =>
          s.create({ ...base(), ...day(10), assignedUserId: u('certified').id }),
        ),
      ).rejects.toMatchObject({ code: 'CERTIFICATION_EXPIRES_BEFORE_SHIFT_END', status: 422 });
    });

    it('rejects non-members and deactivated members', async () => {
      await expect(
        as('manager', (s) => s.create({ ...base(), ...day(3), assignedUserId: b.users.staff!.id })),
      ).rejects.toMatchObject({ code: 'NOT_A_MEMBER', status: 422 });
      await expect(
        as('manager', (s) => s.create({ ...base(), ...day(3), assignedUserId: u('leaver').id })),
      ).rejects.toMatchObject({ code: 'NOT_A_MEMBER', status: 422 });
    });

    it('rejects overlapping assignments but allows back-to-back ones', async () => {
      await as('manager', (s) =>
        s.create({ ...base(), ...day(4, 6, 14), assignedUserId: u('certified').id }),
      );
      await expect(
        as('manager', (s) =>
          s.create({ ...base(), ...day(4, 13, 20), assignedUserId: u('certified').id }),
        ),
      ).rejects.toMatchObject({ code: 'SHIFT_OVERLAP', status: 409 });
      await expect(
        as('manager', (s) =>
          s.create({ ...base(), ...day(4, 14, 22), assignedUserId: u('certified').id }),
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('assignment candidates and override', () => {
    it('lists eligible members, exclusions and override availability', async () => {
      const candidates = await as('manager', (s) => s.candidates({ ...base(), ...day(3) }));
      expect(candidates.find((c) => c.userId === u('certified').id)).toMatchObject({
        eligible: true,
        canOverride: false,
      });
      expect(candidates.find((c) => c.userId === u('uncertified').id)).toMatchObject({
        eligible: false,
        canOverride: true,
      });
      expect(candidates.some((c) => c.userId === u('leaver').id)).toBe(false);
      expect(candidates.some((c) => c.userId === b.users.staff!.id)).toBe(false);
    });

    it('staff cannot inspect candidates or use override', async () => {
      await expect(
        as('certified', (s) => s.candidates({ ...base(), ...day(3) })),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        as('uncertified', (s) =>
          s.create({
            ...base(),
            ...day(20),
            assignedUserId: u('uncertified').id,
            overrideReason: 'Training supervised',
          }),
        ),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('persists an explicit override and still blocks overlap and inactive members', async () => {
      const created = await as('manager', (s) =>
        s.create({
          ...base(),
          ...day(20),
          assignedUserId: u('uncertified').id,
          overrideReason: 'Training supervised',
        }),
      );
      expect(created.overrideReason).toBe('Training supervised');
      const candidates = await as('manager', (s) => s.candidates({ ...base(), ...day(20) }));
      expect(candidates.find((c) => c.userId === u('uncertified').id)).toMatchObject({
        eligible: false,
        canOverride: false,
      });
      await expect(
        as('manager', (s) =>
          s.create({
            ...base(),
            ...day(20),
            assignedUserId: u('uncertified').id,
            overrideReason: 'Training supervised',
          }),
        ),
      ).rejects.toMatchObject({ code: 'SHIFT_OVERLAP' });
      await expect(
        as('manager', (s) =>
          s.create({
            ...base(),
            ...day(20),
            assignedUserId: u('leaver').id,
            overrideReason: 'Training supervised',
          }),
        ),
      ).rejects.toMatchObject({ code: 'NOT_A_MEMBER' });
      const own = await as('manager', (s) =>
        s.candidates({ ...base(), ...day(20), shiftId: created.id }),
      );
      expect(own.find((c) => c.userId === u('uncertified').id)).toMatchObject({
        canOverride: true,
      });
      await expect(
        as('manager', (s) => s.update(created.id, { assignedUserId: u('uncertified').id })),
      ).rejects.toMatchObject({ code: 'CERTIFICATION_MISSING' });
      const edited = await as('manager', (s) =>
        s.update(created.id, {
          endsAt: day(20, 6, 15).endsAt,
          overrideReason: 'Training extended',
        }),
      );
      expect(edited.overrideReason).toBe('Training extended');
    });

    it('checks expiry and rejects cross-organization references with override', async () => {
      const candidates = await as('manager', (s) => s.candidates({ ...base(), ...day(10) }));
      expect(candidates.find((c) => c.userId === u('certified').id)).toMatchObject({
        eligible: false,
        canOverride: true,
      });
      await expect(
        as('manager', (s) =>
          s.create({
            ...base(),
            positionId: b.positionId,
            ...day(21),
            assignedUserId: u('uncertified').id,
            overrideReason: 'Training supervised',
          }),
        ),
      ).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
    });
  });

  describe('read', () => {
    it('lists only the caller’s organizations, with window filters', async () => {
      await insertShift(admin, b, day(5));
      const { items: listed } = await as('certified', (s) => s.list({ limit: 100 }));
      expect(listed.length).toBeGreaterThan(0);
      expect(new Set(listed.map((x) => x.organizationId))).toEqual(new Set([a.orgId]));

      const { items: day4 } = await as('certified', (s) =>
        s.list({ limit: 100, from: '2030-08-04T00:00:00Z', to: '2030-08-05T00:00:00Z' }),
      );
      expect(day4.every((x) => x.startsAt < new Date('2030-08-05T00:00:00Z'))).toBe(true);
      expect(day4).toHaveLength(2);
    });

    it('404s for another tenant’s shift (indistinguishable from missing)', async () => {
      const foreign = await insertShift(admin, b, day(6));
      await expect(as('manager', (s) => s.get(foreign))).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    });
  });

  describe('update', () => {
    it('re-validates the assignment when times change (certificate would expire)', async () => {
      const shift = await as('manager', (s) =>
        s.create({ ...base(), ...day(9), assignedUserId: u('certified').id }),
      );
      await expect(
        as('manager', (s) =>
          s.update(shift.id, { endsAt: '2030-08-10T14:00:00Z', startsAt: '2030-08-10T06:00:00Z' }),
        ),
      ).rejects.toMatchObject({ code: 'CERTIFICATION_EXPIRES_BEFORE_SHIFT_END' });
    });

    it('does not count the shift itself as an overlap', async () => {
      const shift = await as('manager', (s) =>
        s.create({ ...base(), ...day(7, 6, 14), assignedUserId: u('certified').id }),
      );
      const moved = await as('manager', (s) =>
        s.update(shift.id, { endsAt: '2030-08-07T15:00:00Z' }),
      );
      expect(moved.endsAt.toISOString()).toBe('2030-08-07T15:00:00.000Z');
    });

    it('checks ordering against the stored bound when only one is patched', async () => {
      const shift = await as('manager', (s) =>
        s.create({ ...base(), ...day(8), assignedUserId: null }),
      );
      await expect(
        as('manager', (s) => s.update(shift.id, { endsAt: '2030-08-08T05:00:00Z' })),
      ).rejects.toMatchObject({ code: 'CONSTRAINT_VIOLATION', status: 422 });
    });

    it('staff cannot update; another tenant’s shift is 404', async () => {
      const shift = await as('manager', (s) =>
        s.create({ ...base(), ...day(11), assignedUserId: null }),
      );
      await expect(
        as('certified', (s) => s.update(shift.id, { assignedUserId: u('certified').id })),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        as('manager', (s) => s.update(shift.id, { assignedUserId: null }), b),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('delete', () => {
    it('deletes a shift without history; refuses one with swap history', async () => {
      const plain = await as('manager', (s) =>
        s.create({ ...base(), ...day(12), assignedUserId: null }),
      );
      await as('manager', (s) => s.remove(plain.id));
      await expect(as('manager', (s) => s.get(plain.id))).rejects.toMatchObject({ status: 404 });

      const withHistory = await as(
        'manager',
        (s) => s.create({ ...base(), ...day(6, 15, 20), assignedUserId: u('certified').id }), // within cert validity
      );
      await admin.query(
        `insert into app.swap_requests (organization_id, shift_id, requester_id, status)
         values ($1, $2, $3, 'cancelled')`,
        [a.orgId, withHistory.id, u('certified').id],
      );
      await expect(as('manager', (s) => s.remove(withHistory.id))).rejects.toMatchObject({
        code: 'CONFLICT',
        status: 409,
      });
    });
  });
});
