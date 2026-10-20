import { useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { useSessionStore } from '../../lib/auth/SessionProvider';
import { ErrorAlert } from '../../ui/Alert';
import { Button } from '../../ui/Button';
import { FullPageSpinner } from '../../ui/Spinner';
import { NotFoundPage } from '../NotFoundPage';
import { useMe } from './hooks';
import { rememberLastOrg } from './lastOrg';
import { type OrgContext, resolveTimeZone } from './orgContext';
import styles from './OrgLayout.module.css';

/** /orgs/:orgId/*: the org comes from the URL and must be one of the caller's memberships. */
export function OrgLayout() {
  const { orgId = '' } = useParams();
  const me = useMe();
  const store = useSessionStore();
  const navigate = useNavigate();
  const location = useLocation();
  const membership = me.data?.memberships.find((m) => m.id === orgId);

  useEffect(() => {
    if (membership) rememberLastOrg(membership.id);
  }, [membership]);

  if (me.isPending) return <FullPageSpinner label="Loading your organizations" />;
  if (me.isError) {
    return (
      <main className={styles.main}>
        <ErrorAlert error={me.error} onRetry={() => void me.refetch()} />
      </main>
    );
  }
  if (!membership) return <NotFoundPage what="organization" />;

  const { timeZone, valid } = resolveTimeZone(membership.timezone);
  const context: OrgContext = {
    org: membership,
    timeZone,
    timeZoneValid: valid,
    userId: me.data.id,
    isScheduler: membership.role === 'manager' || membership.role === 'admin',
  };
  // Switching keeps the current section: /orgs/A/schedule → /orgs/B/schedule.
  const section = location.pathname.split('/').slice(3).join('/') || 'schedule';

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <span className={styles.brand}>Covershift</span>
        <div className={styles.switcher}>
          <label htmlFor="org-switcher">Organization</label>
          <select
            id="org-switcher"
            value={membership.id}
            onChange={(e) => void navigate(`/orgs/${e.target.value}/${section}`)}
          >
            {me.data.memberships.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <nav aria-label="Main" className={styles.nav}>
          <NavLink to={`/orgs/${membership.id}/schedule`}>Schedule</NavLink>
          <NavLink to={`/orgs/${membership.id}/swaps`}>Swaps</NavLink>
          <NavLink to={`/orgs/${membership.id}/profile`}>My qualifications</NavLink>
          {context.isScheduler ? (
            <NavLink to={`/orgs/${membership.id}/inbox`}>Approvals</NavLink>
          ) : null}
        </nav>
        <div className={styles.user}>
          <span>
            {me.data.fullName || me.data.email}{' '}
            <span className={styles.role}>({membership.role})</span>
          </span>
          <Button variant="secondary" onClick={() => void store.signOut()}>
            Sign out
          </Button>
        </div>
      </header>
      <main className={styles.main}>
        <Outlet context={context} />
      </main>
    </div>
  );
}
