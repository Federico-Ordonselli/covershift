import { MeSchema } from '@covershift/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { describe, expect, it } from 'vitest';
import { ids, me } from '../../../test/msw/fixtures';
import { orgHandlers } from '../../../test/msw/handlers';
import { ok, problem } from '../../../test/msw/respond';
import { API, server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render';

describe('protected routes and the org layout', () => {
  it('a signed-out visitor is sent to login, remembering where they were going', async () => {
    const { router } = renderApp(`/orgs/${ids.org}/schedule?week=2026-10-12`, { signedIn: false });
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(new URLSearchParams(router.state.location.search).get('returnTo')).toBe(
      `/orgs/${ids.org}/schedule?week=2026-10-12`,
    );
  });

  it('an organization that is not one of my memberships is Not found', async () => {
    server.use(...orgHandlers().handlers);
    renderApp('/orgs/99999999-9999-4999-8999-999999999999/schedule');
    expect(await screen.findByRole('heading', { name: 'Not found' })).toBeInTheDocument();
  });

  it('the switcher lists my organizations and keeps the section', async () => {
    server.use(...orgHandlers().handlers);
    const { router } = renderApp(`/orgs/${ids.org}/schedule`);
    const select = await screen.findByLabelText('Organization');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Lakeside Security', 'Harbour Ops']);
    await userEvent.selectOptions(select, ids.otherOrg);
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/orgs/${ids.otherOrg}/schedule`),
    );
    expect(await screen.findByText(/\(manager\)/)).toBeInTheDocument();
  });

  it('sign out clears cached data and returns to login', async () => {
    server.use(...orgHandlers().handlers);
    const { router, queryClient } = renderApp(`/orgs/${ids.org}/schedule`);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('an API 401 that refresh cannot fix: back to login with "session expired"', async () => {
    server.use(http.get(`${API}/me`, () => problem(401, 'UNAUTHORIZED', 'invalid token')));
    const { router } = renderApp(`/orgs/${ids.org}/schedule`);
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(new URLSearchParams(router.state.location.search).get('reason')).toBe('expired');
    expect(await screen.findByText('Your session has expired')).toBeInTheDocument();
  });

  it('no memberships: an explanation instead of a redirect loop', async () => {
    server.use(http.get(`${API}/me`, () => ok(MeSchema, me({ memberships: [] }))));
    renderApp('/');
    expect(
      await screen.findByRole('heading', { name: 'No organizations yet' }),
    ).toBeInTheDocument();
  });
});
