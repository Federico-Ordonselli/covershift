import { Test } from '@nestjs/testing';
import { type Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConfigModule } from '../../src/config/config.module';
import { DatabaseModule } from '../../src/database/database.module';
import { RlsTransactionRunner } from '../../src/database/rls/rls-transaction.runner';
import { SwapRequestsModule } from '../../src/swap-requests/swap-requests.module';
import { SwapRequestsService } from '../../src/swap-requests/swap-requests.service';
import { outcome } from '../helpers/errors';
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

describe('SwapRequestsService (real RLS)', () => {
  let admin: Pool;
  let rls: RlsTransactionRunner;
  let swaps: SwapRequestsService;
  let close: () => Promise<void>;
  let t: Tenant;
  let xray: string;
  let shift: string;

  const u = (key: string) => t.users[key]!;
  const as = <T>(key: string, fn: (s: SwapRequestsService) => Promise<T>) =>
    outcome(rls.run(claimsFor(u(key)), () => fn(swaps))) as Promise<T>;

  async function assignedTo(shiftId: string): Promise<string | null> {
    const { rows } = await admin.query<{ a: string | null }>(
      `select assigned_user_id as a from app.shifts where id = $1`,
      [shiftId],
    );
    return rows[0]!.a;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule, SwapRequestsModule],
    }).compile();
    const app = await moduleRef.init();
    close = () => app.close();
    rls = moduleRef.get(RlsTransactionRunner);
    swaps = moduleRef.get(SwapRequestsService);

    admin = adminPool();
    t = await createTenant(admin, 'swapsvc', {
      requester: 'staff',
      target: 'staff',
      claimer: 'staff',
      claimer2: 'staff',
      uncertified: 'staff',
      manager: 'manager',
      manager2: 'admin',
    });
    xray = await addCertificationType(admin, t, 'X-ray screening');
    await requireCertification(admin, t, xray);
    for (const key of ['requester', 'target', 'claimer', 'claimer2', 'manager', 'manager2']) {
      await grantCertification(admin, t, u(key).id, xray, null);
    }
  });

  afterAll(async () => {
    await dropTenant(admin, t);
    await admin?.end();
    await close?.();
  });

  beforeEach(async () => {
    await admin.query(`delete from app.swap_requests where organization_id = $1`, [t.orgId]);
    await admin.query(`delete from app.shifts where organization_id = $1`, [t.orgId]);
    shift = await insertShift(admin, t, {
      startsAt: '2030-09-01T06:00:00Z',
      endsAt: '2030-09-01T14:00:00Z',
      assignedUserId: u('requester').id,
    });
  });

  const offer = (targetKey?: string) =>
    as('requester', (s) =>
      s.create(u('requester').id, {
        shiftId: shift,
        targetUserId: targetKey ? u(targetKey).id : null,
      }),
    );

  describe('create', () => {
    it('offers your own shift (direct or open)', async () => {
      const swap = await offer('target');
      expect(swap).toMatchObject({ status: 'pending', requesterId: u('requester').id });
    });

    it('refuses someone else’s shift, yourself as target, and non-members', async () => {
      await expect(
        as('target', (s) => s.create(u('target').id, { shiftId: shift, targetUserId: null })),
      ).rejects.toMatchObject({ code: 'SWAP_NOT_ALLOWED', status: 403 });
      await expect(offer('requester')).rejects.toMatchObject({ status: 422 });
      await expect(
        as('requester', (s) =>
          s.create(u('requester').id, {
            shiftId: shift,
            targetUserId: '00000000-0000-4000-8000-000000000000',
          }),
        ),
      ).rejects.toMatchObject({ code: 'NOT_A_MEMBER', status: 422 });
    });

    it('allows one active request per shift', async () => {
      await offer('target');
      await expect(offer()).rejects.toMatchObject({ code: 'SWAP_ALREADY_ACTIVE', status: 409 });
    });

    it('refuses a shift that has already started (trigger reason passed through)', async () => {
      await admin.query(
        `update app.shifts set starts_at = now() - interval '1 hour', ends_at = now() + interval '7 hours' where id = $1`,
        [shift],
      );
      await expect(offer()).rejects.toMatchObject({ code: 'SHIFT_ALREADY_STARTED', status: 409 });
    });
  });

  describe('accept / claim', () => {
    it('the direct target accepts', async () => {
      const swap = await offer('target');
      await expect(as('target', (s) => s.accept(u('target').id, swap.id))).resolves.toMatchObject({
        status: 'accepted',
      });
    });

    it('fails fast when the taker lacks a certification', async () => {
      const swap = await offer('uncertified');
      await expect(
        as('uncertified', (s) => s.accept(u('uncertified').id, swap.id)),
      ).rejects.toMatchObject({ code: 'CERTIFICATION_MISSING', status: 422 });
    });

    it('fails fast when the taker already works an overlapping shift', async () => {
      await insertShift(admin, t, {
        startsAt: '2030-09-01T10:00:00Z',
        endsAt: '2030-09-01T18:00:00Z',
        assignedUserId: u('claimer').id,
      });
      const swap = await offer();
      await expect(as('claimer', (s) => s.accept(u('claimer').id, swap.id))).rejects.toMatchObject({
        code: 'SHIFT_OVERLAP',
        status: 409,
      });
    });

    it('a member claims an open offer and becomes the target', async () => {
      const swap = await offer();
      await expect(as('claimer', (s) => s.accept(u('claimer').id, swap.id))).resolves.toMatchObject(
        {
          status: 'accepted',
          targetUserId: u('claimer').id,
        },
      );
    });

    it('a manager may claim an open offer too', async () => {
      const swap = await offer();
      await expect(as('manager', (s) => s.accept(u('manager').id, swap.id))).resolves.toMatchObject(
        {
          targetUserId: u('manager').id,
        },
      );
    });

    it('refuses claiming your own offer and accepting someone else’s direct offer (403)', async () => {
      const open = await offer();
      await expect(
        as('requester', (s) => s.accept(u('requester').id, open.id)),
      ).rejects.toMatchObject({
        code: 'SWAP_NOT_ALLOWED',
        status: 403,
      });
      await as('requester', (s) => s.cancel(u('requester').id, open.id));
      const direct = await offer('target');
      await expect(
        as('claimer', (s) => s.accept(u('claimer').id, direct.id)),
      ).rejects.toMatchObject({
        status: 403,
      });
    });

    it('two concurrent claims: exactly one wins, the other gets 409', async () => {
      const swap = await offer();
      const results = await Promise.allSettled([
        as('claimer', (s) => s.accept(u('claimer').id, swap.id)),
        as('claimer2', (s) => s.accept(u('claimer2').id, swap.id)),
      ]);
      const won = results.filter((r) => r.status === 'fulfilled');
      const lost = results.filter((r) => r.status === 'rejected');
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      // Depending on interleaving: lost the row-lock race (SWAP_CONFLICT) or saw it taken.
      expect((lost[0] as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    });
  });

  describe('decline / cancel', () => {
    it('target declines; a bystander cannot (visible but not theirs: 403)', async () => {
      const swap = await offer('target');
      await expect(as('claimer', (s) => s.decline(u('claimer').id, swap.id))).rejects.toMatchObject(
        {
          code: 'SWAP_NOT_ALLOWED',
          status: 403,
        },
      );
      await expect(as('target', (s) => s.decline(u('target').id, swap.id))).resolves.toMatchObject({
        status: 'declined',
      });
    });

    it('requester cancels from accepted; not after approval', async () => {
      const swap = await offer('target');
      await as('target', (s) => s.accept(u('target').id, swap.id));
      await expect(
        as('requester', (s) => s.cancel(u('requester').id, swap.id)),
      ).resolves.toMatchObject({
        status: 'cancelled',
      });

      const again = await offer('target');
      await as('target', (s) => s.accept(u('target').id, again.id));
      await as('manager', (s) => s.approve(u('manager').id, again.id));
      await expect(
        as('requester', (s) => s.cancel(u('requester').id, again.id)),
      ).rejects.toMatchObject({
        code: 'SWAP_INVALID_TRANSITION',
        status: 409,
      });
    });
  });

  describe('approve / reject', () => {
    it('approval reassigns the shift and records the decider', async () => {
      const swap = await offer('target');
      await admin.query(`update app.shifts set override_reason = $1 where id = $2`, [
        'Previous assignment exception',
        shift,
      ]);
      await as('target', (s) => s.accept(u('target').id, swap.id));
      const approved = await as('manager', (s) => s.approve(u('manager').id, swap.id));
      expect(approved).toMatchObject({ status: 'approved', decidedById: u('manager').id });
      expect(await assignedTo(shift)).toBe(u('target').id);
      const { rows } = await admin.query(`select override_reason from app.shifts where id = $1`, [
        shift,
      ]);
      expect(rows[0].override_reason).toBeNull();
    });

    it('staff cannot approve, and neither can a participant manager (both 403)', async () => {
      const swap = await offer();
      await as('manager', (s) => s.accept(u('manager').id, swap.id));
      await expect(as('target', (s) => s.approve(u('target').id, swap.id))).rejects.toMatchObject({
        status: 403,
      });
      await expect(as('manager', (s) => s.approve(u('manager').id, swap.id))).rejects.toMatchObject(
        {
          code: 'SWAP_NOT_ALLOWED',
          status: 403,
        },
      );
      await expect(
        as('manager2', (s) => s.approve(u('manager2').id, swap.id)),
      ).resolves.toMatchObject({
        status: 'approved',
      });
    });

    it('re-checks certifications at approval (they can expire after acceptance)', async () => {
      const swap = await offer('target');
      await as('target', (s) => s.accept(u('target').id, swap.id));
      await admin.query(
        `update app.user_certifications set expires_at = '2030-09-01T12:00:00Z'
         where user_id = $1 and organization_id = $2`,
        [u('target').id, t.orgId],
      );
      try {
        await expect(
          as('manager', (s) => s.approve(u('manager').id, swap.id)),
        ).rejects.toMatchObject({
          code: 'CERTIFICATION_EXPIRES_BEFORE_SHIFT_END',
          status: 422,
        });
        expect(await assignedTo(shift)).toBe(u('requester').id);
      } finally {
        await admin.query(
          `update app.user_certifications set expires_at = null where user_id = $1 and organization_id = $2`,
          [u('target').id, t.orgId],
        );
      }
    });

    it('re-checks overlaps at approval', async () => {
      const swap = await offer('target');
      await as('target', (s) => s.accept(u('target').id, swap.id));
      await insertShift(admin, t, {
        startsAt: '2030-09-01T12:00:00Z',
        endsAt: '2030-09-01T20:00:00Z',
        assignedUserId: u('target').id,
      });
      await expect(as('manager', (s) => s.approve(u('manager').id, swap.id))).rejects.toMatchObject(
        {
          code: 'SHIFT_OVERLAP',
          status: 409,
        },
      );
    });

    it('only accepted requests can be approved; managers may reject from pending', async () => {
      const swap = await offer('target');
      await expect(as('manager', (s) => s.approve(u('manager').id, swap.id))).rejects.toMatchObject(
        {
          code: 'SWAP_INVALID_TRANSITION',
          status: 409,
        },
      );
      await expect(as('manager', (s) => s.reject(u('manager').id, swap.id))).resolves.toMatchObject(
        {
          status: 'rejected',
          decidedById: u('manager').id,
        },
      );
    });
  });
});
