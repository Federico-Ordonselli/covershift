import { type Shift } from '@covershift/shared';
import { Link, useSearchParams } from 'react-router';
import {
  dayKey,
  formatDay,
  formatRange,
  formatTime,
  shiftWeeks,
  type Week,
  weekFromKey,
} from '../../lib/time/week';
import { Alert, ErrorAlert } from '../../ui/Alert';
import { PageHeading } from '../../ui/PageHeading';
import { Spinner } from '../../ui/Spinner';
import { useMembers, usePositions } from '../orgs/hooks';
import { useOrg } from '../orgs/orgContext';
import styles from './SchedulePage.module.css';
import { useWeekShifts, WEEK_MAX_PAGES, WEEK_PAGE_SIZE } from './useWeekShifts';

type View = 'all' | 'mine';

export function SchedulePage() {
  const { org, timeZone, timeZoneValid, userId } = useOrg();
  const [params] = useSearchParams();
  const view: View = params.get('view') === 'mine' ? 'mine' : 'all';
  const week = weekFromKey(params.get('week'), timeZone);
  const shifts = useWeekShifts(org.id, week, view === 'mine' ? userId : undefined);
  const positions = usePositions(org.id);
  const members = useMembers(org.id);

  const link = (next: { week?: Week; view?: View }) => {
    const p = new URLSearchParams({ week: (next.week ?? week).key });
    if ((next.view ?? view) === 'mine') p.set('view', 'mine');
    return `?${p.toString()}`;
  };

  const lookupsError = positions.error ?? members.error;

  return (
    <>
      <PageHeading>Schedule</PageHeading>
      <div className={styles.toolbar}>
        <nav aria-label="Week" className={styles.group}>
          <Link to={link({ week: shiftWeeks(week, -1, timeZone) })}>← Previous week</Link>
          <Link to={link({ week: weekFromKey(null, timeZone) })}>This week</Link>
          <Link to={link({ week: shiftWeeks(week, 1, timeZone) })}>Next week →</Link>
        </nav>
        <nav aria-label="Whose shifts" className={styles.group}>
          <Link to={link({ view: 'all' })} aria-current={view === 'all' ? 'page' : undefined}>
            Everyone
          </Link>
          <Link to={link({ view: 'mine' })} aria-current={view === 'mine' ? 'page' : undefined}>
            My shifts
          </Link>
        </nav>
      </div>
      <p className={styles.range}>
        <strong>{formatRange(week)}</strong> · Times shown in {timeZone}
      </p>

      {!timeZoneValid ? (
        <Alert tone="warning" title="Unknown time zone">
          <p>
            This organization’s time zone “{org.timezone}” isn’t recognized, so times are shown in
            UTC.
          </p>
        </Alert>
      ) : null}
      {shifts.data?.truncated ? (
        <Alert tone="warning" title="Not all shifts are shown">
          <p>
            This week has more than {WEEK_MAX_PAGES * WEEK_PAGE_SIZE} shifts; only the first{' '}
            {WEEK_MAX_PAGES * WEEK_PAGE_SIZE} are listed.
            {view === 'all' ? ' Switch to “My shifts” to see all of yours.' : ''}
          </p>
        </Alert>
      ) : null}

      {shifts.isError ? (
        <ErrorAlert error={shifts.error} onRetry={() => void shifts.refetch()} />
      ) : lookupsError ? (
        <ErrorAlert
          error={lookupsError}
          onRetry={() => {
            void positions.refetch();
            void members.refetch();
          }}
        />
      ) : !shifts.data || !positions.data || !members.data ? (
        <Spinner label="Loading shifts" />
      ) : (
        <WeekGrid
          week={week}
          timeZone={timeZone}
          shifts={shifts.data.shifts}
          positionName={nameLookup(
            positions.data,
            (p) => p.id,
            (p) => p.name,
            'Unknown position',
          )}
          memberName={nameLookup(
            members.data,
            (m) => m.userId,
            (m) => m.fullName,
            'Former member',
          )}
          userId={userId}
        />
      )}
    </>
  );
}

function nameLookup<T>(
  rows: T[],
  id: (row: T) => string,
  name: (row: T) => string,
  fallback: string,
): (id: string) => string {
  const byId = new Map(rows.map((row) => [id(row), name(row)]));
  return (key) => byId.get(key) ?? fallback;
}

function WeekGrid(props: {
  week: Week;
  timeZone: string;
  shifts: Shift[];
  positionName: (id: string) => string;
  memberName: (id: string) => string;
  userId: string;
}) {
  const { week, timeZone, shifts, positionName, memberName, userId } = props;
  const byDay = new Map<string, Shift[]>();
  for (const shift of shifts) {
    const key = dayKey(shift.startsAt, timeZone);
    byDay.set(key, [...(byDay.get(key) ?? []), shift]);
  }

  return (
    <div className={styles.grid}>
      {week.days.map((day) => {
        const key = dayKey(day.toISOString(), timeZone);
        const dayShifts = byDay.get(key) ?? [];
        const headingId = `day-${key}`;
        return (
          <section key={key} aria-labelledby={headingId} className={styles.day}>
            <h2 id={headingId} className={styles.dayHeading}>
              {formatDay(day)}
            </h2>
            {dayShifts.length === 0 ? (
              <p className={styles.empty}>No shifts</p>
            ) : (
              <ul className={styles.list}>
                {dayShifts.map((shift) => {
                  const mine = shift.assignedUserId === userId;
                  const nextDay = dayKey(shift.endsAt, timeZone) !== key;
                  return (
                    <li
                      key={shift.id}
                      className={mine ? `${styles.shift} ${styles.mine}` : styles.shift}
                    >
                      <span className={styles.time}>
                        {formatTime(shift.startsAt, timeZone)}–{formatTime(shift.endsAt, timeZone)}
                        {nextDay ? <span aria-label=" (ends the next day)">+1</span> : null}
                      </span>
                      <span className={styles.position}>{positionName(shift.positionId)}</span>
                      <span className={styles.assignee}>
                        {shift.assignedUserId ? memberName(shift.assignedUserId) : 'Unassigned'}
                        {mine ? <strong> (you)</strong> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
