import { Test } from '@nestjs/testing';
import { DataSource, QueryFailedError } from 'typeorm';
import { expect } from 'vitest';
import { ConfigModule } from '../../src/config/config.module';
import { DatabaseModule } from '../../src/database/database.module';
import { RlsTransactionRunner } from '../../src/database/rls/rls-transaction.runner';
import { claimsFor } from './fixtures';

export interface RlsHarness {
  rls: RlsTransactionRunner;
  dataSource: DataSource;
  /**
   * Runs one SQL statement as `user` (covershift_api → authenticated + their claims) and
   * returns its rows (RETURNING rows for writes).
   */
  as<T = Record<string, unknown>>(
    user: { id: string },
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
  close(): Promise<void>;
}

/** The real DatabaseModule (covershift_api role), without HTTP. */
export async function createRlsHarness(): Promise<RlsHarness> {
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule, DatabaseModule],
  }).compile();
  const app = await moduleRef.init();
  const rls = moduleRef.get(RlsTransactionRunner);
  return {
    rls,
    dataSource: moduleRef.get(DataSource),
    // Structured result: TypeORM otherwise returns [rows, affected] for UPDATE/DELETE.
    as: async <T>(user: { id: string }, sql: string, params?: unknown[]) =>
      (await rls.run(claimsFor(user), (em) => em.queryRunner!.query(sql, params, true)))
        .records as T[],
    close: () => app.close(),
  };
}

/** Asserts a database error by SQLSTATE (and optionally message). */
export async function expectDbError(
  promise: Promise<unknown>,
  sqlstate: string,
  message?: string | RegExp,
): Promise<void> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err, `expected SQLSTATE ${sqlstate}, but the statement succeeded`).toBeInstanceOf(
    QueryFailedError,
  );
  const driverError = (err as QueryFailedError).driverError as Error & { code?: string };
  expect(driverError.code, driverError.message).toBe(sqlstate);
  if (message) expect(driverError.message).toMatch(message);
}
