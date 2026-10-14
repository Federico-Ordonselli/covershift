import { ShiftPageSchema } from '@covershift/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { describe, expect, it } from 'vitest';
import { ids, shift } from '../../../test/msw/fixtures';
import { orgHandlers, swapHandlers } from '../../../test/msw/handlers';
import { ok, problem } from '../../../test/msw/respond';
import { API, server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render';

const future = shift({
  assignedUserId: ids.me,
  startsAt: '2030-10-15T04:00:00Z',
  endsAt: '2030-10-15T12:00:00Z',
});
const othersFuture = shift({
  assignedUserId: ids.alex,
  startsAt: '2030-10-16T04:00:00Z',
  endsAt: '2030-10-16T12:00:00Z',
});
const week = `/orgs/${ids.org}/schedule?week=2030-10-14`;

function setup(onWrite?: NonNullable<Parameters<typeof swapHandlers>[0]>['onWrite']) {
  const swaps = swapHandlers({ onWrite });
  server.use(...orgHandlers().handlers, ...swaps.handlers);
  server.use(
    http.get(`${API}/shifts`, () =>
      ok(ShiftPageSchema, { items: [future, othersFuture], nextCursor: null }),
    ),
  );
  renderApp(week);
  return swaps;
}

async function openDialog() {
  await userEvent.click(await screen.findByRole('button', { name: /^Offer swap: Gate screening/ }));
  return screen.findByRole('dialog', { name: 'Offer your shift' });
}

describe('offering a shift', () => {
  it('only my own future shifts can be offered', async () => {
    setup();
    expect(await screen.findAllByRole('button', { name: /^Offer swap/ })).toHaveLength(1);
  });

  it('a direct offer sends shiftId, target and the trimmed note', async () => {
    const { writes } = setup();
    const dialog = await openDialog();
    expect(
      within(dialog)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Anyone (open offer)', 'Alex Moreau', 'Jo Lindqvist']);
    await userEvent.selectOptions(within(dialog).getByLabelText('Offer to'), ids.alex);
    await userEvent.type(within(dialog).getByLabelText('Note (optional)'), '  Wedding  ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send offer' }));

    expect(await screen.findByText('Your offer was sent.')).toBeInTheDocument();
    expect(writes).toEqual([
      { action: 'create', body: { shiftId: future.id, targetUserId: ids.alex, note: 'Wedding' } },
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('an open offer sends targetUserId null and no note', async () => {
    const { writes } = setup();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send offer' }));
    expect(await screen.findByText('Your open offer is posted.')).toBeInTheDocument();
    expect(writes[0]!.body).toEqual({ shiftId: future.id, targetUserId: null });
  });

  it('the shared contract’s note limit applies before sending', async () => {
    const { writes } = setup();
    const dialog = await openDialog();
    const note = within(dialog).getByLabelText('Note (optional)');
    await userEvent.click(note);
    await userEvent.paste('x'.repeat(501));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send offer' }));
    await waitFor(() => expect(note).toHaveAttribute('aria-invalid', 'true'));
    expect(writes).toHaveLength(0);
  });

  it('server field errors (VALIDATION_FAILED) land on their inputs', async () => {
    setup(() =>
      problem(400, 'VALIDATION_FAILED', 'Request validation failed', [
        { path: 'note', message: 'Note rejected by server' },
      ]),
    );
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send offer' }));
    const note = within(dialog).getByLabelText('Note (optional)');
    await waitFor(() => expect(note).toHaveAccessibleDescription('Note rejected by server'));
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a 409 SWAP_ALREADY_ACTIVE explains itself inside the dialog', async () => {
    setup(() =>
      problem(409, 'SWAP_ALREADY_ACTIVE', 'This shift already has an active swap request'),
    );
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send offer' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('This shift already has an active swap request');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('Cancel closes without sending', async () => {
    const { writes } = setup();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(writes).toHaveLength(0);
  });
});
