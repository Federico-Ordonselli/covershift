import { MeSchema, ShiftPageSchema } from '@covershift/shared';
import { screen, within } from '@testing-library/react';
import { http } from 'msw';
import { describe, expect, it } from 'vitest';
import { ids, me, shift } from '../../../test/msw/fixtures';
import { orgHandlers } from '../../../test/msw/handlers';
import { ok, problem } from '../../../test/msw/respond';
import { API, server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render';
import { WEEK_MAX_PAGES } from './useWeekShifts';

const week = `/orgs/${ids.org}/schedule?week=2026-10-12`;

describe('SchedulePage', () => {
  it('shows each shift under its local day with time, position and assignee', async () => {
    const { handlers, shiftRequests } = orgHandlers({
      shifts: [
        shift({ startsAt: '2026-10-13T04:00:00Z', endsAt: '2026-10-13T12:00:00Z' }),
        // 22:30 UTC Tuesday is 00:30 Wednesday in Rome.
        shift({
          startsAt: '2026-10-13T22:30:00Z',
          endsAt: '2026-10-14T06:30:00Z',
          assignedUserId: ids.me,
        }),
        shift({
          startsAt: '2026-10-15T12:00:00Z',
          endsAt: '2026-10-15T20:00:00Z',
          assignedUserId: null,
        }),
      ],
    });
    server.use(...handlers);
    renderApp(week);

    const tuesday = await screen.findByRole('region', { name: 'Tue 13 Oct' });
    expect(within(tuesday).getByText('06:00–14:00')).toBeInTheDocument();
    expect(within(tuesday).getByText('Gate screening')).toBeInTheDocument();
    expect(within(tuesday).getByText('Alex Moreau')).toBeInTheDocument();

    const wednesday = screen.getByRole('region', { name: 'Wed 14 Oct' });
    expect(within(wednesday).getByText('00:30–08:30')).toBeInTheDocument();
    expect(within(wednesday).getByText('(you)')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Thu 15 Oct' })).getByText('Unassigned'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Mon 12 Oct' })).getByText('No shifts'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Times shown in Europe\/Rome/)).toBeInTheDocument();

    // The window is the local week, Monday to Monday.
    const params = shiftRequests[0]!.searchParams;
    expect(params.get('from')).toBe('2026-10-12T00:00:00.000+02:00');
    expect(params.get('to')).toBe('2026-10-19T00:00:00.000+02:00');
    expect(params.get('organizationId')).toBe(ids.org);
    expect(params.get('assignedUserId')).toBeNull();
  });

  it('"My shifts" asks the API for my shifts only', async () => {
    const { handlers, shiftRequests } = orgHandlers();
    server.use(...handlers);
    renderApp(`${week}&view=mine`);
    expect(await screen.findByRole('link', { name: 'My shifts' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await screen.findAllByText('No shifts');
    expect(shiftRequests[0]!.searchParams.get('assignedUserId')).toBe(ids.me);
  });

  it('follows nextCursor until the end', async () => {
    server.use(...orgHandlers().handlers);
    let calls = 0;
    server.use(
      http.get(`${API}/shifts`, ({ request }) => {
        calls += 1;
        const cursor = new URL(request.url).searchParams.get('cursor');
        return cursor
          ? ok(ShiftPageSchema, {
              items: [shift({ startsAt: '2026-10-14T06:00:00Z', endsAt: '2026-10-14T10:00:00Z' })],
              nextCursor: null,
            })
          : ok(ShiftPageSchema, { items: [shift()], nextCursor: 'page-2' });
      }),
    );
    renderApp(week);
    await screen.findByRole('region', { name: 'Tue 13 Oct' });
    expect(await screen.findAllByText('Gate screening')).toHaveLength(2);
    expect(calls).toBe(2);
    expect(screen.queryByText('Not all shifts are shown')).not.toBeInTheDocument();
  });

  it('hitting the safety cap shows a visible warning, never a silent cut', async () => {
    server.use(...orgHandlers().handlers);
    let calls = 0;
    server.use(
      http.get(`${API}/shifts`, () => {
        calls += 1;
        return ok(ShiftPageSchema, { items: [shift()], nextCursor: `page-${calls + 1}` });
      }),
    );
    renderApp(week);
    const warning = await screen.findByText('Not all shifts are shown');
    expect(warning.closest('[role="status"]')).toHaveTextContent(/only the first 1000 are listed/);
    expect(calls).toBe(WEEK_MAX_PAGES);
  });

  it('an unknown org time zone falls back to UTC, visibly', async () => {
    const memberships = me().memberships.map((m) => ({ ...m, timezone: 'Mars/Olympus_Mons' }));
    server.use(...orgHandlers().handlers);
    server.use(http.get(`${API}/me`, () => ok(MeSchema, me({ memberships }))));
    renderApp(week);
    expect(await screen.findByText('Unknown time zone')).toBeInTheDocument();
    expect(screen.getByText(/Times shown in UTC/)).toBeInTheDocument();
  });

  it('an API error is shown with its mapped message and a retry for 5xx', async () => {
    server.use(...orgHandlers().handlers);
    server.use(
      http.get(`${API}/shifts`, () => problem(500, 'INTERNAL_ERROR', 'Internal server error')),
    );
    renderApp(week);
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong on our side');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
