import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { safeReturnTo } from '../../lib/auth/returnTo';
import { useAuthState, useSessionStore } from '../../lib/auth/SessionProvider';
import { Alert } from '../../ui/Alert';
import { Button } from '../../ui/Button';
import { PageHeading } from '../../ui/PageHeading';
import ui from '../../ui/ui.module.css';
import styles from './LoginPage.module.css';

export const LoginSchema = z.object({
  email: z.email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});
type LoginValues = z.infer<typeof LoginSchema>;

export function LoginPage() {
  const auth = useAuthState();
  const store = useSessionStore();
  const [params] = useSearchParams();
  const [failure, setFailure] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(LoginSchema) });

  if (auth.status === 'signedIn') {
    return <Navigate to={safeReturnTo(params.get('returnTo'))} replace />;
  }

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setFailure(null);
    try {
      const { error } = await store.signIn(email, password);
      if (!error) return; // the session store re-renders us signed in → <Navigate>
      setFailure(
        error.code === 'invalid_credentials'
          ? 'Wrong email or password.'
          : 'Signing in failed. Please try again.',
      );
    } catch {
      setFailure('You appear to be offline. Check your connection and try again.');
    }
  });

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <PageHeading>Sign in to Covershift</PageHeading>
        {params.get('reason') === 'expired' && !failure ? (
          <Alert tone="info" title="Your session has expired">
            <p>Sign in again to continue where you left off.</p>
          </Alert>
        ) : null}
        {failure ? <Alert tone="error" title={failure} /> : null}
        <form onSubmit={onSubmit} noValidate>
          <div className={ui.field}>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? 'email-error' : undefined}
              {...register('email')}
            />
            {errors.email ? (
              <span id="email-error" className={ui.fieldError}>
                {errors.email.message}
              </span>
            ) : null}
          </div>
          <div className={ui.field}>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? 'password-error' : undefined}
              {...register('password')}
            />
            {errors.password ? (
              <span id="password-error" className={ui.fieldError}>
                {errors.password.message}
              </span>
            ) : null}
          </div>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </main>
  );
}
