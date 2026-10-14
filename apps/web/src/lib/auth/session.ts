import { type Session, type SupabaseClient } from '@supabase/supabase-js';
import { type TokenSource } from '../api/client';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut'; reason?: 'expired' }
  | { status: 'signedIn'; session: Session };

/** The slice of supabase-js auth the app uses (narrow, so tests can fake it). */
export type AuthClient = Pick<
  SupabaseClient['auth'],
  'getSession' | 'onAuthStateChange' | 'signInWithPassword' | 'signOut' | 'refreshSession'
>;

/**
 * Session state outside React, so the API client (not a component) can expire it.
 * supabase-js owns persistence, auto-refresh and cross-tab sync; this store mirrors it.
 */
export function createSessionStore(auth: AuthClient, onSignedOut: () => void) {
  let state: AuthState = { status: 'loading' };
  let expiring = false;
  const listeners = new Set<() => void>();

  const set = (next: AuthState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  auth.onAuthStateChange((_event, session) => {
    if (session) {
      set({ status: 'signedIn', session });
      return;
    }
    // Signed out (here, in another tab, or expired): no previous user's data may survive.
    onSignedOut();
    set(expiring ? { status: 'signedOut', reason: 'expired' } : { status: 'signedOut' });
    expiring = false;
  });
  void auth.getSession().then(({ data }) => {
    if (state.status === 'loading') {
      set(data.session ? { status: 'signedIn', session: data.session } : { status: 'signedOut' });
    }
  });

  const tokens: TokenSource = {
    current: async () => (await auth.getSession()).data.session?.access_token ?? null,
    refresh: async () => {
      // Only the API client calls this, after a 401. If the refresh token is dead too,
      // supabase-js emits SIGNED_OUT *during* refreshSession(); that sign-out is an expiry.
      expiring = true;
      const { data, error } = await auth.refreshSession();
      const token = error ? null : (data.session?.access_token ?? null);
      if (token) expiring = false;
      return token;
    },
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    tokens,
    signIn: (email: string, password: string) => auth.signInWithPassword({ email, password }),
    signOut: () => auth.signOut(),
    /** The API rejected the session and refresh failed: sign out here, say why on login. */
    expire() {
      if (state.status !== 'signedIn') return;
      expiring = true;
      void auth.signOut({ scope: 'local' });
    },
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
