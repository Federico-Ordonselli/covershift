import { Inject, Injectable } from '@nestjs/common';
import { errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { ENV, type Env } from '../config/env';
import { type AuthUser, SupabaseClaimsSchema } from './auth-user';

export const JWKS = Symbol('JWKS');

/** Asymmetric only. Accepting HS256 would reopen the shared-secret path (and alg confusion). */
const ALGORITHMS = ['ES256', 'RS256'];

export class InvalidTokenError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'InvalidTokenError';
  }
}

@Injectable()
export class SupabaseJwtVerifier {
  constructor(
    @Inject(JWKS) private readonly jwks: JWTVerifyGetKey,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async verify(token: string): Promise<AuthUser> {
    let payload: unknown;
    try {
      ({ payload } = await jwtVerify(token, this.jwks, {
        algorithms: ALGORITHMS,
        issuer: this.env.SUPABASE_JWT_ISSUER,
        audience: 'authenticated',
        requiredClaims: ['sub', 'exp'],
        clockTolerance: 5,
      }));
    } catch (err) {
      throw new InvalidTokenError(describe(err));
    }

    // Signature is fine; now insist on the shape RLS depends on (e.g. reject anon tokens).
    const claims = SupabaseClaimsSchema.safeParse(payload);
    if (!claims.success) {
      throw new InvalidTokenError('token is not a user access token');
    }
    return { id: claims.data.sub, claims: claims.data };
  }
}

function describe(err: unknown): string {
  if (err instanceof errors.JWTExpired) return 'token expired';
  if (err instanceof errors.JWTClaimValidationFailed) return `invalid claim: ${err.claim}`;
  if (err instanceof errors.JOSEAlgNotAllowed) return 'algorithm not allowed';
  if (err instanceof errors.JWKSNoMatchingKey) return 'unknown signing key';
  if (err instanceof errors.JOSEError) return 'invalid token';
  return 'invalid token';
}
