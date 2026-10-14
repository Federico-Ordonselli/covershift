import { describe, expect, it } from 'vitest';
import { dayKey, formatTime, shiftWeeks, weekContaining, weekFromKey } from './week';

describe('weeks in the organization’s time zone', () => {
  it('starts on Monday 00:00 local time, whatever the UTC instant', () => {
    // Sunday 23:30 UTC is already Monday in Rome.
    const week = weekContaining(new Date('2026-10-11T23:30:00Z'), 'Europe/Rome');
    expect(week.key).toBe('2026-10-12');
    expect(week.start.toISOString()).toBe('2026-10-12T00:00:00.000+02:00');
  });

  it('the week DST ends in is 169 hours long; the next one is 168 (Rome, 25 Oct 2026)', () => {
    const hours = (key: string) => {
      const week = weekFromKey(key, 'Europe/Rome');
      return (week.end.getTime() - week.start.getTime()) / 3_600_000;
    };
    expect(hours('2026-10-19')).toBe(169);
    expect(hours('2026-10-26')).toBe(168);
  });

  it('any day of the week selects its week; garbage falls back to the current one', () => {
    expect(weekFromKey('2026-10-15', 'UTC').key).toBe('2026-10-12');
    const now = new Date('2026-10-14T10:00:00Z');
    expect(weekFromKey('2026-02-30', 'UTC', now).key).toBe('2026-10-12');
    expect(weekFromKey('next week', 'UTC', now).key).toBe('2026-10-12');
  });

  it('moves by whole weeks across DST', () => {
    const week = weekFromKey('2026-10-19', 'Europe/Rome');
    expect(shiftWeeks(week, 1, 'Europe/Rome').key).toBe('2026-10-26');
    expect(shiftWeeks(week, -1, 'Europe/Rome').key).toBe('2026-10-12');
  });

  it('formats times and days in the zone', () => {
    expect(formatTime('2026-10-13T04:00:00Z', 'Europe/Rome')).toBe('06:00');
    expect(dayKey('2026-10-13T22:30:00Z', 'Europe/Rome')).toBe('2026-10-14');
  });
});
