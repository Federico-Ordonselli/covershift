import { ERROR_CODES, type ProblemDetails } from '@covershift/shared';
import { describe, expect, it } from 'vitest';
import { ApiError, ContractError, NetworkError } from '../lib/api/errors';
import { CODE_TITLES, toUserMessage } from './messages';

const apiError = (
  status: number,
  code: string,
  detail = 'the reason',
  errors?: ProblemDetails['errors'],
) => new ApiError({ type: 'x', title: 'x', status, code, detail, ...(errors ? { errors } : {}) });

describe('toUserMessage', () => {
  it('has a title for every code in the shared contract', () => {
    for (const code of Object.values(ERROR_CODES)) expect(CODE_TITLES[code]).toBeTruthy();
  });

  it.each([
    [409, 'SWAP_CONFLICT', 'conflict', 'Someone else got there first'],
    [409, 'SWAP_INVALID_TRANSITION', 'conflict', 'This swap request has already moved on'],
    [422, 'CERTIFICATION_MISSING', 'rule', 'Missing certification'],
    [
      422,
      'CERTIFICATION_EXPIRES_BEFORE_SHIFT_END',
      'rule',
      'Certification expires before the shift ends',
    ],
    [403, 'SWAP_NOT_ALLOWED', 'forbidden', 'You can’t do this with this swap request'],
  ])('%i %s shows its title and the API reason verbatim', (status, code, kind, title) => {
    const detail = 'only accepted requests can be approved (from the trigger)';
    expect(toUserMessage(apiError(status, code, detail))).toEqual({
      kind,
      title,
      detail,
      retryable: false,
    });
  });

  it('404 never shows the raw detail', () => {
    expect(toUserMessage(apiError(404, 'NOT_FOUND', 'Shift not found'))).toEqual({
      kind: 'notFound',
      title: CODE_TITLES.NOT_FOUND,
      retryable: false,
    });
  });

  it('401 is a session problem', () => {
    expect(toUserMessage(apiError(401, 'UNAUTHORIZED'))).toMatchObject({ kind: 'session' });
  });

  it('VALIDATION_FAILED carries field errors for the form', () => {
    const errors = [{ path: 'note', message: 'Too long' }];
    expect(toUserMessage(apiError(400, 'VALIDATION_FAILED', 'x', errors))).toMatchObject({
      kind: 'validation',
      fieldErrors: errors,
    });
  });

  it.each([
    [400, 'The request was not accepted', 'client'],
    [403, 'You can’t do this', 'forbidden'],
    [409, 'This conflicts with the current state', 'conflict'],
    [422, 'This isn’t allowed by the rules', 'rule'],
    [503, CODE_TITLES.INTERNAL_ERROR, 'server'],
  ])('an unknown code falls back on its status (%i)', (status, title, kind) => {
    expect(toUserMessage(apiError(status, 'SOMETHING_NEW'))).toMatchObject({ title, kind });
  });

  it('keeps the reason for an unknown 409/422 code', () => {
    expect(toUserMessage(apiError(409, 'SOMETHING_NEW', 'why')).detail).toBe('why');
  });

  it('5xx and network failures are retryable; contract drift is not', () => {
    expect(toUserMessage(apiError(500, 'INTERNAL_ERROR'))).toMatchObject({ retryable: true });
    expect(toUserMessage(new NetworkError(new Error('x')))).toMatchObject({
      kind: 'network',
      retryable: true,
    });
    expect(toUserMessage(new ContractError('/me', new Error('x')))).toMatchObject({
      kind: 'server',
      retryable: false,
    });
  });

  it('never exposes an arbitrary error message', () => {
    const msg = toUserMessage(new Error('TypeError: cannot read x of undefined at secret.ts:12'));
    expect(JSON.stringify(msg)).not.toContain('secret');
  });
});
