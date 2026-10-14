const BASE = 'http://placeholder.invalid';

/**
 * Where to go after login. Only same-origin paths are honoured: `?returnTo=` is user
 * input, and an absolute or protocol-relative URL here would be an open redirect.
 *
 * The check runs on the NORMALIZED result, not the input: URL parsing resolves dot
 * segments, so `/.//evil.example` becomes `//evil.example`, which a browser treats as
 * another origin. Anything whose normalized path doesn't start with exactly one `/`
 * falls back to `/`.
 */
export function safeReturnTo(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/')) return '/';
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return '/';
  }
  const result = `${url.pathname}${url.search}${url.hash}`;
  const sameOrigin = url.origin === BASE;
  const singleLeadingSlash = /^\/(?![/\\])/.test(result);
  // Re-parse the output too: it must resolve to the same origin on its own.
  const stable = sameOrigin && singleLeadingSlash && new URL(result, BASE).origin === BASE;
  return stable ? result : '/';
}
