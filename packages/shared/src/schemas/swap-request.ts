import { z } from 'zod';
import { IsoDateTimeSchema, PageQuerySchema, pageSchema, UuidSchema } from './common.js';
import { SwapRequestStatusSchema } from './enums.js';

export const SwapRequestSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  shiftId: UuidSchema,
  requesterId: UuidSchema,
  /** null = open offer, anyone eligible in the organization may claim it. */
  targetUserId: UuidSchema.nullable(),
  status: SwapRequestStatusSchema,
  note: z.string().nullable(),
  decidedById: UuidSchema.nullable(),
  decidedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type SwapRequest = z.infer<typeof SwapRequestSchema>;

export const CreateSwapRequestSchema = z.object({
  shiftId: UuidSchema,
  targetUserId: UuidSchema.nullable().default(null),
  note: z.string().trim().max(500).optional(),
});
export type CreateSwapRequest = z.infer<typeof CreateSwapRequestSchema>;

/**
 * Newest first (created time, then id). The frontend's views map to filters:
 * mine = requesterId; incoming offers = targetUserId + status=pending;
 * claimable = open=true + status=pending; manager inbox = organizationId + status=accepted.
 */
export const ListSwapRequestsQuerySchema = PageQuerySchema.extend({
  organizationId: UuidSchema.optional(),
  shiftId: UuidSchema.optional(),
  status: SwapRequestStatusSchema.optional(),
  requesterId: UuidSchema.optional(),
  targetUserId: UuidSchema.optional(),
  /** true = open offers only (no target); false = direct offers only. */
  open: z.stringbool().optional(),
});
export type ListSwapRequestsQuery = z.infer<typeof ListSwapRequestsQuerySchema>;

export const SwapRequestPageSchema = pageSchema(SwapRequestSchema);
export type SwapRequestPage = z.infer<typeof SwapRequestPageSchema>;
