import {
  CreateSwapRequestSchema,
  ListSwapRequestsQuerySchema,
  SwapRequestSchema,
} from '@covershift/shared';
import { createZodDto } from 'nestjs-zod';
import { type SwapRequest } from '../database/entities';

export class CreateSwapRequestDto extends createZodDto(CreateSwapRequestSchema) {}
export class ListSwapRequestsQueryDto extends createZodDto(ListSwapRequestsQuerySchema) {}
export class SwapRequestDto extends createZodDto(SwapRequestSchema) {}

export function toSwapRequestDto(swap: SwapRequest): SwapRequestDto {
  return {
    id: swap.id,
    organizationId: swap.organizationId,
    shiftId: swap.shiftId,
    requesterId: swap.requesterId,
    targetUserId: swap.targetUserId,
    status: swap.status,
    note: swap.note,
    decidedById: swap.decidedById,
    decidedAt: swap.decidedAt?.toISOString() ?? null,
    createdAt: swap.createdAt.toISOString(),
    updatedAt: swap.updatedAt.toISOString(),
  };
}
