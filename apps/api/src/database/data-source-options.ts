import { type DataSourceOptions } from 'typeorm';
import { ENTITIES } from './entities';
import { MIGRATIONS } from './migrations';

/** TypeORM bookkeeping lives in a non-exposed schema, created by scripts/migrate.ts. */
export const MIGRATIONS_TABLE = 'ops.typeorm_migrations';

interface Options {
  url: string;
  poolSize?: number;
  applicationName: string;
}

export function dataSourceOptions({ url, poolSize, applicationName }: Options): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    entities: ENTITIES,
    migrations: MIGRATIONS,
    migrationsTableName: MIGRATIONS_TABLE,
    // The schema is owned by migrations. Never let TypeORM touch it.
    synchronize: false,
    migrationsRun: false,
    poolSize,
    applicationName,
  };
}
