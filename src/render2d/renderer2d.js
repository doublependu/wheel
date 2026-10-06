// Canvas 2D renderer for the pixel eras (1–4). Each era draws into its own low-res virtual
// canvas which is scaled up with nearest-neighbour filtering onto the full-screen canvas.
import { PPU, BAR } from '../config.js';
import { makeCanvas } from './palettes.js';
import { buildCatSprites, buildObstacleSprites } from './sprites.js';
import { buildBackground } from './backgrounds.js';
import { createRng } from '../sim/rng.js';

const TRANSITIONS = { 2: 'raster', 3: 'bloom', 4: 'swoop' };
export const TRANSITION_2D_DURATION = 1.6;

export class Renderer2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.sprites = {}; // era → { cat, obstacles }
    this.eraViews = {}; // era → { canvas, ctx, vw, vh, groundY, px, bg }
    this.view = null;
    this.dpr = 1;
    this.transition = null;
    this.crunch = 0;
    this.atlas = null; // pixel-art obstacles from the 3D models (fallback: procedural sprites)
  }

  resize(view, dpr) {
    this.view = view;
    this.dpr = dpr;
    this.canvas.width = Math.round(view.cssW * dpr);
    this.canvas.height = Math.round(view.cssH * dpr);
    this.eraViews = {};
  }

  // Sprites are built once; backgrounds per viewport size. Cheap enough to do in one go.
  prepare(era) {
    if (!this.sprites[era]) this.sprites[era] = { cat: buildCatSprites(era), obstacles: this.#obstacleSprites(era) };
    if (this.view && !this.eraViews[era]) this.#buildEraView(era);
  }

  #obstacleSprites(era) {
    return this.atlas?.frames(era) ?? buildObstacleSprites(era);
  }

  // Swap in the model-rendered obstacle sprites for every stage prepared so far.
  setObstacleAtlas(atlas) {
    this.atlas = atlas;
    for (const era of Object.keys(this.sprites)) this.sprites[era].obstacles = this.#obstacleSprites(era);
  }

  isReady(era) {
    return !!this.sprites[era];
  }

  #buildEraView(era) {
    const ppu = PPU[era];
    const px = this.view.zoom / ppu; // css px per virtual px
    const vw = Math.ceil(this.view.cssW / px);
    const vh = Math.ceil(this.view.cssH / px);
    const groundY = vh - Math.round(this.view.below * ppu);
    const canvas = makeCanvas(vw, vh);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const bg = buildBackground(era, vw, vh, groundY, ppu);
    this.eraViews[era] = { canvas, ctx, vw, vh, groundY, px, ppu, bg, catX: Math.round(this.view.catX * ppu) };
  }

  // Draw the world as `era` into that era's virtual canvas.
  renderEra(era, world, time, { cat: drawCat = true } = {}) {
    this.prepare(era);
    const ev = this.eraViews[era];
    const { ctx, vw, vh, groundY, ppu, bg, catX } = ev;
    const sp = this.sprites[era];
    const dist = world.dist;

    if (bg.sky.canvas) this.#tile(ctx, bg.sky.canvas, 0, 0, vw);
    else {
      ctx.fillStyle = bg.sky.color;
      ctx.fillRect(0, 0, vw, vh);
    }
    for (const l of bg.layers) this.#tile(ctx, l.canvas, l.fixedX != null ? null : dist * ppu * l.parallax, groundY + l.top, vw, l.fixedX);
    this.#tile(ctx, bg.ground.canvas, dist * ppu, groundY + bg.ground.top, vw);

    for (const o of world.obstacles) {
      const frames = sp.obstacles[o.type];
      const f = frames[frames.length > 1 ? Math.floor(time * 3 * frames.length + o.seed * 4) % frames.length : 0]; // 3 flaps/s
      const x = catX + Math.round((o.x - dist) * ppu);
      if (x - f.ox > vw || x + f.canvas.width < 0) continue;
      ctx.drawImage(f.canvas, x - f.ox, groundY - f.oy);
    }

    if (!drawCat) return ev;
    const c = world.cat;
    let frame;
    if (!world.alive) frame = sp.cat.hit;
    else if (!c.onGround) frame = sp.cat.jump[c.vy > 3 ? 0 : c.vy < -3 ? 2 : 1];
    else frame = sp.cat.run[Math.floor(c.phase * sp.cat.run.length) % sp.cat.run.length];
    ctx.drawImage(frame.canvas, catX - frame.ox, groundY - frame.oy - Math.round(c.y * ppu));
    return ev;
  }

  #tile(ctx, canvas, offset, y, vw, fixedX) {
    if (fixedX != null) {
      ctx.drawImage(canvas, Math.round(vw * fixedX - canvas.width / 2), Math.round(y));
      return;
    }
    const w = canvas.width;
    let x = -(Math.round(offset) % w);
    for (; x < vw; x += w) ctx.drawImage(canvas, x, Math.round(y));
  }

  #present(ev, alpha = 1) {
    const { ctx, dpr } = this;
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = alpha;
    if (this.crunch > 0) {
      // restart: mosaic + fade to 1-bit before the run starts over
      const k = Math.max(1, Math.round(1 + this.crunch * this.crunch * 24));
      const w = Math.max(1, Math.ceil(ev.vw / k));
      const h = Math.max(1, Math.ceil(ev.vh / k));
      if (!this.mosaic || this.mosaic.width !== w || this.mosaic.height !== h) this.mosaic = makeCanvas(w, h);
      const m = this.mosaic.getContext('2d');
      m.imageSmoothingEnabled = true;
      m.filter = this.crunch > 0.5 ? `grayscale(1) contrast(${1 + (this.crunch - 0.5) * 30})` : 'none';
      m.drawImage(ev.canvas, 0, 0, w, h);
      ctx.drawImage(this.mosaic, 0, 0, w * k * ev.px * dpr, h * k * ev.px * dpr);
    } else ctx.drawImage(ev.canvas, 0, 0, ev.vw * ev.px * dpr, ev.vh * ev.px * dpr);
    ctx.globalAlpha = 1;
  }

  startTransition(from, to, now) {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.transition = { from, to, start: now, kind: reduced && to === 4 ? 'fade' : (TRANSITIONS[to] ?? 'fade'), reduced };
  }

  // Draw a frame. `section` is the current musical section; during a build-up the next era
  // flickers through in small blocks as a "get ready" preview.
  draw(world, era, now, section) {
    const tr = this.transition;
    if (tr) {
      const p = (now - tr.start) / TRANSITION_2D_DURATION;
      if (p >= 1) this.transition = null;
      else return this.#drawTransition(world, tr, Math.max(0, p), now);
    }
    const ev = this.renderEra(era, world, now);
    this.#present(ev);
    if (section?.kind === 'build' && section.era === era && era < 4 && this.isReady(era + 1)) {
      const p = (world.t / BAR - section.start) / (section.end - section.start);
      this.#preview(world, era + 1, p, now);
    }
  }

  #preview(world, next, p, now) {
    const ev = this.renderEra(next, world, now);
    const rng = createRng(Math.floor(now * 12) + 1);
    const n = Math.floor(2 + p * p * 40);
    const { ctx, dpr } = this;
    const sx = ev.px * dpr;
    ctx.imageSmoothingEnabled = false;
    for (let i = 0; i < n; i++) {
      const w = Math.ceil(2 + rng() * 6);
      const h = Math.ceil(1 + rng() * 3);
      const x = Math.floor(rng() * (ev.vw - w));
      const y = Math.floor(rng() * (ev.vh - h));
      ctx.drawImage(ev.canvas, x, y, w, h, x * sx, y * sx, w * sx, h * sx);
    }
  }

  #drawTransition(world, tr, p, now) {
    const { ctx, dpr } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const a = this.renderEra(tr.from, world, now);
    const b = this.renderEra(tr.to, world, now);
    const ease = p * p * (3 - 2 * p);
    if (tr.kind === 'raster') {
      // CRT beam sweeps down; new palette above the beam, old below. Small degauss wobble.
      const beam = Math.round(ease * H);
      const wob = tr.reduced ? 0 : Math.sin(now * 70) * (1 - p) * 3 * dpr;
      ctx.save();
      ctx.translate(wob, 0);
      this.#present(b);
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, beam, W, H - beam);
      ctx.clip();
      this.#present(a);
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(0, beam - 2 * dpr, W, 3 * dpr);
      ctx.fillStyle = 'rgba(85,255,255,0.35)';
      ctx.fillRect(0, beam - 10 * dpr, W, 8 * dpr);
    } else if (tr.kind === 'bloom') {
      // New colours spread out from the cat.
      const cx = this.view.catX * this.view.zoom * dpr;
      const cy = (this.view.cssH - (this.view.below + 0.5) * this.view.zoom) * dpr;
      const r = ease * Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy)) * 1.05;
      this.#present(a);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      this.#present(b);
      ctx.restore();
      ctx.strokeStyle = 'rgba(215,215,0,0.8)';
      ctx.lineWidth = 4 * dpr;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    } else if (tr.kind === 'swoop') {
      // Mode-7-like spin and zoom of the old playfield, settling into the new one.
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      const half = p < 0.5;
      const q = half ? p * 2 : (1 - p) * 2;
      ctx.save();
      ctx.translate(W / 2, H * 0.6);
      ctx.rotate((half ? 1 : -1) * q * q * 0.6);
      const s = 1 + q * q * 1.5;
      ctx.scale(s, s * (1 - q * 0.4));
      ctx.translate(-W / 2, -H * 0.6);
      this.#present(half ? a : b, half ? 1 - q * 0.3 : 1 - q * 0.6);
      ctx.restore();
    } else {
      this.#present(a);
      this.#present(b, ease);
    }
  }

  // The current era-4 frame (for the 2D → 3D pop-out).
  snapshot(era) {
    return this.eraViews[era];
  }
}
