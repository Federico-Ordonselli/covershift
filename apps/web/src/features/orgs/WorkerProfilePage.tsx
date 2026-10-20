import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useApi } from '../../lib/api/ApiProvider';
import { ErrorAlert } from '../../ui/Alert';
import { PageHeading } from '../../ui/PageHeading';
import { Spinner } from '../../ui/Spinner';
import { useOrg } from './orgContext';

export function WorkerProfilePage() {
  const { org, timeZone } = useOrg();
  const api = useApi();
  const profile = useQuery({
    queryKey: ['org', org.id, 'worker-profile'],
    queryFn: () => api.workerProfile(org.id),
  });
  if (profile.isPending) return <Spinner label="Loading your qualifications" />;
  if (profile.isError)
    return <ErrorAlert error={profile.error} onRetry={() => void profile.refetch()} />;
  return (
    <>
      <PageHeading>My qualifications</PageHeading>
      <h2>My certifications</h2>
      {profile.data.certifications.length ? (
        <ul>
          {profile.data.certifications.map((c) => (
            <li key={c.id}>
              <strong>{c.name}</strong> —{' '}
              {c.expiresAt
                ? `Expires ${new Intl.DateTimeFormat('en', { timeZone, dateStyle: 'medium' }).format(new Date(c.expiresAt))}`
                : 'No expiry'}
            </li>
          ))}
        </ul>
      ) : (
        <p>You have no certifications yet.</p>
      )}
      <h2>Positions I can work</h2>
      <p>
        Based on your certifications today. Assignments also check availability and expiry through
        the end of each shift.
      </p>
      <ul>
        {profile.data.positions.map((p) => (
          <li key={p.id}>
            <strong>{p.name}</strong> —{' '}
            {p.eligible ? 'Qualified' : 'Certification missing or expired'}
            <p>Required: {p.required.join(', ') || 'No certifications'}</p>
          </li>
        ))}
      </ul>
      <h2>Things to do</h2>
      <ul>
        <li>
          <Link to={`/orgs/${org.id}/schedule?view=mine`}>View my shifts and offer a swap</Link>
        </li>
        <li>
          <Link to={`/orgs/${org.id}/swaps`}>Browse open offers</Link>
        </li>
        <li>
          <Link to={`/orgs/${org.id}/swaps/mine`}>Track my swap requests</Link>
        </li>
      </ul>
    </>
  );
}
