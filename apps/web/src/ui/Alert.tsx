import { type ReactNode } from 'react';
import { toUserMessage } from '../errors/messages';
import { Button } from './Button';
import styles from './ui.module.css';

type Tone = 'error' | 'warning' | 'info';

/** Errors interrupt (role=alert); warnings and info are announced politely (role=status). */
export function Alert({
  tone,
  title,
  children,
}: {
  tone: Tone;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className={`${styles.alert} ${styles[tone]}`} role={tone === 'error' ? 'alert' : 'status'}>
      <p className={styles.alertTitle}>{title}</p>
      {children}
    </div>
  );
}

/** Any thrown error, mapped to user-facing copy (errors/messages.ts). */
export function ErrorAlert({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = toUserMessage(error);
  return (
    <Alert tone="error" title={message.title}>
      {message.detail ? <p>{message.detail}</p> : null}
      {message.retryable && onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </Alert>
  );
}
