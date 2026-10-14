import { createClient } from '@supabase/supabase-js';
import { env } from '../env';

/**
 * Supabase is used for authentication only: sign-in, token refresh, sign-out. The app
 * never queries tables through it; all data goes through the NestJS API (ADR 001).
 * The session lives in localStorage (survives reloads, shared across tabs); the CSP in
 * security-headers.ts is the XSS mitigation that choice relies on.
 */
export const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'covershift-auth',
  },
});
