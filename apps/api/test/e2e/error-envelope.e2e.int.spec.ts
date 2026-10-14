import { type INestApplication } from '@nestjs/common';
import { ProblemDetailsSchema } from '@covershift/shared';
import { randomUUID } from 'node:crypto';
import { type Pool } from 'pg';
import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createE2eApp, tokenFor } from '../helpers/app';
import { adminPool, createLoginTenant, type Tenant } from '../helpers/fixtures';
import { adminClient } from '../helpers/supabase';

const PASSWORD = 'e2e-error-envelope-horse';

/**
 * Every error path over HTTP answers with the same RFC 9457 envelope and a code, including
 * the ones produced outside our services: the auth guard, the UUID pipe, body-parser
 * (malformed, too large, bad charset), URL decoding and unknown routes.
 */
describe('e2e: error envelope', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let admin: Pool;
  let t: Tenant;
  let auth: string;

  beforeAll(async () => {
    ({ app, http } = await createE2eApp());
    admin = adminPool();
    t = await createLoginTenant(admin, 'errors', { manager: 'manager' }, PASSWORD);
    auth = `Bearer ${await tokenFor(t.users.manager!, PASSWORD)}`;
  });

  afterAll(async () => {
    if (t) {
      await admin.query(`delete from app.organizations where id = $1`, [t.orgId]);
      for (const user of Object.values(t.users)) await adminClient().auth.admin.deleteUser(user.id);
    }
    await admin?.end();
    await app?.close();
  });

  /** Asserts the envelope and returns it. */
  function problem(res: request.Response, status: number, code: string) {
    expect(res.status, res.text).toBe(status);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    const body = ProblemDetailsSchema.parse(res.body);
    expect(body).toMatchObject({
      status,
      code,
      type: `urn:covershift:error:${code.toLowerCase()}`,
    });
    return body;
  }

  const shiftBody = () => ({
    organizationId: t.orgId,
    positionId: t.positionId,
    startsAt: '2032-01-01T06:00:00Z',
    endsAt: '2032-01-01T14:00:00Z',
  });

  it('401 UNAUTHORIZED: no token, a garbage token', async () => {
    problem(await http().get('/me'), 401, 'UNAUTHORIZED');
    problem(await http().get('/me').set('authorization', 'Bearer x.y.z'), 401, 'UNAUTHORIZED');
  });

  it.each([
    ['GET', '/shifts/not-a-uuid'],
    ['PATCH', '/shifts/not-a-uuid'],
    ['GET', '/swap-requests/42'],
    ['POST', '/swap-requests/42/approve'],
    ['GET', '/organizations/nope/members'],
  ])('400 VALIDATION_FAILED for a malformed id: %s %s', async (method, path) => {
    const base =
      method === 'GET'
        ? http().get(path)
        : method === 'PATCH'
          ? http().patch(path)
          : http().post(path);
    const res = await base
      .set('authorization', auth)
      .send(method === 'PATCH' ? { assignedUserId: null } : undefined);
    const body = problem(res, 400, 'VALIDATION_FAILED');
    expect(body.errors).toEqual([{ path: 'id', message: 'Invalid UUID' }]);
  });

  it('400 VALIDATION_FAILED for a schema violation, with per-field errors', async () => {
    const res = await http().post('/shifts').set('authorization', auth).send({});
    expect(problem(res, 400, 'VALIDATION_FAILED').errors?.length).toBeGreaterThan(0);
  });

  it('400 MALFORMED_REQUEST for invalid JSON, without echoing the parser', async () => {
    const res = await http()
      .post('/shifts')
      .set('authorization', auth)
      .set('content-type', 'application/json')
      .send('{"organizationId":');
    const body = problem(res, 400, 'MALFORMED_REQUEST');
    expect(body.detail).toBe('The request could not be parsed');
  });

  it('400 MALFORMED_REQUEST for a bad percent-encoding in the path', async () => {
    const res = await http().get('/shifts/%E0%A4%A').set('authorization', auth);
    problem(res, 400, 'MALFORMED_REQUEST');
  });

  it('413 PAYLOAD_TOO_LARGE for a body over the limit (was a 500)', async () => {
    const res = await http()
      .post('/swap-requests')
      .set('authorization', auth)
      .send({ shiftId: randomUUID(), note: 'x'.repeat(200_000) });
    problem(res, 413, 'PAYLOAD_TOO_LARGE');
  });

  it('415 UNSUPPORTED_MEDIA_TYPE for an unsupported charset', async () => {
    const res = await http()
      .post('/shifts')
      .set('authorization', auth)
      .set('content-type', 'application/json; charset=klingon')
      .send(JSON.stringify(shiftBody()));
    problem(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
  });

  it('404 NOT_FOUND for an unknown route, and for a hidden resource', async () => {
    expect(
      problem(await http().get('/nope').set('authorization', auth), 404, 'NOT_FOUND').detail,
    ).toBe('Route not found');
    problem(
      await http().get(`/shifts/${randomUUID()}`).set('authorization', auth),
      404,
      'NOT_FOUND',
    );
  });

  it('domain errors keep their specific codes (403, 409, 422 shapes unchanged)', async () => {
    const created = await http().post('/shifts').set('authorization', auth).send(shiftBody());
    expect(created.status, created.text).toBe(201);
    const offer = await http()
      .post('/swap-requests')
      .set('authorization', auth)
      .send({ shiftId: created.body.id });
    problem(offer, 403, 'SWAP_NOT_ALLOWED');
    const outsider = await http()
      .post('/shifts')
      .set('authorization', auth)
      .send({ ...shiftBody(), assignedUserId: randomUUID() });
    problem(outsider, 422, 'NOT_A_MEMBER');
  });
});
