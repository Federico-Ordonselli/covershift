import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { type EntityManager } from 'typeorm';
import { RLS_MANAGER } from './rls.constants';

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
}
