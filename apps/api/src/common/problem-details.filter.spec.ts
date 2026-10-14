import {
  type ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ProblemDetailsSchema } from '@covershift/shared';
import { ZodSerializationException } from 'nestjs-zod';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { DomainError } from './domain-error';
import { ProblemDetailsFilter } from './problem-details.filter';

/** Shaped like body-parser's http-errors: status, expose and a `type`. */
function bodyParserError(status: number, message: string, type: string) {
  return Object.assign(new Error(message), { status, statusCode: status, expose: true, type });
}

function render(exception: unknown) {
  const res = { status: vi.fn(), type: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  res.type.mockReturnValue(res);
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
  new ProblemDetailsFilter().catch(exception, host);
  expect(res.type).toHaveBeenCalledWith('application/problem+json');
  const body = res.json.mock.calls[0]![0] as unknown;
  // The contract: every error body parses as ProblemDetails, `code` included.
  return ProblemDetailsSchema.parse(body);
}

describe('ProblemDetailsFilter: every path answers with a code', () => {
  it.each([
    [
      'guard: missing token',
      new UnauthorizedException('missing bearer token'),
      401,
      'UNAUTHORIZED',
    ],
    ['unknown route', new NotFoundException('Cannot GET /nope'), 404, 'NOT_FOUND'],
    [
      'body-parser SyntaxError wrapped by Nest',
      new BadRequestException('Unexpected token } in JSON'),
      400,
      'MALFORMED_REQUEST',
    ],
    ['other 4xx HttpException', new ForbiddenException(), 403, 'BAD_REQUEST'],
    [
      '5xx HttpException',
      new InternalServerErrorException('db password is hunter2'),
      500,
      'INTERNAL_ERROR',
    ],
    ['plain Error', new Error('connection string postgres://x:y@z'), 500, 'INTERNAL_ERROR'],
    ['a thrown string', 'boom', 500, 'INTERNAL_ERROR'],
    [
      'body too large',
      bodyParserError(413, 'request entity too large', 'entity.too.large'),
      413,
      'PAYLOAD_TOO_LARGE',
    ],
    [
      'raw parse failure',
      bodyParserError(400, 'Unexpected token', 'entity.parse.failed'),
      400,
      'MALFORMED_REQUEST',
    ],
    [
      'unsupported charset',
      bodyParserError(415, 'unsupported charset "KLINGON"', 'charset.unsupported'),
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    ],
    [
      'response failing its own schema',
      new ZodSerializationException(new z.ZodError([])),
      500,
      'INTERNAL_ERROR',
    ],
  ])('%s → %i %s', (_, exception, status, code) => {
    const problem = render(exception);
    expect(problem).toMatchObject({
      status,
      code,
      type: `urn:covershift:error:${code.toLowerCase()}`,
    });
  });

  it('never echoes parser or internal messages', () => {
    expect(render(new BadRequestException('Unexpected token } in JSON')).detail).not.toMatch(
      /token|JSON/,
    );
    expect(render(new Error('postgres://x:y@z')).detail).toBe('Internal server error');
    expect(render(new InternalServerErrorException('hunter2')).detail).not.toContain('hunter2');
  });

  it('keeps per-field errors from a DomainError', () => {
    const problem = render(
      new DomainError('VALIDATION_FAILED', 'Request validation failed', 400, [
        { path: 'id', message: 'Invalid UUID' },
      ]),
    );
    expect(problem).toMatchObject({ code: 'VALIDATION_FAILED', errors: [{ path: 'id' }] });
  });

  it('an HttpException with an unusual status still gets a code', () => {
    expect(render(new HttpException('teapot', 418))).toMatchObject({
      status: 418,
      code: 'BAD_REQUEST',
    });
  });
});
