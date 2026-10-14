import AxeBuilder from '@axe-core/playwright';
import { type BrowserContext, expect, type Page, test as base } from '@playwright/test';

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
/**
 * Records CSP violations on a page: a listener installed before any page script reports
 * through an exposed binding (survives navigations), with the console as a backstop.
 */
async function guardCsp(page: Page): Promise<CspViolation[]> {
  const violations: CspViolation[] = [];
  await page.exposeBinding('__reportCspViolation', (_source, v: CspViolation) => {
    violations.push(v);
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { __reportCspViolation: (v: unknown) => void }).__reportCspViolation({
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
  return violations;
}

/**
 * Every test runs under the real CSP and fails on any violation it didn't expect, on the
 * default page and on every extra user page opened with `as(email)`.
 */
export const test = base.extend<{
  csp: { violations: CspViolation[]; expectViolations: () => void };
  as: (email: string) => Promise<Page>;
}>({
  csp: [
    async ({ page }, use) => {
      const violations = await guardCsp(page);
      let expected = false;
      await use({ violations, expectViolations: () => (expected = true) });
      if (!expected) expect(violations, 'CSP violations').toEqual([]);
    },
    { auto: true },
  ],
  /** A separate, signed-in browser context per user (several people in one test). */
  as: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    const violations: CspViolation[] = [];
    await use(async (email) => {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      const recorded = await guardCsp(page);
      page.on('close', () => violations.push(...recorded));
      await page.goto('/login');
      await signIn(page, email);
      await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
      return page;
    });
    for (const context of contexts) await context.close();
    expect(violations, 'CSP violations (extra users)').toEqual([]);
  },
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

export const ZONE = 'Europe/Rome';
const DAY = 24 * 60 * 60 * 1000;

/** Day `offset` of the seed's week (day 0 = tomorrow, UTC midnight; see seed-data.ts). */
export function seedDay(offset = 0): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + DAY * (1 + offset),
  );
}

export function hoursAfter(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3_600_000);
}

/** The schedule's day heading for `date` in the org zone, e.g. "Thu 15 Oct". */
export function dayHeading(date: Date, timeZone = ZONE): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', day: 'numeric', month: 'short' })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.weekday} ${parts.day} ${parts.month}`;
}

/** /orgs/:orgId of the page's current URL. */
export function orgPath(page: Page): string {
  return new URL(page.url()).pathname.split('/').slice(0, 3).join('/');
}
