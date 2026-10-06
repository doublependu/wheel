// Warn when deploying uncommitted code: the on-screen version names HEAD, not the working tree.
import { execSync } from 'node:child_process';

try {
  const dirty = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  if (dirty) {
    console.warn('\n⚠  Working tree has uncommitted changes. The deployed version tag will point at HEAD,');
    console.warn('   but the uncommitted code will be deployed too.\n');
  }
} catch {
  console.warn('⚠  Not a git checkout: version will be "v.dev" unless WORKERS_CI_COMMIT_SHA is set.');
}
