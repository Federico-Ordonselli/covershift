import { z } from 'zod';

export const MEMBERSHIP_ROLES = ['admin', 'manager', 'staff'] as const;
export const MembershipRoleSchema = z.enum(MEMBERSHIP_ROLES);
export type MembershipRole = z.infer<typeof MembershipRoleSchema>;

/**
 * Roles allowed to manage the schedule (create shifts, approve swaps).
 * Admin is a superset of manager.
 */
export const SCHEDULER_ROLES = ['admin', 'manager'] as const satisfies readonly MembershipRole[];

export const SWAP_REQUEST_STATUSES = [
  'pending', // created by the requester, waiting for the target (or any claimer)
  'accepted', // target accepted / open offer claimed, waiting for a manager
  'declined', // target declined a direct offer
  'approved', // manager approved, shift reassigned
  'rejected', // manager rejected
  'cancelled', // requester withdrew before approval
] as const;
export const SwapRequestStatusSchema = z.enum(SWAP_REQUEST_STATUSES);
export type SwapRequestStatus = z.infer<typeof SwapRequestStatusSchema>;

/** Statuses that block a second swap request on the same shift. */
export const ACTIVE_SWAP_REQUEST_STATUSES = [
  'pending',
  'accepted',
] as const satisfies readonly SwapRequestStatus[];
