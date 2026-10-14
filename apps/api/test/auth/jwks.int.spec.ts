import { createRemoteJWKSet } from 'jose';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseJwtVerifier } from '../../src/auth/supabase-jwt.verifier';
import { env } from '../helpers/env';
import { accessToken, adminClient } from '../helpers/supabase';

describe('JWT verification against the local Supabase JWKS', () => {
  const email = `jwks-${randomUUID()}@covershift.test`;
  const password = 'correct-horse-battery-staple';
  let userId: string;

  beforeAll(async () => {
    const { data, error } = await adminClient().auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;
  });

  afterAll(async () => {
    if (userId) await adminClient().auth.admin.deleteUser(userId);
  });

  it('verifies a real GoTrue access token via JWKS (no shared secret)', async () => {
    const verifier = new SupabaseJwtVerifier(
      createRemoteJWKSet(new URL(env.SUPABASE_JWKS_URL)),
      env,
    );
    const user = await verifier.verify(await accessToken(email, password));
    expect(user.id).toBe(userId);
    expect(user.claims.role).toBe('authenticated');
  });
});
