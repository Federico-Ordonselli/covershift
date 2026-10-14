import { type ListShiftsQuery } from '@covershift/shared';

/** Every org-scoped key starts with ['org', orgId], so switching orgs never mixes caches. */
export const queryKeys = {
  me: ['me'] as const,
  org: (orgId: string) => ['org', orgId] as const,
  positions: (orgId: string) => ['org', orgId, 'positions'] as const,
  members: (orgId: string) => ['org', orgId, 'members'] as const,
  shifts: (orgId: string, query: Partial<ListShiftsQuery>) =>
    ['org', orgId, 'shifts', query] as const,
};
