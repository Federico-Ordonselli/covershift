import { z } from 'zod';
import { IsoDateTimeSchema, UuidSchema } from './common.js';

const endsAfterStart = (v: { startsAt?: string; endsAt?: string }) =>
  v.startsAt === undefined ||
  v.endsAt === undefined ||
  Date.parse(v.endsAt) > Date.parse(v.startsAt);
const endsAfterStartIssue = { message: 'endsAt must be after startsAt', path: ['endsAt'] };

export const ShiftSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  positionId: UuidSchema,
  startsAt: IsoDateTimeSchema,
  endsAt: IsoDateTimeSchema,
  assignedUserId: UuidSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Shift = z.infer<typeof ShiftSchema>;

export const CreateShiftSchema = z
  .object({
    organizationId: UuidSchema,
    positionId: UuidSchema,
    startsAt: IsoDateTimeSchema,
    endsAt: IsoDateTimeSchema,
    assignedUserId: UuidSchema.nullable().default(null),
  })
  .refine(endsAfterStart, endsAfterStartIssue);
export type CreateShift = z.infer<typeof CreateShiftSchema>;

/** organizationId is immutable; moving a shift across tenants is not an update. */
export const UpdateShiftSchema = z
  .object({
    positionId: UuidSchema,
    startsAt: IsoDateTimeSchema,
    endsAt: IsoDateTimeSchema,
    assignedUserId: UuidSchema.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' })
  .refine(endsAfterStart, endsAfterStartIssue);
export type UpdateShift = z.infer<typeof UpdateShiftSchema>;

export const ListShiftsQuerySchema = z.object({
  organizationId: UuidSchema.optional(),
  assignedUserId: UuidSchema.optional(),
  from: IsoDateTimeSchema.optional(),
  to: IsoDateTimeSchema.optional(),
});
export type ListShiftsQuery = z.infer<typeof ListShiftsQuerySchema>;
