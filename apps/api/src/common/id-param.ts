import { Param, ParseUUIDPipe } from '@nestjs/common';
import { DomainError } from './domain-error';

/**
 * `@Param('id')` as a UUID. A malformed id is a VALIDATION_FAILED like any other input
 * problem (same envelope, `errors[].path = 'id'`), not Nest's bare 400.
 */
export const IdParam = (): ParameterDecorator =>
  Param(
    'id',
    new ParseUUIDPipe({
      exceptionFactory: () =>
        new DomainError('VALIDATION_FAILED', 'Request validation failed', 400, [
          { path: 'id', message: 'Invalid UUID' },
        ]),
    }),
  );
