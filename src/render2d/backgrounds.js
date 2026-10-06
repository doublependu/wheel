// Per-era background layers. Each layer is a horizontally tileable canvas at virtual-pixel
// resolution, generated once per era and viewport size, then scrolled with parallax.
import { makeCanvas, quantizeCanvas } from './palettes.js';
import { createRng } from '../sim/rng.js';

const TAU = Math.PI * 2;

// Each layer: { canvas, parallax, top } where `top` is the canvas's y offset relative to the
// ground line in virtual px (negative = above ground).
export function buildBackground(era, vw, vh, groundY, ppu) {
  const tileW = Math.max(64, Math.ceil(vw * 1.5));
  const rng = createRng(era * 101 + 7);
  const B = BUILDERS[era];
  return B({ era, vw, vh, groundY, ppu, tileW, rng });
}

function layer(w, h) {
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return { canvas, ctx };
}

function cloud(ctx, x, y, s, fill, line) {
  const blobs = [[0, 0, 1], [0.9, 0.25, 0.8], [-0.9, 0.3, 0.7], [0.3, -0.5, 0.7]];
  if (line) {
    ctx.fillStyle = line;
    for (const [bx, by, r] of blobs) {
      ctx.beginPath();
      ctx.arc(x + bx * s, y + by * s, r * s + 1, 0, TAU);
      ctx.fill();
    }
  }
  ctx.fillStyle = fill;
  for (const [bx, by, r] of blobs) {
    ctx.beginPath();
    ctx.arc(x + bx * s, y + by * s, r * s, 0, TAU);
    ctx.fill();
  }
}

function hills(ctx, w, h, base, amp, color, rng, freq = 3) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, h);
  const k = [rng() * TAU, rng() * TAU];
  for (let x = 0; x <= w; x++) {
    const t = (x / w) * TAU;
    const y = base - amp * (0.6 * Math.sin(t * freq + k[0]) + 0.4 * Math.sin(t * (freq * 2 + 1) + k[1]));
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
}

// Punch a checkerboard of holes into the lower part of a layer (cheap 2-colour dither).
function checker(ctx, w, h, from) {
  const y0 = Math.floor(h * from);
  for (let y = y0; y < h; y++) for (let x = (y & 1); x < w; x += 2) ctx.clearRect(x, y, 1, 1);
}

const BUILDERS = {
  // 1-bit: white sky, single ground line with specks, outlined clouds.
  1({ tileW, ppu, rng }) {
    const sky = { color: '#f2f2f2' };
    const g = layer(tileW, Math.ceil(ppu * 0.6));
    g.ctx.fillStyle = '#0d0d0d';
    g.ctx.fillRect(0, 0, tileW, 1);
    for (let x = 0; x < tileW; x += 2) {
      const r = rng();
      if (r < 0.06) g.ctx.fillRect(x, 0, Math.ceil(rng() * 4), 1 + (r < 0.02 ? 1 : 0)); // bump
      if (r > 0.82) g.ctx.fillRect(x, 3 + Math.floor(rng() * ppu * 0.4), r > 0.95 ? 2 : 1, 1);
    }
    const c = layer(tileW, ppu * 3);
    for (let i = 0; i < 3; i++) cloud(c.ctx, (i + rng() * 0.6) * (tileW / 3), ppu * (0.8 + rng() * 1.6), ppu * 0.28, '#f2f2f2', '#0d0d0d');
    quantizeCanvas(c.canvas, 1);
    return { sky, layers: [{ canvas: c.canvas, parallax: 0.15, top: -ppu * 4.6 }], ground: { canvas: g.canvas, top: 0 } };
  },

  // CGA: black sky with stars, magenta hills, cyan dithered ground.
  2({ tileW, ppu, rng, vh, groundY }) {
    const sky = { color: '#000000' };
    const st = layer(tileW, Math.max(1, groundY));
    st.ctx.fillStyle = '#ffffff';
    for (let i = 0; i < tileW / 6; i++) st.ctx.fillRect(Math.floor(rng() * tileW), Math.floor(rng() * groundY * 0.8), 1, 1);
    st.ctx.fillStyle = '#55ffff';
    st.ctx.beginPath();
    st.ctx.arc(tileW * 0.7, groundY * 0.25, ppu * 0.6, 0, TAU);
    st.ctx.fill();
    st.ctx.fillStyle = '#000000';
    st.ctx.beginPath();
    st.ctx.arc(tileW * 0.7 + ppu * 0.25, groundY * 0.25 - ppu * 0.1, ppu * 0.5, 0, TAU);
    st.ctx.fill();
    const hl = layer(tileW, ppu * 3);
    hills(hl.ctx, tileW, ppu * 3, ppu * 1.8, ppu * 0.9, '#ff55ff', rng, 3);
    quantizeCanvas(hl.canvas, 2);
    checker(hl.ctx, tileW, ppu * 3, 0.55);
    const groundH = Math.max(4, vh - groundY);
    const g = layer(tileW, groundH);
    g.ctx.fillStyle = '#55ffff';
    g.ctx.fillRect(0, 0, tileW, 2);
    for (let y = 3; y < groundH; y++) for (let x = (y & 1) * 2; x < tileW; x += 4) if (rng() < 0.55 - y / groundH / 2) g.ctx.fillRect(x, y, 1, 1);
    return {
      sky,
      layers: [
        { canvas: st.canvas, parallax: 0.03, top: -groundY },
        { canvas: hl.canvas, parallax: 0.3, top: -ppu * 3 },
      ],
      ground: { canvas: g.canvas, top: 0 },
    };
  },

  // 3-bit RGB: blue sky, yellow sun, white clouds, red-roofed houses, green ground.
  3({ tileW, ppu, rng, vh, groundY }) {
    const sky = { color: '#0000d7' };
    const sun = layer(Math.ceil(ppu * 1.6), Math.ceil(ppu * 1.6));
    sun.ctx.fillStyle = '#d7d700';
    sun.ctx.beginPath();
    sun.ctx.arc(ppu * 0.8, ppu * 0.8, ppu * 0.7, 0, TAU);
    sun.ctx.fill();
    quantizeCanvas(sun.canvas, 3);
    const cl = layer(tileW, ppu * 2);
    for (let i = 0; i < 4; i++) cloud(cl.ctx, (i + rng() * 0.5) * (tileW / 4), ppu * (0.6 + rng() * 0.8), ppu * 0.3, '#d7d7d7');
    quantizeCanvas(cl.canvas, 3);
    const hs = layer(tileW, ppu * 3);
    let x = 0;
    while (x < tileW - ppu * 1.2) {
      const w = Math.round(ppu * (0.9 + rng() * 0.8));
      const h = Math.round(ppu * (0.8 + rng() * 1.0));
      const base = ppu * 3;
      hs.ctx.fillStyle = '#d7d7d7';
      hs.ctx.fillRect(x, base - h, w, h);
      hs.ctx.fillStyle = '#d70000';
      hs.ctx.beginPath();
      hs.ctx.moveTo(x - 2, base - h);
      hs.ctx.lineTo(x + w / 2, base - h - ppu * 0.5);
      hs.ctx.lineTo(x + w + 2, base - h);
      hs.ctx.fill();
      hs.ctx.fillStyle = '#000000';
      const win = Math.max(2, Math.round(ppu * 0.16));
      for (let wy = base - h + win; wy < base - win * 2; wy += win * 2) for (let wx = x + win; wx < x + w - win; wx += win * 2) hs.ctx.fillRect(wx, wy, win, win);
      x += w + Math.round(ppu * (0.2 + rng() * 0.8));
    }
    quantizeCanvas(hs.canvas, 3);
    const groundH = Math.max(4, vh - groundY);
    const g = layer(tileW, groundH);
    g.ctx.fillStyle = '#00d700';
    g.ctx.fillRect(0, 0, tileW, groundH);
    g.ctx.fillStyle = '#000000';
    for (let y = 2; y < groundH; y += 2) for (let x2 = 0; x2 < tileW; x2++) if (rng() < 0.08 + (y / groundH) * 0.3) g.ctx.fillRect(x2, y, 1, 1);
    g.ctx.fillStyle = '#00d700';
    for (let x2 = 0; x2 < tileW; x2 += 3) if (rng() < 0.3) g.ctx.fillRect(x2, -1, 1, 2);
    const grass = layer(tileW, 3);
    grass.ctx.fillStyle = '#00d700';
    for (let x2 = 0; x2 < tileW; x2 += 2) if (rng() < 0.35) grass.ctx.fillRect(x2, rng() < 0.5 ? 0 : 1, 1, 3);
    return {
      sky,
      layers: [
        { canvas: sun.canvas, parallax: 0, top: -groundY + Math.round(ppu * 0.6), fixedX: 0.72 },
        { canvas: cl.canvas, parallax: 0.12, top: -groundY + Math.round(ppu * 0.3) },
        { canvas: hs.canvas, parallax: 0.45, top: -ppu * 3 },
        { canvas: grass.canvas, parallax: 1, top: -3 },
      ],
      ground: { canvas: g.canvas, top: 0 },
    };
  },

  // 256 colours: dithered sunset, mountains, town with lit windows, fence, rich ground.
  4({ tileW, ppu, rng, vh, groundY }) {
    const skyH = Math.max(1, groundY + 2);
    const sk = layer(4, skyH);
    const grad = sk.ctx.createLinearGradient(0, 0, 0, skyH);
    grad.addColorStop(0, '#1e1446');
    grad.addColorStop(0.45, '#6a2f7a');
    grad.addColorStop(0.75, '#d0566a');
    grad.addColorStop(1, '#f7b25c');
    sk.ctx.fillStyle = grad;
    sk.ctx.fillRect(0, 0, 4, skyH);
    quantizeCanvas(sk.canvas, 4, 0.9);
    const sky = { canvas: sk.canvas };
    const sun = layer(Math.ceil(ppu * 2.4), Math.ceil(ppu * 2.4));
    const sg = sun.ctx.createRadialGradient(ppu * 1.2, ppu * 1.2, 0, ppu * 1.2, ppu * 1.2, ppu * 1.2);
    sg.addColorStop(0, '#fff2c0');
    sg.addColorStop(0.55, '#ffd27a');
    sg.addColorStop(0.56, 'rgba(255,190,110,0.55)');
    sg.addColorStop(1, 'rgba(255,160,90,0)');
    sun.ctx.fillStyle = sg;
    sun.ctx.fillRect(0, 0, ppu * 2.4, ppu * 2.4);
    quantizeCanvas(sun.canvas, 4, 0.9);
    const mt = layer(tileW, ppu * 3);
    hills(mt.ctx, tileW, ppu * 3, ppu * 1.5, ppu * 1.2, '#4a2a68', rng, 2);
    hills(mt.ctx, tileW, ppu * 3, ppu * 2.1, ppu * 0.6, '#5e3274', rng, 4);
    quantizeCanvas(mt.canvas, 4, 0.6);
    const town = layer(tileW, ppu * 3);
    let x = 0;
    while (x < tileW - ppu) {
      const w = Math.round(ppu * (0.6 + rng() * 0.9));
      const h = Math.round(ppu * (0.7 + rng() * 1.6));
      const base = ppu * 3;
      town.ctx.fillStyle = '#2a1838';
      town.ctx.fillRect(x, base - h, w, h);
      if (rng() < 0.5) {
        town.ctx.beginPath();
        town.ctx.moveTo(x - 1, base - h);
        town.ctx.lineTo(x + w / 2, base - h - ppu * 0.35);
        town.ctx.lineTo(x + w + 1, base - h);
        town.ctx.fill();
      }
      const win = Math.max(2, Math.round(ppu * 0.1));
      for (let wy = base - h + win * 2; wy < base - win * 2; wy += win * 3) for (let wx = x + win; wx < x + w - win; wx += win * 3) {
        town.ctx.fillStyle = rng() < 0.55 ? '#ffd27a' : '#3a2448';
        town.ctx.fillRect(wx, wy, win, win);
      }
      x += w + Math.round(rng() * ppu * 0.3);
    }
    quantizeCanvas(town.canvas, 4);
    const fence = layer(tileW, Math.ceil(ppu * 0.9));
    const fh = Math.ceil(ppu * 0.9);
    fence.ctx.fillStyle = '#5a3a2a';
    fence.ctx.fillRect(0, Math.round(fh * 0.35), tileW, Math.max(1, Math.round(ppu * 0.06)));
    fence.ctx.fillRect(0, Math.round(fh * 0.7), tileW, Math.max(1, Math.round(ppu * 0.06)));
    const pw = Math.max(2, Math.round(ppu * 0.12));
    for (let px = 0; px < tileW; px += Math.round(ppu * 0.5)) {
      fence.ctx.fillStyle = '#6e4a34';
      fence.ctx.fillRect(px, Math.round(fh * 0.1), pw, fh);
      fence.ctx.fillStyle = '#8a6040';
      fence.ctx.fillRect(px, Math.round(fh * 0.1), 1, fh);
    }
    quantizeCanvas(fence.canvas, 4);
    const groundH = Math.max(4, vh - groundY);
    const g = layer(tileW, groundH);
    const gg = g.ctx.createLinearGradient(0, 0, 0, groundH);
    gg.addColorStop(0, '#3a6a2a');
    gg.addColorStop(0.08, '#2c4a22');
    gg.addColorStop(0.1, '#4a3424');
    gg.addColorStop(1, '#22160e');
    g.ctx.fillStyle = gg;
    g.ctx.fillRect(0, 0, tileW, groundH);
    for (let i = 0; i < tileW * groundH * 0.03; i++) {
      g.ctx.fillStyle = rng() < 0.5 ? '#5a4030' : '#2a1c12';
      g.ctx.fillRect(Math.floor(rng() * tileW), Math.floor(4 + rng() * (groundH - 4)), 2, 1);
    }
    quantizeCanvas(g.canvas, 4, 0.6);
    const grass = layer(tileW, 4);
    for (let x2 = 0; x2 < tileW; x2++) {
      if (rng() < 0.5) {
        grass.ctx.fillStyle = rng() < 0.5 ? '#5aa03a' : '#4a8a30';
        grass.ctx.fillRect(x2, Math.floor(rng() * 3), 1, 4);
      }
    }
    quantizeCanvas(grass.canvas, 4);
    return {
      sky,
      layers: [
        { canvas: sun.canvas, parallax: 0, top: -Math.round(ppu * 2.9), fixedX: 0.62 },
        { canvas: mt.canvas, parallax: 0.08, top: -ppu * 3 },
        { canvas: town.canvas, parallax: 0.25, top: -ppu * 3 },
        { canvas: fence.canvas, parallax: 0.6, top: -fh },
        { canvas: grass.canvas, parallax: 1, top: -3 },
      ],
      ground: { canvas: g.canvas, top: 0 },
    };
  },
};
