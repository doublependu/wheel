// Fails the build if the critical path (HTML, game core, audio core) exceeds its gzip budget.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { BUDGET } from '../src/config.js';

const dist = new URL('../dist/', import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(dist, '.vite/manifest.json'), 'utf8'));
const gz = (file) => gzipSync(readFileSync(join(dist, file)), { level: 9 }).length;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

function closure(key, seen = new Set()) {
  const chunk = manifest[key];
  if (!chunk || seen.has(key)) return seen;
  seen.add(key);
  for (const imp of chunk.imports ?? []) closure(imp, seen);
  return seen;
}

const entryKey = Object.keys(manifest).find((k) => manifest[k].isEntry);
const core = closure(entryKey);
const coreBytes = [...core].reduce((s, k) => s + gz(manifest[k].file) + (manifest[k].css ?? []).reduce((a, c) => a + gz(c), 0), 0);
const htmlBytes = gz('index.html');

const audioKey = Object.keys(manifest).find((k) => k.endsWith('audio/engine.js'));
const audioChunks = audioKey ? [...closure(audioKey)].filter((k) => !core.has(k)) : [];
const audioBytes = audioChunks.reduce((s, k) => s + gz(manifest[k].file), 0);

const rows = [
  ['index.html', htmlBytes, BUDGET.html],
  ['game core (entry + static imports)', coreBytes, BUDGET.core],
  ['audio core', audioBytes, BUDGET.audioCore],
];
let failed = false;
console.log('\nCritical-path budget (gzip):');
for (const [name, size, budget] of rows) {
  const ok = size <= budget;
  failed ||= !ok;
  console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(38)} ${kb(size).padStart(9)} / ${kb(budget)}`);
}

// Informational: everything else (lazy chunks and assets).
const all = [];
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f === '.vite') continue;
    if (statSync(p).isDirectory()) walk(p);
    else all.push(p.slice(dist.length));
  }
};
walk(dist);
const lazy = all.filter((f) => f.startsWith('assets/'));
const total = lazy.reduce((s, f) => s + gz(f), 0);
console.log(`  · all assets (lazy included)               ${kb(total).padStart(9)}`);
if (failed) {
  console.error('\nBudget exceeded.');
  process.exit(1);
}
