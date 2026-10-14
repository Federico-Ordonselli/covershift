import { z } from 'zod';
import { IsoDateTimeSchema, TimeZoneSchema, UuidSchema } from './common.js';
import { MembershipRoleSchema } from './enums.js';

/** An organization as seen by one of its members, with the caller's role in it. */
export const OrganizationSummarySchema = z.object({
  id: UuidSchema,
  name: z.string(),
  slug: z.string(),
  /** IANA zone for presenting shifts; timestamps on the wire are always ISO with offset. */
  timezone: TimeZoneSchema,
  role: MembershipRoleSchema,
});
export type OrganizationSummary = z.infer<typeof OrganizationSummarySchema>;

export const PositionSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  name: z.string(),
});
export type Position = z.infer<typeof PositionSchema>;

/** An active member of an organization. Deactivated members are not listed. */
export const MemberSchema = z.object({
  userId: UuidSchema,
  fullName: z.string(),
  role: MembershipRoleSchema,
  memberSince: IsoDateTimeSchema,
});
export type Member = z.infer<typeof MemberSchema>;

/** The logged-in user: profile plus active memberships (the org switcher's source). */
export const MeSchema = z.object({
  id: UuidSchema,
  /** From the verified access token; profiles don't store email. */
  email: z.string().nullable(),
  fullName: z.string(),
  memberships: z.array(OrganizationSummarySchema),
});
export type Me = z.infer<typeof MeSchema>;
