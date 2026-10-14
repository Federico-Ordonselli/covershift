import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const valid = {
  DATABASE_URL: 'postgresql://covershift_api:pw@127.0.0.1:54322/postgres',
  SUPABASE_URL: 'http://127.0.0.1:54321',
};

describe('loadEnv', () => {
  it('derives issuer and JWKS URL from SUPABASE_URL', () => {
    const env = loadEnv(valid);
    expect(env.SUPABASE_JWT_ISSUER).toBe('http://127.0.0.1:54321/auth/v1');
    expect(env.SUPABASE_JWKS_URL).toBe('http://127.0.0.1:54321/auth/v1/.well-known/jwks.json');
  });

  it('lists every invalid variable', () => {
    expect(() => loadEnv({ PORT: 'abc' })).toThrowError(/DATABASE_URL[\s\S]*SUPABASE_URL/);
  });
});
