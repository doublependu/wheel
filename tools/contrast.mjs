// Runs the ?contrast dev page (src/dev/contrast.js) in Chrome on this machine's GPU and prints the
// obstacle/background edge-contrast table for every stage. Needs `npm run dev` running.
//   node tools/contrast.mjs [--tier low|medium|high|ultra] [--url http://localhost:5173] [--webgl]
//                           [--gpu nvidia]   (hybrid laptops: run all of Chrome on the NVIDIA GPU)
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const tier = opt('tier', 'high');
const base = opt('url', 'http://localhost:5173');
const nvidia = opt('gpu', '') === 'nvidia';
const env = { ...process.env, ...(nvidia ? { __NV_PRIME_RENDER_OFFLOAD: '1', __GLX_VENDOR_LIBRARY_NAME: 'nvidia', __VK_LAYER_NV_optimus: 'NVIDIA_only' } : {}) };
const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  env,
  args: ['--enable-features=Vulkan', '--enable-unsafe-webgpu', '--window-size=1600,900', ...(nvidia ? ['--disable-accelerated-2d-canvas'] : [])],
});
const page = await browser.newPage({ viewport: { width: 1536, height: 864 } });
await page.goto(`${base}/?contrast&tier=${tier}${args.includes('--webgl') ? '&webgl=1' : ''}`);
await page.waitForFunction(() => window.__contrast, null, { timeout: 600000, polling: 1000 });
const res = await page.evaluate(() => window.__contrast);
await browser.close();

let fails = 0;
console.log(`tier ${tier}: share of edge samples with ΔL ≥ 0.2 (whole set / worst offset)`);
for (const [era, row] of Object.entries(res)) {
  const cells = Object.entries(row).map(([t, v]) => {
    if (!v.pass) fails++;
    return `${t} ${String(Math.round(v.share * 100)).padStart(3)}%/${String(Math.round(v.worst * 100)).padStart(3)}%${v.pass ? ' ' : '✗'}`;
  });
  console.log(`  stage ${era}: ${cells.join('  ')}`);
}
console.log(fails ? `${fails} failing` : 'all pass');
process.exitCode = fails ? 1 : 0;
