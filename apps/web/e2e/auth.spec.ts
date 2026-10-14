import { expect, expectAccessible, signIn, test } from './fixtures';

test.describe('authentication', () => {
  test('a protected page sends you to login, and back after signing in', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login\?returnTo=%2F$/);
    await expect(page.getByRole('heading', { name: 'Sign in to Covershift' })).toBeFocused();
    await expectAccessible(page);

    await signIn(page, 'sam@covershift.test', 'not-the-password');
    await expect(page.getByRole('alert')).toHaveText('Wrong email or password.');

    await signIn(page, 'sam@covershift.test');
    await expect(page).toHaveURL(/\/orgs\/[0-9a-f-]+\/schedule$/);
    await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
  });

  test('the session survives a reload; sign out ends it everywhere in the tab', async ({
    page,
  }) => {
    await page.goto('/login');
    await signIn(page, 'sam@covershift.test');
    await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
    const schedule = page.url();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
    await expect(page).toHaveURL(schedule);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    expect(await page.evaluate(() => localStorage.getItem('covershift-auth'))).toBeNull();

    // Both redirects replace history, so "back" has nowhere to go; revisiting is the test.
    await page.goto(schedule);
    await expect(page).toHaveURL(/\/login\?returnTo=/);
  });

  test('a session the server no longer accepts: back to login, told why', async ({ page }) => {
    await page.goto('/login');
    await signIn(page, 'sam@covershift.test');
    await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();

    // Corrupt both tokens but keep expires_at in the future: supabase-js trusts the stored
    // session, the API answers 401, and refreshing with a dead refresh token fails.
    await page.evaluate(() => {
      const session = JSON.parse(localStorage.getItem('covershift-auth')!);
      session.access_token = 'not.a.jwt';
      session.refresh_token = 'dead-refresh-token';
      localStorage.setItem('covershift-auth', JSON.stringify(session));
    });
    await page.reload();
    await expect(page).toHaveURL(/\/login\?.*reason=expired/);
    await expect(page.getByText('Your session has expired')).toBeVisible();
  });

  test('returnTo cannot send you to another site after login', async ({ page }) => {
    for (const evil of ['https://evil.example/', '//evil.example', '/.//evil.example']) {
      await page.goto(`/login?returnTo=${encodeURIComponent(evil)}`);
      await signIn(page, 'sam@covershift.test');
      await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
      expect(new URL(page.url()).origin).toBe('http://127.0.0.1:4173');
      await page.getByRole('button', { name: 'Sign out' }).click();
      await expect(page).toHaveURL(/\/login/);
    }
  });
});
