import { useState } from 'react';
import { NavLink, Navigate, useParams } from 'react-router';
import { type Notice, NoticeBanner } from '../../ui/Notice';
import { ActionButton } from './ActionButton';
import { PageHeading } from '../../ui/PageHeading';
import { useOrg } from '../orgs/orgContext';
import { SwapList } from './SwapList';
import styles from './swaps.module.css';

const TABS = {
  incoming: 'Offers to me',
  open: 'Open offers',
  mine: 'My requests',
} as const;
type Tab = keyof typeof TABS;

/** /orgs/:orgId/swaps/:tab — incoming direct offers, open offers to claim, my requests. */
export function SwapsPage() {
  const { tab } = useParams();
  const { org, userId } = useOrg();
  const [notice, setNotice] = useState<Notice | null>(null);

  if (!tab || !(tab in TABS)) return <Navigate to={`/orgs/${org.id}/swaps/incoming`} replace />;
  const current = tab as Tab;

  return (
    <>
      <PageHeading>Shift swaps</PageHeading>
      <nav aria-label="Swap lists" className={styles.tabs}>
        {(Object.keys(TABS) as Tab[]).map((t) => (
          <NavLink key={t} to={`/orgs/${org.id}/swaps/${t}`} onClick={() => setNotice(null)}>
            {TABS[t]}
          </NavLink>
        ))}
      </nav>
      <div aria-live="polite">
        <NoticeBanner notice={notice} />
      </div>

      {current === 'incoming' ? (
        <SwapList
          filters={{ targetUserId: userId, status: 'pending' }}
          emptyText="No one has offered you a shift."
          actions={(swap) => (
            <>
              <ActionButton onNotice={setNotice} swap={swap} action="accept" />
              <ActionButton onNotice={setNotice} swap={swap} action="decline" variant="secondary" />
            </>
          )}
        />
      ) : current === 'open' ? (
        <SwapList
          filters={{ open: true, status: 'pending' }}
          emptyText="There are no open offers right now."
          actions={(swap) =>
            swap.requesterId === userId ? (
              <p className={styles.muted}>This is your offer.</p>
            ) : (
              <ActionButton
                onNotice={setNotice}
                swap={swap}
                action="accept"
                label="Claim this shift"
              />
            )
          }
        />
      ) : (
        <SwapList
          filters={{ requesterId: userId }}
          emptyText="You haven’t offered any shifts."
          actions={(swap) =>
            swap.status === 'pending' || swap.status === 'accepted' ? (
              <ActionButton onNotice={setNotice} swap={swap} action="cancel" variant="secondary" />
            ) : null
          }
        />
      )}
    </>
  );
}
