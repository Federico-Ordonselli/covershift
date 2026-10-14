import { z } from 'zod';

/**
 * The subset of a Supabase access token the API relies on. Anything else in the payload
 * is kept (passthrough) because the whole verified payload becomes `request.jwt.claims`
 * for RLS, exactly as PostgREST would set it.
 */
export const SupabaseClaimsSchema = z.looseObject({
  sub: z.uuid(),
  role: z.literal('authenticated'),
  aud: z.union([z.literal('authenticated'), z.array(z.string()).nonempty()]),
  exp: z.number().int(),
  email: z.string().optional(),
  session_id: z.string().optional(),
});
export type SupabaseClaims = z.infer<typeof SupabaseClaimsSchema>;

export interface AuthUser {
  id: string;
  /** Verified token payload. The only thing ever written to request.jwt.claims. */
  claims: SupabaseClaims;
}
