import { loadEnv } from '../../src/config/env';

/** Integration tests run against `supabase start` + `pnpm db:migrate`, configured by .env. */
export const env = loadEnv();

export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for integration tests (see .env.example)`);
  return value;
}
