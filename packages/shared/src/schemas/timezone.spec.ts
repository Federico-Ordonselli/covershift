import { describe, expect, it } from 'vitest';
import { TimeZoneSchema } from './common.js';
import { OrganizationSummarySchema } from './organization.js';

describe('TimeZoneSchema (shape only; existence is checked by the database)', () => {
  it.each([
    'Europe/Rome',
    'America/Argentina/Buenos_Aires',
    'Etc/GMT+3',
    'Etc/GMT-14',
    'UTC',
    'Japan',
    'EST5EDT',
    // Well-formed but unknown: the client must not reject it (see the schema's comment).
    'Mars/Olympus_Mons',
  ])('accepts %s', (zone) => {
    expect(TimeZoneSchema.safeParse(zone).success).toBe(true);
  });

  it.each([
    '',
    ' Europe/Rome',
    'Europe/Rome ',
    '/Europe/Rome',
    'Europe//Rome',
    'Europe/Rome/',
    '../../etc/passwd',
    "Europe/Rome'; drop table x; --",
    '<script>',
    'A'.repeat(65),
  ])('rejects %j', (zone) => {
    expect(TimeZoneSchema.safeParse(zone).success).toBe(false);
  });

  it('is enforced on OrganizationSummary', () => {
    const org = { id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', name: 'x', slug: 'x', role: 'staff' };
    expect(OrganizationSummarySchema.safeParse({ ...org, timezone: 'Europe/Rome' }).success).toBe(
      true,
    );
    expect(OrganizationSummarySchema.safeParse({ ...org, timezone: 'not a zone' }).success).toBe(
      false,
    );
  });
});
