// Era palettes and palette quantization with ordered (Bayer) dithering.

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// 6×7×6 colour cube + 4 extra greys = 256 colours ("VGA-like").
function palette256() {
  const p = [];
  for (let r = 0; r < 6; r++) for (let g = 0; g < 7; g++) for (let b = 0; b < 6; b++) {
    p.push([Math.round((r * 255) / 5), Math.round((g * 255) / 6), Math.round((b * 255) / 5)]);
  }
  for (const v of [32, 96, 160, 224]) p.push([v, v, v]);
  return p;
}

export const PALETTES = {
  1: ['#0d0d0d', '#f2f2f2'].map(hex),
  2: ['#000000', '#55ffff', '#ff55ff', '#ffffff'].map(hex),
  3: ['#000000', '#0000d7', '#d70000', '#d700d7', '#00d700', '#00d7d7', '#d7d700', '#d7d7d7'].map(hex),
  4: palette256(),
};

export const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);

function nearest(pal, r, g, b) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < pal.length; i++) {
    const c = pal[i];
    const dr = r - c[0];
    const dg = g - c[1];
    const db = b - c[2];
    const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return pal[best];
}

// In-place quantization of ImageData to an era palette. Alpha is thresholded at 50 %.
// dither: strength of the ordered dither in palette-step units (0 = none).
export function quantize(img, era, dither = 0) {
  const d = img.data;
  const w = img.width;
  const pal = PALETTES[era];
  const cube = era === 4;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (d[i + 3] < 128) {
      d[i + 3] = 0;
      continue;
    }
    d[i + 3] = 255;
    const x = p % w;
    const y = (p / w) | 0;
    const t = BAYER4[(y & 3) * 4 + (x & 3)] * dither;
    if (cube) {
      d[i] = Math.round(Math.min(5, Math.max(0, (d[i] / 255) * 5 + t))) * 51;
      d[i + 1] = Math.round((Math.round(Math.min(6, Math.max(0, (d[i + 1] / 255) * 6 + t))) * 255) / 6);
      d[i + 2] = Math.round(Math.min(5, Math.max(0, (d[i + 2] / 255) * 5 + t))) * 51;
    } else {
      const s = t * 96;
      const c = nearest(pal, d[i] + s, d[i + 1] + s, d[i + 2] + s);
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
    }
  }
  return img;
}

export function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

export function quantizeCanvas(canvas, era, dither = 0) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  quantize(img, era, dither);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// Paint `color` into transparent pixels that touch an opaque pixel (1 px outline).
export function outline(canvas, color) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const src = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) src[p] = d[p * 4 + 3] > 0 ? 1 : 0;
  const [r, g, b] = hex(color);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x;
    if (src[p]) continue;
    const n = (x > 0 && src[p - 1]) || (x < w - 1 && src[p + 1]) || (y > 0 && src[p - w]) || (y < h - 1 && src[p + w]);
    if (n) {
      d[p * 4] = r;
      d[p * 4 + 1] = g;
      d[p * 4 + 2] = b;
      d[p * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
