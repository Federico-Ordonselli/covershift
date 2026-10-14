import {
  type CreateSwapRequest,
  type ListShiftsQuery,
  type ListSwapRequestsQuery,
  MemberSchema,
  MeSchema,
  OrganizationSummarySchema,
  PositionSchema,
  ShiftPageSchema,
  ShiftSchema,
  SwapRequestPageSchema,
  SwapRequestSchema,
} from '@covershift/shared';
import { z } from 'zod';
import { type ApiClient } from './client';

export type SwapAction = 'accept' | 'decline' | 'cancel' | 'approve' | 'reject';

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
    shift: (id: string) =>
      api.request(`/shifts/${encodeURIComponent(id)}`, { schema: ShiftSchema }),
    swaps: (query: Partial<ListSwapRequestsQuery>) =>
      api.request('/swap-requests', { query, schema: SwapRequestPageSchema }),
    createSwap: (body: CreateSwapRequest) =>
      api.request('/swap-requests', { method: 'POST', body, schema: SwapRequestSchema }),
    swapAction: (id: string, action: SwapAction) =>
      api.request(`/swap-requests/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
        schema: SwapRequestSchema,
      }),
  };
}

export type Endpoints = ReturnType<typeof createEndpoints>;
