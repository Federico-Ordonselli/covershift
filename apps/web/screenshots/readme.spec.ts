import { resolve } from 'node:path';
import { type Page } from '@playwright/test';
import {
  dayHeading,
  expect,
  hoursAfter,
  LAKESIDE,
  localDate,
  localTime,
  openOrg,
  orgPath,
  seedDay,
  test,
  ZONE,
} from '../e2e/fixtures';

const OUT = resolve(import.meta.dirname, '../../../docs/screenshots');
const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false, animations: 'disabled' });

/**
 * Real flows, real data: the seeded demo organization plus one direct offer made through
 * the UI, so every screen has something to show. Dates follow the seed (relative to
 * "tomorrow"), so a refresh shows the current week.
 */
test('README screenshots', async ({ page, as }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in to Covershift' })).toBeVisible();
  await shot(page, 'login');

  const start = hoursAfter(seedDay(1), 14);
  const week = `week=${localDate(start, ZONE)}`;

  const manager = await as('manager@covershift.test');
  await openOrg(manager, LAKESIDE);
  const org = orgPath(manager);
  await manager.goto(`${org}/schedule?${week}`);
  await expect(manager.getByRole('region', { name: dayHeading(start) })).toBeVisible();
  await shot(manager, 'schedule');

  const sam = await as('sam@covershift.test');
  await sam.goto(`${org}/schedule?${week}&view=mine`);
  await sam
    .getByRole('button', {
      name: `Offer swap: Gate screening, ${dayHeading(start)} ${localTime(start, ZONE)}`,
    })
    .click();
  const dialog = sam.getByRole('dialog', { name: 'Offer your shift' });
  await dialog.getByLabel('Offer to').selectOption({ label: 'Alex Moreau' });
  await dialog.getByLabel('Note (optional)').fill('School play that afternoon, thank you!');
  await dialog.getByRole('button', { name: 'Send offer' }).click();
  await expect(sam.getByText('Your offer was sent.')).toBeVisible();

  const alex = await as('alex@covershift.test');
  await alex.goto(`${org}/swaps/incoming`);
  const card = alex.getByRole('listitem').filter({ hasText: 'School play' });
  await expect(card).toBeVisible();
  await shot(alex, 'swaps');
  await card.getByRole('button', { name: 'Accept' }).click();
  await expect(alex.getByText('Accepted. A manager still has to approve the swap.')).toBeVisible();

  await manager.goto(`${org}/inbox`);
  await expect(manager.getByRole('listitem').filter({ hasText: 'School play' })).toBeVisible();
  await shot(manager, 'approvals');
});
