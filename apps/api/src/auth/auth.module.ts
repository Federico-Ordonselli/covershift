import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { createRemoteJWKSet } from 'jose';
import { ENV, type Env } from '../config/env';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JWKS, SupabaseJwtVerifier } from './supabase-jwt.verifier';

@Module({
  providers: [
    {
      provide: JWKS,
      inject: [ENV],
      // Cached in memory; refetched on an unknown `kid` (key rotation) at most every 30s.
      useFactory: (env: Env) =>
        createRemoteJWKSet(new URL(env.SUPABASE_JWKS_URL), {
          cacheMaxAge: 10 * 60_000,
          cooldownDuration: 30_000,
        }),
    },
    SupabaseJwtVerifier,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [SupabaseJwtVerifier],
})
export class AuthModule {}
