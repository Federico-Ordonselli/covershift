import { MeSchema } from '@covershift/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { describe, expect, it } from 'vitest';
import { ids, me, swap } from '../../../test/msw/fixtures';
import { orgHandlers, swapHandlers } from '../../../test/msw/handlers';
import { ok, problem } from '../../../test/msw/respond';
import { API, server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render';

const asManager = () =>
  me({
    memberships: me().memberships.map((m) =>
      m.id === ids.org ? { ...m, role: 'manager' as const } : m,
    ),
  });

describe('InboxPage (approvals)', () => {
  it('staff deep-linking to /inbox get "Managers only" and no swap data is requested', async () => {
    const { handlers, listRequests } = swapHandlers();
    server.use(...orgHandlers().handlers, ...handlers);
    renderApp(`/orgs/${ids.org}/inbox`);
    expect(await screen.findByRole('heading', { name: 'Managers only' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Approvals' })).not.toBeInTheDocument();
    expect(listRequests).toHaveLength(0);
  });

  it('managers see accepted swaps; approve/reject hidden where they are a participant', async () => {
    const participant = swap({ status: 'accepted', requesterId: ids.me, targetUserId: ids.alex });
    const other = swap({ status: 'accepted', requesterId: ids.alex, targetUserId: ids.jo });
    const { handlers, listRequests } = swapHandlers({ swaps: [participant, other] });
    server.use(...orgHandlers({ meOverrides: asManager() }).handlers, ...handlers);
    renderApp(`/orgs/${ids.org}/inbox`);

    const cards = await screen.findAllByRole('listitem');
    expect(within(cards[0]!).queryByRole('button')).not.toBeInTheDocument();
    expect(within(cards[0]!).getByText(/another manager has to decide/)).toBeInTheDocument();
    expect(within(cards[1]!).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(within(cards[1]!).getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    expect(listRequests[0]!.get('status')).toBe('accepted');
    expect(screen.getByRole('link', { name: 'Approvals' })).toBeInTheDocument();
  });

  it('a 403 from a revoked role: the reason stays, /me is refetched, the page turns read-only', async () => {
    let role: 'manager' | 'staff' = 'manager';
    const { handlers } = swapHandlers({
      swaps: [swap({ status: 'accepted', requesterId: ids.alex, targetUserId: ids.jo })],
      onWrite: () => {
        role = 'staff'; // the role was revoked while the page was open
        return problem(
          403,
          'SWAP_NOT_ALLOWED',
          'Only managers or admins of this organization can approve',
        );
      },
    });
    server.use(...orgHandlers().handlers, ...handlers);
    server.use(
      http.get(`${API}/me`, () =>
        ok(
          MeSchema,
          me({ memberships: me().memberships.map((m) => (m.id === ids.org ? { ...m, role } : m)) }),
        ),
      ),
    );
    renderApp(`/orgs/${ids.org}/inbox`);

    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('You can’t do this with this swap request');
    expect(alert).toHaveTextContent('Only managers or admins of this organization can approve');
    expect(await screen.findByRole('heading', { name: 'Managers only' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Only managers or admins'); // still visible
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument(),
    );
  });
});
