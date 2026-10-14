import { type z } from 'zod';
import { ApiError, ContractError, NetworkError } from './errors';

export interface TokenSource {
  /** The current access token (refreshed first if it's about to expire), or null. */
  current(): Promise<string | null>;
  /** Forces a refresh; resolves to the new access token, or null if the session is gone. */
  refresh(): Promise<string | null>;
}

export interface ApiClientOptions {
  tokens: TokenSource;
  /** Called once the session can't be recovered (refresh failed or no session at all). */
  onUnauthorized: () => void;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export type Query = Record<string, string | number | boolean | undefined>;

export interface RequestOptions<S extends z.ZodType> {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  query?: Query;
  body?: unknown;
  /** Response contract; omit only for 204 responses. */
  schema?: S;
}

/**
 * Fetch wrapper for the NestJS API: bearer token, problem-details errors, response
 * validation against the shared zod contracts, and one recovery attempt on 401.
 *
 * Refresh is single-flight: concurrent 401s share one refresh() call, so a burst of
 * requests with an expired token never spends the (rotating) refresh token twice.
 */
export function createApiClient(options: ApiClientOptions) {
  const { tokens, onUnauthorized } = options;
  const baseUrl = options.baseUrl ?? '/api';
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  let refreshing: Promise<string | null> | null = null;

  function refreshOnce(): Promise<string | null> {
    refreshing ??= tokens
      .refresh()
      .catch(() => null)
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  async function send(path: string, init: RequestInit, token: string): Promise<Response> {
    try {
      return await doFetch(`${baseUrl}${path}`, {
        ...init,
        headers: { ...init.headers, authorization: `Bearer ${token}` },
      });
    } catch (err) {
      throw new NetworkError(err);
    }
  }

  async function request<S extends z.ZodType>(
    path: string,
    opts: RequestOptions<S> = {},
  ): Promise<z.infer<S>> {
    const url = path + toQueryString(opts.query);
    const init: RequestInit = {
      method: opts.method ?? 'GET',
      headers: opts.body === undefined ? {} : { 'content-type': 'application/json' },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    };

    let token = await tokens.current();
    if (!token) {
      onUnauthorized();
      throw unauthorized('No session');
    }
    let res = await send(url, init, token);

    if (res.status === 401) {
      // If another request already refreshed while this one was in flight, the current
      // token is newer than the one we sent: retry with it instead of refreshing again.
      const latest = await tokens.current();
      token = latest && latest !== token ? latest : await refreshOnce();
      if (!token) {
        onUnauthorized();
        throw await ApiError.from(res);
      }
      res = await send(url, init, token);
      if (res.status === 401) {
        onUnauthorized();
        throw await ApiError.from(res);
      }
    }

    if (!res.ok) throw await ApiError.from(res);
    if (res.status === 204 || !opts.schema) return undefined as z.infer<S>;

    const body: unknown = await res.json().catch(() => undefined);
    const parsed = opts.schema.safeParse(body);
    if (!parsed.success) throw new ContractError(path, parsed.error);
    return parsed.data;
  }

  return { request };
}

export type ApiClient = ReturnType<typeof createApiClient>;

function toQueryString(query: Query | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

function unauthorized(detail: string): ApiError {
  return new ApiError({
    type: 'urn:covershift:error:unauthorized',
    title: 'unauthorized',
    status: 401,
    detail,
    code: 'UNAUTHORIZED',
  });
}
