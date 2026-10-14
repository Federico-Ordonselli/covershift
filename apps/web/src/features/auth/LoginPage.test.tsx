import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { orgHandlers } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render';

describe('LoginPage', () => {
  it('validates both fields before calling Supabase', async () => {
    const { auth } = renderApp('/login', { signedIn: false });
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(
      'Enter a valid email address',
    );
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('wrong credentials: a clear message, still on the login page', async () => {
    renderApp('/login', { signedIn: false });
    await userEvent.type(await screen.findByLabelText('Email'), 'sam@covershift.test');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password.');
  });

  it('success returns to the page that required login (same-origin only)', async () => {
    server.use(...orgHandlers().handlers);
    const { router } = renderApp(
      '/login?returnTo=%2Forgs%2F11111111-1111-4111-8111-111111111111%2Fschedule',
      { signedIn: false },
    );
    await userEvent.type(await screen.findByLabelText('Email'), 'sam@covershift.test');
    await userEvent.type(screen.getByLabelText('Password'), 'right');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        '/orgs/11111111-1111-4111-8111-111111111111/schedule',
      ),
    );
  });

  it('ignores an off-site returnTo', async () => {
    server.use(...orgHandlers().handlers);
    const { router } = renderApp('/login?returnTo=https%3A%2F%2Fevil.example', { signedIn: true });
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/^\/orgs\/[^/]+\/schedule$/),
    );
  });
});
