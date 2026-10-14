import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { createApiClient } from '../lib/api/client';
import { ApiProvider } from '../lib/api/ApiProvider';
import { createEndpoints } from '../lib/api/endpoints';
import { createSessionStore } from '../lib/auth/session';
import { SessionProvider } from '../lib/auth/SessionProvider';
import { supabase } from '../lib/auth/supabase';
import { createQueryClient } from './queryClient';
import { routes } from './routes';

/** Wiring: supabase auth → session store → API client → TanStack Query → router. */
function createServices() {
  const queryClient = createQueryClient();
  const session = createSessionStore(supabase.auth, () => queryClient.clear());
  const api = createApiClient({ tokens: session.tokens, onUnauthorized: () => session.expire() });
  return {
    queryClient,
    session,
    endpoints: createEndpoints(api),
    router: createBrowserRouter(routes),
  };
}

export function App() {
  const [services] = useState(createServices);
  return (
    <SessionProvider store={services.session}>
      <QueryClientProvider client={services.queryClient}>
        <ApiProvider endpoints={services.endpoints}>
          <RouterProvider router={services.router} />
        </ApiProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}
