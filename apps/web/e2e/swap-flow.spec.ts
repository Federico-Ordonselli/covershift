import {
  dayHeading,
  expect,
  expectAccessible,
  hoursAfter,
  LAKESIDE,
  localDate,
  localTime,
  openOrg,
  orgPath,
  seedDay,
  test,
  ZONE,
} from './fixtures';

/**
 * A direct swap from offer to approval, three real users in three browser contexts.
 * Sam's afternoon gate screening on the seed's second day (14:00–22:00 UTC) goes to Alex,
 * who holds X-ray + pat-down and has no shift that afternoon.
 */
test('offer → accept → approve: the shift ends up assigned to the colleague', async ({ as }) => {
  const start = hoursAfter(seedDay(1), 14);
  const end = hoursAfter(seedDay(1), 22);
  const time = `${localTime(start, ZONE)}–${localTime(end, ZONE)}`;
  const week = `week=${localDate(start, ZONE)}`;

  // Sam offers the shift to Alex from the schedule.
  const sam = await as('sam@covershift.test');
  const org = orgPath(sam);
  await sam.goto(`${org}/schedule?${week}&view=mine`);
  await sam
    .getByRole('button', {
      name: `Offer swap: Gate screening, ${dayHeading(start)} ${localTime(start, ZONE)}`,
    })
    .click();
  const dialog = sam.getByRole('dialog', { name: 'Offer your shift' });
  await dialog.getByLabel('Offer to').selectOption({ label: 'Alex Moreau' });
  await dialog.getByLabel('Note (optional)').fill('Childcare clash, thanks!');
  await expectAccessible(sam);
  await dialog.getByRole('button', { name: 'Send offer' }).click();
  await expect(sam.getByText('Your offer was sent.')).toBeVisible();
  await expect(dialog).toBeHidden();

  await sam.getByRole('link', { name: 'My requests' }).click();
  const samCard = sam.getByRole('listitem').filter({ hasText: 'Childcare clash' });
  await expect(samCard).toContainText('Waiting for a reply');
  await expect(samCard).toContainText(time);

  // Alex accepts it.
  const alex = await as('alex@covershift.test');
  await alex.goto(`${org}/swaps/incoming`);
  const alexCard = alex.getByRole('listitem').filter({ hasText: 'Childcare clash' });
  await expect(alexCard).toContainText('Sam Carter');
  await expectAccessible(alex);
  await alexCard.getByRole('button', { name: 'Accept' }).click();
  await expect(alex.getByText('Accepted. A manager still has to approve the swap.')).toBeVisible();
  await expect(alexCard).toBeHidden(); // no longer a pending offer to Alex

  await sam.reload();
  await expect(samCard).toContainText('Waiting for manager approval');

  // The manager approves it.
  const manager = await as('manager@covershift.test');
  await openOrg(manager, LAKESIDE);
  await manager.getByRole('link', { name: 'Approvals' }).click();
  await expect(manager.getByRole('heading', { name: 'Approvals' })).toBeVisible();
  const managerCard = manager.getByRole('listitem').filter({ hasText: 'Childcare clash' });
  await expect(managerCard).toContainText('Sam Carter');
  await expect(managerCard).toContainText('Alex Moreau');
  await expectAccessible(manager);
  await managerCard.getByRole('button', { name: 'Approve' }).click();
  await expect(manager.getByText('Approved. The shift has been reassigned.')).toBeVisible();
  await expect(managerCard).toBeHidden();

  // The schedule shows the result for everyone.
  await manager.goto(`${org}/schedule?${week}`);
  const shift = manager
    .getByRole('region', { name: dayHeading(start) })
    .getByRole('listitem')
    .filter({ hasText: time })
    .filter({ hasText: 'Gate screening' });
  await expect(shift).toContainText('Alex Moreau');

  await alex.goto(`${org}/schedule?${week}&view=mine`);
  await expect(
    alex
      .getByRole('region', { name: dayHeading(start) })
      .getByRole('listitem')
      .filter({ hasText: time }),
  ).toContainText('(you)');

  await sam.goto(`${org}/swaps/mine`);
  await expect(sam.getByRole('listitem').filter({ hasText: 'Childcare clash' })).toContainText(
    'Approved',
  );
});
