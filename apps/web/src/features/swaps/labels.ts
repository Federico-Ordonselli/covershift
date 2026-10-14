import { type SwapRequest } from '@covershift/shared';

export function statusLabel(swap: SwapRequest): string {
  switch (swap.status) {
    case 'pending':
      return swap.targetUserId ? 'Waiting for a reply' : 'Open offer';
    case 'accepted':
      return 'Waiting for manager approval';
    case 'approved':
      return 'Approved';
    case 'declined':
      return 'Declined';
    case 'rejected':
      return 'Rejected by a manager';
    case 'cancelled':
      return 'Cancelled';
  }
}

export const ACTION_LABELS = {
  accept: 'Accept',
  claim: 'Claim',
  decline: 'Decline',
  cancel: 'Cancel request',
  approve: 'Approve',
  reject: 'Reject',
} as const;

export const ACTION_DONE = {
  accept: 'Accepted. A manager still has to approve the swap.',
  decline: 'Declined.',
  cancel: 'Request cancelled.',
  approve: 'Approved. The shift has been reassigned.',
  reject: 'Rejected.',
} as const;
