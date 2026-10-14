import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { type ErrorCode, type ProblemDetails } from '@covershift/shared';
import type { Response } from 'express';
import { ZodSerializationException, ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import { isPrivilegeBug, translateDatabaseError } from './database-errors';
import { DomainError } from './domain-error';

/**
 * Maps every error to an RFC 9457 problem-details body with a machine-readable `code`.
 * Unknown errors never leak details; neither do parser messages.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const problem = this.toProblem(exception);
    res.status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblem(exception: unknown): ProblemDetails {
    const fromDatabase = translateDatabaseError(exception);
    if (fromDatabase) {
      if (isPrivilegeBug(exception)) {
        // Mapped to 403 per ADR 001, but a missing grant is almost always our bug: be loud.
        this.logger.error('Privilege error outside RLS policies', exception);
      }
      exception = fromDatabase;
    }

    if (exception instanceof DomainError) {
      return {
        ...problem(exception.status, exception.message, exception.code),
        ...(exception.errors ? { errors: exception.errors } : {}),
      };
    }

    if (exception instanceof ZodValidationException) {
      const zodError = exception.getZodError();
      const errors =
        zodError instanceof ZodError
          ? zodError.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
          : [];
      return { ...problem(400, 'Request validation failed', 'VALIDATION_FAILED'), errors };
    }

    if (exception instanceof ZodSerializationException) {
      this.logger.error('Response failed its own schema', exception.getZodError());
      return internalError();
    }

    const bodyParser = bodyParserProblem(exception);
    if (bodyParser) return bodyParser;

    if (exception instanceof UnauthorizedException) {
      // Guard messages ("missing bearer token", "invalid token") are safe and useful.
      return problem(401, exception.message, 'UNAUTHORIZED');
    }
    if (exception instanceof NotFoundException) {
      return problem(404, 'Route not found', 'NOT_FOUND');
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status >= 500) {
        this.logger.error(exception);
        return internalError();
      }
      if (status === 400) {
        // Our code never throws a plain 400 (validation is zod's or a DomainError). What's
        // left is Nest's express adapter wrapping body-parser's SyntaxError (invalid JSON)
        // or a URIError (bad percent-encoding in the path); its message is the parser's.
        return problem(400, 'The request could not be parsed', 'MALFORMED_REQUEST');
      }
      return problem(status, HttpStatus[status]?.toLowerCase() ?? 'error', 'BAD_REQUEST');
    }

    this.logger.error(exception);
    return internalError();
  }
}

/**
 * body-parser errors (http-errors with a `type`) that Nest passes through unwrapped.
 * https://github.com/expressjs/body-parser#errors
 */
function bodyParserProblem(exception: unknown): ProblemDetails | undefined {
  if (typeof exception !== 'object' || exception === null || !('type' in exception)) {
    return undefined;
  }
  switch ((exception as { type: unknown }).type) {
    case 'entity.too.large':
      return problem(413, 'The request body is too large', 'PAYLOAD_TOO_LARGE');
    case 'entity.parse.failed':
    case 'entity.verify.failed':
    case 'request.aborted':
    case 'request.size.invalid':
    case 'stream.encoding.set':
    case 'parameters.too.many':
      return problem(400, 'The request could not be parsed', 'MALFORMED_REQUEST');
    case 'charset.unsupported':
    case 'encoding.unsupported':
      return problem(415, 'Unsupported body encoding', 'UNSUPPORTED_MEDIA_TYPE');
    default:
      return undefined;
  }
}

function internalError(): ProblemDetails {
  return problem(HttpStatus.INTERNAL_SERVER_ERROR, 'Internal server error', 'INTERNAL_ERROR');
}

function problem(status: number, detail: string, code: ErrorCode): ProblemDetails {
  return {
    type: `urn:covershift:error:${code.toLowerCase()}`,
    title: HttpStatus[status]?.replaceAll('_', ' ').toLowerCase() ?? 'error',
    status,
    detail,
    code,
  };
}
