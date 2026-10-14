import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { accessToken } from './supabase';

/** The real application: JWKS guard, RLS interceptor, problem-details filter, zod pipes. */
export async function createE2eApp(): Promise<{
  app: INestApplication;
  http: () => ReturnType<typeof request>;
}> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, http: () => request(app.getHttpServer()) };
}

const tokens = new Map<string, string>();

/** A real GoTrue access token for the user (cached per test run). */
export async function tokenFor(user: { email: string }, password: string): Promise<string> {
  const cached = tokens.get(user.email);
  if (cached) return cached;
  const token = await accessToken(user.email, password);
  tokens.set(user.email, token);
  return token;
}

/**
 * The running stack's own anon/service_role JWTs: validly signed by the project key,
 * so only the user-token checks can reject them. Read at runtime, never committed.
 */
export function stackJwts(): { anon: string; serviceRole: string } {
  const out = execFileSync('pnpm', ['-s', 'supabase', 'status', '-o', 'env'], {
    cwd: resolve(__dirname, '../../../..'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const read = (name: string) => {
    const match = new RegExp(`^${name}="(.*)"$`, 'm').exec(out);
    if (!match?.[1]) throw new Error(`supabase status did not report ${name}`);
    return match[1];
  };
  return { anon: read('ANON_KEY'), serviceRole: read('SERVICE_ROLE_KEY') };
}
