// Dev tool (?contrast, dev server only): measures how well each obstacle separates from its
// background in every stage. For each stage × obstacle × scroll offset it renders the obstacle
// over the real background, finds the silhouette edge and compares OKLab lightness just outside
// the edge with the most contrasting pixel up to 3 px inside it (so an outline or the body
// counts). Bottom edges are skipped: that's where an obstacle meets the ground. A case passes when ≥ 85 % of its edge samples differ by ΔL ≥ 0.2.
import { OBSTACLES } from '../config.js';

export const PASS_DL = 0.2;
export const PASS_SHARE = 0.85;
const OFFSETS = [3.1, 4.4, 5.7, 7.2, 8.9, 10.6];
const TYPES = Object.keys(OBSTACLES);

const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function okL(r, g, b) {
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

// Edge contrast of `mask` (Uint8 per pixel) over `rgba` (same size). `step` = how far outside the
// edge the background is sampled (2 for anti-aliased 3D frames).
export function edgeContrast(rgba, mask, w, h, step = 1, marks = null) {
  const L = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) L[p] = okL(rgba[p * 4], rgba[p * 4 + 1], rgba[p * 4 + 2]);
  const dl = [];
  const dirs = [[1, 0], [-1, 0], [0, -1]]; // not downwards: obstacles stand on the ground
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    for (const [dx, dy] of dirs) {
      const ox = x + dx * step, oy = y + dy * step;
      if (ox < 0 || oy < 0 || ox >= w || oy >= h || mask[oy * w + ox]) continue;
      if (mask[(y + dy) * w + (x + dx)]) continue; // only true boundary pixels
      const out = L[oy * w + ox];
      let best = 0;
      for (let k = 0; k < 3; k++) {
        const ix = x - dx * k, iy = y - dy * k; // inside: every pixel, so a thin outline or rim counts
        if (ix < 0 || iy < 0 || ix >= w || iy >= h || !mask[iy * w + ix]) break;
        best = Math.max(best, Math.abs(L[iy * w + ix] - out));
      }
      dl.push(best);
      marks?.push(x, y, best >= PASS_DL ? 1 : 0);
    }
  }
  dl.sort((a, b) => a - b);
  const share = dl.length ? dl.filter((v) => v >= PASS_DL).length / dl.length : 0;
  return { samples: dl.length, share, median: dl[dl.length >> 1] ?? 0, p10: dl[Math.floor(dl.length * 0.1)] ?? 0 };
}

const fakeWorld = (type, dist, offset) => ({
  dist, t: 0, era: 1, alive: true, speed: 0, section: null,
  cat: { y: 0, vy: 0, onGround: true, phase: 0.3 },
  // a unique id per type and offset: the 3D view reuses meshes by obstacle id
  obstacles: [{ id: 1000 + TYPES.indexOf(type) * 100 + Math.round(offset * 10), type, x: dist + offset, def: OBSTACLES[type], seed: 0 }],
});

function merge(cases) {
  const s = cases.reduce((a, c) => a + c.samples, 0) || 1;
  return {
    share: cases.reduce((a, c) => a + c.share * c.samples, 0) / s,
    worst: Math.min(...cases.map((c) => c.share)),
    median: cases.map((c) => c.median).sort((a, b) => a - b)[cases.length >> 1],
  };
}

// 2D stages: render into the stage's virtual canvas; the mask comes from the sprite's alpha.
export function measure2D(r2d, era) {
  r2d.prepare(era);
  const out = {};
  for (const type of TYPES) {
    const cases = [];
    for (const off of OFFSETS) {
      const dist = off * 37.3;
      const world = fakeWorld(type, dist, off);
      const ev = r2d.renderEra(era, world, 0, { cat: false });
      const { canvas, vw, vh, groundY, ppu, catX } = ev;
      const rgba = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, vw, vh).data;
      const f = r2d.sprites[era].obstacles[type][0];
      const sx = catX + Math.round(off * ppu) - f.ox;
      const sy = groundY - f.oy;
      const sa = f.canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, f.canvas.width, f.canvas.height).data;
      const mask = new Uint8Array(vw * vh);
      for (let y = 0; y < f.canvas.height; y++) for (let x = 0; x < f.canvas.width; x++) {
        const X = sx + x, Y = sy + y;
        if (X >= 0 && Y >= 0 && X < vw && Y < vh && sa[(y * f.canvas.width + x) * 4 + 3] > 127) mask[Y * vw + X] = 1;
      }
      cases.push(edgeContrast(rgba, mask, vw, vh, 1));
    }
    out[type] = merge(cases);
  }
  return out;
}

// 3D stages: a normal frame, then an off-screen mask (obstacles white on black, no post) from the
// same camera.
export async function measure3D(g3d, era) {
  const w3 = g3d.world3d;
  const canvas = g3d.renderer.domElement;
  const grab = () => {
    const c = document.createElement('canvas');
    c.width = canvas.width;
    c.height = canvas.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0);
    return ctx.getImageData(0, 0, c.width, c.height).data;
  };
  const out = {};
  for (const type of TYPES) {
    const cases = [];
    for (const off of OFFSETS.slice(0, 4)) {
      // scroll at running speed like gameplay, so temporal effects (TRAA, motion blur) see real
      // motion and history, then hold the last 3 frames still: some pipelines show the previous
      // frame's pass, which would put a moving obstacle a few pixels off its mask
      const SPEED = 6.5;
      const d0 = off * 37.3;
      const world = fakeWorld(type, d0, off);
      const ob = world.obstacles[0];
      ob.x = d0 + 16 * (SPEED / 60) + off;
      // one render per animation frame, like the game loop: post passes render once per frame
      let rgba = null;
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        world.dist = d0 + Math.min(i, 16) * (SPEED / 60);
        w3.render(world, era, i / 60, 1 / 60, null);
        if (i === 19) rgba = grab();
      }
      const m = await w3.renderMask(world, era, 19 / 60); // same flap pose as the last frame
      if (m.width !== canvas.width || m.height !== canvas.height) throw new Error('mask size mismatch');
      const mask = new Uint8Array(canvas.width * canvas.height);
      for (let p = 0; p < mask.length; p++) mask[p] = m.data[p * 4] > 127 ? 1 : 0;
      cases.push(edgeContrast(rgba, mask, canvas.width, canvas.height, 2));
      await new Promise((r) => setTimeout(r, 0));
    }
    out[type] = merge(cases);
  }
  return out;
}

// Runs every stage and returns { era: { type: { share, worst, median, pass } } }.
export async function runContrast({ r2d, g3d }) {
  const res = {};
  for (const era of [1, 2, 3, 4]) res[era] = measure2D(r2d, era);
  if (g3d) {
    await g3d.prepareWorld();
    g3d.hideWheel(); // the title donut shares the canvas
    for (const era of [5, 6, 7]) if (g3d.isReady(era)) res[era] = await measure3D(g3d, era);
  }
  for (const r of Object.values(res)) for (const v of Object.values(r)) v.pass = v.worst >= PASS_SHARE * 0.9 && v.share >= PASS_SHARE;
  return res;
}
