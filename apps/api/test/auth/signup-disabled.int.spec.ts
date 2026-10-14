import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { env, required } from '../helpers/env';
import { accessToken, adminClient } from '../helpers/supabase';

/**
 * Accounts come from the seed (auth.admin) and later from invitations, never from public
 * signup: supabase/config.toml sets enable_signup = false. Anyone holding the publishable
 * key (it ships in the web bundle) must not be able to create a user.
 */
describe('auth: public signup is disabled', () => {
  it('signUp with the publishable key is refused and creates no user', async () => {
    const email = `signup-${randomUUID().slice(0, 8)}@covershift.test`;
    const client = createClient(env.SUPABASE_URL, required('SUPABASE_PUBLISHABLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.signUp({ email, password: 'a-long-password-123' });
    expect(error?.code).toBe('signup_disabled');
    expect(data.user).toBeNull();

    const { data: list } = await adminClient().auth.admin.listUsers({ perPage: 1000 });
    expect(list.users.map((u) => u.email)).not.toContain(email);
  });

  it('admin-created users (the seed’s path) can still sign in with a password', async () => {
    // Guards the opposite misconfiguration: [auth.email] enable_signup = false looks like
    // "no email signups" but disables the email provider, i.e. every password login.
    const email = `admin-created-${randomUUID().slice(0, 8)}@covershift.test`;
    const password = 'a-long-password-123';
    const { data, error } = await adminClient().auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(error).toBeNull();
    try {
      expect(await accessToken(email, password)).toMatch(/^ey/);
    } finally {
      await adminClient().auth.admin.deleteUser(data.user!.id);
    }
  });
});
