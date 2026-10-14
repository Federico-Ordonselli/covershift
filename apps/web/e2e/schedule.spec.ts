import { SECOND_ORG } from './db';
import {
  expect,
  expectAccessible,
  LAKESIDE,
  localDate,
  localTime,
  openOrg,
  signIn,
  test,
} from './fixtures';

const ZONE = 'Europe/Rome';
const DAY = 24 * 60 * 60 * 1000;

/** The seed's first shift day: tomorrow, UTC midnight (apps/api/scripts/seed-data.ts). */
function seedDay(offset = 0): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + DAY * (1 + offset),
  );
}

function dayHeading(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `${parts.weekday} ${parts.day} ${parts.month}`;
}

test.describe('schedule', () => {
  test('the week shows seeded shifts with position, assignee and local times', async ({ page }) => {
    await page.goto('/login');
    await signIn(page, 'manager@covershift.test');
    await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
    await openOrg(page, LAKESIDE);

    // Morning gate screening, Alex, 06:00–14:00 UTC on the seed's first day.
    const start = new Date(seedDay().getTime() + 6 * 3_600_000);
    const end = new Date(seedDay().getTime() + 14 * 3_600_000);
    await page.goto(`${new URL(page.url()).pathname}?week=${localDate(start, ZONE)}`);

    const day = page.getByRole('region', { name: dayHeading(start) });
    const item = day
      .getByRole('listitem')
      .filter({ hasText: `${localTime(start, ZONE)}–${localTime(end, ZONE)}` })
      .filter({ hasText: 'Gate screening' });
    await expect(item).toHaveCount(1);
    await expect(item).toContainText('Alex Moreau');
    await expect(page.getByText(`Times shown in ${ZONE}`)).toBeVisible();
    await expectAccessible(page);
  });

  test('"My shifts" lists only the signed-in user’s shifts', async ({ page }) => {
    await page.goto('/login');
    await signIn(page, 'sam@covershift.test');
    await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
    await page.goto(`${new URL(page.url()).pathname}?week=${localDate(seedDay(), ZONE)}&view=mine`);

    await expect(page.getByRole('link', { name: 'My shifts' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const items = page.getByRole('main').getByRole('listitem');
    await expect(items.first()).toBeVisible();
    for (const text of await items.allTextContents()) expect(text).toContain('(you)');
  });

  test('switching organization keeps the section and scopes the data', async ({ page }) => {
    await page.goto('/login');
    await signIn(page, 'manager@covershift.test');
    const lakeside = await openOrg(page, LAKESIDE);
    await expect(page.getByText('(manager)')).toBeVisible();

    await page.getByLabel('Organization').selectOption({ label: SECOND_ORG.name });
    await expect(page).toHaveURL(/\/orgs\/[0-9a-f-]+\/schedule$/);
    expect(new URL(page.url()).pathname.split('/')[2]).not.toBe(lakeside);
    await expect(page.getByText('(staff)')).toBeVisible();
    await expect(page.getByText('No shifts')).toHaveCount(7);
    await expect(page.getByText('Times shown in UTC')).toBeVisible();

    // "/" now lands on the last organization used, not the first by name.
    await openOrg(page, LAKESIDE);
    await page.goto('/');
    await expect(page.getByText('(manager)')).toBeVisible();
    expect(new URL(page.url()).pathname.split('/')[2]).toBe(lakeside);
  });

  test('an organization you are not a member of is Not found', async ({ page }) => {
    await page.goto('/login');
    await signIn(page, 'sam@covershift.test');
    await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
    await page.goto('/orgs/00000000-0000-4000-8000-000000000000/schedule');
    await expect(page.getByRole('heading', { name: 'Not found' })).toBeVisible();
  });
});
