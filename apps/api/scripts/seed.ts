/**
 * Local demo data: one organization, one manager, three staff, positions with
 * certification requirements, a week of shifts and one open swap offer.
 *
 *   pnpm db:seed        (re-runnable: resets the demo organization, reuses users)
 *
 * Uses the privileged DATABASE_MIGRATION_URL and the secret key; never run against
 * anything but a local or disposable database.
 */
import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import { seed } from './seed-data';

async function main(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    // rely on the real environment
  }
  const need = (name: string) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required (run pnpm db:env)`);
    return value;
  };
  const url = need('SUPABASE_URL');
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
    throw new Error(`Refusing to seed a non-local Supabase (${url})`);
  }

  const pool = new Pool({ connectionString: need('DATABASE_MIGRATION_URL'), max: 2 });
  const auth = createClient(url, need('SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const password = process.env.SEED_PASSWORD ?? 'covershift-demo';
  try {
    const result = await seed({ pool, auth, password });
    console.log(`Seeded organization ${result.organizationId} (lakeside-security)`);
    console.log(`${result.shiftIds.length} shifts, open swap request ${result.openSwapRequestId}`);
    console.log(`Log in with any of these (password: ${password}):`);
    for (const user of Object.values(result.users)) {
      console.log(`  ${user.role.padEnd(7)} ${user.email}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
