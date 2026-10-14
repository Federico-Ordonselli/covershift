import {
  type Me,
  MeSchema,
  type Member,
  MemberSchema,
  type Position,
  PositionSchema,
  type Shift,
  ShiftSchema,
} from '@covershift/shared';

/** Fixture builders: each result is parsed with the shared schema (no drifted mocks). */
export const ids = {
  org: '11111111-1111-4111-8111-111111111111',
  otherOrg: '22222222-2222-4222-8222-222222222222',
  me: '33333333-3333-4333-8333-333333333333',
  alex: '44444444-4444-4444-8444-444444444444',
  gate: '55555555-5555-4555-8555-555555555555',
};

export function me(overrides: Partial<Me> = {}): Me {
  return MeSchema.parse({
    id: ids.me,
    email: 'sam@covershift.test',
    fullName: 'Sam Carter',
    memberships: [
      {
        id: ids.org,
        name: 'Lakeside Security',
        slug: 'lakeside',
        timezone: 'Europe/Rome',
        role: 'staff',
      },
      { id: ids.otherOrg, name: 'Harbour Ops', slug: 'harbour', timezone: 'UTC', role: 'manager' },
    ],
    ...overrides,
  });
}

export function position(overrides: Partial<Position> = {}): Position {
  return PositionSchema.parse({
    id: ids.gate,
    organizationId: ids.org,
    name: 'Gate screening',
    ...overrides,
  });
}

export function member(overrides: Partial<Member> = {}): Member {
  return MemberSchema.parse({
    userId: ids.alex,
    fullName: 'Alex Moreau',
    role: 'staff',
    memberSince: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });
}

let n = 0;
export function shift(overrides: Partial<Shift> = {}): Shift {
  n += 1;
  return ShiftSchema.parse({
    id: `66666666-6666-4666-8666-${String(n).padStart(12, '0')}`,
    organizationId: ids.org,
    positionId: ids.gate,
    startsAt: '2026-10-13T04:00:00.000Z',
    endsAt: '2026-10-13T12:00:00.000Z',
    assignedUserId: ids.alex,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  });
}
