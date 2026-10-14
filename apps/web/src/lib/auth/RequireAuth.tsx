import { Navigate, Outlet, useLocation } from 'react-router';
import { FullPageSpinner } from '../../ui/Spinner';
import { useAuthState } from './SessionProvider';

/** Protected routes: a signed-out visitor goes to /login and comes back afterwards. */
export function RequireAuth() {
  const auth = useAuthState();
  const location = useLocation();
  if (auth.status === 'loading') return <FullPageSpinner label="Checking your session" />;
  if (auth.status === 'signedOut') {
    const params = new URLSearchParams({
      returnTo: `${location.pathname}${location.search}`,
      ...(auth.reason ? { reason: auth.reason } : {}),
    });
    return <Navigate to={`/login?${params.toString()}`} replace />;
  }
  return <Outlet />;
}
