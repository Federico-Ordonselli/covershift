import { Test } from '@nestjs/testing';
import { type Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CertificationEligibilityService } from '../../src/certifications/certification-eligibility.service';
import { CertificationsModule } from '../../src/certifications/certifications.module';
import { DomainError } from '../../src/common/domain-error';
import { ConfigModule } from '../../src/config/config.module';
import { DatabaseModule } from '../../src/database/database.module';
import { RlsTransactionRunner } from '../../src/database/rls/rls-transaction.runner';
import {
  addCertificationType,
  adminPool,
  claimsFor,
  createTenant,
  dropTenant,
  grantCertification,
  requireCertification,
  type Tenant,
} from '../helpers/fixtures';

const SHIFT_END = new Date('2030-07-01T14:00:00Z');

describe('CertificationEligibilityService (real RLS)', () => {
  let admin: Pool;
  let rls: RlsTransactionRunner;
  let service: CertificationEligibilityService;
  let close: () => Promise<void>;
  let a: Tenant;
  let b: Tenant;
  let openPositionId: string;

  const u = (key: string) => a.users[key]!;

  /** Runs the check as `actor`, for `subject`, in org A's gate position. */
  const check = (actor: string, subject: string, positionId = a.positionId) =>
    rls.run(claimsFor(u(actor)), () =>
      service.assertEligible({
        organizationId: a.orgId,
        positionId,
        userId: u(subject).id,
        shiftEndsAt: SHIFT_END,
      }),
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule, CertificationsModule],
    }).compile();
    const app = await moduleRef.init();
    close = () => app.close();
    rls = moduleRef.get(RlsTransactionRunner);
    service = moduleRef.get(CertificationEligibilityService);

    admin = adminPool();
    a = await createTenant(admin, 'elig-a', {
      manager: 'manager',
      certified: 'staff',
      expiring: 'staff',
      uncertified: 'staff',
      renewed: 'staff',
    });
    b = await createTenant(admin, 'elig-b', { manager: 'manager' });

    const xray = await addCertificationType(admin, a, 'X-ray screening');
    const etd = await addCertificationType(admin, a, 'Explosive trace detection');
    await requireCertification(admin, a, xray);
    await requireCertification(admin, a, etd);

    await grantCertification(admin, a, u('certified').id, xray, null);
    await grantCertification(admin, a, u('certified').id, etd, '2031-01-01T00:00:00Z');
    await grantCertification(admin, a, u('expiring').id, xray, null);
    await grantCertification(admin, a, u('expiring').id, etd, '2030-07-01T13:00:00Z'); // mid-shift
    await grantCertification(admin, a, u('uncertified').id, xray, null);
    await grantCertification(admin, a, u('renewed').id, xray, '2025-01-01T00:00:00Z');
    await grantCertification(admin, a, u('renewed').id, xray, '2032-01-01T00:00:00Z');
    await grantCertification(admin, a, u('renewed').id, etd, null);

    const { rows } = await admin.query<{ id: string }>(
      `insert into app.positions (organization_id, name) values ($1, 'Queue host') returning id`,
      [a.orgId],
    );
    openPositionId = rows[0]!.id;
  });

  afterAll(async () => {
    await dropTenant(admin, a);
    await dropTenant(admin, b);
    await admin?.end();
    await close?.();
  });

  it('passes when every required certification is valid through the shift end', async () => {
    await expect(check('manager', 'certified')).resolves.toBeUndefined();
  });

  it('passes for a position with no requirements', async () => {
    await expect(check('manager', 'uncertified', openPositionId)).resolves.toBeUndefined();
  });

  it('uses the renewed certificate, not the expired one', async () => {
    await expect(check('manager', 'renewed')).resolves.toBeUndefined();
  });

  it('rejects a certification that expires before the shift ends, naming it', async () => {
    const err = await check('manager', 'expiring').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect(err).toMatchObject({
      code: 'CERTIFICATION_EXPIRES_BEFORE_SHIFT_END',
      status: 422,
      message: 'Certification(s) expire before the shift ends: Explosive trace detection',
    });
  });

  it('rejects a missing certification, naming it', async () => {
    await expect(check('manager', 'uncertified')).rejects.toMatchObject({
      code: 'CERTIFICATION_MISSING',
      status: 422,
      message: 'Missing required certification(s): Explosive trace detection',
    });
  });

  it('lets users check themselves (RLS shows them their own certificates)', async () => {
    await expect(check('certified', 'certified')).resolves.toBeUndefined();
    await expect(check('uncertified', 'uncertified')).rejects.toMatchObject({
      code: 'CERTIFICATION_MISSING',
    });
  });

  it('refuses a staff member checking a coworker instead of answering "missing"', async () => {
    // RLS hides coworkers' certificates from staff: answering would be a false negative.
    await expect(check('uncertified', 'certified')).rejects.toThrow(
      /can only be checked by a manager\/admin/,
    );
  });

  it('treats another tenant’s position as unknown', async () => {
    await expect(check('manager', 'certified', b.positionId)).rejects.toMatchObject({
      code: 'INVALID_REFERENCE',
      status: 422,
    });
  });

  it('does not count a certificate held in another organization', async () => {
    // Same person is a member of A and B, certified only in B.
    const both = u('uncertified');
    await admin.query(
      `insert into app.memberships (organization_id, user_id, role) values ($1, $2, 'staff')`,
      [b.orgId, both.id],
    );
    const bEtd = await addCertificationType(admin, b, 'Explosive trace detection');
    await grantCertification(admin, b, both.id, bEtd, null);

    await expect(check('manager', 'uncertified')).rejects.toMatchObject({
      code: 'CERTIFICATION_MISSING',
    });
  });
});
