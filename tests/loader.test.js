import { describe, it, expect } from 'vitest';
import {
  cubicBezier, EASE, EASE_IN_OUT, GEOM, layout, stationLife, twinAngle, dustPlan, DUST_FLIGHT, hitchLag, clockFor,
} from '../src/loader/orbitPhysics.js';
import { Gate, chance, menuReady } from '../src/loader/gate.js';
import { createRng } from '../src/sim/rng.js';
import { ORBIT, LOADER } from '../src/config.js';

const close = (a, b, eps = 1e-4) => Math.abs(a - b) < eps;

describe('the wheel matches the reference components', () => {
  it('solves CSS cubic-bézier curves', () => {
    const linear = cubicBezier(0, 0, 1, 1);
    for (let x = 0; x <= 1; x += 0.05) expect(close(linear(x), x)).toBe(true);
    // well-known samples of CSS `ease`
    expect(close(EASE(0.25), 0.4085, 2e-3)).toBe(true);
    expect(close(EASE(0.5), 0.8024, 2e-3)).toBe(true);
    expect(close(EASE_IN_OUT(0.5), 0.5)).toBe(true);
    expect(EASE(0)).toBe(0);
    expect(EASE(1)).toBe(1);
  });

  it('Spiral: 8 stations, scale 0 → 1 → 0 over 1.5 s with easeInOut halves, station i delayed by i/8', () => {
    const T = ORBIT.ringPeriod;
    expect(ORBIT.stations).toBe(8);
    expect(T).toBe(1.5);
    for (let i = 0; i < 8; i++) {
      const d = (i / 8) * T;
      if (d > 0) expect(stationLife(i, d - 0.01).scale).toBe(0); // before its delay
      for (let u = 0; u < 1; u += 0.01) {
        const want = u < 0.5 ? EASE_IN_OUT(u * 2) : 1 - EASE_IN_OUT(u * 2 - 1);
        expect(close(stationLife(i, d + u * T + 3 * T).scale, want)).toBe(true);
      }
    }
  });

  it('Twin Orbit: rotate(0 → 360deg) with `ease` over 1 s, the second twin half a period behind', () => {
    const T = ORBIT.twinPeriod;
    expect(T).toBe(1);
    for (let t = 0; t < 5; t += 0.01) {
      expect(close(twinAngle(0, t), 2 * Math.PI * EASE((t / T) % 1))).toBe(true);
      const u = (t - T / 2) / T;
      expect(close(twinAngle(1, t), 2 * Math.PI * EASE(u - Math.floor(u)))).toBe(true);
    }
    expect(close(GEOM.twinOrbit / (2 * GEOM.twinR), 1.55)).toBe(true);
    expect(GEOM.starR).toBe(GEOM.twinR);
  });
});

describe('the wheel’s physics', () => {
  // A body's farthest surface point: its radius plus morph and tide headroom.
  const reach = (b) => b.r * (1 + GEOM.morph + GEOM.tideMax);

  for (const reduced of [false, true]) {
    it(`no two bodies ever touch (${reduced ? 'reduced motion' : 'normal'})`, () => {
      const c = clockFor(reduced);
      let minGap = Infinity;
      for (let t = 0; t < 20; t += 0.002) {
        const { star, twins, stations } = layout(t, c);
        const all = [star, ...twins, ...stations];
        for (let a = 0; a < all.length; a++) {
          for (let b = a + 1; b < all.length; b++) {
            if (!all[a].r || !all[b].r) continue;
            const d = Math.hypot(...all[a].pos.map((v, j) => v - all[b].pos[j]));
            minGap = Math.min(minGap, d - reach(all[a]) - reach(all[b]));
          }
        }
      }
      expect(minGap).toBeGreaterThan(0.005);
    });
  }

  it('tides stay within their headroom and point at their source', () => {
    for (let t = 0; t < 10; t += 0.01) {
      const { star, twins, stations } = layout(t);
      for (const b of [star, ...twins, ...stations]) {
        for (const td of b.tides) {
          expect(td.amp).toBeLessThanOrEqual(GEOM.tideMax * b.r + 1e-9);
          expect(close(Math.hypot(...td.dir), 1)).toBe(true);
        }
      }
      const toTwin = twins[0].pos.map((v) => v / Math.hypot(...twins[0].pos));
      expect(star.tides[0].dir.every((v, j) => close(v, toTwin[j]))).toBe(true);
    }
  });

  it('dust shed by a crumbling planet arrives at a planet that is forming', () => {
    const T = ORBIT.ringPeriod;
    const plan = dustPlan(4000, createRng(3));
    for (let m = 0; m < 4000; m++) {
      const [src, release, flight, hops] = plan.subarray(m * 4, m * 4 + 4);
      expect(flight).toBeGreaterThanOrEqual(DUST_FLIGHT[0] - 1e-6);
      expect(flight).toBeLessThanOrEqual(DUST_FLIGHT[1] + 1e-6);
      expect(hops).toBeGreaterThanOrEqual(1);
      // released while the source breaks up, a few cycles in so every station has started
      const t0 = release + 4 * T;
      const s = stationLife(src, t0 + 1e-4);
      expect(s.phase).toBeGreaterThanOrEqual(0.5);
      const dst = (src + hops) % 8;
      const d = stationLife(dst, t0 + flight - 1e-4);
      expect(d.phase).toBeLessThan(0.5);
    }
  });

  it('the hitch freezes the clock, then catches up without running backwards', () => {
    // a plain miss, and one where the page really was busy for a second (as the wheel uses it)
    for (const freeze of [LOADER.hitch, 1.15]) {
      const catchUp = Math.max(0.4, freeze * 1.2);
      let prev = -Infinity;
      for (let s = 0; s < freeze + catchUp + 0.2; s += 0.001) {
        const tw = s - hitchLag(s, freeze, catchUp);
        expect(tw).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = tw;
        if (s < freeze) expect(close(tw, 0)).toBe(true);
      }
      expect(hitchLag(freeze + catchUp, freeze, catchUp)).toBe(0);
    }
  });
});

describe('the gate past the loading wheel', () => {
  it('ignores everything until the wheel has played for the quiet period', () => {
    const g = new Gate({ random: () => 0 });
    expect(g.attempt(1, true)).toBe('ignored');
    g.begin(2);
    expect(g.attempt(2 + LOADER.quiet - 0.01, true)).toBe('ignored');
    expect(g.attempt(2 + LOADER.quiet, true)).toBe('hit');
  });

  it('merges attempts closer than the debounce', () => {
    const g = new Gate({ random: () => 0.999 });
    g.begin(0);
    expect(g.attempt(5.1, true)).toBe('miss');
    expect(g.attempt(5.2, true)).toBe('merged');
    expect(g.attempt(5.4, true)).toBe('miss');
  });

  it('always lets the third attempt through', () => {
    const g = new Gate({ random: () => 0.999999 });
    g.begin(0);
    expect(g.attempt(5.0, true)).toBe('miss');
    expect(g.attempt(5.3, true)).toBe('miss');
    expect(g.attempt(5.6, true)).toBe('hit');
  });

  it('never lets an attempt through before the menu is loaded', () => {
    const g = new Gate({ random: () => 0 });
    g.begin(0);
    for (let k = 0; k < 6; k++) expect(g.attempt(5 + k, false)).toBe('miss');
    expect(g.attempt(12, true)).toBe('hit');
  });

  it('hits at the advertised rate', () => {
    const rng = createRng(11);
    const n = 100000;
    const hits = [0, 0];
    for (let k = 0; k < n; k++) {
      const g = new Gate({ random: rng });
      g.begin(0);
      if (g.attempt(5.5, true) === 'hit') hits[0]++;
      else if (g.attempt(6.5, true) === 'hit') hits[1]++;
    }
    const p1 = chance(0.5, 0);
    const p2 = chance(1.5, 1);
    expect(Math.abs(hits[0] / n - p1)).toBeLessThan(0.01);
    expect(Math.abs(hits[1] / (n - hits[0]) - p2)).toBeLessThan(0.01);
    expect(p1).toBeCloseTo(0.39, 5);
    expect(p2).toBeCloseTo(0.77, 5);
  });

  it('needs the 3D donut, unless 3D is unavailable or has been waited for long enough', () => {
    expect(menuReady({ atlas: true, donut: true, threeD: true, sinceStart: 6 })).toBe(true);
    expect(menuReady({ atlas: true, donut: false, threeD: true, sinceStart: 6 })).toBe(false);
    expect(menuReady({ atlas: true, donut: false, threeD: false, sinceStart: 6 })).toBe(true);
    expect(menuReady({ atlas: true, donut: false, threeD: true, sinceStart: LOADER.need3D })).toBe(true);
    expect(menuReady({ atlas: false, donut: true, threeD: true, sinceStart: 20 })).toBe(false);
  });
});
