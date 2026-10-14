import { Navigate } from 'react-router';
import { ErrorAlert } from '../../ui/Alert';
import { FullPageSpinner } from '../../ui/Spinner';
import { PageHeading } from '../../ui/PageHeading';
import { useMe } from './hooks';
import { lastOrg } from './lastOrg';

/** "/": the last organization used if still a member, otherwise the first one. */
export function RootRedirect() {
  const me = useMe();
  if (me.isPending) return <FullPageSpinner label="Loading your organizations" />;
  if (me.isError) {
    return (
      <main>
        <ErrorAlert error={me.error} onRetry={() => void me.refetch()} />
      </main>
    );
  }
  const memberships = me.data.memberships;
  if (memberships.length === 0) {
    return (
      <main>
        <PageHeading>No organizations yet</PageHeading>
        <p>You’re not an active member of any organization. Ask a manager to add you.</p>
      </main>
    );
  }
  const remembered = lastOrg();
  const target = memberships.find((m) => m.id === remembered) ?? memberships[0]!;
  return <Navigate to={`/orgs/${target.id}/schedule`} replace />;
}
