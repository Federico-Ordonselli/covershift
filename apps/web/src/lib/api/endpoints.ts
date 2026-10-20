import {
  type AssignmentQuery,
  type CreateShift,
  type UpdateShift,
  AssignmentCandidatesSchema,
  WorkerProfileSchema,
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
    workerProfile: (orgId: string) =>
      api.request(`/organizations/${encodeURIComponent(orgId)}/worker-profile`, {
        schema: WorkerProfileSchema,
      }),
    assignmentCandidates: (query: AssignmentQuery) =>
      api.request('/shifts/candidates', { query, schema: AssignmentCandidatesSchema }),
    createShift: (body: CreateShift) =>
      api.request('/shifts', { method: 'POST', body, schema: ShiftSchema }),
    updateShift: (id: string, body: UpdateShift) =>
      api.request(`/shifts/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body,
        schema: ShiftSchema,
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
