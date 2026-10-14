import {
  CreateShiftSchema,
  ListShiftsQuerySchema,
  ShiftSchema,
  UpdateShiftSchema,
} from '@covershift/shared';
import { createZodDto } from 'nestjs-zod';
import { type Shift } from '../database/entities';

export class CreateShiftDto extends createZodDto(CreateShiftSchema) {}
export class UpdateShiftDto extends createZodDto(UpdateShiftSchema) {}
export class ListShiftsQueryDto extends createZodDto(ListShiftsQuerySchema) {}
export class ShiftDto extends createZodDto(ShiftSchema) {}

export function toShiftDto(shift: Shift): ShiftDto {
  return {
    id: shift.id,
    organizationId: shift.organizationId,
    positionId: shift.positionId,
    startsAt: shift.startsAt.toISOString(),
    endsAt: shift.endsAt.toISOString(),
    assignedUserId: shift.assignedUserId,
    createdAt: shift.createdAt.toISOString(),
    updatedAt: shift.updatedAt.toISOString(),
  };
}
