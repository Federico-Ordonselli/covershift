import { useState } from 'react';
import { type Notice, NoticeBanner } from '../../ui/Notice';
import { ActionButton } from '../swaps/ActionButton';
import { PageHeading } from '../../ui/PageHeading';
import { useOrg } from '../orgs/orgContext';
import { SwapList } from '../swaps/SwapList';
import styles from '../swaps/swaps.module.css';

/**
 * /orgs/:orgId/inbox — accepted swaps awaiting a manager. The role check here only shapes
 * the UI; the API decides. The notice lives above the role guard, so when a 403 reveals a
 * revoked role (and /me refetches), the reason stays on screen next to "Managers only".
 */
export function InboxPage() {
  const { isScheduler, userId } = useOrg();
  const [notice, setNotice] = useState<Notice | null>(null);

  return (
    <>
      <PageHeading>{isScheduler ? 'Approvals' : 'Managers only'}</PageHeading>
      <div aria-live="polite">
        <NoticeBanner notice={notice} />
      </div>
      {!isScheduler ? (
        <p>Only managers and admins of this organization can approve shift swaps.</p>
      ) : (
        <SwapList
          filters={{ status: 'accepted' }}
          emptyText="No swaps are waiting for approval."
          actions={(swap) =>
            swap.requesterId === userId || swap.targetUserId === userId ? (
              <p className={styles.muted}>
                You’re part of this swap, so another manager has to decide.
              </p>
            ) : (
              <>
                <ActionButton onNotice={setNotice} swap={swap} action="approve" />
                <ActionButton
                  onNotice={setNotice}
                  swap={swap}
                  action="reject"
                  variant="secondary"
                />
              </>
            )
          }
        />
      )}
    </>
  );
}
