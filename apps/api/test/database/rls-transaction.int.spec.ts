import { Test } from '@nestjs/testing';
import { type Pool } from 'pg';
import { DataSource, QueryFailedError } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigModule } from '../../src/config/config.module';
import { DatabaseModule } from '../../src/database/database.module';
import { RlsTransactionRunner } from '../../src/database/rls/rls-transaction.runner';
import { TxManager } from '../../src/database/rls/tx-manager';
import {
  adminPool,
  claimsFor,
  createTenant,
  dropTenant,
  insertShift,
  type Tenant,
} from '../helpers/fixtures';

describe('RlsTransactionRunner (real Postgres, covershift_api role)', () => {
  let admin: Pool;
  let tenant: Tenant;
  let otherTenant: Tenant;
  let dataSource: DataSource;
  let rls: RlsTransactionRunner;
  let tx: TxManager;
  let close: () => Promise<void>;

  beforeAll(async () => {
    // A single pooled connection: every test reuses the same physical connection, so any
    // identity leaking past commit/rollback would be visible to the next query.
    process.env.DATABASE_POOL_SIZE = '1';
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule],
    }).compile();
    const app = await moduleRef.init();
    close = () => app.close();
    dataSource = moduleRef.get(DataSource);
    rls = moduleRef.get(RlsTransactionRunner);
    tx = moduleRef.get(TxManager);

    admin = adminPool();
    tenant = await createTenant(admin, 'rls-runner', { staff: 'staff' });
    await insertShift(admin, tenant, {
      startsAt: '2030-01-01T06:00:00Z',
      endsAt: '2030-01-01T14:00:00Z',
      assignedUserId: tenant.users.staff!.id,
    });
    // A second tenant's row must exist, or "sees 1 shift" would pass with RLS switched off.
    otherTenant = await createTenant(admin, 'rls-runner-other', { staff: 'staff' });
    await insertShift(admin, otherTenant, {
      startsAt: '2030-01-01T06:00:00Z',
      endsAt: '2030-01-01T14:00:00Z',
    });
  });

  afterAll(async () => {
    await dropTenant(admin, tenant);
    await dropTenant(admin, otherTenant);
    await admin?.end();
    await close?.();
    delete process.env.DATABASE_POOL_SIZE;
  });

  it('fails closed: a query outside the wrapper is denied', async () => {
    const outside = dataSource.query('select count(*) from app.shifts');
    await expect(outside).rejects.toBeInstanceOf(QueryFailedError);
    await expect(outside).rejects.toMatchObject({ driverError: { code: '42501' } });
  });

  it('runs as `authenticated` with the caller as auth.uid()', async () => {
    const [row] = await rls.run(claimsFor(tenant.users.staff!), (em) =>
      em.query<Array<{ role: string; uid: string }>>(
        'select current_user as role, auth.uid() as uid',
      ),
    );
    expect(row).toEqual({ role: 'authenticated', uid: tenant.users.staff!.id });
  });

  it('applies RLS to queries in the transaction', async () => {
    const { rows } = await admin.query<{ n: number }>(`select count(*)::int as n from app.shifts`);
    expect(rows[0]!.n).toBeGreaterThanOrEqual(2); // precondition: other tenants' rows exist

    const visible = await rls.run(claimsFor(tenant.users.staff!), (em) =>
      em.query<Array<{ organization_id: string }>>('select organization_id from app.shifts'),
    );
    expect(visible.map((r) => r.organization_id)).toEqual([tenant.orgId]);
  });

  it('does not leak the identity to the next user of the pooled connection', async () => {
    await rls.run(claimsFor(tenant.users.staff!), (em) => em.query('select 1'));
    const [row] = await dataSource.query<Array<{ role: string; claims: string | null }>>(
      `select current_user as role, current_setting('request.jwt.claims', true) as claims`,
    );
    expect(row!.role).toBe('covershift_api');
    expect(row!.claims ?? '').toBe('');
  });

  it('rolls back everything when the callback throws', async () => {
    await expect(
      rls.run(claimsFor(tenant.users.staff!), async (em) => {
        // Session-level on purpose: even this is undone by the rollback.
        await em.query(`select set_config('covershift.marker', 'dirty', false)`);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const [row] = await dataSource.query<Array<{ marker: string | null }>>(
      `select current_setting('covershift.marker', true) as marker`,
    );
    expect(row!.marker ?? '').not.toBe('dirty');
  });

  it('exposes the transaction manager to code called inside run()', async () => {
    await rls.run(claimsFor(tenant.users.staff!), async (em) => {
      expect(tx.get()).toBe(em);
    });
  });

  it('refuses database access outside any transaction', () => {
    expect(() => tx.get()).toThrow(/No RLS transaction in scope/);
  });

  it('refuses to nest (a second connection would be a separate transaction)', async () => {
    await expect(
      rls.run(claimsFor(tenant.users.staff!), () =>
        rls.run(claimsFor(tenant.users.staff!), async () => undefined),
      ),
    ).rejects.toThrow(/Nested RLS transaction/);
  });
});
