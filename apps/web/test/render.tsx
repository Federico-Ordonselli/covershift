import { type Session } from '@supabase/supabase-js';
import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import { createQueryClient } from '../src/app/queryClient';
import { routes } from '../src/app/routes';
import { createApiClient } from '../src/lib/api/client';
import { ApiProvider } from '../src/lib/api/ApiProvider';
import { createEndpoints } from '../src/lib/api/endpoints';
import { type AuthClient, createSessionStore } from '../src/lib/auth/session';
import { SessionProvider } from '../src/lib/auth/SessionProvider';
import { ids } from './msw/fixtures';
import { API } from './msw/server';

type Listener = Parameters<AuthClient['onAuthStateChange']>[0];

/** A supabase-js auth stand-in: just enough surface for the real session store. */
export function fakeAuth(signedIn: boolean) {
  const session = { access_token: 'token', user: { id: ids.me } } as unknown as Session;
  let current: Session | null = signedIn ? session : null;
  let listener: Listener | undefined;
  const emit = (event: 'SIGNED_IN' | 'SIGNED_OUT') => listener?.(event, current);
  const auth = {
    getSession: vi.fn(async () => ({ data: { session: current }, error: null })),
    onAuthStateChange: vi.fn((cb: Listener) => {
      listener = cb;
      return { data: { subscription: { id: 'x', callback: cb, unsubscribe: () => {} } } };
    }),
    signInWithPassword: vi.fn(async ({ password }: { email: string; password: string }) => {
      if (password !== 'right') {
        return { data: { user: null, session: null }, error: { code: 'invalid_credentials' } };
      }
      current = session;
      emit('SIGNED_IN');
      return { data: { user: session.user, session }, error: null };
    }),
    signOut: vi.fn(async () => {
      current = null;
      emit('SIGNED_OUT');
      return { error: null };
    }),
    // Like supabase-js with a dead refresh token: the session is dropped and SIGNED_OUT
    // is emitted before refreshSession() resolves with the error.
    refreshSession: vi.fn(async () => {
      current = null;
      emit('SIGNED_OUT');
      return { data: { session: null, user: null }, error: { code: 'refresh_token_not_found' } };
    }),
  };
  return auth as typeof auth & AuthClient;
}

/** The real app (routes, providers, API client) on a memory router, against MSW. */
export function renderApp(path: string, { signedIn = true } = {}) {
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  const auth = fakeAuth(signedIn);
  const session = createSessionStore(auth, () => queryClient.clear());
  const api = createApiClient({
    tokens: session.tokens,
    onUnauthorized: () => session.expire(),
    baseUrl: API,
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <SessionProvider store={session}>
      <QueryClientProvider client={queryClient}>
        <ApiProvider endpoints={createEndpoints(api)}>
          <RouterProvider router={router} />
        </ApiProvider>
      </QueryClientProvider>
    </SessionProvider>,
  );
  return { ...view, router, auth, queryClient };
}
