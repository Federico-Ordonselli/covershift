/**
 * Response security headers for the web app, including the Content-Security-Policy.
 * `vite preview` serves them (so every Playwright run executes under them) and phase 4's
 * hosting reuses this module, so the policy has one source of truth.
 *
 * The build has no inline scripts or styles, so neither 'unsafe-inline' nor 'unsafe-eval'
 * is allowed anywhere. The browser talks to exactly two origins: itself (the app and the
 * API, proxied under /api) and Supabase Auth.
 */
export function contentSecurityPolicy(supabaseUrl: string): string {
  const supabaseOrigin = new URL(supabaseUrl).origin;
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${supabaseOrigin}`,
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ');
}

export function securityHeaders(supabaseUrl: string): Record<string, string> {
  return {
    'Content-Security-Policy': contentSecurityPolicy(supabaseUrl),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  };
}
