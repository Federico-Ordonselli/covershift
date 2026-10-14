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
    // Normalization bypasses (security review): dot segments and encoded dots resolve
    // to a protocol-relative "//evil.example" after parsing.
    '/.//evil.example',
    '/x/..//evil.example',
    '/%2e//evil.example',
    '/./\\evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
  ])('falls back to / for %j', (raw) => {
    expect(safeReturnTo(raw)).toBe('/');
  });
});
