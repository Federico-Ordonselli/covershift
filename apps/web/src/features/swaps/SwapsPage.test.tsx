import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ids, swap } from '../../../test/msw/fixtures';
import { orgHandlers, swapHandlers } from '../../../test/msw/handlers';
import { problem } from '../../../test/msw/respond';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render';

const page = (tab: string) => `/orgs/${ids.org}/swaps/${tab}`;

describe('SwapsPage', () => {
  it('/swaps opens "Offers to me"', async () => {
    server.use(...orgHandlers().handlers, ...swapHandlers().handlers);
    const { router } = renderApp(`/orgs/${ids.org}/swaps`);
    await waitFor(() => expect(router.state.location.pathname).toBe(page('incoming')));
  });

  it('incoming: asks for my pending direct offers and shows the shift and people', async () => {
    const s = swap({ note: 'Dentist appointment' });
    const { handlers, listRequests } = swapHandlers({ swaps: [s] });
    server.use(...orgHandlers().handlers, ...handlers);
    renderApp(page('incoming'));

    const card = await screen.findByRole('listitem', {
      name: /Gate screening · Tue 15 Oct 06:00–14:00/,
    });
    expect(within(card).getByText('Alex Moreau')).toBeInTheDocument();
    expect(within(card).getByText('You')).toBeInTheDocument();
    expect(within(card).getByText('Waiting for a reply')).toBeInTheDocument();
    expect(within(card).getByText('Dentist appointment')).toBeInTheDocument();

    const q = listRequests[0]!;
    expect(Object.fromEntries(q)).toMatchObject({
      targetUserId: ids.me,
      status: 'pending',
      organizationId: ids.org,
      limit: '20',
    });
  });

  it('accept: success message, and the list is refetched', async () => {
    const s = swap();
    const { handlers, listRequests, writes } = swapHandlers({ swaps: [s] });
    server.use(...orgHandlers().handlers, ...handlers);
    renderApp(page('incoming'));
    await userEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    expect(
      await screen.findByText('Accepted. A manager still has to approve the swap.'),
    ).toBeInTheDocument();
    expect(writes).toEqual([{ action: 'accept', id: s.id }]);
    await waitFor(() => expect(listRequests.length).toBeGreaterThan(1));
  });

  it.each([
    [409, 'SWAP_CONFLICT', 'Someone else got there first', 'the offer was already claimed'],
    [
      409,
      'SWAP_INVALID_TRANSITION',
      'This swap request has already moved on',
      'only pending requests can be accepted',
    ],
    [
      422,
      'CERTIFICATION_MISSING',
      'Missing certification',
      'Required certification missing: X-ray screening',
    ],
  ] as const)(
    'a %i %s shows its title and the API reason verbatim',
    async (status, code, title, detail) => {
      const { handlers, listRequests } = swapHandlers({
        swaps: [swap()],
        onWrite: () => problem(status, code, detail),
      });
      server.use(...orgHandlers().handlers, ...handlers);
      renderApp(page('incoming'));
      await userEvent.click(await screen.findByRole('button', { name: 'Accept' }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(title);
      expect(alert).toHaveTextContent(detail);
      await waitFor(() => expect(listRequests.length).toBeGreaterThan(1)); // refetched anyway
    },
  );

  it('open offers: claim others’ offers, never my own', async () => {
    const mine = swap({ requesterId: ids.me, targetUserId: null });
    const theirs = swap({ requesterId: ids.jo, targetUserId: null });
    const { handlers, listRequests } = swapHandlers({ swaps: [mine, theirs] });
    server.use(...orgHandlers().handlers, ...handlers);
    renderApp(page('open'));
    const cards = await screen.findAllByRole('listitem');
    expect(within(cards[0]!).getByText('This is your offer.')).toBeInTheDocument();
    expect(within(cards[0]!).queryByRole('button')).not.toBeInTheDocument();
    expect(within(cards[1]!).getByRole('button', { name: 'Claim this shift' })).toBeInTheDocument();
    expect(within(cards[1]!).getByText('Anyone in the organization')).toBeInTheDocument();
    expect(Object.fromEntries(listRequests[0]!)).toMatchObject({ open: 'true', status: 'pending' });
  });

  it('my requests: cancel only while pending or accepted', async () => {
    const { handlers, listRequests } = swapHandlers({
      swaps: [
        swap({ requesterId: ids.me, status: 'pending' }),
        swap({ requesterId: ids.me, status: 'accepted' }),
        swap({ requesterId: ids.me, status: 'approved' }),
      ],
    });
    server.use(...orgHandlers().handlers, ...handlers);
    renderApp(page('mine'));
    const cards = await screen.findAllByRole('listitem');
    expect(
      cards.map((c) => within(c).queryAllByRole('button', { name: 'Cancel request' }).length),
    ).toEqual([1, 1, 0]);
    expect(listRequests[0]!.get('requesterId')).toBe(ids.me);
  });
});
