import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test as base } from '@playwright/test';

export const PASSWORD = process.env.SEED_PASSWORD ?? 'covershift-demo';

export interface CspViolation {
  directive: string;
  blocked: string;
  source: string;
}

/**
 * Every test runs under the real CSP and fails on any violation it didn't expect.
 * Violations are reported through an exposed binding (survives navigations) from a
 * listener installed before any page script, plus the console as a backstop.
 */
export const test = base.extend<{
  csp: { violations: CspViolation[]; expectViolations: () => void };
}>({
  csp: [
    async ({ page }, use) => {
      const violations: CspViolation[] = [];
      let expected = false;
      await page.exposeBinding('__reportCspViolation', (_source, v: CspViolation) => {
        violations.push(v);
      });
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (e) => {
          (
            window as unknown as { __reportCspViolation: (v: unknown) => void }
          ).__reportCspViolation({
            directive: e.effectiveDirective,
            blocked: e.blockedURI,
            source: `${e.sourceFile}:${e.lineNumber}`,
          });
        });
      });
      page.on('console', (msg) => {
        if (msg.type() === 'error' && msg.text().includes('Content Security Policy')) {
          violations.push({ directive: 'console', blocked: msg.text(), source: 'console' });
        }
      });
      await use({ violations, expectViolations: () => (expected = true) });
      if (!expected) expect(violations, 'CSP violations').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** WCAG 2.1 A/AA checks on the current page; any violation fails the test. */
export async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.map(
      (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
    ),
  ).toEqual([]);
}

export async function signIn(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** The yyyy-MM-dd of `date` in `timeZone`. */
export function localDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** HH:mm of `iso` in `timeZone`. */
export function localTime(iso: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

export const LAKESIDE = 'Lakeside International Airport: Security';

/** Selects an organization through the switcher (the first one by name is the default). */
export async function openOrg(page: Page, name: string): Promise<string> {
  const select = page.getByLabel('Organization');
  if ((await select.locator('option:checked').textContent()) !== name) {
    await select.selectOption({ label: name });
  }
  await expect(page.getByLabel('Organization').locator('option:checked')).toHaveText(name);
  return new URL(page.url()).pathname.split('/')[2]!;
}
