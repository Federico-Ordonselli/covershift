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
    }
  } finally {
    await ds.destroy();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
