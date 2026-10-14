import { type ProblemDetails, ProblemDetailsSchema } from '@covershift/shared';

/** An error response from the API, always in its problem-details envelope. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  readonly errors: ProblemDetails['errors'];

  constructor(problem: ProblemDetails) {
    super(`${problem.status} ${problem.code}: ${problem.detail}`);
    this.name = 'ApiError';
    this.status = problem.status;
    this.code = problem.code;
    this.detail = problem.detail;
    this.errors = problem.errors;
  }

  /** Parses an error response; anything not in the envelope becomes UNKNOWN_RESPONSE. */
  static async from(res: Response): Promise<ApiError> {
    const body: unknown = await res.json().catch(() => undefined);
    const parsed = ProblemDetailsSchema.safeParse(body);
    if (parsed.success) return new ApiError(parsed.data);
    return new ApiError({
      type: 'about:blank',
      title: res.statusText || 'error',
      status: res.status,
      detail: 'The server answered in an unexpected format',
      code: 'UNKNOWN_RESPONSE',
    });
  }
}

/** The request never got an HTTP answer (offline, DNS, connection reset). */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('Network request failed', { cause });
    this.name = 'NetworkError';
  }
}

/** A 2xx response that doesn't match the shared contract: the client and API have drifted. */
export class ContractError extends Error {
  constructor(path: string, cause: unknown) {
    super(`Response from ${path} does not match the shared contract`, { cause });
    this.name = 'ContractError';
  }
}
