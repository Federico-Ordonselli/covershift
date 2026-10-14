/** Entry point: `node dist/migrate.js [revert]` (deploy-time one-off task). */
import { migrate } from './database/migrate';

migrate(process.argv[2]).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
