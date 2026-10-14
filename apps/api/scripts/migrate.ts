/**
 * Applies (or reverts) migrations over the privileged DATABASE_MIGRATION_URL.
 *
 *   pnpm db:migrate          run pending migrations
 *   pnpm db:migrate revert   revert the last one
 *
 * The logic lives in src/database/migrate.ts so the production image can run it too.
 */
import { migrate } from '../src/database/migrate';

migrate(process.argv[2]).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
