import { type Shift } from '@covershift/shared';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../../lib/api/ApiProvider';
import { queryKeys } from '../../lib/api/queryKeys';
import { type Week } from '../../lib/time/week';

export const WEEK_PAGE_SIZE = 100;
/** Safety cap: at most this many pages (1000 shifts) for one week view. */
export const WEEK_MAX_PAGES = 10;

export interface WeekShifts {
  shifts: Shift[];
  /** The cap was hit: more shifts exist than are shown. The UI must say so. */
  truncated: boolean;
}

/** Every shift overlapping the week, following nextCursor up to the safety cap. */
export function useWeekShifts(
  orgId: string,
  week: Week,
  assignedUserId: string | undefined,
  maxPages = WEEK_MAX_PAGES,
) {
  const api = useApi();
  const query = {
    organizationId: orgId,
    from: week.start.toISOString(),
    to: week.end.toISOString(),
    assignedUserId,
    limit: WEEK_PAGE_SIZE,
  };
  return useQuery({
    queryKey: queryKeys.shifts(orgId, query),
    queryFn: async (): Promise<WeekShifts> => {
      const shifts: Shift[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < maxPages; page++) {
        const res = await api.shifts({ ...query, cursor });
        shifts.push(...res.items);
        if (!res.nextCursor) return { shifts, truncated: false };
        cursor = res.nextCursor;
      }
      return { shifts, truncated: true };
    },
  });
}
