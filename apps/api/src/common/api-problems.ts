import { applyDecorators } from '@nestjs/common';
import { ProblemDetailsSchema } from '@covershift/shared';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';

export class ProblemDetailsDto extends createZodDto(ProblemDetailsSchema) {}

const DEFAULTS = {
  400: 'VALIDATION_FAILED (per-field `errors[]`) or MALFORMED_REQUEST (unparseable JSON or URL)',
  401: 'UNAUTHORIZED: missing, invalid or expired access token',
  403: 'FORBIDDEN: visible, but not your action',
  404: 'NOT_FOUND: does not exist or is not visible to you (deliberately indistinguishable)',
  409: 'Conflict with the current state',
  413: 'PAYLOAD_TOO_LARGE: request body over 100 kB',
  422: 'A business rule was violated',
  500: 'INTERNAL_ERROR: unexpected failure, no details exposed',
} as const;
export type ProblemStatus = keyof typeof DEFAULTS;

/**
 * Documents an endpoint's error responses as RFC 9457 `application/problem+json`.
 * `true` uses the generic description; a string names the codes this endpoint can return.
 * On a controller class it applies to every route.
 */
export function ApiProblems(
  spec: Partial<Record<ProblemStatus, true | string>>,
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiExtraModels(ProblemDetailsDto),
    ...Object.entries(spec).map(([status, text]) =>
      ApiResponse({
        status: Number(status),
        description: text === true ? DEFAULTS[Number(status) as ProblemStatus] : text,
        content: {
          'application/problem+json': { schema: { $ref: getSchemaPath(ProblemDetailsDto) } },
        },
      }),
    ),
  );
}

/** Every authenticated route can answer these. */
export const ApiAuthenticatedProblems = () => ApiProblems({ 401: true, 500: true });
