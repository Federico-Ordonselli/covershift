import { TZDate } from '@date-fns/tz';
import { addDays, format, startOfWeek } from 'date-fns';

export interface Week {
  /** Monday 00:00 in the org's zone. */
  start: TZDate;
  /** The following Monday 00:00 (exclusive), so DST weeks are 167 or 169 hours. */
  end: TZDate;
  days: TZDate[];
  /** yyyy-MM-dd of the Monday, as used in ?week= */
  key: string;
}

const KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The Monday-to-Monday week containing `instant`, in `timeZone`. */
export function weekContaining(instant: Date, timeZone: string): Week {
  const start = startOfWeek(new TZDate(instant, timeZone), { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return { start, end: addDays(start, 7), days, key: format(start, 'yyyy-MM-dd') };
}

/** ?week=yyyy-MM-dd (any day of the week); anything else falls back to the current week. */
export function weekFromKey(key: string | null, timeZone: string, now = new Date()): Week {
  const m = key ? KEY.exec(key) : null;
  if (m) {
    const day = new TZDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, timeZone);
    if (!Number.isNaN(day.getTime()) && format(day, 'yyyy-MM-dd') === key) {
      return weekContaining(day, timeZone);
    }
  }
  return weekContaining(now, timeZone);
}

export function shiftWeeks(week: Week, delta: number, timeZone: string): Week {
  return weekContaining(addDays(week.start, 7 * delta + 1), timeZone);
}

/** The calendar day (yyyy-MM-dd) an instant falls on in `timeZone`. */
export function dayKey(iso: string, timeZone: string): string {
  return format(new TZDate(iso, timeZone), 'yyyy-MM-dd');
}

export function formatTime(iso: string, timeZone: string): string {
  return format(new TZDate(iso, timeZone), 'HH:mm');
}

export function formatDay(day: Date): string {
  return format(day, 'EEE d MMM');
}

export function formatRange(week: Week): string {
  return `${format(week.start, 'd MMM')} – ${format(addDays(week.start, 6), 'd MMM yyyy')}`;
}
