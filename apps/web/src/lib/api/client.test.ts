import { MeSchema } from '@covershift/shared';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { me } from '../../../test/msw/fixtures';
import { ok, problem } from '../../../test/msw/respond';
import { API, server } from '../../../test/msw/server';
import { createApiClient, type TokenSource } from './client';
import { ApiError, ContractError, NetworkError } from './errors';

/** A token source whose refresh is controllable: it resolves when the test says so. */
function tokens(initial: string | null) {
  let token = initial;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const refresh = vi.fn(async () => {
    await gate;
    token = 'fresh';
    return token;
  });
  const source: TokenSource = { current: async () => token, refresh };
  return { source, refresh, release, set: (t: string) => (token = t) };
}

/** /me accepts only the "fresh" token; records the token of every request it sees. */
function meRequiringFreshToken() {
  const seen: string[] = [];
  server.use(
    http.get(`${API}/me`, ({ request }) => {
      const auth = request.headers.get('authorization') ?? '';
      seen.push(auth);
      return auth === 'Bearer fresh'
        ? ok(MeSchema, me())
        : problem(401, 'UNAUTHORIZED', 'invalid token');
    }),
  );
  return seen;
}

describe('API client: 401 recovery', () => {
  it('concurrent 401s share ONE refresh, then all retry with the new token', async () => {
    const t = tokens('expired');
    const seen = meRequiringFreshToken();
    const onUnauthorized = vi.fn();
    const api = createApiClient({ tokens: t.source, onUnauthorized, baseUrl: API });

    const calls = Promise.all([1, 2, 3, 4, 5].map(() => api.request('/me', { schema: MeSchema })));
    await vi.waitFor(() => expect(seen).toHaveLength(5)); // all five hit 401 with the old token
    t.release();

    const results = await calls;
    expect(t.refresh).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.id === me().id)).toBe(true);
    expect(seen.filter((s) => s === 'Bearer fresh')).toHaveLength(5);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('a 401 for a token that was already replaced retries without refreshing again', async () => {
    const t = tokens('expired');
    const seen = meRequiringFreshToken();
    const api = createApiClient({ tokens: t.source, onUnauthorized: vi.fn(), baseUrl: API });
    // The request goes out with "expired"; by the time its 401 lands, another refresh
    // has already produced "fresh".
    server.use(
      http.get(`${API}/me`, ({ request }) => {
        seen.push(request.headers.get('authorization') ?? '');
        if (request.headers.get('authorization') === 'Bearer fresh') return ok(MeSchema, me());
        t.set('fresh');
        return problem(401, 'UNAUTHORIZED', 'invalid token');
      }),
    );
    await expect(api.request('/me', { schema: MeSchema })).resolves.toMatchObject({ id: me().id });
    expect(t.refresh).not.toHaveBeenCalled();
    expect(seen).toEqual(['Bearer expired', 'Bearer fresh']);
  });

  it('a failed refresh signs out once and surfaces the 401', async () => {
    meRequiringFreshToken();
    const onUnauthorized = vi.fn();
    const source: TokenSource = {
      current: async () => 'expired',
      refresh: vi.fn(async () => null),
    };
    const api = createApiClient({ tokens: source, onUnauthorized, baseUrl: API });
    const err = await api.request('/me', { schema: MeSchema }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('a 401 after a successful refresh is final (no loop)', async () => {
    let hits = 0;
    server.use(
      http.get(`${API}/me`, () => {
        hits += 1;
        return problem(401, 'UNAUTHORIZED', 'invalid token');
      }),
    );
    const onUnauthorized = vi.fn();
    const source: TokenSource = { current: async () => 'a', refresh: vi.fn(async () => 'b') };
    const api = createApiClient({ tokens: source, onUnauthorized, baseUrl: API });
    await expect(api.request('/me', { schema: MeSchema })).rejects.toMatchObject({ status: 401 });
    expect(hits).toBe(2);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('no session at all: no request, signs out', async () => {
    const onUnauthorized = vi.fn();
    const source: TokenSource = { current: async () => null, refresh: vi.fn() };
    const api = createApiClient({ tokens: source, onUnauthorized, baseUrl: API });
    await expect(api.request('/me', { schema: MeSchema })).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});

describe('API client: responses', () => {
  const api = () =>
    createApiClient({
      tokens: { current: async () => 't', refresh: async () => 't' },
      onUnauthorized: vi.fn(),
      baseUrl: API,
    });

  it('problem responses become ApiError with code, detail and errors', async () => {
    server.use(
      http.get(`${API}/me`, () =>
        problem(400, 'VALIDATION_FAILED', 'Request validation failed', [
          { path: 'id', message: 'Invalid UUID' },
        ]),
      ),
    );
    await expect(api().request('/me', { schema: MeSchema })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      errors: [{ path: 'id', message: 'Invalid UUID' }],
    });
  });

  it('a non-envelope error body becomes UNKNOWN_RESPONSE, not a crash', async () => {
    server.use(
      http.get(`${API}/me`, () => new HttpResponse('<html>Bad gateway</html>', { status: 502 })),
    );
    await expect(api().request('/me', { schema: MeSchema })).rejects.toMatchObject({
      status: 502,
      code: 'UNKNOWN_RESPONSE',
    });
  });

  it('a 2xx body that breaks the contract is a ContractError', async () => {
    server.use(http.get(`${API}/me`, () => HttpResponse.json({ id: 'not-a-uuid' })));
    await expect(api().request('/me', { schema: MeSchema })).rejects.toBeInstanceOf(ContractError);
  });

  it('a network failure is a NetworkError', async () => {
    server.use(http.get(`${API}/me`, () => HttpResponse.error()));
    await expect(api().request('/me', { schema: MeSchema })).rejects.toBeInstanceOf(NetworkError);
  });

  it('sends the bearer token and drops undefined query params', async () => {
    let url = '';
    let auth = '';
    server.use(
      http.get(`${API}/shifts`, ({ request }) => {
        url = request.url;
        auth = request.headers.get('authorization') ?? '';
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );
    await api().request('/shifts', { query: { limit: 5, cursor: undefined, organizationId: 'x' } });
    expect(new URL(url).search).toBe('?limit=5&organizationId=x');
    expect(auth).toBe('Bearer t');
  });
});
