import { z } from 'zod';
import { IsoDateTimeSchema, PageQuerySchema, pageSchema, UuidSchema } from './common.js';

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
  overrideReason: z.string().optional(),
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
    overrideReason: z.string().trim().min(5).max(500).nullable().optional(),
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
    overrideReason: z.string().trim().min(5).max(500).nullable().optional(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' })
  .refine(endsAfterStart, endsAfterStartIssue);
export type UpdateShift = z.infer<typeof UpdateShiftSchema>;

/** `from`/`to` select shifts overlapping [from, to). Ordered by start time, then id. */
export const ListShiftsQuerySchema = PageQuerySchema.extend({
  organizationId: UuidSchema.optional(),
  assignedUserId: UuidSchema.optional(),
  from: IsoDateTimeSchema.optional(),
  to: IsoDateTimeSchema.optional(),
}).refine((v) => !v.from || !v.to || Date.parse(v.to) > Date.parse(v.from), {
  message: 'to must be after from',
  path: ['to'],
});
export type ListShiftsQuery = z.infer<typeof ListShiftsQuerySchema>;

export const ShiftPageSchema = pageSchema(ShiftSchema);
export type ShiftPage = z.infer<typeof ShiftPageSchema>;

export const AssignmentQuerySchema = z
  .object({
    organizationId: UuidSchema,
    positionId: UuidSchema,
    startsAt: IsoDateTimeSchema,
    endsAt: IsoDateTimeSchema,
    shiftId: UuidSchema.optional(),
  })
  .refine(endsAfterStart, endsAfterStartIssue);
export type AssignmentQuery = z.infer<typeof AssignmentQuerySchema>;
export const AssignmentCandidateSchema = z.object({
  userId: UuidSchema,
  fullName: z.string(),
  eligible: z.boolean(),
  canOverride: z.boolean(),
  reasons: z.array(z.string()),
});
export const AssignmentCandidatesSchema = z.array(AssignmentCandidateSchema);
