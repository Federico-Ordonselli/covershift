import { describe, expect, it } from 'vitest';
import { safeReturnTo } from './returnTo';

describe('safeReturnTo (open-redirect guard)', () => {
  it.each([
    ['/orgs/x/schedule?week=2026-10-12', '/orgs/x/schedule?week=2026-10-12'],
    ['/', '/'],
  ])('keeps same-origin path %s', (raw, expected) => {
    expect(safeReturnTo(raw)).toBe(expected);
  });

  it.each([
    null,
    '',
    'https://evil.example/phish',
    '//evil.example/phish',
    '/\\evil.example',
    'javascript:alert(1)',
    'orgs/x',
  ])('falls back to / for %s', (raw) => {
    expect(safeReturnTo(raw)).toBe('/');
  });
});
