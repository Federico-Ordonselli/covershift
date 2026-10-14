import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';

/**
 * Privileged connection (DATABASE_MIGRATION_URL from apps/api/.env) for arranging e2e
 * state only, exactly like the API's integration tests. Assertions go through the UI.
 */
export function adminPool(): Pool {
  const envFile = readFileSync(resolve(import.meta.dirname, '../../api/.env'), 'utf8');
  const url = /^DATABASE_MIGRATION_URL=(.*)$/m.exec(envFile)?.[1];
  if (!url) throw new Error('DATABASE_MIGRATION_URL missing from apps/api/.env (run pnpm db:env)');
  return new Pool({ connectionString: url, max: 2 });
}

export const SECOND_ORG = { slug: 'e2e-harbour-ops', name: 'Harbour Ops (e2e)' };
