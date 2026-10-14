import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { adminPool, SECOND_ORG } from './db';

/**
 * Fresh demo data for every run: the re-runnable seed (lakeside-security) plus a second,
 * empty organization where the seeded manager is staff, for the org switcher.
 */
export default async function globalSetup(): Promise<void> {
  execFileSync('pnpm', ['db:seed'], { cwd: resolve(import.meta.dirname, '../../..'), stdio: 'inherit' });

  const pool = adminPool();
  try {
    await pool.query(`delete from app.organizations where slug = $1`, [SECOND_ORG.slug]);
    const {
      rows: [org],
    } = await pool.query<{ id: string }>(
      `insert into app.organizations (name, slug, timezone) values ($1, $2, 'UTC') returning id`,
      [SECOND_ORG.name, SECOND_ORG.slug],
    );
    await pool.query(
      `insert into app.memberships (organization_id, user_id, role)
       select $1, id, 'staff' from auth.users where email = 'manager@covershift.test'`,
      [org!.id],
    );
    await pool.query(`insert into app.positions (organization_id, name) values ($1, 'Berth marshal')`, [
      org!.id,
    ]);
  } finally {
    await pool.end();
  }
}
