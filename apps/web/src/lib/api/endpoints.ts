import {
  type ListShiftsQuery,
  MemberSchema,
  MeSchema,
  OrganizationSummarySchema,
  PositionSchema,
  ShiftPageSchema,
} from '@covershift/shared';
import { z } from 'zod';
import { type ApiClient } from './client';

/** The API surface the app uses, every response parsed with the shared contracts. */
export function createEndpoints(api: ApiClient) {
  return {
    me: () => api.request('/me', { schema: MeSchema }),
    organizations: () =>
      api.request('/organizations', { schema: z.array(OrganizationSummarySchema) }),
    positions: (orgId: string) =>
      api.request(`/organizations/${encodeURIComponent(orgId)}/positions`, {
        schema: z.array(PositionSchema),
      }),
    members: (orgId: string) =>
      api.request(`/organizations/${encodeURIComponent(orgId)}/members`, {
        schema: z.array(MemberSchema),
      }),
    shifts: (query: Partial<ListShiftsQuery>) =>
      api.request('/shifts', { query, schema: ShiftPageSchema }),
  };
}

export type Endpoints = ReturnType<typeof createEndpoints>;
