import { z } from 'zod';
import { IsoDateTimeSchema, UuidSchema } from './common.js';
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

export const ListSwapRequestsQuerySchema = z.object({
  organizationId: UuidSchema.optional(),
  shiftId: UuidSchema.optional(),
  status: SwapRequestStatusSchema.optional(),
});
export type ListSwapRequestsQuery = z.infer<typeof ListSwapRequestsQuerySchema>;
