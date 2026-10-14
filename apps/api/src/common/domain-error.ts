import { type ErrorCode } from '@covershift/shared';

/**
 * A violated business rule. Services throw these; the problem-details filter maps
 * them to HTTP. Keeps the domain layer free of HTTP exceptions.
 */
export interface FieldError {
  path: string;
  message: string;
}

export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 422 = 422,
    /** Per-field details for VALIDATION_FAILED. */
    readonly errors?: FieldError[],
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
