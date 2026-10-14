import { type UserMessage } from '../errors/messages';
import { Alert } from './Alert';

export type Notice = { tone: 'success'; text: string } | { tone: 'error'; message: UserMessage };

/**
 * The page-level outcome of the last action. Lives on the page, not the card: a card often
 * leaves its list after acting (accepted, cancelled, …), and the message must survive that.
 */
export function NoticeBanner({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  if (notice.tone === 'success') return <Alert tone="info" title={notice.text} />;
  return (
    <Alert tone="error" title={notice.message.title}>
      {notice.message.detail ? <p>{notice.message.detail}</p> : null}
    </Alert>
  );
}
