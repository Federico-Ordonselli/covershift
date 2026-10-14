/**
 * Applies (or reverts) migrations over the privileged DATABASE_MIGRATION_URL.
 *
 *   pnpm db:migrate          run pending migrations
 *   pnpm db:migrate revert   revert the last one
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../src/database/data-source-options';

async function main(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    // rely on the real environment
  }
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) throw new Error('DATABASE_MIGRATION_URL is required');

  const ds = new DataSource(dataSourceOptions({ url, applicationName: 'covershift-migrate' }));
  await ds.initialize();
  try {
    await ds.query(`create schema if not exists ops`);
    await ds.query(`revoke all on schema ops from public`);

    if (process.argv[2] === 'revert') {
      await ds.undoLastMigration({ transaction: 'each' });
    } else {
      const applied = await ds.runMigrations({ transaction: 'each' });
      console.log(
        applied.length ? `Applied: ${applied.map((m) => m.name).join(', ')}` : 'Up to date',
      );
      await setApiRolePassword(ds);
    }
  } finally {
    await ds.destroy();
  }
}

/**
 * Local/CI convenience: give the API's login role a password from the environment.
 * Deployed environments manage this credential outside the app (ADR 001).
 */
async function setApiRolePassword(ds: DataSource): Promise<void> {
  const password = process.env.COVERSHIFT_API_DB_PASSWORD;
  if (!password) return;
  // DDL can't take bind parameters; format(%L) quotes the literal safely.
  const [row] = await ds.query<Array<{ sql: string }>>(
    `select format('alter role covershift_api with password %L', $1::text) as sql`,
    [password],
  );
  await ds.query(row!.sql);
  console.log('Set covershift_api password from COVERSHIFT_API_DB_PASSWORD');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
