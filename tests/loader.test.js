import { describe, it, expect } from 'vitest';
import {
  cubicBezier, EASE_IN_OUT, GEOM, PIECE, GROUP, layout, landed, remnant, precursor, spiralScale, stationAngle, fromFrame, onRing,
  pieceSeeds, pieceOffset, pieceErosion, pieceEroded, pieceScale, cloudAdvance, dustPlan, moteAt, massAt,
} from '../src/loader/orbitPhysics.js';
import { speedPlan, phaseAt, speedAt, stateAt, hitchLag, hitchCatchUp, firstStation, WheelClock } from '../src/loader/netSpeed.js';
import { Gate, chance, menuReady } from '../src/loader/gate.js';
import { createRng } from '../src/sim/rng.js';
import { ORBIT, NET, LOADER, SPIRAL } from '../src/config.js';

const close = (a, b, eps = 1e-4) => Math.abs(a - b) < eps;
const HOP = ORBIT.hop;
const SEEDS = pieceSeeds(26, createRng(9));
const PLAN = dustPlan(8192, SEEDS, createRng(5));

describe('the pre-loader matches the reference component', () => {
  it('solves CSS cubic-bézier curves', () => {
    const linear = cubicBezier(0, 0, 1, 1);
    for (let x = 0; x <= 1; x += 0.05) expect(close(linear(x), x)).toBe(true);
    expect(close(EASE_IN_OUT(0.5), 0.5)).toBe(true);
    expect(close(EASE_IN_OUT(0.25), 0.1292, 2e-3)).toBe(true); // a well-known sample of ease-in-out
    expect(EASE_IN_OUT(0)).toBe(0);
    expect(EASE_IN_OUT(1)).toBe(1);
  });

  it('Spiral: 8 dots, scale 0 → 1 → 0 over 1.5 s with easeInOut halves, dot i delayed by i/8', () => {
    const T = SPIRAL.period;
    expect(SPIRAL.dots).toBe(8);
    expect(T).toBe(1.5);
    for (let i = 0; i < 8; i++) {
      const d = (i / 8) * T;
      if (d > 0) expect(spiralScale(i, d - 0.01)).toBe(0); // before its delay
      for (let u = 0; u < 1; u += 0.01) {
        const want = u < 0.5 ? EASE_IN_OUT(u * 2) : 1 - EASE_IN_OUT(u * 2 - 1);
        expect(close(spiralScale(i, d + u * T + 3 * T), want)).toBe(true);
      }
    }
  });

  it('the first planet forms two stations ahead of the crest of the pre-loader’s wave', () => {
    for (let t = 0.8; t < 6; t += 0.037) {
      const first = firstStation(t);
      const crest = (first + 6) % 8;
      // the crest is the biggest dot, and the dots from there to the first planet's station are shrinking in order
      for (let i = 0; i < 8; i++) expect(spiralScale(crest, t)).toBeGreaterThanOrEqual(spiralScale(i, t) - 0.06);
      expect(spiralScale(first, t)).toBeLessThan(spiralScale((first + 7) % 8, t));
    }
  });
});

describe('one planet’s matter goes round the ring', () => {
  it('keeps the stations where Spiral’s dots are', () => {
    expect(ORBIT.stations).toBe(8);
    expect(close(GEOM.ringR * 0.34, 0.3125)).toBe(true); // 31.25 % of the box from its centre
    const p = onRing(stationAngle(2));
    expect(close(p[0], 0) && close(p[1], -GEOM.ringR)).toBe(true); // clockwise from 3 o'clock: station 2 is at 6
  });

  it('eight hops visit every station once, and then the ring repeats', () => {
    for (const first of [0, 3, 7]) {
      const seen = [];
      for (let n = 1; n <= 8; n++) {
        const L = layout((n + 0.9) * HOP, first);
        expect(L.planets.length).toBe(1); // one whole planet, at rest
        expect(L.planets[0].u).toBe(-1);
        expect(close(L.planets[0].r, GEOM.stationR)).toBe(true);
        seen.push(L.planets[0].i);
        expect(L.planets[0].i).toBe((first + n) % 8);
      }
      expect(new Set(seen).size).toBe(8);
    }
    const strip = ({ n, h, ...rest }) => JSON.parse(JSON.stringify(rest, (k, v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v)));
    for (let w = HOP; w < 9 * HOP; w += 0.173) expect(strip(layout(w + 8 * HOP, 2))).toEqual(strip(layout(w, 2)));
  });

  it('a hop runs in order: seams, burst, pieces gone, the last dust landed, rest', () => {
    const c = ORBIT;
    expect(0).toBeLessThan(c.seams);
    expect(c.pieces[0]).toBe(c.seams);
    expect(c.seams).toBeLessThan(c.accrete[0]); // nothing lands before the burst
    expect(c.pieces[1]).toBeLessThan(c.accrete[1]);
    expect(c.accrete[1]).toBeLessThan(1); // then the new planet rests
    for (const s of SEEDS) {
      const [a, b] = pieceErosion(s);
      expect(a).toBeGreaterThan(c.seams);
      expect(b).toBeLessThanOrEqual(c.pieces[1] + 1e-9);
      expect(pieceEroded(s, c.seams)).toBe(0);
      expect(pieceScale(pieceEroded(s, c.pieces[1]))).toBe(0);
    }
    // the planet that bursts: whole while its seams open, in pieces after, gone once they are dust
    let prev = 1;
    for (let u = 0; u < 1; u += 0.005) {
      const L = layout((3 + u) * HOP);
      const old = L.planets.find((p) => p.i === L.src);
      const fresh = L.planets.find((p) => p.i === L.dst);
      expect(!!old).toBe(u < c.pieces[1]);
      expect(!!fresh).toBe(landed(u) > 0);
      if (fresh) {
        expect(close(fresh.r, GEOM.stationR * Math.cbrt(landed(u)))).toBe(true);
        expect(fresh.heat).toBeLessThanOrEqual(prev + 1e-9); // it only cools
        prev = fresh.heat;
      }
      if (u >= c.accrete[1] + 0.08) expect(fresh.heat).toBe(0);
    }
  });

  it('matter from a station lands only at the next one, after the burst', () => {
    for (let m = 0; m < PLAN.count; m += 7) {
      for (let h = 1; h < 4; h += 0.013) {
        const s = moteAt(PLAN, m, h);
        expect(s.to - s.from).toBe(1);
        if (s.at !== 'flight') continue;
        const n = Math.floor(h);
        const leader = s.group === GROUP.leader;
        // into the planet that is forming (or, for a straggler finishing late, the one that just did)
        if (leader) expect([n, n + 1]).toContain(s.to);
        else expect([n - 1, n]).toContain(s.to);
      }
    }
    // bulk dust is released after the burst and has landed before the new planet rests
    for (let m = 0; m < PLAN.count; m++) {
      const [group, offset, flight] = PLAN.A.subarray(m * 4, m * 4 + 3);
      if (group > GROUP.core) continue;
      expect(offset).toBeGreaterThanOrEqual(ORBIT.seams - 1e-6);
      expect(offset + flight).toBeGreaterThan(ORBIT.accrete[0] - 1e-6);
      expect(offset + flight).toBeLessThanOrEqual(ORBIT.accrete[1] + 1e-6);
    }
  });

  it('every mote is in one place, and the new planet grows as fast as the bulk lands', () => {
    const bulkShare = 1 - ORBIT.stragglers.share - ORBIT.leaders.share;
    let groups = [0, 0, 0, 0];
    for (let m = 0; m < PLAN.count; m++) groups[PLAN.A[m * 4]]++;
    groups = groups.map((g) => g / PLAN.count);
    expect(close(groups[GROUP.straggler], ORBIT.stragglers.share, 2e-3)).toBe(true);
    expect(close(groups[GROUP.leader], ORBIT.leaders.share, 2e-3)).toBe(true);
    expect(close(groups[GROUP.piece] + groups[GROUP.core], bulkShare, 2e-3)).toBe(true);
    for (let h = 2; h < 3; h += 0.01) {
      const u = h - 2;
      const mass = massAt(PLAN, h);
      expect(close(mass.old + mass.flying + mass.shade + mass.fresh, 1, 1e-9)).toBe(true);
      expect(mass.dots).toBe(0);
      // the forming planet: landed bulk, plus the stragglers that have caught up with it
      const stragglersIn = mass.fresh - bulkShare * landed(u);
      expect(stragglersIn).toBeGreaterThan(-2e-3);
      expect(stragglersIn).toBeLessThan(ORBIT.stragglers.share + 2e-3);
      if (u < ORBIT.stragglers.leave[0]) expect(close(mass.fresh, bulkShare * landed(u), 2e-3)).toBe(true);
    }
    // the very first hop: the matter is the pre-loader's dots, standing as dust until it flies
    expect(massAt(PLAN, 0.05).dots).toBeGreaterThan(0.75);
    expect(massAt(PLAN, 0.95).dots).toBeLessThan(0.02);
  });

  it('a piece’s dust is released as the piece grinds down', () => {
    // count the motes of each piece that have been released, against the piece's eroded share
    const of = SEEDS.map(() => []);
    const rng = createRng(5);
    const plan = dustPlan(20000, SEEDS, rng);
    for (let m = 0; m < plan.count; m++) {
      if (plan.A[m * 4] !== GROUP.piece) continue;
      const offset = plan.A[m * 4 + 1];
      const k = SEEDS.findIndex((s) => {
        const [a, b] = pieceErosion(s);
        return offset >= a - 1e-6 && offset <= b + 1e-6;
      });
      expect(k).toBeGreaterThanOrEqual(0);
      const [a, b] = pieceErosion(SEEDS[k]);
      of[k].push((offset - a) / (b - a));
    }
    const all = of.flat();
    for (const q of [0.25, 0.5, 0.75]) expect(close(all.filter((x) => x < q).length / all.length, q, 0.02)).toBe(true);
  });
});

describe('a whole planet has a faint neighbour on either side', () => {
  const whole = [ORBIT.accrete[1], 1 + ORBIT.seams]; // while the planet formed in a hop is whole

  it('shows a shade before and after it, with dust flowing in both gaps, and nothing elsewhere', () => {
    for (const first of [0, 5]) {
      for (let x = whole[0] + 0.01; x < whole[1] - 0.005; x += 0.01) {
        const n = 3;
        const L = layout((n + x) * HOP, first);
        const current = (first + n) % 8; // the planet that formed in hop n
        const solid = L.planets.find((p) => p.i === current);
        expect(solid && close(solid.r, GEOM.stationR)).toBe(true);
        const prev = L.shades.find((s) => s.i === (current + 7) % 8);
        const next = L.shades.find((s) => s.i === (current + 1) % 8);
        // the previous shade thins to nothing at 1.0 (its last dust is then in flight); the next one thickens
        if (x < ORBIT.stragglers.leave[1] - 0.02) expect(prev?.strength).toBeGreaterThan(0.02);
        expect(next?.strength).toBeGreaterThan(0.02);
        for (const s of L.shades) expect([(current + 7) % 8, (current + 1) % 8]).toContain(s.i);
        for (const p of L.planets) expect(p.i).toBe(current);
        // traces: dust in flight into the whole planet and on from it
        let into = 0;
        let onward = 0;
        for (let m = 0; m < PLAN.count; m++) {
          const s = moteAt(PLAN, m, n + x);
          if (s.at !== 'flight') continue;
          if (s.to === n) into++;
          else if (s.to === n + 1) onward++;
          else throw new Error(`dust flying to station ${s.to} in hop ${n + x}`);
        }
        if (x < ORBIT.stragglers.land - 0.02) expect(into).toBeGreaterThan(0);
        expect(onward).toBeGreaterThan(0);
      }
    }
  });

  it('the previous shade has emptied, every straggler landed, before the planet bursts', () => {
    expect(ORBIT.stragglers.land).toBeLessThan(1 + ORBIT.seams);
    expect(remnant(1)).toBe(0);
    for (let m = 0; m < PLAN.count; m++) {
      const [group, offset, flight] = PLAN.A.subarray(m * 4, m * 4 + 3);
      if (group !== GROUP.straggler) continue;
      expect(offset + flight).toBeLessThanOrEqual(ORBIT.stragglers.land + 1e-6);
      expect(moteAt(PLAN, m, 4 + ORBIT.stragglers.land - 1 + 1e-4).at).toBe('planet');
      expect(moteAt(PLAN, m, 4 + ORBIT.seams + 1e-4).at).toBe('shade'); // and it stays behind at the next burst
    }
  });

  it('a shade’s strength follows the dust that hangs in it', () => {
    const hanging = (h, station) => {
      let c = 0;
      for (let m = 0; m < PLAN.count; m++) {
        const s = moteAt(PLAN, m, h);
        if (s.at === 'shade' && s.to === station) c++;
      }
      return c / PLAN.count;
    };
    for (let u = 0.3; u < 1; u += 0.05) {
      // the old planet's (stragglers), at station 2 in hop 3
      expect(close(hanging(3 + u, 2), ORBIT.stragglers.share * remnant(u), 6e-3)).toBe(true);
    }
    // the coming planet's (leaders) thickens through the hop before it forms
    for (let x = -0.4; x < 0.3; x += 0.05) {
      const arrived = hanging(4 + x, 4);
      const expected = ORBIT.leaders.share * Math.min(1, Math.max(0, (x + 0.4) / 0.55));
      expect(close(arrived, expected, 6e-3)).toBe(true);
      if (x < ORBIT.accrete[0]) expect(close(precursor(x), expected / ORBIT.leaders.share, 1e-6)).toBe(true);
    }
  });

  it('never draws more than two shades or two solid planets', () => {
    for (let w = 0; w < 10 * HOP; w += 0.004) {
      const L = layout(w, 1);
      expect(L.shades.length).toBeLessThanOrEqual(2);
      expect(L.planets.length).toBeLessThanOrEqual(2);
      for (const s of L.shades) {
        expect(s.strength).toBeGreaterThan(0);
        expect(s.strength).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('the debris keeps clear', () => {
  it('no piece goes below the mirror floor, and none reaches the forming planet', () => {
    const step = (2 * Math.PI) / 8;
    let minFloor = Infinity;
    let minGap = Infinity;
    for (let i = 0; i < 8; i++) {
      for (let u = 0; u <= ORBIT.pieces[1]; u += 0.01) {
        const a = stationAngle(i) + cloudAdvance(u) * step;
        const target = onRing(stationAngle(i + 1));
        const targetR = GEOM.stationR * Math.cbrt(landed(u));
        for (const s of SEEDS) {
          const size = pieceScale(pieceEroded(s, u));
          if (size === 0) continue;
          const off = pieceOffset(s, u);
          const centre = fromFrame(a, [0, 1, 2].map((j) => (s.dir[j] * PIECE.core + off[j]) * GEOM.stationR));
          minFloor = Math.min(minFloor, centre[1] - GEOM.floorY);
          const d = Math.hypot(centre[0] - target[0], centre[1] - target[1], centre[2] - target[2]);
          minGap = Math.min(minGap, d - targetR);
        }
      }
    }
    expect(minFloor).toBeGreaterThan(0.02);
    expect(minGap).toBeGreaterThan(0.02);
  });

  it('reduced motion: the pieces drift apart instead of blasting', () => {
    for (const s of SEEDS) {
      const far = pieceOffset(s, ORBIT.pieces[1]);
      const near = pieceOffset(s, ORBIT.pieces[1], ORBIT, 0.45);
      expect(Math.hypot(...near)).toBeLessThan(Math.hypot(...far) * 0.6);
    }
    const calm = dustPlan(2000, SEEDS, createRng(5), ORBIT, 0.45);
    const full = dustPlan(2000, SEEDS, createRng(5));
    const reach = (plan) => {
      let max = 0;
      for (let m = 0; m < plan.count; m++) if (plan.A[m * 4] === GROUP.piece) max = Math.max(max, Math.hypot(...plan.B.subarray(m * 4, m * 4 + 3)));
      return max;
    };
    expect(reach(calm)).toBeLessThan(reach(full) * 0.8);
    expect([...calm.A]).toEqual([...full.A]); // the schedule itself is the same
  });

  it('dust is released where its piece is', () => {
    for (let m = 0; m < PLAN.count; m++) {
      if (PLAN.A[m * 4] > GROUP.core) continue;
      const p = PLAN.B.subarray(m * 4, m * 4 + 3);
      const reach = Math.hypot(p[0], p[1], p[2]) / GEOM.stationR;
      expect(reach).toBeLessThan(PIECE.core + PIECE.seam + PIECE.blast[1] + 0.5);
    }
  });
});

describe('the wheel’s clock runs like a changing connection', () => {
  const plans = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => speedPlan(createRng(seed)));

  it('never runs backwards, stays within its speeds and averages 1×', () => {
    for (const plan of plans) {
      let prev = -1;
      for (let t = 0; t < plan.period * 2.2; t += 0.01) {
        const w = phaseAt(plan, t);
        expect(w).toBeGreaterThan(prev);
        prev = w;
        const v = speedAt(plan, t);
        expect(v).toBeGreaterThan(NET.stall.v[0] * 0.85);
        expect(v).toBeLessThan(NET.burst.v[1] * 1.15);
        // the speed is the clock's slope
        if (t > 0.01) expect(close((phaseAt(plan, t + 1e-4) - phaseAt(plan, t - 1e-4)) / 2e-4, v, 2e-2)).toBe(true);
      }
      expect(close(phaseAt(plan, plan.period), plan.period, 1e-9)).toBe(true);
      expect(close(phaseAt(plan, 3 * plan.period), 3 * plan.period, 1e-9)).toBe(true);
    }
  });

  it('loops without a jump', () => {
    for (const plan of plans) {
      expect(close(speedAt(plan, plan.period - 1e-6), speedAt(plan, plan.period + 1e-6), 1e-3)).toBe(true);
      expect(close(phaseAt(plan, plan.period - 1e-6), phaseAt(plan, plan.period + 1e-6), 1e-4)).toBe(true);
      expect(plan.period).toBeGreaterThanOrEqual(NET.length);
    }
  });

  it('is steady for the hand-off, then slows and bursts before anyone can click', () => {
    for (const plan of plans) {
      for (let t = 0; t < 0.8; t += 0.05) expect(close(speedAt(plan, t), speedAt(plan, 0), 1e-9)).toBe(true);
      let slow = false;
      let fast = false;
      for (let t = 0; t < LOADER.quiet; t += 0.02) {
        slow ||= speedAt(plan, t) < 0.5;
        fast ||= speedAt(plan, t) > 1.5;
      }
      expect(slow && fast).toBe(true);
    }
  });

  it('no near-stall lasts long, and each is followed by a burst', () => {
    for (const plan of plans) {
      let run = 0;
      for (let t = 0; t < plan.period; t += 0.005) {
        run = speedAt(plan, t) < 0.25 ? run + 0.005 : 0;
        expect(run).toBeLessThan(NET.stall.dur[1] + NET.drop + 0.1);
      }
      for (let k = 0; k < plan.n; k++) if (plan.state[k] === 'stall') expect(plan.state[(k + 1) % plan.n]).toBe('burst');
      expect(new Set(plan.state)).toEqual(new Set(['steady', 'slow', 'stall', 'burst']));
    }
  });

  it('is the same for the same seed', () => {
    const a = speedPlan(createRng(42));
    const b = speedPlan(createRng(42));
    const c = speedPlan(createRng(43));
    for (let t = 0; t < 30; t += 0.37) expect(phaseAt(a, t)).toBe(phaseAt(b, t));
    expect(phaseAt(a, 20)).not.toBe(phaseAt(c, 20));
    expect(stateAt(a, 0.1)).toBe('steady');
  });

  it('reduced motion: half speed, and a calm connection', () => {
    const plan = speedPlan(createRng(3), { reduced: true });
    for (let t = 0; t < plan.period; t += 0.02) {
      expect(speedAt(plan, t)).toBeGreaterThan(NET.calm.v[0] * 0.85);
      expect(speedAt(plan, t)).toBeLessThan(NET.calm.v[1] * 1.15);
    }
    expect(close(phaseAt(plan, plan.period), plan.period, 1e-9)).toBe(true);
    const calm = new WheelClock(plan, { reduced: true });
    const full = new WheelClock(plan);
    calm.start(10);
    full.start(10);
    expect(close(calm.at(25), full.at(25) / 2, 1e-9)).toBe(true);
  });

  it('the hitch freezes the clock, then catches up without running backwards', () => {
    // a plain miss, and one where the page really was busy for a second (as the wheel uses it)
    for (const freeze of [LOADER.hitch, 1.15]) {
      const catchUp = hitchCatchUp(freeze);
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

  it('hitches on top of the changing speed never run the wheel backwards', () => {
    const clock = new WheelClock(plans[0]);
    expect(clock.at(5)).toBe(0); // not started yet
    clock.start(2, 3);
    expect(clock.first).toBe(3);
    let prev = 0;
    for (let now = 2; now < 12; now += 0.004) {
      if (close(now, 7, 0.002) || close(now, 7.3, 0.002) || close(now, 9, 0.002)) clock.hitch(now, now > 8 ? 1.1 : LOADER.hitch);
      const w = clock.at(now);
      expect(w).toBeGreaterThanOrEqual(prev);
      prev = w;
    }
    expect(close(clock.at(20), phaseAt(plans[0], 18), 1e-9)).toBe(true); // caught up completely
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
