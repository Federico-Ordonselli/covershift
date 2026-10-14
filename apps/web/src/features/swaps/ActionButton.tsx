import { type SwapRequest } from '@covershift/shared';
import { toUserMessage } from '../../errors/messages';
import { type SwapAction } from '../../lib/api/endpoints';
import { Button } from '../../ui/Button';
import { type Notice } from '../../ui/Notice';
import { useOrg } from '../orgs/orgContext';
import { useSwapAction } from './hooks';
import { ACTION_DONE, ACTION_LABELS } from './labels';

/**
 * A swap transition button. The outcome goes to the page's notice (it must outlive the
 * card); the API's reason is shown verbatim on 403/409/422, and data is refetched either way.
 */
export function ActionButton({
  swap,
  action,
  onNotice,
  label = ACTION_LABELS[action],
  variant = 'primary',
}: {
  swap: SwapRequest;
  action: SwapAction;
  onNotice: (notice: Notice) => void;
  label?: string;
  variant?: 'primary' | 'secondary';
}) {
  const { org } = useOrg();
  const mutation = useSwapAction(org.id);
  return (
    <Button
      variant={variant}
      disabled={mutation.isPending}
      onClick={() =>
        mutation.mutate(
          { id: swap.id, action },
          {
            onSuccess: () => onNotice({ tone: 'success', text: ACTION_DONE[action] }),
            onError: (error) => onNotice({ tone: 'error', message: toUserMessage(error) }),
          },
        )
      }
    >
      {mutation.isPending ? 'Working…' : label}
    </Button>
  );
}
