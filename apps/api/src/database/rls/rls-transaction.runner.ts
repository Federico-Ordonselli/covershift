import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { DataSource, type EntityManager } from 'typeorm';
import { type SupabaseClaims } from '../../auth/auth-user';
import { RLS_MANAGER } from './rls.constants';

/**
 * The primitive behind RLS-through-NestJS (ADR 001): run `fn` in a transaction that
 * impersonates the user, so every query inside it is subject to their RLS policies.
 *
 * Both settings are transaction-local (`set local`, `set_config(..., true)`): commit or
 * rollback restores the connection to the bare, privilege-less `covershift_api` role before
 * it goes back to the pool. This is what makes it safe with pooling and Supavisor.
 *
 * HTTP requests get this automatically via RlsTransactionInterceptor; call it directly
 * only for non-HTTP work (jobs, scripts) and keep slow I/O outside `fn`.
 */
@Injectable()
export class RlsTransactionRunner {
  constructor(
    private readonly dataSource: DataSource,
    private readonly cls: ClsService,
  ) {}

  async run<T>(claims: SupabaseClaims, fn: (manager: EntityManager) => Promise<T>): Promise<T> {
    if (this.cls.isActive() && this.cls.get(RLS_MANAGER)) {
      // A second connection would be a second, independent transaction: partial commits.
      throw new Error('Nested RLS transaction: use TxManager.get() inside an existing one');
    }

    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      await runner.startTransaction();
      await runner.query('set local role authenticated');
      // Only ever the verified token payload (SupabaseJwtVerifier), passed as a bind
      // parameter. auth.uid() and auth.jwt() read it from here.
      await runner.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify(claims),
      ]);

      const result = await this.cls.run({ ifNested: 'inherit' }, () => {
        this.cls.set(RLS_MANAGER, runner.manager);
        return fn(runner.manager);
      });

      await runner.commitTransaction();
      return result;
    } catch (err) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      throw err;
    } finally {
      await runner.release();
    }
  }
}
