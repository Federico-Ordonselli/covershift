import { QueryFailedError } from 'typeorm';
import { describe, expect, it } from 'vitest';
import { isPrivilegeBug, translateDatabaseError } from './database-errors';

function pgError(code: string, message = 'boom', constraint?: string) {
  return new QueryFailedError('query', [], Object.assign(new Error(message), { code, constraint }));
}

describe('translateDatabaseError', () => {
  it('passes the transition trigger code and reason through as 409', () => {
    const err = translateDatabaseError(
      pgError('CS409', 'SWAP_INVALID_TRANSITION: only accepted requests can be approved'),
    );
    expect(err).toMatchObject({
      code: 'SWAP_INVALID_TRANSITION',
      message: 'only accepted requests can be approved',
      status: 409,
    });
  });

  it('falls back to CONFLICT for an unknown trigger code', () => {
    expect(translateDatabaseError(pgError('CS409', 'WHATEVER: reason'))).toMatchObject({
      code: 'CONFLICT',
      status: 409,
    });
  });

  it.each([
    ['42501', undefined, 'FORBIDDEN', 403],
    ['23P01', undefined, 'SHIFT_OVERLAP', 409],
    ['23505', 'swap_requests_one_active_per_shift', 'SWAP_ALREADY_ACTIVE', 409],
    ['23505', 'organizations_slug_key', 'CONFLICT', 409],
    ['23503', undefined, 'INVALID_REFERENCE', 422],
    ['23514', undefined, 'CONSTRAINT_VIOLATION', 422],
  ])('maps %s (%s) to %s / %i', (sqlstate, constraint, code, status) => {
    expect(translateDatabaseError(pgError(sqlstate, 'x', constraint))).toMatchObject({
      code,
      status,
    });
  });

  it('leaves unknown errors alone (they become an opaque 500)', () => {
    expect(translateDatabaseError(pgError('57014'))).toBeUndefined();
    expect(translateDatabaseError(new Error('not a db error'))).toBeUndefined();
  });

  it('flags grant errors, but not RLS violations, as likely bugs', () => {
    expect(isPrivilegeBug(pgError('42501', 'permission denied for table shifts'))).toBe(true);
    expect(
      isPrivilegeBug(
        pgError('42501', 'new row violates row-level security policy for table "shifts"'),
      ),
    ).toBe(false);
  });
});
