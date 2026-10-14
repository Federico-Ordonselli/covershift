const KEY = 'covershift:lastOrg';

/** Only used to pick the org for "/"; the URL is the source of truth everywhere else. */
export function rememberLastOrg(orgId: string): void {
  try {
    localStorage.setItem(KEY, orgId);
  } catch {
    // Storage can be unavailable (private mode, quota); it's only a convenience.
  }
}

export function lastOrg(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
