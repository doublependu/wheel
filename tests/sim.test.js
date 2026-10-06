import { describe, it, expect } from 'vitest';
import { World, speedAt } from '../src/sim/world.js';
import { EraClock } from '../src/eras.js';
import { BAR, OBSTACLES, SPEED, BREATHER, CHILL_BARS, BUILD_BARS, EXTRA_CHILL_BARS } from '../src/config.js';
import { runBot } from './bot.js';

// Jump-start distances (cat → obstacle centre) that clear a single obstacle at a fixed speed.
function clearWindow(type, speed) {
  const cleared = [];
  for (let r0 = 0.5; r0 < 8; r0 += 0.005) {
    const w = new World({ fixedSpeed: speed, spawn: false });
    w.addObstacle(type, r0);
    w.step({ press: true, held: true });
    w.step({ press: false, held: false });
    while (w.alive && w.dist < r0 + 2) w.step({});
    if (w.alive) cleared.push(r0);
  }
  if (!cleared.length) return 0;
  // contiguous window length converted to seconds
  return (cleared[cleared.length - 1] - cleared[0]) / speed;
}

describe('jump window', () => {
  for (const type of Object.keys(OBSTACLES)) {
    for (const speed of [SPEED.v0, speedAt(1e6)]) {
      it(`${type} at ${speed.toFixed(2)} u/s has a timing window ≥ 400 ms`, () => {
        const win = clearWindow(type, speed);
        expect(win).toBeGreaterThanOrEqual(0.4);
      });
    }
  }
});

describe('era clock', () => {
  it('runs 6 chill + 2 build bars per era and drops into the next era', () => {
    const clock = new EraClock(() => true);
    clock.plan(200);
    const eraStarts = [];
    for (const s of clock.sections) if (s.kind === 'chill' && !eraStarts.find((e) => e.era === s.era)) eraStarts.push(s);
    expect(eraStarts.map((s) => s.start)).toEqual([0, 8, 16, 24, 32, 40, 48]);
    expect(clock.eraAt(48 * BAR + 0.01)).toBe(7);
    expect(clock.sections.find((s) => s.kind === 'build').end - clock.sections.find((s) => s.kind === 'build').start).toBe(BUILD_BARS);
  });

  it('plays extra chill instead of a build-up while the next era is not ready', () => {
    let ready = false;
    const clock = new EraClock(() => ready);
    clock.plan(CHILL_BARS * BAR + 0.1);
    expect(clock.sectionAtBar(CHILL_BARS).kind).toBe('chill');
    ready = true;
    clock.plan((CHILL_BARS + EXTRA_CHILL_BARS) * BAR + 0.1);
    expect(clock.sectionAtBar(CHILL_BARS + EXTRA_CHILL_BARS).kind).toBe('build');
  });

  it('never builds up in the final era', () => {
    const clock = new EraClock(() => true, 7);
    clock.plan(100);
    expect(clock.sections.every((s) => s.kind === 'chill' && s.era === 7)).toBe(true);
  });
});

describe('spawner', () => {
  it('keeps obstacles away from the cat around every era drop', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const w = new World({ seed });
      const reach = new Map();
      while (w.t < 140) {
        w.step({});
        w.alive = true; // invincible: we only inspect spawn timing
        for (const o of w.obstacles) if (!reach.has(o.id) && o.x <= w.dist) reach.set(o.id, w.t);
      }
      for (const drop of w.clock.dropTimes()) {
        for (const t of reach.values()) {
          const inside = t > drop - BREATHER.before + 0.02 && t < drop + BREATHER.after - 0.02;
          expect(inside, `seed ${seed}: obstacle at ${t.toFixed(2)} near drop ${drop.toFixed(2)}`).toBe(false);
        }
      }
    }
  });
});

describe('fairness and reachability', () => {
  it('a perfect player never dies', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const r = runBot({ seed, sigma: 0, sloppy: 0, maxTime: 200 });
      expect(r.alive, `seed ${seed} died at ${r.time.toFixed(1)}s`).toBe(true);
    }
  });

  const RUNS = 1000;
  const reach = (sigma) => {
    const eras = [];
    for (let seed = 1; seed <= RUNS; seed++) eras.push(runBot({ seed, sigma }).era);
    const share = (e) => eras.filter((x) => x >= e).length / RUNS;
    return { era5: share(5), era7: share(7) };
  };

  it('an average player (σ = 70 ms) reaches 3D in ≥ 90 % and HDR in ≥ 75 % of runs', () => {
    const r = reach(0.07);
    console.log('average player', r);
    expect(r.era5).toBeGreaterThanOrEqual(0.9);
    expect(r.era7).toBeGreaterThanOrEqual(0.75);
  }, 120_000);

  it('a first-timer (σ = 110 ms) reaches 3D in ≥ 60 % of runs', () => {
    const r = reach(0.11);
    console.log('first-timer', r);
    expect(r.era5).toBeGreaterThanOrEqual(0.6);
  }, 120_000);
});

describe('song', async () => {
  const { barNotes } = await import('../src/audio/song.js');
  it('has a melody, bass and drums in every chill and build bar', () => {
    for (let i = 0; i < 16; i++) {
      const n = barNotes({ kind: 'chill', index: i, drop: i === 0 });
      expect(n.lead.length).toBeGreaterThan(0);
      expect(n.bass.length).toBeGreaterThan(0);
      expect(n.drums.length).toBeGreaterThan(0);
      expect(n.swing).toBeGreaterThan(0);
    }
    for (let i = 0; i < 2; i++) {
      const n = barNotes({ kind: 'build', index: i, drop: false });
      expect(n.swing).toBe(0); // the build-up is straight and upbeat
      expect(n.drums.filter((d) => d[1] === 'kick').length).toBe(4);
    }
  });
});
