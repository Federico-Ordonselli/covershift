import { type Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminPool, createTenant, dropTenant, insertShift, type Tenant } from '../helpers/fixtures';
import { createRlsHarness, expectDbError, type RlsHarness } from '../helpers/rls';

const TRANSITION = 'CS409';

/**
 * The swap-request state machine as enforced by the database (ADR 001): one update policy
 * (who may touch a row) + transition triggers (what they may do with it). Includes the
 * regressions found in security review (H1-H4) and the double-claim race.
 */
describe('RLS: swap request state machine', () => {
  let admin: Pool;
  let db: RlsHarness;
  let t: Tenant;
  let shift: string;
  let swap: string;

  // requester owns `shift`; target receives direct offers; coworker is a bystander;
  // manager and manager2 decide; claimer claims open offers.
  const u = (key: string) => t.users[key]!;

  beforeAll(async () => {
    admin = adminPool();
    db = await createRlsHarness();
    t = await createTenant(admin, 'swaps', {
      requester: 'staff',
      target: 'staff',
      coworker: 'staff',
      claimer: 'staff',
      manager: 'manager',
      manager2: 'admin',
    });
  });

  afterAll(async () => {
    await dropTenant(admin, t);
    await admin?.end();
    await db?.close();
  });

  beforeEach(async () => {
    shift = await insertShift(admin, t, {
      startsAt: '2030-06-01T06:00:00Z',
      endsAt: '2030-06-01T14:00:00Z',
      assignedUserId: u('requester').id,
    });
  });

  afterEach(async () => {
    await admin.query(`delete from app.shifts where organization_id = $1`, [t.orgId]);
  });

  /** Creates a request as the requester, through RLS. targetKey undefined = open offer. */
  async function openSwap(targetKey?: string): Promise<string> {
    const [row] = await db.as<{ id: string }>(
      u('requester'),
      `insert into app.swap_requests (organization_id, shift_id, requester_id, target_user_id)
       values ($1, $2, $3, $4) returning id`,
      [t.orgId, shift, u('requester').id, targetKey ? u(targetKey).id : null],
    );
    return row!.id;
  }

  const setStatus = (who: string, status: string, extra = '') =>
    db.as<{ id: string }>(
      u(who),
      `update app.swap_requests set status = $1 ${extra} where id = $2 returning id`,
      [status, swap],
    );

  async function row() {
    const { rows } = await admin.query(`select * from app.swap_requests where id = $1`, [swap]);
    return rows[0] as Record<string, unknown>;
  }

  describe('happy paths', () => {
    it('direct offer: target accepts, manager approves, shift is reassigned atomically', async () => {
      swap = await openSwap('target');
      await setStatus('target', 'accepted');
      await setStatus('manager', 'approved');

      const r = await row();
      expect(r).toMatchObject({ status: 'approved', decided_by_id: u('manager').id });
      expect(r.decided_at).toBeInstanceOf(Date);
      const { rows } = await admin.query(`select assigned_user_id from app.shifts where id = $1`, [
        shift,
      ]);
      expect(rows[0].assigned_user_id).toBe(u('target').id);
    });

    it('open offer: a manager may claim it, and a different scheduler approves', async () => {
      swap = await openSwap();
      await db.as(
        u('manager'),
        `update app.swap_requests set status = 'accepted', target_user_id = $1
         where id = $2 and status = 'pending' and target_user_id is null`,
        [u('manager').id, swap],
      );
      await setStatus('manager2', 'approved');
      expect(await row()).toMatchObject({ status: 'approved', target_user_id: u('manager').id });
    });

    it('target declines a direct offer; requester cancels (from pending and accepted)', async () => {
      swap = await openSwap('target');
      await setStatus('target', 'declined');
      expect((await row()).status).toBe('declined');

      swap = await openSwap('target');
      await setStatus('requester', 'cancelled');
      expect((await row()).status).toBe('cancelled');

      swap = await openSwap('target');
      await setStatus('target', 'accepted');
      await setStatus('requester', 'cancelled');
      expect((await row()).status).toBe('cancelled');
    });

    it('a manager may reject from pending and from accepted', async () => {
      swap = await openSwap('target');
      await setStatus('manager', 'rejected');
      expect(await row()).toMatchObject({ status: 'rejected', decided_by_id: u('manager').id });

      swap = await openSwap('target');
      await setStatus('target', 'accepted');
      await setStatus('manager', 'rejected');
      expect((await row()).status).toBe('rejected');
    });
  });

  describe('security review regressions', () => {
    it('H1: a bystander cannot decline someone else’s open offer', async () => {
      swap = await openSwap();
      await expectDbError(
        setStatus('coworker', 'declined', `, target_user_id = '${u('coworker').id}'`),
        TRANSITION,
        /^SWAP_INVALID_TRANSITION|^SWAP_NOT_ALLOWED/,
      );
      await expectDbError(setStatus('coworker', 'declined'), TRANSITION, /^SWAP_NOT_ALLOWED/);
      expect((await row()).status).toBe('pending');
    });

    it('H2: staff cannot write decision fields or rewrite the target', async () => {
      swap = await openSwap('target');
      // no UPDATE grant on decision columns at all
      await expectDbError(
        setStatus('requester', 'cancelled', `, decided_at = '2020-01-01'`),
        '42501',
      );
      await expectDbError(
        setStatus('requester', 'cancelled', `, target_user_id = '${u('coworker').id}'`),
        TRANSITION,
        /^SWAP_INVALID_TRANSITION: target changes only when claiming/,
      );
    });

    it('H2: audit timestamps are stamped by the database, not the caller', async () => {
      const [created] = await db.as<{ id: string; created_at: Date; updated_at: Date }>(
        u('requester'),
        `insert into app.swap_requests (organization_id, shift_id, requester_id, created_at, updated_at)
         values ($1, $2, $3, '2001-01-01', '2001-01-01') returning id, created_at, updated_at`,
        [t.orgId, shift, u('requester').id],
      );
      expect(created!.created_at.getUTCFullYear()).toBeGreaterThan(2001);
      expect(created!.updated_at.getUTCFullYear()).toBeGreaterThan(2001);

      // a no-op update cannot smuggle in a timestamp either
      swap = created!.id;
      await db.as(
        u('requester'),
        `update app.swap_requests set updated_at = '1999-01-01' where id = $1`,
        [swap],
      );
      expect(((await row()).updated_at as Date).getUTCFullYear()).toBeGreaterThan(1999);
    });

    it('H3: a manager cannot attribute a decision to someone else', async () => {
      swap = await openSwap('target');
      await setStatus('target', 'accepted');
      await expectDbError(
        setStatus('manager', 'approved', `, decided_by_id = '${u('manager2').id}'`),
        '42501',
      );
      await setStatus('manager', 'approved');
      expect((await row()).decided_by_id).toBe(u('manager').id);
    });

    it('H4: deleting an organization with swap history cascades; history blocks hard deletes', async () => {
      const other = await createTenant(admin, 'h4', { requester: 'staff', target: 'staff' });
      try {
        const otherShift = await insertShift(admin, other, {
          startsAt: '2030-06-01T06:00:00Z',
          endsAt: '2030-06-01T14:00:00Z',
          assignedUserId: other.users.requester!.id,
        });
        await admin.query(
          `insert into app.swap_requests (organization_id, shift_id, requester_id, target_user_id)
           values ($1, $2, $3, $4)`,
          [other.orgId, otherShift, other.users.requester!.id, other.users.target!.id],
        );

        // hard-deleting a member with swap history: refused (deferred FK, checked at commit)
        await expect(
          admin.query(`delete from app.memberships where organization_id = $1 and user_id = $2`, [
            other.orgId,
            other.users.target!.id,
          ]),
        ).rejects.toMatchObject({ code: '23503' });
        // deleting a position that still has shifts: refused
        await expect(
          admin.query(`delete from app.positions where id = $1`, [other.positionId]),
        ).rejects.toMatchObject({ code: '23503' });

        await admin.query(`delete from app.organizations where id = $1`, [other.orgId]);
        const { rows } = await admin.query(
          `select count(*)::int as n from app.swap_requests where organization_id = $1`,
          [other.orgId],
        );
        expect(rows[0].n).toBe(0);
      } finally {
        await dropTenant(admin, other);
      }
    });
  });

  describe('who decides', () => {
    it('staff cannot approve or reject, even their own request', async () => {
      swap = await openSwap('target');
      await setStatus('target', 'accepted');
      await expectDbError(setStatus('requester', 'approved'), TRANSITION, /^SWAP_NOT_ALLOWED/);
      await expectDbError(setStatus('target', 'approved'), TRANSITION, /^SWAP_NOT_ALLOWED/);
      // a bystander can't even see a direct offer for update: 0 rows, nothing to refuse
      expect(await setStatus('coworker', 'rejected')).toEqual([]);
    });

    it('the approver can never be the requester or the target (trigger)', async () => {
      swap = await openSwap();
      await db.as(
        u('manager'),
        `update app.swap_requests set status = 'accepted', target_user_id = $1 where id = $2`,
        [u('manager').id, swap],
      );
      await expectDbError(
        setStatus('manager', 'approved'),
        TRANSITION,
        /^SWAP_NOT_ALLOWED: the decider cannot be the requester or the target/,
      );
    });

    it('the approver can never be the requester or the target (CHECK backstop, bypassing the trigger)', async () => {
      swap = await openSwap('target');
      // as a maintenance role the triggers are skipped; the CHECK constraint still holds
      await expect(
        admin.query(
          `update app.swap_requests set status = 'rejected', decided_by_id = requester_id, decided_at = now()
           where id = $1`,
          [swap],
        ),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'swap_requests_decider_not_participant_check',
      });
    });
  });

  describe('invalid transitions', () => {
    it('only accepted requests can be approved', async () => {
      swap = await openSwap('target');
      await expectDbError(
        setStatus('manager', 'approved'),
        TRANSITION,
        /^SWAP_INVALID_TRANSITION: only accepted requests can be approved/,
      );
    });

    it('terminal states are final', async () => {
      swap = await openSwap('target');
      await setStatus('target', 'accepted');
      await setStatus('manager', 'approved');
      await expectDbError(
        setStatus('requester', 'cancelled'),
        TRANSITION,
        /^SWAP_INVALID_TRANSITION: request is already approved/,
      );
    });

    it('cannot claim your own open offer, or claim on someone else’s behalf', async () => {
      swap = await openSwap();
      await expectDbError(
        setStatus('requester', 'accepted', `, target_user_id = '${u('requester').id}'`),
        TRANSITION,
      );
      await expectDbError(
        setStatus('claimer', 'accepted', `, target_user_id = '${u('coworker').id}'`),
        TRANSITION,
        /a claim assigns the offer to the claimer/,
      );
    });

    it('approval is refused once the shift has started', async () => {
      swap = await openSwap('target');
      await setStatus('target', 'accepted');
      await admin.query(
        `update app.shifts set starts_at = now() - interval '1 hour', ends_at = now() + interval '7 hours'
         where id = $1`,
        [shift],
      );
      await expectDbError(setStatus('manager', 'approved'), TRANSITION, /^SHIFT_ALREADY_STARTED/);
    });

    it('approval fails if the shift was reassigned in the meantime', async () => {
      swap = await openSwap('target');
      await setStatus('target', 'accepted');
      await admin.query(`update app.shifts set assigned_user_id = $1 where id = $2`, [
        u('coworker').id,
        shift,
      ]);
      await expectDbError(setStatus('manager', 'approved'), TRANSITION, /^SWAP_CONFLICT/);
      expect((await row()).status).toBe('accepted'); // whole statement rolled back
    });

    it('approval that would double-book the target hits the exclusion constraint', async () => {
      await insertShift(admin, t, {
        startsAt: '2030-06-01T10:00:00Z',
        endsAt: '2030-06-01T18:00:00Z',
        assignedUserId: u('target').id,
      });
      swap = await openSwap('target');
      await setStatus('target', 'accepted');
      await expectDbError(setStatus('manager', 'approved'), '23P01');
      expect((await row()).status).toBe('accepted');
    });

    it('a shift has at most one active request', async () => {
      swap = await openSwap('target');
      await expectDbError(openSwap(), '23505', /swap_requests_one_active_per_shift/);
      await setStatus('requester', 'cancelled');
      await expect(openSwap()).resolves.toBeDefined(); // terminal ones don't count
    });
  });

  describe('concurrency', () => {
    it('two members claiming the same open offer: exactly one wins, the other matches 0 rows', async () => {
      swap = await openSwap();
      const claim = `update app.swap_requests set status = 'accepted', target_user_id = $1
                     where id = $2 and status = 'pending' and target_user_id is null
                     returning id`;

      let releaseFirst!: () => void;
      const firstMayCommit = new Promise<void>((resolve) => (releaseFirst = resolve));
      let firstUpdated!: () => void;
      const firstHasUpdated = new Promise<void>((resolve) => (firstUpdated = resolve));

      // First claimer updates and holds its transaction (and the row lock) open.
      const first = db.rls.run(
        { sub: u('claimer').id, role: 'authenticated', aud: 'authenticated', exp: 9999999999 },
        async (em) => {
          const { records: rows } = await em.queryRunner!.query(
            claim,
            [u('claimer').id, swap],
            true,
          );
          firstUpdated();
          await firstMayCommit;
          return rows;
        },
      );
      await firstHasUpdated;

      // Second claimer's identical update blocks on the row lock...
      const second = db.as(u('coworker'), claim, [u('coworker').id, swap]);
      await waitUntilBlockedOnLock(admin);

      // ...and, once the first commits, re-evaluates its WHERE and matches nothing.
      releaseFirst();
      const [firstRows, secondRows] = await Promise.all([first, second]);

      expect(firstRows).toHaveLength(1);
      expect(secondRows).toHaveLength(0); // the service turns this into 409
      expect(await row()).toMatchObject({ status: 'accepted', target_user_id: u('claimer').id });
    });
  });
});

/** Polls until some covershift-api backend is waiting on a lock (proves the race overlapped). */
async function waitUntilBlockedOnLock(admin: Pool, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await admin.query(
      `select count(*)::int as n from pg_stat_activity
       where application_name = 'covershift-api' and wait_event_type = 'Lock'`,
    );
    if (rows[0].n > 0) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('second claim never blocked on the row lock');
}
