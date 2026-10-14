import { createLocalJWKSet, exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { type Env } from '../config/env';
import { SupabaseJwtVerifier } from './supabase-jwt.verifier';

const ISSUER = 'http://127.0.0.1:54321/auth/v1';
const USER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const env = { SUPABASE_JWT_ISSUER: ISSUER } as Env;

let signingKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let verifier: SupabaseJwtVerifier;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  signingKey = pair.privateKey;
  const publicJwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256' };
  verifier = new SupabaseJwtVerifier(createLocalJWKSet({ keys: [publicJwk] }), env);
});

function token(overrides: Record<string, unknown> = {}, opts: { exp?: string; iss?: string } = {}) {
  return new SignJWT({ role: 'authenticated', email: 'a@b.test', ...overrides })
    .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
    .setSubject(USER_ID)
    .setAudience('authenticated')
    .setIssuer(opts.iss ?? ISSUER)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '5m')
    .sign(signingKey);
}

describe('SupabaseJwtVerifier', () => {
  it('accepts a valid user access token and keeps the full payload as claims', async () => {
    const user = await verifier.verify(await token());
    expect(user.id).toBe(USER_ID);
    expect(user.claims).toMatchObject({ sub: USER_ID, role: 'authenticated', email: 'a@b.test' });
  });

  it('rejects an expired token', async () => {
    await expect(verifier.verify(await token({}, { exp: '-1m' }))).rejects.toThrow('token expired');
  });

  it('rejects a token from another issuer', async () => {
    await expect(
      verifier.verify(await token({}, { iss: 'https://evil.example/auth/v1' })),
    ).rejects.toThrow('invalid claim: iss');
  });

  it('rejects a token for another audience', async () => {
    const t = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setSubject(USER_ID)
      .setAudience('service')
      .setIssuer(ISSUER)
      .setExpirationTime('5m')
      .sign(signingKey);
    await expect(verifier.verify(t)).rejects.toThrow('invalid claim: aud');
  });

  it('rejects HS256 even when everything else is right (no shared-secret path)', async () => {
    const t = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256', kid: 'k1' })
      .setSubject(USER_ID)
      .setAudience('authenticated')
      .setIssuer(ISSUER)
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('super-secret-jwt-token-with-at-least-32-characters-long'));
    await expect(verifier.verify(t)).rejects.toThrow('algorithm not allowed');
  });

  it('rejects a token signed by an unknown key', async () => {
    const other = await generateKeyPair('ES256');
    const t = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setSubject(USER_ID)
      .setAudience('authenticated')
      .setIssuer(ISSUER)
      .setExpirationTime('5m')
      .sign(other.privateKey);
    await expect(verifier.verify(t)).rejects.toThrow('invalid token');
  });

  it('rejects a validly signed non-user token (e.g. role anon)', async () => {
    await expect(verifier.verify(await token({ role: 'anon' }))).rejects.toThrow(
      'not a user access token',
    );
  });

  it('rejects a tampered payload', async () => {
    const [h, , s] = (await token()).split('.');
    const forged = Buffer.from(
      JSON.stringify({
        sub: USER_ID,
        role: 'authenticated',
        aud: 'authenticated',
        iss: ISSUER,
        exp: 9999999999,
      }),
    ).toString('base64url');
    await expect(verifier.verify(`${h}.${forged}.${s}`)).rejects.toThrow('invalid token');
  });
});
