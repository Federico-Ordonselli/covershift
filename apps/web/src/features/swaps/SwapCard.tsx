import { type SwapRequest } from '@covershift/shared';
import { type ReactNode } from 'react';
import { formatDay, formatTime } from '../../lib/time/week';
import { TZDate } from '@date-fns/tz';
import { useMembers, usePositions } from '../orgs/hooks';
import { useOrg } from '../orgs/orgContext';
import { useShift } from './hooks';
import { statusLabel } from './labels';
import styles from './swaps.module.css';

/** One swap request with its shift, people, status, note, and whatever actions apply. */
export function SwapCard({ swap, actions }: { swap: SwapRequest; actions?: ReactNode }) {
  const { org, timeZone, userId } = useOrg();
  const shift = useShift(org.id, swap.shiftId);
  const positions = usePositions(org.id);
  const members = useMembers(org.id);
  const name = (id: string | null) => {
    if (!id) return 'Anyone in the organization';
    if (id === userId) return 'You';
    return members.data?.find((m) => m.userId === id)?.fullName ?? 'Former member';
  };
  const headingId = `swap-${swap.id}`;
  const position = shift.data
    ? (positions.data?.find((p) => p.id === shift.data.positionId)?.name ?? 'Shift')
    : 'Shift';

  return (
    <li className={styles.card} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.cardTitle}>
        {position}
        {shift.data ? (
          <>
            {' · '}
            {formatDay(new TZDate(shift.data.startsAt, timeZone))}{' '}
            {formatTime(shift.data.startsAt, timeZone)}–{formatTime(shift.data.endsAt, timeZone)}
          </>
        ) : shift.isError ? (
          ' · details unavailable'
        ) : null}
      </h2>
      <dl className={styles.facts}>
        <dt>From</dt>
        <dd>{name(swap.requesterId)}</dd>
        <dt>To</dt>
        <dd>{name(swap.targetUserId)}</dd>
        <dt>Status</dt>
        <dd>{statusLabel(swap)}</dd>
        {swap.note ? (
          <>
            <dt>Note</dt>
            <dd>{swap.note}</dd>
          </>
        ) : null}
      </dl>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </li>
  );
}
