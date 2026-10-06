// Turns the Blender obstacle renders (tools/blender/render_obstacle_sprites.py) into pixel art for
// the 2D stages: area-downsample to each stage's pixel density, threshold alpha, map colours to the
// stage palette, add a 1 px outline, then pack everything into one atlas.
//   node tools/build-obstacle-sprites.mjs [renders dir]  →  src/assets/obstacles.{png,json}
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { PALETTES, quantize } from '../src/render2d/palettes.js';
import { PPU } from '../src/config.js';
import { OBSTACLE_LOOK } from './obstacle-look.mjs';

const SRC = process.argv[2] ?? new URL('./blender/.out/sprites/', import.meta.url).pathname;
const OUT = new URL('../src/assets/', import.meta.url).pathname;
const meta = JSON.parse(readFileSync(join(SRC, 'meta.json'), 'utf8'));
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// ---- colour helpers ----
const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function oklab([r, g, b]) {
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function hsv([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx];
}
const luma = ([r, g, b]) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;

// Colour family of a rendered pixel: white / dark / grey, else a hue family.
function family(c) {
  const [h, sat] = hsv(c);
  const L = luma(c);
  if (L > 0.85 && sat < 0.2) return 'white';
  if (L < 0.2) return 'dark';
  if (sat < 0.25) return 'grey';
  if (h < 15 || h >= 335) return 'red';
  if (h < 45) return 'orange';
  if (h < 70) return 'yellow';
  if (h < 170) return 'green';
  if (h < 200) return 'cyan';
  if (h < 260) return 'blue';
  return 'magenta';
}

// Stage colour mappers: rgb → rgb. `inner` = pixel is not on the silhouette border.
const MAPPERS = {
  // 1-bit: black silhouette, white only for white details (eyes, glints) inside it.
  1: (c, inner) => (inner && family(c) === 'white' ? hex('#f2f2f2') : hex('#0d0d0d')),
  // CGA and 3-bit RGB: each colour family maps to a small ramp (dark → light) of the stage palette.
  2: (c, inner, look) => ramp(look.families, c),
  3: (c, inner, look) => ramp(look.families, c),
};

function ramp(families, c) {
  const r = families[family(c)] ?? families.grey;
  const L = luma(c);
  const i = r.length === 1 ? 0 : r.length === 2 ? (L < 0.42 ? 0 : 1) : L < 0.35 ? 0 : L < 0.7 ? 1 : 2;
  return hex(r[i]);
}

// Area-average the RGBA render down by `f`, keeping the ground origin on a pixel edge.
function downsample(src, w, h, f, ox, oy) {
  const oxo = Math.round(ox / f);
  const oyo = Math.round(oy / f);
  const gx = ox - oxo * f;
  const gy = oy - oyo * f;
  const W = Math.ceil((w - gx) / f);
  const H = Math.ceil((h - gy) / f);
  const out = new Float32Array(W * H * 4);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let a = 0, r = 0, g = 0, b = 0, n = 0;
    const x0 = Math.round(gx + i * f), y0 = Math.round(gy + j * f);
    for (let y = y0; y < y0 + f; y++) for (let x = x0; x < x0 + f; x++) {
      n++;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const k = (y * w + x) * 4;
      const al = src[k + 3] / 255;
      a += al;
      r += src[k] * al;
      g += src[k + 1] * al;
      b += src[k + 2] * al;
    }
    const o = (j * W + i) * 4;
    out[o] = a ? r / a : 0;
    out[o + 1] = a ? g / a : 0;
    out[o + 2] = a ? b / a : 0;
    out[o + 3] = a / n;
  }
  return { data: out, w: W, h: H, ox: oxo, oy: oyo };
}

function toPixelArt(img, era, name) {
  const look = OBSTACLE_LOOK[era];
  const pad = 1; // room for the outline
  const W = img.w + pad * 2;
  const H = img.h + pad * 2;
  const solid = new Uint8Array(W * H);
  for (let j = 0; j < img.h; j++) for (let i = 0; i < img.w; i++) if (img.data[(j * img.w + i) * 4 + 3] >= (look.alpha ?? 0.5)) solid[(j + pad) * W + i + pad] = 1;
  const px = new Uint8ClampedArray(W * H * 4);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const p = j * W + i;
    if (!solid[p]) continue;
    const s = ((j - pad) * img.w + (i - pad)) * 4;
    const c = [img.data[s], img.data[s + 1], img.data[s + 2]].map((v) => Math.round(v));
    const inner = solid[p - 1] && solid[p + 1] && solid[p - W] && solid[p + W];
    const k = p * 4;
    px[k + 3] = 255;
    if (era === 4) {
      [px[k], px[k + 1], px[k + 2]] = c;
    } else {
      const m = MAPPERS[era](c, inner, look);
      [px[k], px[k + 1], px[k + 2]] = m;
    }
  }
  if (era === 4) quantize({ data: px, width: W, height: H }, 4, look.dither ?? 0.5);
  const oc = look.outline?.[name] ?? look.outline?.default;
  if (oc) {
    const [r, g, b] = hex(oc);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const p = j * W + i;
      if (solid[p]) continue;
      const n = (i > 0 && solid[p - 1]) || (i < W - 1 && solid[p + 1]) || (j > 0 && solid[p - W]) || (j < H - 1 && solid[p + W]);
      if (!n) continue;
      px[p * 4] = r;
      px[p * 4 + 1] = g;
      px[p * 4 + 2] = b;
      px[p * 4 + 3] = 255;
    }
  }
  return { px, w: W, h: H, ox: img.ox + pad, oy: img.oy + pad };
}

// ---- build every stage × obstacle × frame ----
const sprites = [];
for (const era of [1, 2, 3, 4]) {
  const f = meta.ppu / PPU[era];
  for (const [name, frames] of Object.entries(meta.frames)) {
    const pick = name === 'crow' && era < 4 ? [frames[0], frames[2]] : frames; // 2-frame flap until 256 colours
    for (const fr of pick) {
      const { data, info } = await sharp(join(SRC, fr.file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const small = downsample(data, info.width, info.height, f, fr.ox, fr.oy);
      sprites.push({ era, name, ...toPixelArt(small, era, name) });
    }
  }
}

// ---- shelf-pack into one atlas ----
const ATLAS_W = 256;
let x = 0, y = 0, rowH = 0;
for (const s of [...sprites].sort((a, b) => b.h - a.h)) {
  if (x + s.w > ATLAS_W) {
    x = 0;
    y += rowH;
    rowH = 0;
  }
  s.x = x;
  s.y = y;
  x += s.w;
  rowH = Math.max(rowH, s.h);
}
const ATLAS_H = y + rowH;
const atlas = Buffer.alloc(ATLAS_W * ATLAS_H * 4);
const json = { w: ATLAS_W, h: ATLAS_H, ppu: Object.fromEntries([1, 2, 3, 4].map((e) => [e, PPU[e]])), eras: {} };
for (const s of sprites) {
  for (let j = 0; j < s.h; j++) Buffer.from(s.px.buffer, j * s.w * 4, s.w * 4).copy(atlas, ((s.y + j) * ATLAS_W + s.x) * 4);
  ((json.eras[s.era] ??= {})[s.name] ??= []).push([s.x, s.y, s.w, s.h, s.ox, s.oy]);
}
mkdirSync(OUT, { recursive: true });
await sharp(atlas, { raw: { width: ATLAS_W, height: ATLAS_H, channels: 4 } }).png({ compressionLevel: 9, palette: false }).toFile(join(OUT, 'obstacles.png'));
writeFileSync(join(OUT, 'obstacles.json'), JSON.stringify(json));
const kb = (readFileSync(join(OUT, 'obstacles.png')).length / 1024).toFixed(1);
console.log(`obstacle atlas ${ATLAS_W}×${ATLAS_H}, ${sprites.length} sprites, ${kb} KB → src/assets/obstacles.{png,json}`);
