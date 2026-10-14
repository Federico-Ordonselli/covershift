import { ShiftPageSchema } from '@covershift/shared';
import { describe, expect, it } from 'vitest';
import { ids, me, shift } from './fixtures';
import { ok, problem } from './respond';

/** Negative controls for the mock layer: drifted fixtures must not reach a test. */
describe('MSW fixtures are held to the shared contract', () => {
  it('rejects a builder override the API could never send', () => {
    expect(() => shift({ startsAt: 'yesterday' })).toThrow();
    expect(() => me({ memberships: [{ id: ids.org } as never] })).toThrow();
  });

  it('rejects a response body that does not match its schema', () => {
    expect(() => ok(ShiftPageSchema, { items: [shift()] } as never)).toThrow();
    expect(() =>
      ok(ShiftPageSchema, { items: [{ id: 'x' }], nextCursor: null } as never),
    ).toThrow();
  });

  it('rejects a problem response with an unknown code or a broken envelope', () => {
    expect(() => problem(409, 'NOT_A_REAL_CODE' as never, 'x')).toThrow(/error code/);
    expect(() => problem(409, 'CONFLICT', undefined as never)).toThrow();
  });
});
