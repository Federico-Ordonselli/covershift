import { Test } from '@nestjs/testing';
import { createRemoteJWKSet } from 'jose';
import { randomUUID } from 'node:crypto';
import { type Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed, type SeedResult } from '../../scripts/seed-data';
import { SupabaseJwtVerifier } from '../../src/auth/supabase-jwt.verifier';
import { CertificationEligibilityService } from '../../src/certifications/certification-eligibility.service';
import { CertificationsModule } from '../../src/certifications/certifications.module';
import { ConfigModule } from '../../src/config/config.module';
import { DatabaseModule } from '../../src/database/database.module';
import { Shift } from '../../src/database/entities';
import { RlsTransactionRunner } from '../../src/database/rls/rls-transaction.runner';
import { env } from '../helpers/env';
import { adminPool } from '../helpers/fixtures';
import { accessToken, adminClient } from '../helpers/supabase';

describe('seed script', () => {
  const slug = `seed-test-${randomUUID().slice(0, 8)}`;
  const emailDomain = `${slug}.covershift.test`;
  const password = 'seed-test-password';
  let pool: Pool;
  let first: SeedResult;
  let second: SeedResult;
  let rls: RlsTransactionRunner;
  let eligibility: CertificationEligibilityService;
  let close: () => Promise<void>;

  beforeAll(async () => {
    pool = adminPool();
    const auth = adminClient();
    first = await seed({ pool, auth, slug, emailDomain, password });
    second = await seed({ pool, auth, slug, emailDomain, password }); // re-runnable

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule, CertificationsModule],
    }).compile();
    const app = await moduleRef.init();
    close = () => app.close();
    rls = moduleRef.get(RlsTransactionRunner);
    eligibility = moduleRef.get(CertificationEligibilityService);
  });

  afterAll(async () => {
    if (second) {
      await pool.query(`delete from app.organizations where id = $1`, [second.organizationId]);
      for (const user of Object.values(second.users)) {
        await adminClient().auth.admin.deleteUser(user.id);
      }
    }
    await pool?.end();
    await close?.();
  });

  it('is re-runnable: same users, one organization for the slug', async () => {
    expect(Object.values(second.users).map((u) => u.id)).toEqual(
      Object.values(first.users).map((u) => u.id),
    );
    const { rows } = await pool.query(`select id from app.organizations where slug = $1`, [slug]);
    expect(rows).toEqual([{ id: second.organizationId }]);
  });

  it('has 1 manager, 4 staff, 3 positions, a week of shifts and one open offer', async () => {
    const { rows: roles } = await pool.query<{ role: string; n: number }>(
      `select role, count(*)::int as n from app.memberships where organization_id = $1 group by role`,
      [second.organizationId],
    );
    expect(Object.fromEntries(roles.map((r) => [r.role, r.n]))).toEqual({ manager: 1, staff: 4 });

    const { rows: counts } = await pool.query(
      `select (select count(*)::int from app.positions where organization_id = $1) as positions,
              (select count(*)::int from app.shifts where organization_id = $1) as shifts,
              (select count(*)::int from app.swap_requests
                 where organization_id = $1 and status = 'pending' and target_user_id is null) as open_offers`,
      [second.organizationId],
    );
    expect(counts[0]).toEqual({ positions: 3, shifts: 35, open_offers: 1 });
  });

  it('every seeded assignment passes the real eligibility rule (as the seeded manager, under RLS)', async () => {
    const manager = second.users.manager;
    const token = await accessToken(manager.email, password); // real GoTrue login
    const verified = await new SupabaseJwtVerifier(
      createRemoteJWKSet(new URL(env.SUPABASE_JWKS_URL)),
      env,
    ).verify(token);

    await rls.run(verified.claims, async (em) => {
      const assigned = await em
        .createQueryBuilder(Shift, 's')
        .where('s.assigned_user_id is not null')
        .getMany();
      expect(assigned.length).toBeGreaterThan(20);
      expect(new Set(assigned.map((s) => s.organizationId))).toEqual(
        new Set([second.organizationId]),
      );

      for (const s of assigned) {
        const result = await eligibility.check({
          organizationId: s.organizationId,
          positionId: s.positionId,
          userId: s.assignedUserId!,
          shiftEndsAt: s.endsAt,
        });
        expect(result, `shift ${s.id}`).toEqual({ eligible: true });
      }
    });
  });
});
