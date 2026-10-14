import { type Page } from '@covershift/shared';
import { z } from 'zod';
import { DomainError } from './domain-error';

/**
 * Keyset cursor: the sort key of the last item on the page plus its id (tiebreaker).
 *
 * `key` is the database's own rendering of a timestamptz in UTC with microseconds
 * (`to_char(... at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`), never a JS Date:
 * Postgres keeps microseconds and `now()` is constant within a transaction, so a
 * millisecond key would skip or repeat rows on the page boundary.
 *
 * Opaque to clients, but not secret: a tampered cursor only moves the page start.
 * RLS and the query's filters still decide which rows exist.
 */
export const CURSOR_KEY_SQL_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

const CursorSchema = z.object({
  key: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
  id: z.uuid(),
});
export type Cursor = z.infer<typeof CursorSchema>;

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/** Throws 400 VALIDATION_FAILED for anything that isn't a cursor this API issued. */
export function decodeCursor(raw: string): Cursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    parsed = undefined;
  }
  const result = CursorSchema.safeParse(parsed);
  if (!result.success) throw new DomainError('VALIDATION_FAILED', 'Invalid cursor', 400);
  return result.data;
}

/**
 * Builds a page from rows fetched with `limit + 1`: the extra row only signals that
 * another page exists. `keys[i]` is the cursor key selected alongside `rows[i]`.
 */
export function toPage<T extends { id: string }>(
  rows: T[],
  keys: string[],
  limit: number,
): Page<T> {
  if (rows.length <= limit) return { items: rows, nextCursor: null };
  const items = rows.slice(0, limit);
  const last = items[items.length - 1]!;
  return { items, nextCursor: encodeCursor({ key: keys[limit - 1]!, id: last.id }) };
}
