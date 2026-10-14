import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClsModule } from 'nestjs-cls';
import { ENV, type Env } from '../config/env';
import { dataSourceOptions } from './data-source-options';
import { RlsTransactionInterceptor } from './rls/rls-transaction.interceptor';
import { RlsTransactionRunner } from './rls/rls-transaction.runner';
import { TxManager } from './rls/tx-manager';

@Module({
  imports: [
    ClsModule.forRoot({ global: true, middleware: { mount: true } }),
    TypeOrmModule.forRootAsync({
      inject: [ENV],
      // DATABASE_URL is the covershift_api role: no privileges outside RlsTransactionRunner.
      useFactory: (env: Env) =>
        dataSourceOptions({
          url: env.DATABASE_URL,
          poolSize: env.DATABASE_POOL_SIZE,
          applicationName: 'covershift-api',
        }),
    }),
  ],
  providers: [
    RlsTransactionRunner,
    TxManager,
    { provide: APP_INTERCEPTOR, useClass: RlsTransactionInterceptor },
  ],
  exports: [RlsTransactionRunner, TxManager],
})
export class DatabaseModule {}
