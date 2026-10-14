/**
 * Where to go after login. Only same-origin paths are honoured: `?returnTo=` is user
 * input, and an absolute or protocol-relative URL here would be an open redirect.
 */
export function safeReturnTo(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  try {
    const url = new URL(raw, 'http://placeholder.invalid');
    if (url.origin !== 'http://placeholder.invalid') return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}
