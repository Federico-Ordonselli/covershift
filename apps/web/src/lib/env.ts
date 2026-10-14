import { z } from 'zod';

const EnvSchema = z.object({
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

/** Public build-time configuration only (it ships in the bundle). Never a secret. */
export const env = EnvSchema.parse(import.meta.env);
