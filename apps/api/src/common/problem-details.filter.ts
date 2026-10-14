import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { type ProblemDetails } from '@covershift/shared';
import type { Response } from 'express';
import { ZodSerializationException, ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import { isPrivilegeBug, translateDatabaseError } from './database-errors';
import { DomainError } from './domain-error';

/** Maps every error to an RFC 9457 problem-details body. Unknown errors never leak details. */
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
      return problem(exception.status, exception.message, exception.code);
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
      return problem(500, 'Internal server error');
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return problem(status, exception.message);
    }

    this.logger.error(exception);
    return problem(HttpStatus.INTERNAL_SERVER_ERROR, 'Internal server error');
  }
}

function problem(status: number, detail: string, code?: string): ProblemDetails {
  return {
    type: code ? `urn:covershift:error:${code.toLowerCase()}` : 'about:blank',
    title: HttpStatus[status]?.replaceAll('_', ' ').toLowerCase() ?? 'error',
    status,
    detail,
    ...(code ? { code } : {}),
  };
}
