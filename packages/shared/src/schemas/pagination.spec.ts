import { describe, expect, it } from 'vitest';
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from './common.js';
import { ListShiftsQuerySchema } from './shift.js';
import { ListSwapRequestsQuerySchema } from './swap-request.js';

describe('page query (query strings arrive as text)', () => {
  it('defaults limit and coerces it from a string', () => {
    expect(ListShiftsQuerySchema.parse({}).limit).toBe(PAGE_SIZE_DEFAULT);
    expect(ListShiftsQuerySchema.parse({ limit: '7' }).limit).toBe(7);
  });

  it.each(['0', String(PAGE_SIZE_MAX + 1), '2.5', 'ten'])('rejects limit=%s', (limit) => {
    expect(ListShiftsQuerySchema.safeParse({ limit }).success).toBe(false);
  });

  it('rejects an empty cursor', () => {
    expect(ListSwapRequestsQuerySchema.safeParse({ cursor: '' }).success).toBe(false);
  });
});

describe('ListShiftsQuerySchema date range', () => {
  it('accepts from < to', () => {
    const q = { from: '2026-11-02T00:00:00Z', to: '2026-11-09T00:00:00Z' };
    expect(ListShiftsQuerySchema.safeParse(q).success).toBe(true);
  });

  it.each([
    ['equal', '2026-11-02T00:00:00Z'],
    ['reversed', '2026-11-01T00:00:00Z'],
  ])('rejects %s bounds on `to`', (_, to) => {
    const result = ListShiftsQuerySchema.safeParse({ from: '2026-11-02T00:00:00Z', to });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['to']);
  });
});

describe('ListSwapRequestsQuerySchema.open', () => {
  // z.coerce.boolean would turn the string "false" into true.
  it.each([
    ['true', true],
    ['false', false],
  ])('parses "%s" as %s', (raw, parsed) => {
    expect(ListSwapRequestsQuerySchema.parse({ open: raw }).open).toBe(parsed);
  });

  it('rejects other values', () => {
    expect(ListSwapRequestsQuerySchema.safeParse({ open: 'maybe' }).success).toBe(false);
  });
});
