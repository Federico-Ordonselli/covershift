import { TimeZoneSchema } from '@covershift/shared';
import { randomUUID } from 'node:crypto';
import { type Pool } from 'pg';
import { QueryFailedError } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { translateDatabaseError } from '../../src/common/database-errors';
import { adminPool } from '../helpers/fixtures';

/**
 * organizations.timezone is validated by a trigger against pg_timezone_names. Exercised
 * through the privileged pool on purpose: unlike the swap triggers, this rule has no
 * maintenance-role exemption, so the seed and fix-up scripts are held to it too.
 */
describe('organizations.timezone must be a known IANA zone', () => {
  let admin: Pool;
  const slugs: string[] = [];

  const insert = (timezone?: string) => {
    const slug = `tz-${randomUUID().slice(0, 8)}`;
    slugs.push(slug);
    return timezone === undefined
      ? admin.query(
          `insert into app.organizations (name, slug) values ('Tz', $1) returning timezone`,
          [slug],
        )
      : admin.query(
          `insert into app.organizations (name, slug, timezone) values ('Tz', $1, $2) returning timezone`,
          [slug, timezone],
        );
  };

  async function rejected(promise: Promise<unknown>) {
    const err = (await promise.then(
      () => undefined,
      (e: unknown) => e,
    )) as { code?: string; constraint?: string; message?: string } | undefined;
    expect(err, 'expected the trigger to reject the write').toBeDefined();
    expect(err!.code).toBe('23514');
    expect(err!.constraint).toBe('organizations_timezone_known');
    return err!;
  }

  beforeAll(() => {
    admin = adminPool();
  });

  afterAll(async () => {
    await admin.query(`delete from app.organizations where slug = any($1::text[])`, [slugs]);
    await admin.end();
  });

  it.each(['Europe/Rome', 'UTC', 'America/Argentina/Buenos_Aires', 'Asia/Kolkata', 'Etc/GMT+3'])(
    'accepts %s',
    async (zone) => {
      const { rows } = await insert(zone);
      expect(rows[0].timezone).toBe(zone);
    },
  );

  it('the column default (UTC) passes', async () => {
    expect((await insert()).rows[0].timezone).toBe('UTC');
  });

  it.each([
    'Mars/Olympus_Mons',
    'europe/rome', // case matters to Intl and to the tz database
    'Europe/Rome ',
    '',
    'posix/Europe/Rome', // in pg_timezone_names, unknown to browsers
    'Factory',
    "Europe/Rome'; drop table app.organizations; --",
  ])('rejects %j on insert', async (zone) => {
    const err = await rejected(insert(zone));
    expect(err.message).toContain('is not a known time zone');
  });

  it('rejects an update to an unknown zone, and leaves the row unchanged', async () => {
    const { rows } = await insert('Europe/Rome');
    const slug = slugs.at(-1)!;
    await rejected(
      admin.query(`update app.organizations set timezone = 'Moon/Tranquility' where slug = $1`, [
        slug,
      ]),
    );
    const after = await admin.query(`select timezone from app.organizations where slug = $1`, [
      slug,
    ]);
    expect(after.rows[0].timezone).toBe(rows[0].timezone);
  });

  it('other updates on an organization are not re-validated needlessly', async () => {
    await insert('Europe/Rome');
    await expect(
      admin.query(`update app.organizations set name = 'Renamed' where slug = $1`, [slugs.at(-1)]),
    ).resolves.toBeDefined();
  });

  it('every zone the database accepts also passes the shared contract', async () => {
    // Otherwise a valid organization would fail its own response schema (/me → 500).
    const { rows } = await admin.query<{ name: string }>(
      `select name from pg_catalog.pg_timezone_names where app.is_known_timezone(name)`,
    );
    expect(rows.length).toBeGreaterThan(300);
    const rejectedByContract = rows
      .map((r) => r.name)
      .filter((n) => !TimeZoneSchema.safeParse(n).success);
    expect(rejectedByContract).toEqual([]);
  });

  it('reaches API clients as 422 CONSTRAINT_VIOLATION (existing mapping)', async () => {
    const driverError = await rejected(insert('Mars/Olympus_Mons'));
    // The API sees the driver error wrapped by TypeORM, exactly like this.
    const wrapped = new QueryFailedError('insert', [], driverError as Error);
    expect(translateDatabaseError(wrapped)).toMatchObject({
      code: 'CONSTRAINT_VIOLATION',
      status: 422,
    });
  });
});
