import { z } from 'zod';

/** Timestamps cross the wire as ISO 8601 with an explicit offset; stored as timestamptz. */
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });

export const UuidSchema = z.uuid();

/**
 * Keyset pagination. The cursor is opaque to clients: pass back `nextCursor` verbatim.
 * `nextCursor: null` means there are no more items.
 */
export const PAGE_SIZE_DEFAULT = 50;
export const PAGE_SIZE_MAX = 100;

/**
 * Hard cap for the unpaginated organization lists (positions, members). Larger
 * organizations get the first LIST_HARD_CAP rows in the documented order; pagination
 * is the fix if that ever happens.
 */
export const LIST_HARD_CAP = 500;
export const PageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
  cursor: z.string().min(1).max(512).optional(),
});
export type PageQuery = z.infer<typeof PageQuerySchema>;

export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}
export type Page<T> = { items: T[]; nextCursor: string | null };

/**
 * RFC 9457 problem details. Every error response the API sends has this shape, with a
 * stable machine-readable `code` (clients branch on `code`, never on `detail`).
 */
export const ProblemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string(),
  code: z.string(),
  /** Per-field problems, on VALIDATION_FAILED only. */
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

/** Domain error codes the client may branch on. */
export const ERROR_CODES = {
  // Framework-level: transport, auth, routing, unexpected failures.
  UNAUTHORIZED: 'UNAUTHORIZED',
  MALFORMED_REQUEST: 'MALFORMED_REQUEST',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  BAD_REQUEST: 'BAD_REQUEST',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  // Domain-level.
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
