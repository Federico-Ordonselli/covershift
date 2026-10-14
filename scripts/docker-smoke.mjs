// Smoke-tests the production API image against the local Supabase stack, run the way ECS
// would run it: read-only root filesystem, all capabilities dropped, no privilege
// escalation, non-root user, and only the environment the API needs (no migration URL,
// no Supabase keys). Needs `pnpm db:start && pnpm db:migrate && pnpm db:seed`.
//
//   pnpm docker:smoke            build the image, then test it
//   pnpm docker:smoke --no-build test an existing covershift-api:local
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const IMAGE = 'covershift-api:local';
const NAME = 'covershift-api-smoke';
const PORT = 3999;
const env = Object.fromEntries(
  readFileSync('apps/api/.env', 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const docker = (args, opts = {}) => execFileSync('docker', args, { encoding: 'utf8', ...opts });
const step = (msg) => console.log(`docker-smoke: ${msg}`);
const fail = (msg) => {
  console.error(`docker-smoke: FAILED: ${msg}`);
  spawnSync('docker', ['logs', '--tail', '40', NAME], { stdio: 'inherit' });
  spawnSync('docker', ['rm', '-f', NAME], { stdio: 'ignore' });
  process.exit(1);
};
const hardened = [
  '--read-only',
  '--tmpfs',
  '/tmp:size=16m',
  '--cap-drop',
  'ALL',
  '--security-opt',
  'no-new-privileges',
  '--network',
  'host',
];

if (!process.argv.includes('--no-build')) {
  step(`building ${IMAGE}`);
  docker(['build', '-q', '-f', 'apps/api/Dockerfile', '-t', IMAGE, '.'], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

const user = docker(['image', 'inspect', IMAGE, '--format', '{{.Config.User}}']).trim();
if (user !== 'nonroot') fail(`image user is "${user}", expected nonroot`);
step('image runs as nonroot');

step('migrations from the same image (one-off task, privileged URL)');
const migrate = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    ...hardened,
    '-e',
    `DATABASE_MIGRATION_URL=${env.DATABASE_MIGRATION_URL}`,
    IMAGE,
    'dist/migrate.js',
  ],
  { encoding: 'utf8' },
);
if (migrate.status !== 0 || !/Up to date|Applied:/.test(migrate.stdout))
  fail(`migrate: ${migrate.stdout}${migrate.stderr}`);

spawnSync('docker', ['rm', '-f', NAME], { stdio: 'ignore' });
step('starting the API (read-only root fs, no capabilities, API env only)');
docker([
  'run',
  '-d',
  '--name',
  NAME,
  ...hardened,
  '-e',
  `PORT=${PORT}`,
  '-e',
  `DATABASE_URL=${env.DATABASE_URL}`,
  '-e',
  `SUPABASE_URL=${env.SUPABASE_URL}`,
  IMAGE,
]);
const inspect = JSON.parse(docker(['inspect', NAME]))[0];
if (!inspect.HostConfig.ReadonlyRootfs) fail('root filesystem is not read-only');

const base = `http://127.0.0.1:${PORT}`;
let healthy = false;
for (let i = 0; i < 40 && !healthy; i++) {
  healthy = await fetch(`${base}/health`).then(
    (r) => r.ok,
    () => false,
  );
  if (!healthy) await new Promise((r) => setTimeout(r, 500));
}
if (!healthy) fail('/health never answered 200');
step('GET /health → 200');

const anon = await fetch(`${base}/me`);
const anonBody = await anon.json();
if (anon.status !== 401 || anonBody.code !== 'UNAUTHORIZED')
  fail(`/me without a token → ${anon.status} ${JSON.stringify(anonBody)}`);
step('GET /me without a token → 401 UNAUTHORIZED');

const login = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json' },
  body: JSON.stringify({
    email: 'sam@covershift.test',
    password: process.env.SEED_PASSWORD ?? 'covershift-demo',
  }),
}).then((r) => r.json());
if (!login.access_token) fail(`GoTrue login: ${JSON.stringify(login)}`);
const me = await fetch(`${base}/me`, {
  headers: { authorization: `Bearer ${login.access_token}` },
});
const meBody = await me.json();
if (
  me.status !== 200 ||
  meBody.email !== 'sam@covershift.test' ||
  meBody.memberships.length === 0
) {
  fail(`/me with a real token → ${me.status} ${JSON.stringify(meBody)}`);
}
step(
  `GET /me with a real token → 200 (${meBody.fullName}, ${meBody.memberships.length} membership)`,
);

const shifts = await fetch(`${base}/shifts?limit=5`, {
  headers: { authorization: `Bearer ${login.access_token}` },
});
if (shifts.status !== 200 || (await shifts.json()).items.length === 0)
  fail('GET /shifts under RLS returned nothing');
step('GET /shifts under RLS → 200 with rows');

docker(['rm', '-f', NAME]);
step('OK');
