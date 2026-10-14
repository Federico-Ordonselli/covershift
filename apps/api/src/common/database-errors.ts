import { isErrorCode } from '@covershift/shared';
import { QueryFailedError } from 'typeorm';
import { DomainError } from './domain-error';

/** SQLSTATE raised by the swap-request transition triggers; message is '<CODE>: <reason>'. */
export const TRANSITION_SQLSTATE = 'CS409';

interface PgError {
  code?: string;
  constraint?: string;
  message: string;
}

/**
 * Database outcome → domain error (ADR 001, "Errors: database → HTTP"). Returns undefined
 * for anything unexpected, which then surfaces as an opaque 500.
 */
export function translateDatabaseError(err: unknown): DomainError | undefined {
  if (!(err instanceof QueryFailedError)) return undefined;
  const pg = err.driverError as PgError;

  switch (pg.code) {
    case TRANSITION_SQLSTATE: {
      const separator = pg.message.indexOf(': ');
      const code = separator > 0 ? pg.message.slice(0, separator) : '';
      const reason = separator > 0 ? pg.message.slice(separator + 2) : pg.message;
      return new DomainError(isErrorCode(code) ? code : 'CONFLICT', reason, 409);
    }
    case '42501': // insufficient_privilege, including RLS WITH CHECK violations
      return new DomainError('FORBIDDEN', 'You are not allowed to perform this operation', 403);
    case '23P01': // exclusion_violation: shifts_no_overlap_per_assignee
      return new DomainError(
        'SHIFT_OVERLAP',
        'The assignee already has an overlapping shift in this organization',
        409,
      );
    case '23505': // unique_violation
      return pg.constraint === 'swap_requests_one_active_per_shift'
        ? new DomainError(
            'SWAP_ALREADY_ACTIVE',
            'This shift already has an active swap request',
            409,
          )
        : new DomainError('CONFLICT', 'Conflicts with an existing record', 409);
    case '23503': // foreign_key_violation (incl. composite tenant FKs)
      return new DomainError(
        'INVALID_REFERENCE',
        'A referenced record does not exist in this organization',
        422,
      );
    case '23514': // check_violation
      return new DomainError(
        'CONSTRAINT_VIOLATION',
        'The data violates a business constraint',
        422,
      );
    default:
      return undefined;
  }
}

/** True for 42501 raised by a missing grant rather than by an RLS policy: likely our bug. */
export function isPrivilegeBug(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const pg = err.driverError as PgError;
  return pg.code === '42501' && !pg.message.includes('row-level security');
}
