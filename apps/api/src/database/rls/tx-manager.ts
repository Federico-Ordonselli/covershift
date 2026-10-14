import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import {
  type DeleteQueryBuilder,
  type EntityManager,
  type InsertQueryBuilder,
  type ObjectLiteral,
  type UpdateQueryBuilder,
} from 'typeorm';
import { RLS_MANAGER } from './rls.constants';

export interface WriteResult<T> {
  /** RETURNING rows, with database column names. */
  rows: T[];
  /** Rows actually written. 0 = nothing matched: missing, hidden by RLS, or lost a race. */
  affected: number;
}

type WriteQueryBuilder =
  | UpdateQueryBuilder<ObjectLiteral>
  | InsertQueryBuilder<ObjectLiteral>
  | DeleteQueryBuilder<ObjectLiteral>;

/**
 * How services reach the database. Returns the EntityManager bound to the current
 * request's RLS transaction. Never inject Repository<T> from the global DataSource: it
 * would run outside the transaction, and the connection role makes that fail anyway.
 */
@Injectable()
export class TxManager {
  constructor(private readonly cls: ClsService) {}

  get(): EntityManager {
    const manager = this.cls.isActive()
      ? this.cls.get<EntityManager | undefined>(RLS_MANAGER)
      : undefined;
    if (!manager) {
      throw new Error(
        'No RLS transaction in scope. Database access must happen inside an authenticated ' +
          'request (RlsTransactionInterceptor) or RlsTransactionRunner.run().',
      );
    }
    return manager;
  }

  /**
   * The one way to execute writes whose outcome matters (ADR 001, write path rule).
   * Builders keep the columns explicit; execution goes through the structured-result API,
   * so `affected` is exact. TypeORM's plain query() returns [rows, affected] for writes,
   * and save() can't express conditional WHERE clauses at all.
   *
   *   const { affected } = await tx.write(
   *     tx.get().createQueryBuilder().update(SwapRequest)
   *       .set({ status: 'accepted', targetUserId: me })
   *       .where('id = :id and status = :pending and target_user_id is null', {...}),
   *   );
   *   if (affected === 0) throw new DomainError('SWAP_CONFLICT', ..., 409);
   */
  async write<T = Record<string, unknown>>(builder: WriteQueryBuilder): Promise<WriteResult<T>> {
    const [sql, params] = builder.getQueryAndParameters();
    const result = await this.get().queryRunner!.query(sql, params, true);
    const rows = (Array.isArray(result.records) ? result.records : []) as T[];
    return { rows, affected: result.affected ?? rows.length };
  }
}
