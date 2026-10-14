import { Link } from 'react-router';
import { PageHeading } from '../ui/PageHeading';

export function NotFoundPage({ what = 'page' }: { what?: string }) {
  return (
    <main>
      <PageHeading>Not found</PageHeading>
      <p>This {what} doesn’t exist or isn’t visible to you.</p>
      <p>
        <Link to="/">Go to your schedule</Link>
      </p>
    </main>
  );
}
