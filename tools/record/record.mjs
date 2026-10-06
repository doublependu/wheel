// Plays the whole game hands-free and records it, picture and game audio together, from a real
// Chrome on this machine's GPU (Chrome tab capture + MediaRecorder), then encodes an MP4.
//
//   npm run record -- [--tier ultra] [--seed 7] [--crash 7:40] [--size 1920x1080] [--fps 60]
//                     [--idle 3] [--tail 5] [--out recordings] [--no-build] [--gpu default|nvidia]
//                     [--codec h264|vp9|vp8]
//
// A full-screen Chrome window shows the game for the length of the run (≈ 3½ min); the game
// keeps running if another window takes focus. Best quality when the screen has at least WxH
// device pixels at 16:9. Output: recordings/wheel-<version>-<date>.mp4 plus a .json with frame-time
// stats per stage and a contact sheet with one still per stage.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { execFileSync, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, openSync, writeSync, closeSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);
const [W, H] = opt('size', '1920x1080').split('x').map(Number);
const FPS = Number(opt('fps', 60));
const TIER = opt('tier', 'ultra');
const SEED = opt('seed', '7');
const CRASH = opt('crash', '7:40');
const IDLE = Number(opt('idle', 3));
const TAIL = Number(opt('tail', 5));
const OUT = resolve(ROOT, opt('out', 'recordings'));
// Hybrid-GPU laptops: 'nvidia' runs all of Chrome on the discrete GPU (WebGPU there otherwise loses
// its device) with 2D canvases in software; 'default' leaves GPU choice to Chrome.
const GPU = opt('gpu', 'nvidia');
const CODEC = opt('codec', 'h264'); // h264 | vp9 | vp8 (MediaRecorder); the final MP4 is always H.264
// Headed: headless Chrome has no audio output to capture, and its WebGPU frames are very slow.
const PORT = 4190;

const log = (...a) => console.log('[record]', ...a);

// ---- build and serve dist/ (and the harness) ----
if (!flag('no-build')) execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
const DIST = join(ROOT, 'dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.css': 'text/css', '.wasm': 'application/wasm' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = url.pathname === '/__harness' ? join(ROOT, 'tools/record/harness.html') : join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST) && !file.endsWith('harness.html')) file = join(DIST, 'index.html');
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

// ---- launch Chrome on the GPU ----
const env = { ...process.env };
if (GPU === 'nvidia') Object.assign(env, { __NV_PRIME_RENDER_OFFLOAD: '1', __GLX_VENDOR_LIBRARY_NAME: 'nvidia', __VK_LAYER_NV_optimus: 'NVIDIA_only' });
const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  env,
  args: [
    '--enable-features=Vulkan', // without it, WebGPU on Linux falls back to SwiftShader (CPU)
    '--enable-unsafe-webgpu',
    '--auto-accept-this-tab-capture',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--start-maximized',
    ...(GPU === 'nvidia' ? ['--disable-accelerated-2d-canvas'] : []), // with PRIME, GPU 2D canvases come out black
    ...(flag('vsync') ? [] : ['--disable-gpu-vsync', '--disable-frame-rate-limit']), // render faster than the 60 fps capture samples
  ],
});
// No viewport emulation: tab capture follows the real window. The harness goes full screen and
// gives the game the largest 16:9 area; ffmpeg crops that and scales it to WxH.
const context = await browser.newContext({ viewport: null });
const page = await context.newPage();
page.on('console', (m) => m.type() === 'error' && log('page error:', m.text()));

mkdirSync(OUT, { recursive: true });
const raw = join(OUT, `.raw-${Date.now()}.bin`);
const fd = openSync(raw, 'w');
let bytes = 0;
await page.exposeFunction('saveChunk', (b64) => {
  const buf = Buffer.from(b64, 'base64');
  bytes += buf.length;
  writeSync(fd, buf);
});

const gameUrl = `/?autopilot=human&seed=${SEED}&crash=${CRASH}&tier=${TIER}`;
await page.goto(`http://127.0.0.1:${PORT}/__harness`);
await page.evaluate((o) => (window.__recordOptions = o), { fps: FPS, bitrate: 24_000_000, url: gameUrl, codec: CODEC });
const wallStart = Date.now();
await page.click('#rec');
await page.waitForFunction(() => window.__recordInfo, null, { timeout: 15000 });
const info = await page.evaluate(() => window.__recordInfo);
log('capturing', info.mimeType, `${info.settings.width}x${info.settings.height}@${info.settings.frameRate}`, 'game area', JSON.stringify(info.crop), 'audio tracks', info.audio);

// ---- the game frame: wait for Play, log frame times and stage changes ----
let game = null;
for (let i = 0; i < 100 && !game; i++) {
  game = page.frames().find((f) => f.url().includes('autopilot='));
  if (!game) await page.waitForTimeout(100);
}
await game.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 30000 });
await game.evaluate(() => {
  const L = (window.__rec = { events: [], dts: {}, last: performance.now() });
  let key = '';
  const tick = (now) => {
    const cls = document.body.className;
    const era = (cls.match(/era-(\d)/) ?? [])[1] ?? '0';
    const screen = (cls.match(/screen-(\w+)/) ?? [])[1] ?? '';
    const k = `${screen}:${era}`;
    if (k !== key) {
      key = k;
      L.events.push({ wall: Date.now(), screen, era: Number(era) });
    }
    if (screen === 'run') (L.dts[era] ??= []).push(now - L.last);
    L.last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const adapter = await game.evaluate(async () => {
  const a = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null);
  return a?.info ? `${a.info.vendor} ${a.info.architecture}`.trim() : 'none';
});
log('WebGPU adapter:', adapter);
log(`title is ready; letting the donut run ${IDLE}s, then Play`);
await game.waitForTimeout(IDLE * 1000);
await game.click('#play');
log('playing…');
await game.waitForFunction(() => document.body.classList.contains('screen-over'), null, { timeout: 20 * 60 * 1000, polling: 500 });
log(`game over; ${TAIL}s more`);
await game.waitForTimeout(TAIL * 1000);
const rec = await game.evaluate(() => window.__rec);
await page.evaluate(() => window.stopRecording());
closeSync(fd);
await browser.close();
server.close();
log(`captured ${(bytes / 1e6).toFixed(1)} MB`);

// ---- encode: constant 60 fps H.264 + AAC for sharing ----
const version = execFileSync('git', ['rev-parse', '--short=4', 'HEAD'], { cwd: ROOT }).toString().trim();
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const base = join(OUT, `wheel-v.${version}-${stamp}`);
const ff = (a) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a], { stdio: ['ignore', 'inherit', 'pipe'] });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
  return r;
};
// video: constant frame rate at exactly WxH; audio: loudness-normalised to −14 LUFS (YouTube's target)
const { x, y, w, h } = info.crop;
ff(['-i', raw, '-vf', `fps=${FPS},crop=${w}:${h}:${x}:${y},scale=${W}:${H}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-profile:v', 'high',
  '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-ar', '48000', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', `${base}.mp4`]);
rmSync(raw);

// ---- QA: per-stage frame times, loudness, stills ----
const stats = {};
for (const [era, dts] of Object.entries(rec.dts)) {
  const s = dts.slice(5).sort((a, b) => a - b);
  if (!s.length) continue;
  stats[era] = { frames: s.length, p50: +s[s.length >> 1].toFixed(1), p95: +s[Math.floor(s.length * 0.95)].toFixed(1), over20ms: +((s.filter((v) => v > 20).length / s.length) * 100).toFixed(2) };
}
const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,width,height,avg_frame_rate', '-of', 'json', `${base}.mp4`]).stdout.toString();
const loud = spawnSync('ffmpeg', ['-hide_banner', '-i', `${base}.mp4`, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
const summary = loud.slice(loud.lastIndexOf('Summary:'));
// one still per stage, a few seconds after it arrives
const stills = [];
for (const e of rec.events) {
  if (e.screen !== 'run' || stills.some((s) => s.era === e.era)) continue;
  stills.push({ era: e.era, t: (e.wall - wallStart) / 1000 + 6 });
}
const over = rec.events.find((e) => e.screen === 'over');
if (over) stills.push({ era: 'over', t: (over.wall - wallStart) / 1000 + 2 });
const title = rec.events.find((e) => e.screen === 'title');
if (title) stills.unshift({ era: 'title', t: 2.8 });
const duration = Number(JSON.parse(probe).format?.duration ?? 0);
const tiles = [];
for (const s of stills) {
  const f = `${base}.still-${s.era}.png`;
  ff(['-ss', String(Math.min(Math.max(0, s.t), duration - 0.5)), '-i', `${base}.mp4`, '-frames:v', '1', '-vf', 'scale=640:-2', f]);
  if (existsSync(f)) tiles.push(f);
}
if (tiles.length) {
  const cols = 3;
  ff([...tiles.flatMap((t) => ['-i', t]), '-filter_complex', `${tiles.map((_, i) => `[${i}]`).join('')}xstack=inputs=${tiles.length}:layout=${tiles.map((_, i) => `${(i % cols) * 640}_${Math.floor(i / cols) * 360}`).join('|')}:fill=black`, '-frames:v', '1', `${base}.sheet.png`]);
  for (const t of tiles) rmSync(t);
}
const lastEra = Math.max(...rec.events.map((e) => e.era));
const report = { file: `${base}.mp4`, capture: info, adapter, tier: TIER, seed: SEED, crash: CRASH, gpu: GPU, frameTimesMs: stats, reachedStage: lastEra, probe: JSON.parse(probe), loudness: summary.trim(), events: rec.events.map((e) => ({ ...e, t: +((e.wall - wallStart) / 1000).toFixed(2) })) };
writeFileSync(`${base}.json`, JSON.stringify(report, null, 1));
log('wrote', `${base}.mp4`, `${base}.sheet.png`, `${base}.json`);
log('frame times per stage (ms):', JSON.stringify(stats));
log(summary.split('\n').filter((l) => /I:|Peak:|LRA:/.test(l)).map((l) => l.trim()).join(' | '));
if (lastEra < 7) {
  log(`WARNING: the run ended in stage ${lastEra}, before stage 7. Try another --seed.`);
  process.exitCode = 2;
}
