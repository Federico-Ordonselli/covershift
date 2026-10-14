import { type INestApplication } from '@nestjs/common';
import { decodeJwt, decodeProtectedHeader, generateKeyPair, SignJWT } from 'jose';
import { type Pool } from 'pg';
import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createE2eApp, stackJwts, tokenFor } from '../helpers/app';
import { env } from '../helpers/env';
import { adminPool, createLoginTenant, insertShift, type Tenant } from '../helpers/fixtures';
import { adminClient } from '../helpers/supabase';

const PASSWORD = 'e2e-correct-horse-battery';

/**
 * HTTP-level proof of tenant isolation: the real app (JWKS guard, RLS interceptor,
 * problem-details filter), real GoTrue logins, and requests an attacker would craft:
 * forged or misused tokens, other tenants' ids in paths, queries and bodies, and
 * fields the API never accepts from clients.
 */
describe('e2e: crafted requests', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let admin: Pool;
  let a: Tenant;
  let b: Tenant;
  let shiftA: string;
  let shiftB: string;
  let swapB: string;

  const token = (t: Tenant, key: string) => tokenFor(t.users[key]!, PASSWORD);
  const bearer = async (t: Tenant, key: string) => `Bearer ${await token(t, key)}`;

  async function shiftCount(orgId: string): Promise<number> {
    const { rows } = await admin.query<{ n: number }>(
      `select count(*)::int as n from app.shifts where organization_id = $1`,
      [orgId],
    );
    return rows[0]!.n;
  }

  beforeAll(async () => {
    ({ app, http } = await createE2eApp());
    admin = adminPool();
    a = await createLoginTenant(
      admin,
      'e2e-a',
      { manager: 'manager', staff: 'staff', coworker: 'staff', coworker2: 'staff' },
      PASSWORD,
    );
    b = await createLoginTenant(admin, 'e2e-b', { manager: 'manager', staff: 'staff' }, PASSWORD);

    shiftA = await insertShift(admin, a, {
      startsAt: '2030-10-01T06:00:00Z',
      endsAt: '2030-10-01T14:00:00Z',
      assignedUserId: a.users.staff!.id,
    });
    shiftB = await insertShift(admin, b, {
      startsAt: '2030-10-01T06:00:00Z',
      endsAt: '2030-10-01T14:00:00Z',
      assignedUserId: b.users.staff!.id,
    });
    const { rows } = await admin.query<{ id: string }>(
      `insert into app.swap_requests (organization_id, shift_id, requester_id)
       values ($1, $2, $3) returning id`,
      [b.orgId, shiftB, b.users.staff!.id],
    );
    swapB = rows[0]!.id;
  });

  afterAll(async () => {
    for (const t of [a, b]) {
      if (!t) continue;
      await admin.query(`delete from app.organizations where id = $1`, [t.orgId]);
      for (const user of Object.values(t.users)) await adminClient().auth.admin.deleteUser(user.id);
    }
    await admin?.end();
    await app?.close();
  });

  describe('forged and misused tokens are rejected before any database access', () => {
    const victim = () => b.users.manager!;

    async function expect401(authorization: string | undefined) {
      const before = await shiftCount(b.orgId);
      const req = http().post('/shifts').send({
        organizationId: b.orgId,
        positionId: b.positionId,
        startsAt: '2030-10-02T06:00:00Z',
        endsAt: '2030-10-02T14:00:00Z',
      });
      if (authorization) req.set('authorization', authorization);
      const res = await req;
      expect(res.status, res.text).toBe(401);
      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(await shiftCount(b.orgId)).toBe(before); // no side effect
    }

    it('no token, or a non-bearer scheme', async () => {
      await expect401(undefined);
      await expect401(`Basic ${Buffer.from('manager:pw').toString('base64')}`);
    });

    it('a self-signed ES256 token reusing the project’s kid and claiming the victim', async () => {
      const real = await token(a, 'staff');
      const { kid } = decodeProtectedHeader(real);
      const attacker = await generateKeyPair('ES256');
      const forged = await new SignJWT({ role: 'authenticated', email: victim().email })
        .setProtectedHeader({ alg: 'ES256', kid: kid! })
        .setSubject(victim().id)
        .setAudience('authenticated')
        .setIssuer(env.SUPABASE_JWT_ISSUER)
        .setExpirationTime('5m')
        .sign(attacker.privateKey);
      await expect401(`Bearer ${forged}`);
    });

    it('alg: none', async () => {
      const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const payload = {
        sub: victim().id,
        role: 'authenticated',
        aud: 'authenticated',
        iss: env.SUPABASE_JWT_ISSUER,
        exp: Math.floor(Date.now() / 1000) + 300,
      };
      await expect401(`Bearer ${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.`);
    });

    it('HS256 signed with the local stack’s published JWT secret', async () => {
      const forged = await new SignJWT({ role: 'authenticated' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(victim().id)
        .setAudience('authenticated')
        .setIssuer(env.SUPABASE_JWT_ISSUER)
        .setExpirationTime('5m')
        .sign(new TextEncoder().encode('super-secret-jwt-token-with-at-least-32-characters-long'));
      await expect401(`Bearer ${forged}`);
    });

    it('a real token with its payload swapped for the victim', async () => {
      const [header, , signature] = (await token(a, 'staff')).split('.');
      const payload = { ...decodeJwt(await token(a, 'staff')), sub: victim().id };
      const swapped = Buffer.from(JSON.stringify(payload)).toString('base64url');
      await expect401(`Bearer ${header}.${swapped}.${signature}`);
    });

    it('the stack’s own anon and service_role keys (validly signed, but not user tokens)', async () => {
      const { anon, serviceRole } = stackJwts();
      await expect401(`Bearer ${anon}`);
      await expect401(`Bearer ${serviceRole}`); // accepted, this would mean RLS bypass
    });
  });

  describe('other tenants’ ids in paths, queries and bodies', () => {
    it('lists only the caller’s organization, even when filtering by another', async () => {
      const own = await http()
        .get('/shifts')
        .set('authorization', await bearer(a, 'staff'));
      expect(own.status).toBe(200);
      expect(new Set(own.body.map((s: { organizationId: string }) => s.organizationId))).toEqual(
        new Set([a.orgId]),
      );

      const crafted = await http()
        .get('/shifts')
        .query({ organizationId: b.orgId })
        .set('authorization', await bearer(a, 'staff'));
      expect(crafted.status).toBe(200);
      expect(crafted.body).toEqual([]);
    });

    it('GET, PATCH and DELETE of another tenant’s shift are 404 and change nothing', async () => {
      const auth = await bearer(a, 'manager');
      const get = await http().get(`/shifts/${shiftB}`).set('authorization', auth);
      expect(get.status).toBe(404);
      expect(get.body).toMatchObject({ code: 'NOT_FOUND' });

      const patch = await http()
        .patch(`/shifts/${shiftB}`)
        .set('authorization', auth)
        .send({ assignedUserId: null });
      expect(patch.status).toBe(404);

      const del = await http().delete(`/shifts/${shiftB}`).set('authorization', auth);
      expect(del.status).toBe(404);

      const { rows } = await admin.query(`select assigned_user_id from app.shifts where id = $1`, [
        shiftB,
      ]);
      expect(rows[0]).toEqual({ assigned_user_id: b.users.staff!.id });
    });

    // Service-layer pre-checks (readable 403/422). They stay green with RLS switched off
    // (negative control N2); the RLS backstop for the same cases is proven in test/rls.
    it('creating in another organization is 403; mixing in its position or members is 422', async () => {
      const auth = await bearer(a, 'manager');
      const window = { startsAt: '2030-10-03T06:00:00Z', endsAt: '2030-10-03T14:00:00Z' };

      const otherOrg = await http()
        .post('/shifts')
        .set('authorization', auth)
        .send({ organizationId: b.orgId, positionId: b.positionId, ...window });
      expect(otherOrg.status).toBe(403);

      const otherPosition = await http()
        .post('/shifts')
        .set('authorization', auth)
        .send({ organizationId: a.orgId, positionId: b.positionId, ...window });
      expect(otherPosition.status).toBe(422);
      expect(otherPosition.body.code).toBe('INVALID_REFERENCE');

      const otherMember = await http()
        .post('/shifts')
        .set('authorization', auth)
        .send({
          organizationId: a.orgId,
          positionId: a.positionId,
          ...window,
          assignedUserId: b.users.staff!.id,
        });
      expect(otherMember.status).toBe(422);
      expect(otherMember.body.code).toBe('NOT_A_MEMBER');
    });

    it('another tenant’s swap request is 404 for reads and every action', async () => {
      const auth = await bearer(a, 'manager');
      expect((await http().get(`/swap-requests/${swapB}`).set('authorization', auth)).status).toBe(
        404,
      );
      for (const action of ['accept', 'decline', 'cancel', 'approve', 'reject']) {
        const res = await http()
          .post(`/swap-requests/${swapB}/${action}`)
          .set('authorization', auth);
        expect(res.status, action).toBe(404);
      }
      const { rows } = await admin.query(`select status from app.swap_requests where id = $1`, [
        swapB,
      ]);
      expect(rows[0]).toEqual({ status: 'pending' });
    });

    it('offering another tenant’s shift is 404', async () => {
      const res = await http()
        .post('/swap-requests')
        .set('authorization', await bearer(a, 'staff'))
        .send({ shiftId: shiftB });
      expect(res.status).toBe(404);
    });
  });

  describe('transitions: hidden = 404, visible but not yours = 403, wrong state = 409', () => {
    let direct: string; // staff -> coworker
    let open: string; // staff -> anyone

    const act = async (who: string, action: string, id: string) =>
      http()
        .post(`/swap-requests/${id}/${action}`)
        .set('authorization', await bearer(a, who));

    async function status(id: string): Promise<string> {
      const { rows } = await admin.query<{ status: string }>(
        `select status from app.swap_requests where id = $1`,
        [id],
      );
      return rows[0]!.status;
    }

    async function offerShift(day: string, target: string | null): Promise<string> {
      const shiftId = await insertShift(admin, a, {
        startsAt: `2030-11-${day}T06:00:00Z`,
        endsAt: `2030-11-${day}T14:00:00Z`,
        assignedUserId: a.users.staff!.id,
      });
      const res = await http()
        .post('/swap-requests')
        .set('authorization', await bearer(a, 'staff'))
        .send({ shiftId, targetUserId: target });
      expect(res.status, res.text).toBe(201);
      return res.body.id as string;
    }

    beforeAll(async () => {
      direct = await offerShift('01', a.users.coworker!.id);
      open = await offerShift('02', null);
    });

    it.each([
      ['accept', 'coworker2', 'direct', 'not the target of a direct offer'],
      ['accept', 'staff', 'open', 'claiming your own offer'],
      ['decline', 'coworker2', 'direct', 'not the target'],
      ['decline', 'coworker', 'open', 'open offers have no target to decline'],
      ['cancel', 'coworker', 'direct', 'not the requester'],
      ['approve', 'coworker2', 'direct', 'staff'],
      ['reject', 'coworker2', 'direct', 'staff'],
    ])('%s by %s on the %s offer is 403 (%s) and changes nothing', async (action, who, which) => {
      const id = which === 'direct' ? direct : open;
      const before = await status(id);
      const res = await act(who, action, id);
      expect(res.status, res.text).toBe(403);
      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(await status(id)).toBe(before);
    });

    it('a manager who is a participant may not decide: approve and reject are 403', async () => {
      const claimed = await act('manager', 'accept', open);
      expect(claimed.status, claimed.text).toBe(200);
      for (const action of ['approve', 'reject']) {
        const res = await act('manager', action, open);
        expect(res.status, action).toBe(403);
        expect(res.body.code).toBe('SWAP_NOT_ALLOWED');
      }
      expect(await status(open)).toBe('accepted');
    });

    it('the right actor in the wrong state gets 409, for every transition', async () => {
      // direct is pending: approving it is a state error, not a permission error
      expect((await act('manager', 'approve', direct)).status).toBe(409);
      expect((await act('coworker', 'accept', direct)).status).toBe(200);
      expect((await act('coworker', 'accept', direct)).status).toBe(409); // already accepted
      expect((await act('coworker', 'decline', direct)).status).toBe(409); // only from pending
      expect((await act('manager', 'approve', direct)).status).toBe(200);
      expect((await act('staff', 'cancel', direct)).status).toBe(409); // already approved
      expect((await act('manager', 'reject', direct)).status).toBe(409); // already approved
    });
  });

  describe('fields clients never control', () => {
    it('requester and organization come from the token and the shift, not the body', async () => {
      const res = await http()
        .post('/swap-requests')
        .set('authorization', await bearer(a, 'staff'))
        .send({
          shiftId: shiftA,
          requesterId: a.users.coworker!.id, // ignored
          organizationId: b.orgId, // ignored
          status: 'approved', // ignored
          decidedById: a.users.manager!.id, // ignored
        });
      expect(res.status, res.text).toBe(201);
      expect(res.body).toMatchObject({
        requesterId: a.users.staff!.id,
        organizationId: a.orgId,
        status: 'pending',
        decidedById: null,
      });
      await admin.query(`delete from app.swap_requests where id = $1`, [res.body.id]);
    });

    it('malformed input is a 400 problem with field errors', async () => {
      const auth = await bearer(a, 'manager');
      const res = await http()
        .post('/shifts')
        .set('authorization', auth)
        .send({ organizationId: 'not-a-uuid', positionId: a.positionId, startsAt: 'tomorrow' });
      expect(res.status).toBe(400);
      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.errors.map((e: { path: string }) => e.path)).toEqual(
        expect.arrayContaining(['organizationId', 'startsAt', 'endsAt']),
      );

      expect((await http().get('/shifts/not-a-uuid').set('authorization', auth)).status).toBe(400);
    });
  });

  describe('the swap flow over HTTP', () => {
    it('offer → claim → approve reassigns the shift; a manager of another org cannot interfere', async () => {
      const offer = await http()
        .post('/swap-requests')
        .set('authorization', await bearer(a, 'staff'))
        .send({ shiftId: shiftA, note: 'Doctor appointment' });
      expect(offer.status, offer.text).toBe(201);

      const claim = await http()
        .post(`/swap-requests/${offer.body.id}/accept`)
        .set('authorization', await bearer(a, 'coworker'));
      expect(claim.status, claim.text).toBe(200);
      expect(claim.body).toMatchObject({ status: 'accepted', targetUserId: a.users.coworker!.id });

      const foreign = await http()
        .post(`/swap-requests/${offer.body.id}/approve`)
        .set('authorization', await bearer(b, 'manager'));
      expect(foreign.status).toBe(404);

      const approve = await http()
        .post(`/swap-requests/${offer.body.id}/approve`)
        .set('authorization', await bearer(a, 'manager'));
      expect(approve.status, approve.text).toBe(200);
      expect(approve.body).toMatchObject({ status: 'approved', decidedById: a.users.manager!.id });

      const shift = await http()
        .get(`/shifts/${shiftA}`)
        .set('authorization', await bearer(a, 'coworker'));
      expect(shift.body.assignedUserId).toBe(a.users.coworker!.id);
    });

    it('two members claiming the same open offer: one 200, one 409', async () => {
      const shift = await insertShift(admin, a, {
        startsAt: '2030-10-05T06:00:00Z',
        endsAt: '2030-10-05T14:00:00Z',
        assignedUserId: a.users.staff!.id,
      });
      const offer = await http()
        .post('/swap-requests')
        .set('authorization', await bearer(a, 'staff'))
        .send({ shiftId: shift });
      expect(offer.status).toBe(201);

      const [r1, r2] = await Promise.all([
        http()
          .post(`/swap-requests/${offer.body.id}/accept`)
          .set('authorization', await bearer(a, 'coworker')),
        http()
          .post(`/swap-requests/${offer.body.id}/accept`)
          .set('authorization', await bearer(a, 'coworker2')),
      ]);
      expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    });
  });
});
