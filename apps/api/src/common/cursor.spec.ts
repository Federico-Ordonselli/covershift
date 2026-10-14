import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, toPage } from './cursor';

const id = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const key = '2030-10-01T06:00:00.000001Z';

describe('cursor', () => {
  it('round-trips, keeping microseconds', () => {
    expect(decodeCursor(encodeCursor({ key, id }))).toEqual({ key, id });
  });

  it.each([
    ['not base64 json', 'abc'],
    ['empty object', Buffer.from('{}').toString('base64url')],
    ['millisecond key', encodeCursor({ key: '2030-10-01T06:00:00.000Z', id })],
    ['sql in key', encodeCursor({ key: "2030-10-01'; drop table x; --", id })],
    ['non-uuid id', encodeCursor({ key, id: '1 or 1=1' })],
  ])('rejects %s with 400 VALIDATION_FAILED', (_, raw) => {
    expect(() => decodeCursor(raw)).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED', status: 400 }),
    );
  });
});

describe('toPage', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const keys = ['k1', 'k2', 'k3'];

  it('returns no cursor when the extra row is absent', () => {
    expect(toPage(rows, keys, 3)).toEqual({ items: rows, nextCursor: null });
  });

  it('drops the extra row and points the cursor at the last item kept', () => {
    const page = toPage(rows, keys, 2);
    expect(page.items).toEqual(rows.slice(0, 2));
    expect(JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString())).toEqual({
      key: 'k2',
      id: 'b',
    });
  });
});
