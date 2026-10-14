import { translateDatabaseError } from '../../src/common/database-errors';

/**
 * The outcome a client would see: database errors go through the same translation the
 * ProblemDetailsFilter applies, so service tests assert codes and statuses, not SQLSTATEs.
 */
export async function outcome(promise: Promise<unknown>): Promise<unknown> {
  try {
    return await promise;
  } catch (err) {
    throw translateDatabaseError(err) ?? err;
  }
}
