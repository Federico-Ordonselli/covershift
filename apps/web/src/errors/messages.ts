import { type ErrorCode, isErrorCode } from '@covershift/shared';
import { ApiError, ContractError, NetworkError } from '../lib/api/errors';

/**
 * One title per API error code. Typed as a total Record: adding a code to the shared
 * contract fails the build until it has a message here.
 */
export const CODE_TITLES: Record<ErrorCode, string> = {
  UNAUTHORIZED: 'Your session has expired',
  MALFORMED_REQUEST: 'The request could not be sent correctly',
  PAYLOAD_TOO_LARGE: 'That is too much text to send',
  UNSUPPORTED_MEDIA_TYPE: 'The request could not be sent correctly',
  BAD_REQUEST: 'The request was not accepted',
  INTERNAL_ERROR: 'Something went wrong on our side',
  VALIDATION_FAILED: 'Some fields need attention',
  FORBIDDEN: 'You can’t do this',
  NOT_FOUND: 'This no longer exists or isn’t visible to you',
  CONFLICT: 'This conflicts with the current state',
  INVALID_REFERENCE: 'Something this refers to no longer exists',
  CONSTRAINT_VIOLATION: 'That combination isn’t allowed',
  CERTIFICATION_MISSING: 'Missing certification',
  CERTIFICATION_EXPIRES_BEFORE_SHIFT_END: 'Certification expires before the shift ends',
  NOT_A_MEMBER: 'Not an active member of this organization',
  SHIFT_OVERLAP: 'Overlaps another shift',
  SHIFT_ALREADY_STARTED: 'The shift has already started',
  SWAP_ALREADY_ACTIVE: 'This shift already has an active swap request',
  SWAP_INVALID_TRANSITION: 'This swap request has already moved on',
  SWAP_CONFLICT: 'Someone else got there first',
  SWAP_NOT_ALLOWED: 'You can’t do this with this swap request',
};

/** Unknown codes still get a sensible message from their status. */
const STATUS_TITLES: Record<number, string> = {
  400: 'The request was not accepted',
  401: CODE_TITLES.UNAUTHORIZED,
  403: 'You can’t do this',
  404: CODE_TITLES.NOT_FOUND,
  409: 'This conflicts with the current state',
  413: CODE_TITLES.PAYLOAD_TOO_LARGE,
  422: 'This isn’t allowed by the rules',
};

export type ErrorKind =
  | 'session'
  | 'validation'
  | 'forbidden'
  | 'notFound'
  | 'conflict'
  | 'rule'
  | 'client'
  | 'server'
  | 'network';

export interface UserMessage {
  kind: ErrorKind;
  title: string;
  /** The API's own explanation, shown verbatim where it carries the reason (403/409/422). */
  detail?: string;
  /** Per-field problems (VALIDATION_FAILED), for forms to attach to their inputs. */
  fieldErrors?: Array<{ path: string; message: string }>;
  /** Worth offering "Try again". */
  retryable: boolean;
}

export function toUserMessage(error: unknown): UserMessage {
  if (error instanceof NetworkError) {
    return {
      kind: 'network',
      title: 'You appear to be offline',
      detail: 'Check your connection and try again.',
      retryable: true,
    };
  }
  if (!(error instanceof ApiError)) {
    // ContractError or a bug: never show internals.
    return {
      kind: 'server',
      title: CODE_TITLES.INTERNAL_ERROR,
      retryable: !(error instanceof ContractError),
    };
  }

  const title = isErrorCode(error.code)
    ? CODE_TITLES[error.code]
    : (STATUS_TITLES[error.status] ?? CODE_TITLES.INTERNAL_ERROR);
  const { status } = error;

  if (status === 401) return { kind: 'session', title, retryable: false };
  if (status === 400 && error.code === 'VALIDATION_FAILED') {
    return { kind: 'validation', title, fieldErrors: error.errors ?? [], retryable: false };
  }
  if (status === 403) return { kind: 'forbidden', title, detail: error.detail, retryable: false };
  if (status === 404) return { kind: 'notFound', title, retryable: false };
  // 409: the transition trigger's reason; 422: the eligibility details. Verbatim.
  if (status === 409) return { kind: 'conflict', title, detail: error.detail, retryable: false };
  if (status === 422) return { kind: 'rule', title, detail: error.detail, retryable: false };
  if (status >= 500) return { kind: 'server', title, retryable: true };
  return { kind: 'client', title, retryable: false };
}
