import { z } from 'zod';

/** Timestamps cross the wire as ISO 8601 with an explicit offset; stored as timestamptz. */
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });

export const UuidSchema = z.uuid();

/** RFC 9457 problem details, with a stable machine-readable `code`. */
export const ProblemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  code: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

/** Domain error codes the client may branch on. */
export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INVALID_REFERENCE: 'INVALID_REFERENCE',
  CONSTRAINT_VIOLATION: 'CONSTRAINT_VIOLATION',
  CERTIFICATION_MISSING: 'CERTIFICATION_MISSING',
  CERTIFICATION_EXPIRES_BEFORE_SHIFT_END: 'CERTIFICATION_EXPIRES_BEFORE_SHIFT_END',
  NOT_A_MEMBER: 'NOT_A_MEMBER',
  SHIFT_OVERLAP: 'SHIFT_OVERLAP',
  SHIFT_ALREADY_STARTED: 'SHIFT_ALREADY_STARTED',
  SWAP_ALREADY_ACTIVE: 'SWAP_ALREADY_ACTIVE',
  SWAP_INVALID_TRANSITION: 'SWAP_INVALID_TRANSITION',
  SWAP_CONFLICT: 'SWAP_CONFLICT',
  SWAP_NOT_ALLOWED: 'SWAP_NOT_ALLOWED',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export function isErrorCode(value: string): value is ErrorCode {
  return Object.hasOwn(ERROR_CODES, value);
}
