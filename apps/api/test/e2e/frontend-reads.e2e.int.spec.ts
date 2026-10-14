import { type INestApplication } from '@nestjs/common';
import { LIST_HARD_CAP } from '@covershift/shared';
import { randomUUID } from 'node:crypto';
import { type Pool } from 'pg';
import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeCursor } from '../../src/common/cursor';
import { createE2eApp, tokenFor } from '../helpers/app';
import { adminPool, createLoginTenant, insertShift, type Tenant } from '../helpers/fixtures';
import { adminClient } from '../helpers/supabase';

const PASSWORD = 'e2e-frontend-reads-horse';

interface Item {
  id: string;
  organizationId: string;
}

/**
 * The reads the frontend is built on (/me, organizations, positions, members) and keyset
 * pagination, over HTTP with real logins. Tenant b is foreign to everyone in a; in c,
 * a.staff is a manager and a.manager has a deactivated membership.
 */
describe('e2e: frontend reads and pagination', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let admin: Pool;
  let a: Tenant;
  let b: Tenant;
  let c: Tenant;

  const bearer = async (t: Tenant, key: string) =>
    `Bearer ${await tokenFor(t.users[key]!, PASSWORD)}`;
  const get = async (path: string, auth: string, query: Record<string, string | number> = {}) =>
    http().get(path).query(query).set('authorization', auth);

  /** Follows nextCursor to the end; fails on a cycle instead of hanging. */
  async function walk(path: string, auth: string, query: Record<string, string | number>) {
    const seen: Item[] = [];
    let cursor: string | null = null;
    for (let pages = 0; pages < 50; pages++) {
      const res = await get(path, auth, { ...query, ...(cursor ? { cursor } : {}) });
      expect(res.status, res.text).toBe(200);
      seen.push(...(res.body.items as Item[]));
      cursor = res.body.nextCursor as string | null;
      if (!cursor) return seen;
    }
    throw new Error('pagination did not terminate');
  }

  beforeAll(async () => {
    ({ app, http } = await createE2eApp());
    admin = adminPool();
    a = await createLoginTenant(
      admin,
      'fe-a',
      { manager: 'manager', staff: 'staff', coworker: 'staff', leaver: 'staff' },
      PASSWORD,
    );
    b = await createLoginTenant(admin, 'fe-b', { manager: 'manager', staff: 'staff' }, PASSWORD);
    c = await createLoginTenant(admin, 'fe-c', { owner: 'admin' }, PASSWORD);

    await admin.query(
      `insert into app.memberships (organization_id, user_id, role) values ($1, $2, 'manager')`,
      [c.orgId, a.users.staff!.id],
    );
    await admin.query(
      `insert into app.memberships (organization_id, user_id, role, deactivated_at)
       values ($1, $2, 'staff', now())`,
      [c.orgId, a.users.manager!.id],
    );
    await admin.query(
      `update app.memberships set deactivated_at = now() where organization_id = $1 and user_id = $2`,
      [a.orgId, a.users.leaver!.id],
    );
    await admin.query(`insert into app.positions (organization_id, name) values ($1, 'Apron')`, [
      a.orgId,
    ]);
  });

  afterAll(async () => {
    for (const t of [a, b, c]) {
      if (!t) continue;
      await admin.query(`delete from app.organizations where id = $1`, [t.orgId]);
      for (const user of Object.values(t.users)) await adminClient().auth.admin.deleteUser(user.id);
    }
    await admin?.end();
    await app?.close();
  });

  describe('GET /me and GET /organizations', () => {
    it('returns the caller’s profile and every active membership with its role', async () => {
      const res = await get('/me', await bearer(a, 'staff'));
      expect(res.status, res.text).toBe(200);
      expect(res.body).toMatchObject({
        id: a.users.staff!.id,
        email: a.users.staff!.email,
        fullName: 'staff',
      });
      const roles = Object.fromEntries(
        (res.body.memberships as Array<{ id: string; role: string }>).map((m) => [m.id, m.role]),
      );
      expect(roles).toEqual({ [a.orgId]: 'staff', [c.orgId]: 'manager' });
    });

    it('leaves out deactivated memberships and other users’ memberships', async () => {
      // a.manager was deactivated in c; c's other members must not show up as "my" orgs.
      const me = await get('/me', await bearer(a, 'manager'));
      expect(me.body.memberships.map((m: { id: string }) => m.id)).toEqual([a.orgId]);

      const leaver = await get('/me', await bearer(a, 'leaver'));
      expect(leaver.status).toBe(200);
      expect(leaver.body.memberships).toEqual([]);
    });

    it('GET /organizations matches /me memberships', async () => {
      const auth = await bearer(a, 'staff');
      const [me, orgs] = await Promise.all([get('/me', auth), get('/organizations', auth)]);
      expect(orgs.status).toBe(200);
      expect(orgs.body).toEqual(me.body.memberships);
      expect(orgs.body.map((o: { id: string }) => o.id)).not.toContain(b.orgId);
    });
  });

  describe('GET /organizations/:id/positions and /members', () => {
    it('lists the organization’s positions', async () => {
      const res = await get(`/organizations/${a.orgId}/positions`, await bearer(a, 'staff'));
      expect(res.status).toBe(200);
      expect(res.body.map((p: { name: string }) => p.name)).toEqual(['Apron', 'Gate screening']);
      expect(new Set(res.body.map((p: Item) => p.organizationId))).toEqual(new Set([a.orgId]));
    });

    it('lists active members only, with names and roles', async () => {
      const res = await get(`/organizations/${a.orgId}/members`, await bearer(a, 'staff'));
      expect(res.status).toBe(200);
      expect(
        res.body.map((m: { userId: string; fullName: string; role: string }) => [
          m.userId,
          m.fullName,
          m.role,
        ]),
      ).toEqual([
        [a.users.coworker!.id, 'coworker', 'staff'],
        [a.users.manager!.id, 'manager', 'manager'],
        [a.users.staff!.id, 'staff', 'staff'],
      ]);
    });

    it.each(['positions', 'members'])(
      '%s: another tenant’s or an unknown organization is 404, indistinguishably',
      async (sub) => {
        const auth = await bearer(a, 'manager');
        const foreign = await get(`/organizations/${b.orgId}/${sub}`, auth);
        const unknown = await get(`/organizations/${randomUUID()}/${sub}`, auth);
        for (const res of [foreign, unknown]) {
          expect(res.status).toBe(404);
          expect(res.body).toMatchObject({ code: 'NOT_FOUND', detail: 'Organization not found' });
        }
        expect((await get(`/organizations/not-a-uuid/${sub}`, auth)).status).toBe(400);
      },
    );

    it.each(['positions', 'members'])(
      '%s: a deactivated member has lost access (404)',
      async (sub) => {
        const res = await get(`/organizations/${a.orgId}/${sub}`, await bearer(a, 'leaver'));
        // Status and body together: a failure shows whether anything leaked.
        expect({ status: res.status, body: res.body }).toEqual({
          status: 404,
          body: expect.objectContaining({ code: 'NOT_FOUND' }),
        });
      },
    );
  });

  describe(`hard cap: positions and members return at most ${LIST_HARD_CAP}`, () => {
    let big: Tenant;
    const bulkEmail = (slug: string) => `bulk-%-${slug}@covershift.test`;

    beforeAll(async () => {
      big = await createLoginTenant(admin, 'fe-big', { manager: 'manager' }, PASSWORD);
      const over = LIST_HARD_CAP + 1;
      await admin.query(
        `insert into app.positions (organization_id, name)
         select $1, 'P' || lpad(g::text, 4, '0') from generate_series(1, $2) g`,
        [big.orgId, over],
      );
      // Profiles come from the on_auth_user_created trigger.
      await admin.query(
        `with u as (
           insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
           select gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
                  'authenticated', replace($2, '%', g::text),
                  jsonb_build_object('full_name', 'Bulk ' || lpad(g::text, 4, '0'))
           from generate_series(1, $3) g
           returning id)
         insert into app.memberships (organization_id, user_id, role)
         select $1, id, 'staff' from u`,
        [big.orgId, bulkEmail(big.slug), over],
      );
    });

    afterAll(async () => {
      if (!big) return;
      await admin.query(`delete from app.organizations where id = $1`, [big.orgId]);
      await admin.query(`delete from auth.users where email like $1`, [bulkEmail(big.slug)]);
      for (const user of Object.values(big.users))
        await adminClient().auth.admin.deleteUser(user.id);
    });

    it('positions: the first LIST_HARD_CAP by name', async () => {
      const res = await get(`/organizations/${big.orgId}/positions`, await bearer(big, 'manager'));
      expect(res.status).toBe(200);
      const { rows } = await admin.query<{ id: string }>(
        `select id from app.positions where organization_id = $1 order by name, id limit $2`,
        [big.orgId, LIST_HARD_CAP],
      );
      expect(res.body.map((p: { id: string }) => p.id)).toEqual(rows.map((r) => r.id));
    });

    it('members: the first LIST_HARD_CAP by name', async () => {
      const res = await get(`/organizations/${big.orgId}/members`, await bearer(big, 'manager'));
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(LIST_HARD_CAP);
      expect(res.body[0].fullName).toBe('Bulk 0001');
      expect(res.body.at(-1).fullName).toBe(`Bulk ${String(LIST_HARD_CAP).padStart(4, '0')}`);
    });
  });

  describe('GET /shifts pagination', () => {
    // Keys that break naive cursors: equal starts (id decides), and starts that differ
    // only below a millisecond (a JS Date cursor would truncate them together).
    const starts = [
      '2031-03-01T06:00:00.000001Z',
      '2031-03-01T06:00:00.000002Z',
      '2031-03-01T06:00:00.000003Z',
      '2031-03-01T08:00:00Z',
      '2031-03-01T08:00:00Z',
      '2031-03-01T08:00:00Z',
      '2031-03-02T06:00:00Z',
    ];
    let expected: string[];

    beforeAll(async () => {
      const created: Array<{ id: string; startsAt: string }> = [];
      for (const startsAt of starts) {
        const endsAt = new Date(Date.parse(startsAt) + 4 * 3600_000).toISOString();
        created.push({ id: await insertShift(admin, a, { startsAt, endsAt }), startsAt });
        await insertShift(admin, b, { startsAt, endsAt });
      }
      const { rows } = await admin.query<{ id: string }>(
        `select id from app.shifts where id = any($1::uuid[]) order by starts_at, id`,
        [created.map((s) => s.id)],
      );
      expected = rows.map((r) => r.id);
    });

    const window = { from: '2031-03-01T00:00:00Z', to: '2031-03-03T00:00:00Z' };

    it.each([1, 2, 3, 7, 100])(
      'limit=%i returns every shift exactly once, in (startsAt, id) order',
      async (limit) => {
        const seen = await walk('/shifts', await bearer(a, 'staff'), { ...window, limit });
        expect(seen.map((s) => s.id)).toEqual(expected);
      },
    );

    it('never pages into another tenant, even when filtering by it', async () => {
      const auth = await bearer(a, 'staff');
      const seen = await walk('/shifts', auth, { ...window, limit: 2 });
      expect(new Set(seen.map((s) => s.organizationId))).toEqual(new Set([a.orgId]));
      expect(await walk('/shifts', auth, { ...window, organizationId: b.orgId })).toEqual([]);
    });

    it('a crafted cursor only moves the page start: RLS still decides the rows', async () => {
      const auth = await bearer(a, 'staff');
      const { rows } = await admin.query<{ id: string }>(
        `select id from app.shifts where organization_id = $1 limit 1`,
        [b.orgId],
      );
      const crafted = encodeCursor({ key: '1970-01-01T00:00:00.000000Z', id: rows[0]!.id });
      const res = await get('/shifts', auth, { ...window, cursor: crafted, limit: 100 });
      expect(res.status).toBe(200);
      expect(res.body.items.map((s: Item) => s.id)).toEqual(expected);
    });

    it('filters by date range: shifts overlapping [from, to)', async () => {
      const seen = await walk('/shifts', await bearer(a, 'staff'), {
        from: '2031-03-02T00:00:00Z',
        to: '2031-03-03T00:00:00Z',
        limit: 1,
      });
      expect(seen.map((s) => s.id)).toEqual(expected.slice(-1));
    });

    it.each([
      ['a garbage cursor', { cursor: 'garbage' }],
      ['limit=0', { limit: 0 }],
      ['limit=101', { limit: 101 }],
      ['to before from', { from: '2031-03-02T00:00:00Z', to: '2031-03-01T00:00:00Z' }],
    ])('rejects %s with 400 VALIDATION_FAILED', async (_, query) => {
      const res = await get('/shifts', await bearer(a, 'staff'), query);
      expect(res.status, res.text).toBe(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });

  describe('GET /swap-requests pagination and filters', () => {
    let expectedNewestFirst: string[];
    let direct: string;

    beforeAll(async () => {
      // One transaction: now() is constant, so every created_at is identical and only
      // the id tiebreaker orders them.
      const requester = a.users.staff!.id;
      const client = await admin.connect();
      const ids: string[] = [];
      try {
        await client.query('begin');
        for (let day = 1; day <= 5; day++) {
          const shift = await insertShift(client, a, {
            startsAt: `2031-04-0${day}T06:00:00Z`,
            endsAt: `2031-04-0${day}T14:00:00Z`,
            assignedUserId: requester,
          });
          const target = day === 1 ? a.users.coworker!.id : null;
          const { rows } = await client.query<{ id: string }>(
            `insert into app.swap_requests (organization_id, shift_id, requester_id, target_user_id)
             values ($1, $2, $3, $4) returning id`,
            [a.orgId, shift, requester, target],
          );
          ids.push(rows[0]!.id);
        }
        await client.query('commit');
      } finally {
        client.release();
      }
      direct = ids[0]!;
      const { rows } = await admin.query<{ id: string; same: boolean }>(
        `select id, min(created_at) over () = max(created_at) over () as same
         from app.swap_requests where id = any($1::uuid[]) order by created_at desc, id desc`,
        [ids],
      );
      expect(rows.every((r) => r.same)).toBe(true); // the premise of this suite
      expectedNewestFirst = rows.map((r) => r.id);

      const shiftB = await insertShift(admin, b, {
        startsAt: '2031-04-01T06:00:00Z',
        endsAt: '2031-04-01T14:00:00Z',
        assignedUserId: b.users.staff!.id,
      });
      await admin.query(
        `insert into app.swap_requests (organization_id, shift_id, requester_id) values ($1, $2, $3)`,
        [b.orgId, shiftB, b.users.staff!.id],
      );
    });

    it.each([1, 2, 5])('limit=%i walks identical timestamps exactly once', async (limit) => {
      const seen = await walk('/swap-requests', await bearer(a, 'coworker'), {
        requesterId: a.users.staff!.id,
        limit,
      });
      expect(seen.map((s) => s.id)).toEqual(expectedNewestFirst);
    });

    it('filters for the frontend’s views', async () => {
      const auth = await bearer(a, 'coworker');
      const ids = async (query: Record<string, string>) =>
        (await walk('/swap-requests', auth, query)).map((s) => s.id);

      expect(await ids({ targetUserId: a.users.coworker!.id, status: 'pending' })).toEqual([
        direct,
      ]);
      expect(await ids({ open: 'false', organizationId: a.orgId })).toEqual([direct]);
      const open = await ids({ open: 'true', status: 'pending', organizationId: a.orgId });
      expect(open.sort()).toEqual(expectedNewestFirst.filter((id) => id !== direct).sort());
      expect(await ids({ status: 'accepted', organizationId: a.orgId })).toEqual([]);
    });

    it('never returns another tenant’s requests, whatever the filter', async () => {
      const auth = await bearer(a, 'coworker');
      const all = await walk('/swap-requests', auth, { limit: 2 });
      expect(new Set(all.map((s) => s.organizationId))).toEqual(new Set([a.orgId]));
      const crafted: Array<Record<string, string>> = [
        { organizationId: b.orgId },
        { requesterId: b.users.staff!.id },
        { open: 'true', organizationId: b.orgId },
      ];
      for (const query of crafted) {
        expect(await walk('/swap-requests', auth, query)).toEqual([]);
      }
    });

    it('rejects a non-boolean open filter', async () => {
      // z.stringbool also accepts yes/no, 1/0, on/off; anything else is a 400.
      const res = await get('/swap-requests', await bearer(a, 'coworker'), { open: 'maybe' });
      expect(res.status).toBe(400);
    });
  });
});
