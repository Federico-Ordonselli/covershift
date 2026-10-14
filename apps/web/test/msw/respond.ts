import { type ErrorCode, isErrorCode, ProblemDetailsSchema } from '@covershift/shared';
import { HttpResponse } from 'msw';
import { type z } from 'zod';

/**
 * Every mocked API response goes through the shared contract first, so a fixture that
 * drifts from what the API can actually send fails the test instead of passing silently.
 */
export function ok<S extends z.ZodType>(schema: S, body: z.input<S>, status = 200) {
  return HttpResponse.json(schema.parse(body) as never, { status });
}

export function problem(
  status: number,
  code: ErrorCode,
  detail: string,
  errors?: Array<{ path: string; message: string }>,
) {
  if (!isErrorCode(code)) throw new Error(`Mock uses an error code the API doesn't have: ${code}`);
  const body = ProblemDetailsSchema.parse({
    type: `urn:covershift:error:${code.toLowerCase()}`,
    title: 'error',
    status,
    detail,
    code,
    ...(errors ? { errors } : {}),
  });
  return HttpResponse.json(body, {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
}
