// Pre-commit gate: lint + format on staged files, typecheck on the packages they touch.
// Installed by simple-git-hooks (root "prepare"). CI's gate remains the backstop; this
// exists so a broken commit can't be created locally by accident (e.g. `a ; git commit`).
//
// Note: tools read the working tree, not the index. For partially staged files the
// check covers the working-tree version; we never stash to isolate the index, because
// stashing around uncommitted work is how changes get lost.
import { execFileSync, spawnSync } from 'node:child_process';

const staged = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean);
if (staged.length === 0) process.exit(0);

const run = (label, cmd, args) => {
  process.stdout.write(`pre-commit: ${label}\n`);
  const { status } = spawnSync(cmd, args, { stdio: 'inherit' });
  if (status !== 0) {
    process.stderr.write(
      `\npre-commit: ${label} failed. Fix it, or bypass knowingly with --no-verify.\n`,
    );
    process.exit(status ?? 1);
  }
};

const lintable = staged.filter((f) => /\.(c|m)?(t|j)sx?$/.test(f));
if (lintable.length)
  run('eslint (staged files)', 'pnpm', ['exec', 'eslint', '--max-warnings=0', ...lintable]);
run('prettier --check (staged files)', 'pnpm', [
  'exec',
  'prettier',
  '--check',
  '--ignore-unknown',
  ...staged,
]);

// Which packages to typecheck. shared is consumed as dist by api and web, so a change
// there rebuilds it and checks its dependents too. Root config affects everything.
const PACKAGES = {
  'apps/api/': '@covershift/api',
  'apps/web/': '@covershift/web',
  'packages/shared/': '@covershift/shared',
};
const touched = new Set();
let rootConfig = false;
for (const file of staged) {
  const prefix = Object.keys(PACKAGES).find((p) => file.startsWith(p));
  if (prefix) touched.add(PACKAGES[prefix]);
  else if (
    /^(tsconfig[^/]*\.json|eslint\.config\.[cm]?js|package\.json|pnpm-lock\.yaml)$/.test(file)
  )
    rootConfig = true;
}
if (rootConfig || touched.has('@covershift/shared')) {
  Object.values(PACKAGES).forEach((p) => touched.add(p));
}
if (touched.has('@covershift/api') || touched.has('@covershift/web')) {
  run('build @covershift/shared (consumed as dist)', 'pnpm', [
    '--filter',
    '@covershift/shared',
    'build',
  ]);
}
for (const pkg of touched) run(`typecheck ${pkg}`, 'pnpm', ['--filter', pkg, 'typecheck']);
