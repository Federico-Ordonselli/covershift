import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { type AuthenticatedRequest } from '../../auth/current-user.decorator';
import { RlsTransactionRunner } from './rls-transaction.runner';

/**
 * Wraps every authenticated HTTP request in one RLS transaction (ADR 001, option C2).
 * Runs after JwtAuthGuard, so `req.user` holds verified claims. Commits when the handler
 * completes, rolls back if it throws.
 *
 * @Public() routes get no transaction: if they touch the database, TxManager throws.
 */
@Injectable()
export class RlsTransactionInterceptor implements NestInterceptor {
  constructor(private readonly runner: RlsTransactionRunner) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const user = context.switchToHttp().getRequest<Partial<AuthenticatedRequest>>().user;
    if (!user) return next.handle();

    // The handler runs when lastValueFrom subscribes, i.e. inside the transaction.
    return from(
      this.runner.run(user.claims, () => lastValueFrom(next.handle(), { defaultValue: undefined })),
    );
  }
}
