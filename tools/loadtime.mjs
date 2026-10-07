// Measures loading on the production build: the first frame, when the fancy loading wheel starts playing
// (`loader:fancy`, the spec's "page loading done": 2–3 s, 4 s at most) and when the menu is ready
// behind it. Cold cache, Chrome on this machine, CDP network and CPU throttling.
//
//   npm run loadtime -- [--runs 3] [--gpu default|nvidia] [--no-build] [--size 1280x800]
//
// Exits non-zero if `loader:fancy` ever comes later than 4 s.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const RUNS = Number(opt('runs', 3));
const GPU = opt('gpu', 'default');
const [W, H] = opt('size', '1280x800').split('x').map(Number);
const PORT = 4191;
const PROFILES = [
  { name: '50 Mbps / 40 ms', down: 50e6, up: 10e6, rtt: 40, cpu: 1 },
  { name: '10 Mbps / 100 ms / 4× CPU', down: 10e6, up: 2e6, rtt: 100, cpu: 4 },
];

if (!args.includes('--no-build')) execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
const DIST = join(ROOT, 'dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.css': 'text/css' };
const server = createServer((req, res) => {
  let file = join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const env = { ...process.env };
if (GPU === 'nvidia') Object.assign(env, { __NV_PRIME_RENDER_OFFLOAD: '1', __GLX_VENDOR_LIBRARY_NAME: 'nvidia', __VK_LAYER_NV_optimus: 'NVIDIA_only' });
const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  env,
  args: ['--enable-unsafe-webgpu', ...(GPU === 'nvidia' ? ['--enable-features=Vulkan', '--disable-accelerated-2d-canvas'] : []), `--window-size=${W + 20},${H + 140}`],
});

const fmt = (ms) => (ms == null ? '   —  ' : `${(ms / 1000).toFixed(2)} s`);
let worst = 0;
console.log(`\nLoad times (cold cache, ${GPU === 'nvidia' ? 'discrete GPU' : 'default GPU'}, ${W}×${H}, median of ${RUNS}):`);
console.log(`  ${'profile'.padEnd(28)} first paint   fancy wheel (mode)   menu ready   backend`);
for (const p of PROFILES) {
  const runs = [];
  for (let k = 0; k < RUNS; k++) {
    const context = await browser.newContext({ viewport: { width: W, height: H } });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: p.rtt, downloadThroughput: p.down / 8, uploadThroughput: p.up / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'commit' });
    // until the menu's donut is ready behind the wheel (or 20 s)
    await page.waitForFunction(() => performance.getEntriesByName('menu:ready').length || performance.now() > 20000, null, { timeout: 30000, polling: 100 }).catch(() => {});
    const r = await page.evaluate(() => {
      const m = (n) => performance.getEntriesByName(n)[0];
      // the pre-loader's first frame, marked by index.html (Chrome's paint timing is unreliable here:
      // the loader's dots are plain boxes, which first-contentful-paint ignores)
      const paint = m('paint:first');
      const steps = performance.getEntriesByType('mark').filter((e) => e.name.startsWith('3d:')).map((e) => `${e.name.slice(3)} ${(e.startTime / 1000).toFixed(2)}`);
      return { paint: paint?.startTime, fancy: m('loader:fancy')?.startTime, mode: m('loader:fancy')?.detail, menu: m('menu:ready')?.startTime, backend: m('3d:backend')?.detail, steps };
    });
    runs.push(r);
    if (args.includes('--steps')) console.log('   ', r.steps.join(' · '));
    await context.close();
  }
  const med = (key) => {
    const v = runs.map((r) => r[key]).filter((x) => x != null).sort((a, b) => a - b);
    return v.length ? v[v.length >> 1] : null;
  };
  worst = Math.max(worst, ...runs.map((r) => r.fancy ?? Infinity));
  const modes = [...new Set(runs.map((r) => r.mode))].join('/');
  console.log(`  ${p.name.padEnd(28)} ${fmt(med('paint')).padEnd(13)} ${(fmt(med('fancy')) + ` (${modes})`).padEnd(20)} ${fmt(med('menu')).padEnd(12)} ${[...new Set(runs.map((r) => r.backend))].join('/')}`);
}
await browser.close();
server.close();
console.log(`  worst fancy-wheel start: ${fmt(worst)} (spec: 2–3 s, at most 4 s)`);
process.exitCode = worst > 4000 ? 1 : 0;
