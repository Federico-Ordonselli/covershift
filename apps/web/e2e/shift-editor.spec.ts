import { expect, expectAccessible, LAKESIDE, openOrg, signIn, test } from './fixtures';

test('manager creates and reassigns shifts with eligibility and explicit override', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') throw new Error(message.text());
  });
  await page.goto('/login');
  await signIn(page, 'manager@covershift.test');
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
  const org = await openOrg(page, LAKESIDE);
  await page.goto(`/orgs/${org}/schedule?week=2030-08-05`);
  await page.getByRole('button', { name: 'Create shift', exact: true }).click();
  const editor = page.getByRole('dialog');
  await editor.getByLabel('Position', { exact: true }).selectOption({ label: 'Gate screening' });
  await expect(editor.getByLabel('Assign to')).toBeEnabled();
  await expect(
    editor.getByLabel('Assign to').getByRole('option', { name: 'Maria Rossi', exact: true }),
  ).toHaveCount(1);
  await expect(
    editor.getByLabel('Assign to').getByRole('option', { name: /Luca Bianchi/ }),
  ).toHaveCount(0);
  await editor.getByLabel('Assign to').selectOption({ label: 'Maria Rossi' });
  await expectAccessible(page);
  await editor.getByRole('button', { name: 'Save shift' }).click();
  await expect(page.getByText('Shift saved', { exact: true })).toBeVisible();
  const shift = page.getByRole('listitem').filter({ hasText: 'Gate screening' });
  await expect(shift).toContainText('Maria Rossi');
  await shift.getByRole('button', { name: 'Edit / assign' }).click();
  await editor.getByRole('button', { name: 'Override certifications' }).click();
  await editor.getByLabel('Assign to').selectOption({ label: 'Luca Bianchi — override required' });
  await expect(editor.getByRole('button', { name: 'Save shift' })).toBeDisabled();
  await editor.getByLabel('Override reason').fill('Supervised test assignment');
  await editor.getByRole('button', { name: 'Save shift' }).click();
  await expect(editor).not.toBeVisible();
  await expect(shift).toContainText('Luca Bianchi');
  await expect(shift).toContainText('Supervised test assignment');
  await page.screenshot({ path: '/tmp/covershift-manager.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('normal worker sees qualifications and personal actions without scheduling controls', async ({
  page,
}) => {
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') throw new Error(message.text());
  });
  await page.goto('/login');
  await signIn(page, 'worker@covershift.test');
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create shift', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit / assign' })).toHaveCount(0);
  await page.getByRole('link', { name: 'My qualifications' }).click();
  await expect(page.getByRole('heading', { name: 'My certifications' })).toBeVisible();
  await expect(page.getByText('Explosive trace detection', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Hold baggage screening' }),
  ).toContainText('Qualified');
  await expect(page.getByRole('listitem').filter({ hasText: 'Gate screening' })).toContainText(
    'Certification missing',
  );
  await expectAccessible(page);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '/tmp/covershift-worker-mobile.png', fullPage: true });
  await page.getByRole('link', { name: 'View my shifts and offer a swap' }).click();
  await expect(page.getByRole('link', { name: 'My shifts', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
});
