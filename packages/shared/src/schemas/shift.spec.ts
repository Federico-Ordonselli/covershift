import { describe, expect, it } from 'vitest';
import { CreateShiftSchema, UpdateShiftSchema } from './shift.js';

const base = {
  organizationId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  positionId: '9b2f3c1e-5d4a-4f6b-8c7d-0e1f2a3b4c5d',
  startsAt: '2026-11-01T06:00:00Z',
  endsAt: '2026-11-01T14:00:00Z',
};

describe('CreateShiftSchema', () => {
  it('defaults assignedUserId to null', () => {
    expect(CreateShiftSchema.parse(base).assignedUserId).toBeNull();
  });

  it('rejects a shift that ends before it starts', () => {
    const result = CreateShiftSchema.safeParse({ ...base, endsAt: '2026-11-01T05:00:00Z' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['endsAt']);
  });

  it('rejects timestamps without an offset', () => {
    expect(CreateShiftSchema.safeParse({ ...base, startsAt: '2026-11-01T06:00:00' }).success).toBe(
      false,
    );
  });
});

describe('UpdateShiftSchema', () => {
  it('rejects an empty patch', () => {
    expect(UpdateShiftSchema.safeParse({}).success).toBe(false);
  });

  it('only checks ordering when both bounds are present', () => {
    expect(UpdateShiftSchema.safeParse({ endsAt: '2026-11-01T05:00:00Z' }).success).toBe(true);
  });
});
