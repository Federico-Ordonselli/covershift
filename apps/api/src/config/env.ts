import { z } from 'zod';

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.url(),
    SUPABASE_URL: z.url(),
    SUPABASE_JWT_ISSUER: z.url().optional(),
    /** Max size of the pg pool. Each in-flight request holds one connection (see ADR 001). */
    DATABASE_POOL_SIZE: z.coerce.number().int().positive().default(10),
  })
  .transform((env) => ({
    ...env,
    SUPABASE_JWT_ISSUER: env.SUPABASE_JWT_ISSUER ?? `${env.SUPABASE_URL}/auth/v1`,
    SUPABASE_JWKS_URL: `${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
  }));

export type Env = z.infer<typeof EnvSchema>;

export const ENV = Symbol('ENV');

/** Loads `.env` outside production, then validates. Fails fast with every problem listed. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (source === process.env && process.env.NODE_ENV !== 'production') {
    try {
      process.loadEnvFile();
    } catch {
      // no .env file: rely on the real environment
    }
  }
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
