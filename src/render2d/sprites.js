// Procedural pixel art: the cat and obstacles are drawn as vector shapes at the era's pixel
// density, then alpha-thresholded and snapped to the era palette.
import { makeCanvas, quantizeCanvas, outline } from './palettes.js';
import { PPU } from '../config.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Per-era colour styles.
export const STYLES = {
  1: { body: '#0d0d0d', far: '#0d0d0d', eye: '#f2f2f2', ear: '#0d0d0d', nose: '#0d0d0d', runFrames: 6, dither: 0 },
  2: { body: '#000000', far: '#000000', eye: '#55ffff', ear: '#ff55ff', nose: '#ff55ff', outline: '#ffffff', runFrames: 6, dither: 0 },
  3: { body: '#000000', far: '#000000', eye: '#d7d700', ear: '#d700d7', nose: '#d700d7', runFrames: 8, dither: 0 },
  4: { body: '#20202c', far: '#14141c', light: '#3c3c58', eye: '#5cf05c', ear: '#d9789a', nose: '#e88aa8', outline: '#b8607e', runFrames: 12, dither: 0.6 },
};

// ---- Cat pose (shared with the 3D fallback cat) ----
function leg(anchor, theta, lift, len, kneeDir) {
  const reach = len * 2 * 0.9;
  let px = anchor[0] + Math.sin(theta) * reach;
  let py = anchor[1] - Math.cos(theta) * reach + lift;
  py = Math.max(0, py);
  const dx = px - anchor[0];
  const dy = py - anchor[1];
  const d = Math.min(Math.hypot(dx, dy), len * 2 - 1e-4);
  const h = Math.sqrt(Math.max(0, len * len - (d / 2) * (d / 2)));
  const mx = anchor[0] + dx / 2;
  const my = anchor[1] + dy / 2;
  const nx = -dy / (d || 1);
  const ny = dx / (d || 1);
  const knee = [mx + nx * h * kneeDir, my + ny * h * kneeDir];
  return { hip: anchor, knee, paw: [px, py] };
}

export function catPose(phase, mode = 'run', vy = 0) {
  const p = phase * TAU;
  const bob = mode === 'run' ? 0.025 * Math.sin(2 * p) : 0;
  const stretch = mode === 'run' ? 0.035 * Math.sin(p) : mode === 'jump' ? 0.05 : 0;
  const shoulder = [0.24 + stretch, 0.36 + bob];
  const hip = [-0.27 - stretch, 0.38 + bob];
  const L = 0.2;
  let legs;
  if (mode === 'jump') {
    legs = [
      { ...leg(hip, -1.15, 0.12, L, 1), far: true },
      { ...leg(shoulder, 1.0, 0.1, L, -1), far: true },
      { ...leg(hip, -1.0, 0.1, L, 1), far: false },
      { ...leg(shoulder, 0.85, 0.12, L, -1), far: false },
    ];
  } else if (mode === 'hit') {
    legs = [
      { ...leg(hip, -1.3, 0.05, L, 1), far: true },
      { ...leg(shoulder, 1.3, 0.05, L, -1), far: true },
      { ...leg(hip, -0.6, 0, L, 1), far: false },
      { ...leg(shoulder, 0.6, 0, L, -1), far: false },
    ];
  } else {
    const swing = (off, amp) => {
      const a = p + off * TAU;
      return { theta: amp * Math.sin(a), lift: Math.max(0, Math.cos(a)) * 0.11 };
    };
    const hf = swing(0.5, 0.62);
    const hn = swing(0.58, 0.62);
    const ff = swing(0.0, 0.66);
    const fn = swing(0.08, 0.66);
    legs = [
      { ...leg(hip, hf.theta, hf.lift, L, 1), far: true },
      { ...leg(shoulder, ff.theta, ff.lift, L, -1), far: true },
      { ...leg(hip, hn.theta, hn.lift, L, 1), far: false },
      { ...leg(shoulder, fn.theta, fn.lift, L, -1), far: false },
    ];
  }
  const sway = mode === 'run' ? Math.sin(p + 1) : 0;
  const tail =
    mode === 'jump'
      ? [[-0.38, 0.46], [-0.6, 0.5], [-0.86, 0.6]]
      : mode === 'hit'
        ? [[-0.38, 0.46], [-0.5, 0.75], [-0.48, 0.98]]
        : [[-0.38, 0.46 + bob], [-0.62, 0.5 + 0.06 * sway + bob], [-0.72, 0.74 + 0.08 * Math.sin(p) + bob]];
  const tilt = mode === 'jump' ? clamp(vy * 0.035, -0.3, 0.3) : 0;
  return { bob, stretch, legs, tail, tilt, mode };
}

// ---- Drawing in unit space (y up) ----
function ellipse(ctx, x, y, rx, ry, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fill();
}

function poly(ctx, pts, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fill();
}

function stroke(ctx, pts, width, color, curve = false) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  if (curve && pts.length === 3) ctx.quadraticCurveTo(pts[1][0], pts[1][1], pts[2][0], pts[2][1]);
  else for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}

function drawCatShape(ctx, pose, s) {
  const { bob, stretch, legs, tail, mode } = pose;
  const squash = mode === 'hit' ? 0.85 : 1;
  const legW = 0.085;
  for (const l of legs.filter((l) => l.far)) stroke(ctx, [l.hip, l.knee, l.paw], legW, s.far);
  stroke(ctx, tail, mode === 'hit' ? 0.11 : 0.07, s.body, true);
  ellipse(ctx, -0.02, 0.41 + bob, 0.38 + stretch, 0.13 * squash, s.body);
  ellipse(ctx, 0.22 + stretch, 0.42 + bob, 0.14, 0.14 * squash, s.body);
  ellipse(ctx, -0.26 - stretch, 0.44 + bob, 0.15, 0.14 * squash, s.body);
  if (s.light) {
    ellipse(ctx, -0.02, 0.5 + bob, 0.3, 0.04, s.light);
  }
  // neck + head
  poly(ctx, [[0.22 + stretch, 0.52 + bob], [0.42 + stretch, 0.68 + bob], [0.5 + stretch, 0.52 + bob], [0.3 + stretch, 0.36 + bob]], s.body);
  const hx = 0.47 + stretch;
  const hy = 0.6 + bob;
  ellipse(ctx, hx, hy, 0.15, 0.13, s.body);
  ellipse(ctx, hx + 0.12, hy - 0.04, 0.07, 0.055, s.body);
  poly(ctx, [[hx - 0.12, hy + 0.06], [hx - 0.09, hy + 0.25], [hx - 0.01, hy + 0.11]], s.body);
  poly(ctx, [[hx + 0.01, hy + 0.12], [hx + 0.08, hy + 0.27], [hx + 0.13, hy + 0.08]], s.body);
  if (s.ear !== s.body) poly(ctx, [[hx + 0.04, hy + 0.13], [hx + 0.08, hy + 0.21], [hx + 0.1, hy + 0.11]], s.ear);
  if (s.light) ellipse(ctx, hx - 0.02, hy + 0.08, 0.08, 0.025, s.light);
  for (const l of legs.filter((l) => !l.far)) stroke(ctx, [l.hip, l.knee, l.paw], legW, s.body);
  return { eye: [hx + 0.07, hy + 0.03], nose: [hx + 0.185, hy - 0.025] };
}

// Bounding box of every cat frame, in units.
const CAT_BOX = { x0: -1.0, x1: 0.85, y0: -0.12, y1: 1.15 };

function spriteCanvas(box, ppu) {
  const w = Math.ceil((box.x1 - box.x0) * ppu) + 2;
  const h = Math.ceil((box.y1 - box.y0) * ppu) + 2;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const ox = Math.round(-box.x0 * ppu) + 1;
  const oy = Math.round(box.y1 * ppu) + 1;
  ctx.setTransform(ppu, 0, 0, -ppu, ox, oy);
  return { canvas, ctx, ox, oy };
}

function plot(canvas, ox, oy, ppu, pt, color, size = 1) {
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = color;
  const x = Math.round(ox + pt[0] * ppu - size / 2);
  const y = Math.round(oy - pt[1] * ppu - size / 2);
  ctx.fillRect(x, y, size, size);
}

export function renderCatFrame(era, pose) {
  const ppu = PPU[era];
  const s = STYLES[era];
  const { canvas, ctx, ox, oy } = spriteCanvas(CAT_BOX, ppu);
  ctx.translate(0, 0);
  if (pose.tilt) {
    ctx.translate(0, 0.4);
    ctx.rotate(pose.tilt);
    ctx.translate(0, -0.4);
  }
  const marks = drawCatShape(ctx, pose, s);
  quantizeCanvas(canvas, era, s.dither);
  if (s.outline) outline(canvas, s.outline);
  // re-rotate eye/nose points
  const rot = (pt) => {
    if (!pose.tilt) return pt;
    const c = Math.cos(pose.tilt);
    const sn = Math.sin(pose.tilt);
    const y = pt[1] - 0.4;
    return [pt[0] * c - y * sn, pt[0] * sn + y * c + 0.4];
  };
  const eyeSize = ppu >= 40 ? 2 : 1;
  if (pose.mode === 'hit') {
    const e = rot(marks.eye);
    plot(canvas, ox, oy, ppu, [e[0] - 0.5 / ppu, e[1] + 0.5 / ppu], s.eye);
    plot(canvas, ox, oy, ppu, [e[0] + 0.5 / ppu, e[1] - 0.5 / ppu], s.eye);
    plot(canvas, ox, oy, ppu, [e[0] - 0.5 / ppu, e[1] - 0.5 / ppu], s.eye);
    plot(canvas, ox, oy, ppu, [e[0] + 0.5 / ppu, e[1] + 0.5 / ppu], s.eye);
  } else {
    plot(canvas, ox, oy, ppu, rot(marks.eye), s.eye, eyeSize);
  }
  if (s.nose !== s.body) plot(canvas, ox, oy, ppu, rot(marks.nose), s.nose, 1);
  return { canvas, ox, oy };
}

export function buildCatSprites(era) {
  const s = STYLES[era];
  const run = [];
  for (let i = 0; i < s.runFrames; i++) run.push(renderCatFrame(era, catPose(i / s.runFrames, 'run')));
  const jump = [6, 0, -6].map((vy) => renderCatFrame(era, catPose(0, 'jump', vy)));
  const hit = renderCatFrame(era, catPose(0, 'hit'));
  return { run, jump, hit };
}

// ---- Obstacles ----
const OB_STYLES = {
  1: { cuke: '#0d0d0d', cukeDot: '#f2f2f2', pot: '#0d0d0d', rim: '#0d0d0d', plant: '#0d0d0d', flower: '#0d0d0d', vac: '#0d0d0d', vacLight: '#f2f2f2', vacDark: '#0d0d0d', crow: '#0d0d0d', beak: '#0d0d0d', crowEye: '#f2f2f2' },
  2: { cuke: '#55ffff', cukeDot: '#000000', pot: '#ff55ff', rim: '#ffffff', plant: '#55ffff', flower: '#ffffff', vac: '#ffffff', vacLight: '#55ffff', vacDark: '#ff55ff', crow: '#000000', beak: '#ff55ff', crowEye: '#55ffff', crowOutline: '#ffffff', outline: '#000000' },
  3: { cuke: '#00d700', cukeDot: '#000000', pot: '#d70000', rim: '#d7d7d7', plant: '#00d700', flower: '#d7d700', vac: '#d7d7d7', vacLight: '#d70000', vacDark: '#000000', crow: '#000000', beak: '#d7d700', crowEye: '#d7d7d7', crowOutline: '#d7d7d7', outline: '#000000' },
  4: { cuke: '#3f9a3a', cukeDot: '#9ad86a', pot: '#c0603a', rim: '#e08a5a', plant: '#4aa850', flower: '#f070a0', vac: '#9aa2b8', vacLight: '#6ad0ff', vacDark: '#3a3e50', crow: '#1a1826', beak: '#e0b040', crowEye: '#f0f0f0', sheen: '#4a3a78', crowOutline: '#b8607e', outline: '#1a1020' },
};

const OB_BOX = {
  cucumber: { x0: -0.5, x1: 0.5, y0: -0.05, y1: 0.35 },
  pot: { x0: -0.36, x1: 0.36, y0: -0.05, y1: 0.98 },
  vacuum: { x0: -0.52, x1: 0.52, y0: -0.05, y1: 0.42 },
  crow: { x0: -0.48, x1: 0.48, y0: -0.05, y1: 0.75 },
};

function drawObstacle(ctx, type, s, frame, seed) {
  if (type === 'cucumber') {
    stroke(ctx, [[-0.38, 0.12], [0, 0.17], [0.38, 0.11]], 0.24, s.cuke, true);
    for (let i = 0; i < 5; i++) ellipse(ctx, -0.28 + i * 0.14, 0.16 + ((i * 7 + seed * 5) % 3) * 0.02, 0.02, 0.02, s.cukeDot);
    ellipse(ctx, 0.47, 0.11, 0.03, 0.03, s.cukeDot);
  } else if (type === 'pot') {
    poly(ctx, [[-0.21, 0], [0.21, 0], [0.27, 0.34], [-0.27, 0.34]], s.pot);
    poly(ctx, [[-0.3, 0.3], [0.3, 0.3], [0.3, 0.38], [-0.3, 0.38]], s.rim);
    // a little cactus in a pot (a nod to the original dino)
    stroke(ctx, [[0, 0.38], [0, 0.82]], 0.16, s.plant);
    stroke(ctx, [[0, 0.55], [-0.16, 0.6], [-0.16, 0.72]], 0.09, s.plant);
    stroke(ctx, [[0, 0.5], [0.15, 0.56], [0.15, 0.68]], 0.09, s.plant);
    ellipse(ctx, 0, 0.88, 0.05, 0.05, s.flower);
  } else if (type === 'vacuum') {
    poly(ctx, [[-0.44, 0.04], [0.44, 0.04], [0.47, 0.18], [0.42, 0.3], [-0.42, 0.3], [-0.47, 0.18]], s.vac);
    poly(ctx, [[-0.1, 0.3], [0.1, 0.3], [0.08, 0.37], [-0.08, 0.37]], s.vacDark);
    ellipse(ctx, -0.25, 0.04, 0.06, 0.04, s.vacDark);
    ellipse(ctx, 0.25, 0.04, 0.06, 0.04, s.vacDark);
    poly(ctx, [[-0.47, 0.15], [-0.4, 0.15], [-0.4, 0.2], [-0.47, 0.2]], s.vacDark);
    ellipse(ctx, -0.3, 0.24, 0.03, 0.03, s.vacLight);
  } else if (type === 'crow') {
    // faces left (towards the cat)
    poly(ctx, [[0.15, 0.4], [0.42, 0.48], [0.42, 0.36]], s.crow);
    ellipse(ctx, 0, 0.4, 0.22, 0.1, s.crow);
    ellipse(ctx, -0.2, 0.47, 0.09, 0.08, s.crow);
    poly(ctx, [[-0.27, 0.49], [-0.4, 0.45], [-0.27, 0.42]], s.beak);
    if (frame === 0) poly(ctx, [[-0.08, 0.45], [0.18, 0.45], [0.12, 0.72]], s.crow);
    else poly(ctx, [[-0.08, 0.4], [0.18, 0.4], [0.1, 0.18]], s.crow);
    if (s.sheen) ellipse(ctx, 0.02, 0.44, 0.12, 0.025, s.sheen);
  }
}

function renderObstacleFrame(era, type, frame = 0, seed = 0) {
  const ppu = PPU[era];
  const s = OB_STYLES[era];
  const { canvas, ctx, ox, oy } = spriteCanvas(OB_BOX[type], ppu);
  drawObstacle(ctx, type, s, frame, seed);
  quantizeCanvas(canvas, era, era === 4 ? 0.5 : 0);
  if (type === 'crow') {
    if (s.crowOutline) outline(canvas, s.crowOutline);
    plot(canvas, ox, oy, ppu, [-0.22, 0.49], s.crowEye, 1);
  } else if (s.outline) outline(canvas, s.outline);
  return { canvas, ox, oy };
}

export function buildObstacleSprites(era) {
  return {
    cucumber: [renderObstacleFrame(era, 'cucumber', 0, 1)],
    pot: [renderObstacleFrame(era, 'pot')],
    vacuum: [renderObstacleFrame(era, 'vacuum')],
    crow: [renderObstacleFrame(era, 'crow', 0), renderObstacleFrame(era, 'crow', 1)],
  };
}
