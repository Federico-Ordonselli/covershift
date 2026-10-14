// Writes apps/api/.env for the running local Supabase stack (dev and CI alike).
// Keys and URLs come from `supabase status`, so nothing key-shaped is ever committed.
// Existing values in .env are kept unless the stack provides them.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const ENV_FILE = 'apps/api/.env';
const EXAMPLE = 'apps/api/.env.example';

/** .env variable <- `supabase status -o env` variable */
const FROM_STACK = {
  SUPABASE_URL: 'API_URL',
  DATABASE_MIGRATION_URL: 'DB_URL',
  SUPABASE_PUBLISHABLE_KEY: 'PUBLISHABLE_KEY',
  SUPABASE_SECRET_KEY: 'SECRET_KEY',
};

const status = execFileSync('pnpm', ['-s', 'supabase', 'status', '-o', 'env'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
});
const stack = Object.fromEntries(
  [...status.matchAll(/^([A-Z_]+)="(.*)"$/gm)].map(([, key, value]) => [key, value]),
);

if (!existsSync(ENV_FILE)) copyFileSync(EXAMPLE, ENV_FILE);
let env = readFileSync(ENV_FILE, 'utf8');

const missing = [];
for (const [name, source] of Object.entries(FROM_STACK)) {
  const value = stack[source];
  if (!value) {
    missing.push(source);
    continue;
  }
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, 'm');
  env = pattern.test(env) ? env.replace(pattern, line) : `${env.trimEnd()}\n${line}\n`;
}
if (missing.length) {
  console.error(`supabase status did not report: ${missing.join(', ')}. Is the stack running?`);
  process.exit(1);
}

writeFileSync(ENV_FILE, env);
console.log(`Wrote ${ENV_FILE} (${Object.keys(FROM_STACK).join(', ')} from the running stack)`);
