import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env, required } from './env';

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

/** auth.admin client (secret key). Test setup only: create users, never in the API. */
export function adminClient(): SupabaseClient {
  return createClient(env.SUPABASE_URL, required('SUPABASE_SECRET_KEY'), noSession);
}

/** Signs a user in against local GoTrue and returns a real access token. */
export async function accessToken(email: string, password: string): Promise<string> {
  const client = createClient(env.SUPABASE_URL, required('SUPABASE_PUBLISHABLE_KEY'), noSession);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`sign-in failed for ${email}: ${error?.message}`);
  return data.session.access_token;
}
