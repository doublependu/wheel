// The fancy loading wheel's motion. A ring of 8 stations (the dot positions of loading-ui.com's
// Spiral) and one planet's worth of matter that goes round it, a station per hop:
//  - the planet at a station is built of solid wedge pieces. Its seams open, it bursts, and the
//    pieces fly forward along the ring and in toward the hub, tumble and grind down to dust;
//  - the dust streams clockwise to the next station and lands on a hot blob there, which grows with
//    it into the next planet. That one rests for a moment, whole, and bursts in turn;
//  - a tenth of the dust (stragglers) stays behind as a faint shade of the old planet and trickles
//    after the rest; another tenth (leaders) runs a station ahead and hangs there as a faint shade
//    of the planet to come. So a whole planet always has a faint neighbour on either side.
//
// Pure functions of wheel time (netSpeed.js: it runs faster and slower than real time), shared by
// the 3D scene and the tests. The shaders in render3d/bodies.js and orbit.js follow the same
// formulas and constants. World units: the menu donut's ring has outer radius 1 (0.34 of the CSS
// box), centred on the origin, facing +z, y up. Angles run clockwise on screen from 3 o'clock.
import { ORBIT, SPIRAL } from '../config.js';

// CSS-style cubic-bézier easing x → y, solved the way browsers do (Newton, then bisection).
export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dsx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-7) return sy(t);
      const d = dsx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    while (hi - lo > 1e-7) {
      if (sx(t) < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}
export const EASE_IN_OUT = cubicBezier(0.42, 0, 0.58, 1); // Motion's easeInOut (Spiral)

// CSS box fraction per world unit: the menu donut's ring has outer radius 0.34 of the box.
export const BOX = 0.34;

export const GEOM = {
  ringR: 0.3125 / BOX, // Spiral: dots sit at 31.25 % of the box from its centre
  stationR: 0.27, // a planet at full size (Spiral's dots are 18.75 % of the box wide: 0.276)
  morph: 0.12, // surface displacement never exceeds this share of a planet's radius
  floorY: -1.32,
};

const TAU = Math.PI * 2;
const sat = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, x) => a + (b - a) * x;
const smooth = (x) => sat(x) ** 2 * (3 - 2 * sat(x));
const ramp = (a, b, x) => smooth((x - a) / (b - a));
const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

export const stationAngle = (i, n = ORBIT.stations) => (i / n) * TAU;
export const onRing = (a, r = GEOM.ringR) => [r * Math.cos(a), -r * Math.sin(a), 0];
// A station's own frame: x forward along the ring (clockwise), y outward, z toward the viewer. A
// planet's mesh is turned into it (rotation −(a + 90°) about z), so every planet breaks the same
// way relative to where its matter is headed.
export const fromFrame = (a, l) => {
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  return [cs * GEOM.ringR - sn * l[0] + cs * l[1], -sn * GEOM.ringR - cs * l[0] - sn * l[1], l[2]];
};

// The pre-loader's dot i at real time t (s): Spiral's scale 0 → 1 → 0 with easeInOut halves, each
// dot i/8 of a period behind the previous one.
export function spiralScale(i, t, period = SPIRAL.period) {
  const since = t - (i / SPIRAL.dots) * period;
  if (since < 0) return 0;
  const phase = (since / period) % 1;
  return phase < 0.5 ? EASE_IN_OUT(phase * 2) : 1 - EASE_IN_OUT(phase * 2 - 1);
}

// ---------- pieces ----------
// Lengths are in planet radii, in the station's frame; times are shares of a hop (u).
export const PIECE = {
  core: 0.74, // a piece turns and shrinks about this point along its direction
  seam: 0.035, // the pieces part this far before the burst
  bias: [0.7, -0.8, 0], // the blast leans forward along the ring and in toward the hub
  blast: [0.55, 1.0], // how far a piece flies
  drag: 9, // it has flown 1 − e^(−drag·Δu) of that Δu after the burst
  spin: [1.5, 5], // rad it tumbles over its flight
  erodeFrom: 0.04, // the front pieces start to grind down this long after the burst…
  erodeLag: 0.1, // …the rear ones this much later
  erode: [0.18, 0.21], // and a piece is dust this long after it started
  drift: 0.22, // the debris cloud's centre drifts this share of a station step along the ring
};

// The pieces of a planet: unit directions spread evenly over the sphere (a jittered Fibonacci
// lattice) with three random numbers each. Every triangle of the sphere belongs to the nearest one.
export function pieceSeeds(count, rand) {
  const seeds = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let k = 0; k < count; k++) {
    const y = 1 - (2 * (k + 0.5)) / count;
    const r = Math.sqrt(1 - y * y);
    const a = k * golden;
    const j = () => (rand() - 0.5) * (1.6 / Math.sqrt(count));
    seeds.push({ dir: norm([r * Math.cos(a) + j(), y + j(), r * Math.sin(a) + j()]), r: [rand(), rand(), rand()] });
  }
  return seeds;
}
export const nearestSeed = (seeds, d) => {
  let best = 0;
  let bestDot = -2;
  for (let k = 0; k < seeds.length; k++) {
    const s = seeds[k].dir;
    const dp = s[0] * d[0] + s[1] * d[1] + s[2] * d[2];
    if (dp > bestDot) {
      bestDot = dp;
      best = k;
    }
  }
  return best;
};

// Share of its flight a piece has covered at hop phase u.
export const pieceTravel = (u, c = ORBIT) => (u <= c.seams ? 0 : 1 - Math.exp(-PIECE.drag * (u - c.seams)));
// Where a piece's centre has moved to (from core·dir). `gentle` < 1 (reduced motion): the pieces
// drift apart instead of blasting, and tumble less.
export function pieceOffset(seed, u, c = ORBIT, gentle = 1) {
  const d = norm([seed.dir[0] + PIECE.bias[0], seed.dir[1] + PIECE.bias[1], seed.dir[2] + PIECE.bias[2]]);
  const seam = PIECE.seam * ramp(0, c.seams, u);
  const fly = lerp(PIECE.blast[0], PIECE.blast[1], seed.r[0]) * pieceTravel(u, c) * gentle;
  return [seed.dir[0] * seam + d[0] * fly, seed.dir[1] * seam + d[1] * fly, seed.dir[2] * seam + d[2] * fly];
}
// When a piece grinds down: [start, end].
export function pieceErosion(seed, c = ORBIT) {
  const start = c.pieces[0] + PIECE.erodeFrom + (1 - seed.dir[0]) * 0.5 * PIECE.erodeLag + 0.03 * seed.r[1];
  return [start, Math.min(c.pieces[1], start + lerp(PIECE.erode[0], PIECE.erode[1], seed.r[2]))];
}
// The share of a piece that is dust already, and the size of what is left of it.
export const pieceEroded = (seed, u, c = ORBIT) => {
  const [a, b] = pieceErosion(seed, c);
  return sat((u - a) / (b - a));
};
export const pieceScale = (eroded) => Math.cbrt(1 - eroded);
// Its tumble: a unit axis and an angle.
export function pieceTurn(seed, u, c = ORBIT, gentle = 1) {
  const axis = norm([seed.r[0] - 0.5, seed.r[1] - 0.5, seed.r[2] - 0.5 + 1e-3]);
  return { axis, angle: pieceTravel(u, c) * lerp(PIECE.spin[0], PIECE.spin[1], seed.r[1]) * (seed.r[2] < 0.5 ? -1 : 1) * gentle };
}
// v rotated by angle a about the unit axis k (Rodrigues).
export function turned(v, k, a) {
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  const d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  const x = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  return [0, 1, 2].map((j) => v[j] * cs + x[j] * sn + k[j] * d * (1 - cs));
}
// How far along the ring the debris cloud's centre has drifted, in station steps.
export const cloudAdvance = (u, c = ORBIT) => PIECE.drift * ramp(c.seams, c.pieces[1], u);

// ---------- one hop ----------
// Share of the bulk of the dust that has landed on the next planet. Its radius is the cube root.
export const landed = (u, c = ORBIT) => ramp(c.accrete[0], c.accrete[1], u);
const unsmooth = (y) => 0.5 - Math.sin(Math.asin(1 - 2 * sat(y)) / 3); // the inverse of smoothstep

// How strong the faint shades are (0…1). The old planet's: it appears as the pieces leave and thins
// as its stragglers do.
export function remnant(u, c = ORBIT) {
  const [a, b] = c.stragglers.leave;
  return ramp(c.seams, c.seams + 0.2, u) * (1 - sat((u - a) / (b - a)));
}
// The coming planet's, x hops into the hop that forms it (it starts in the hop before, x < 0): it
// thickens as leaders arrive and gives way to the blob that grows inside it.
export function precursor(x, c = ORBIT) {
  const a = c.leaders.leave[0] + c.leaders.flight - 1;
  const b = c.leaders.leave[1] + c.leaders.flight - 1;
  return sat((x - a) / (b - a)) * (1 - ramp(c.accrete[0], c.accrete[0] + 0.26, x));
}
// The very first planet has no hop before it: its shade gathers out of the pre-loader's dust.
const firstPrecursor = (u, c) => ramp(0, 0.3, u) * (1 - ramp(c.accrete[0], c.accrete[0] + 0.26, u));

// The light of the explosion: it rises as the seams open, peaks at the burst and dies down.
export const blastPower = (u, c = ORBIT) => (u < c.seams ? 0.25 * smooth(u / c.seams) : Math.exp(-7 * (u - c.seams)));
// How hot the inside of the pieces glows.
export const innerGlow = (u, c = ORBIT) => (u < 0 ? 0 : u < c.seams ? 0.8 * smooth(u / c.seams) : Math.exp(-5 * (u - c.seams)));

// Everything on the ring at wheel time w (s). `first`: the station where the first planet forms.
// Hop n takes the matter from station first − 1 + n to first + n; hop 0 has no planet to come from
// (its matter is the pre-loader's dots, turned to dust).
//  planets: the solid ones (at most two), each { i, angle, pos, r, heat, u }. u ≥ 0: the hop phase
//    of a planet whose seams are opening or that has burst; −1: forming or resting.
//  shades: the faint ones (at most two), each { i, strength, remnant }.
export function layout(w, first = 0, c = ORBIT) {
  const N = c.stations;
  const h = Math.max(0, w) / c.hop;
  const n = Math.floor(h);
  const u = h - n;
  const mod = (i) => ((i % N) + N) % N;
  const src = mod(first - 1 + n);
  const dst = mod(first + n);
  const planets = [];
  const shades = [];
  let blast = { pos: onRing(stationAngle(dst)), power: 0 };
  if (n >= 1 && u < c.pieces[1]) {
    const angle = stationAngle(src) + cloudAdvance(u, c) * (TAU / N);
    planets.push({ i: src, angle, pos: onRing(angle), r: GEOM.stationR, heat: 0, u });
    blast = { pos: onRing(angle), power: blastPower(u, c) };
  }
  const m = landed(u, c);
  if (m > 0) {
    const angle = stationAngle(dst);
    // hot and lumpy while the dust lands, then it cools into its look
    const heat = 0.85 * (1 - m) ** 1.5 + 0.15 * (1 - ramp(c.accrete[1], c.accrete[1] + 0.08, u));
    planets.push({ i: dst, angle, pos: onRing(angle), r: GEOM.stationR * Math.cbrt(m), heat, u: -1 });
  }
  const add = (i, strength, isRemnant) => strength > 1e-3 && shades.push({ i, strength, remnant: isRemnant });
  if (n >= 1) add(src, remnant(u, c), true);
  add(dst, n === 0 ? firstPrecursor(u, c) : precursor(u, c), false);
  add(mod(dst + 1), precursor(u - 1, c), false);
  return { n, u, h, src, dst, planets, shades, blast };
}

// ---------- dust ----------
// Every mote repeats one routine each hop, a flight from one station to the next and a rest:
//  - bulk (pieces and core): rests hidden in the planet, then on its piece; is released as the piece
//    grinds down (core motes at the burst); flies to the next station and lands, hidden again;
//  - stragglers: hang where the old planet was, leave late, land on the whole planet and hide until
//    it bursts;
//  - leaders: hang at the station ahead of the whole planet, leave when the bulk arrives there, and
//    fly on. They never land.
// Flight k of a mote starts at hop phase k + offset and lasts `flight` hops. It runs from station
// first − 1 + k to first + k (leaders: one station further on).
export const GROUP = { piece: 0, core: 1, straggler: 2, leader: 3 };

// The schedule, 8 floats per mote: [group, offset, flight, advance] and [x, y, z, seed].
//  advance: for bulk, how far along the ring (in station steps) the debris cloud is at release;
//  x, y, z: for bulk, the release point in the source station's frame (world units from the cloud's
//    centre); for the others, a point in the unit ball (where it hangs in the shade).
export function dustPlan(count, seeds, rand, c = ORBIT, gentle = 1) {
  const A = new Float32Array(count * 4);
  const B = new Float32Array(count * 4);
  const ball = () => {
    const d = norm([rand() - 0.5, rand() - 0.5, rand() - 0.5]);
    const r = Math.cbrt(rand());
    return [d[0] * r, d[1] * r, d[2] * r];
  };
  const bulk = [];
  for (let m = 0; m < count; m++) {
    const lot = (m * 0.6180339887) % 1; // evenly spread, so any tier gets the same shares
    let group;
    let offset;
    let flight = 0;
    let advance = 0;
    let p;
    if (lot < c.stragglers.share) {
      group = GROUP.straggler;
      offset = lerp(c.stragglers.leave[0], c.stragglers.leave[1], rand());
      flight = Math.min(0.2 + 0.1 * rand(), c.stragglers.land - offset);
      p = ball();
    } else if (lot < c.stragglers.share + c.leaders.share) {
      group = GROUP.leader;
      offset = lerp(c.leaders.leave[0], c.leaders.leave[1], rand());
      flight = c.leaders.flight;
      p = ball();
    } else if ((m * 0.7548776662) % 1 < 0.25) {
      group = GROUP.core;
      offset = c.seams + 0.06 * rand() ** 2;
      p = ball().map((v) => v * 0.35 * GEOM.stationR);
      advance = cloudAdvance(offset, c);
      bulk.push(m);
    } else {
      // a point inside a piece, carried along with it until that much of the piece is dust
      group = GROUP.piece;
      const d = norm([rand() - 0.5, rand() - 0.5, rand() - 0.5]);
      const seed = seeds[nearestSeed(seeds, d)];
      const [a, b] = pieceErosion(seed, c);
      const q = rand();
      offset = lerp(a, b, q);
      const core = seed.dir.map((v) => v * PIECE.core);
      const rho = 0.55 + 0.45 * rand();
      const turn = pieceTurn(seed, offset, c, gentle);
      const local = turned([d[0] * rho - core[0], d[1] * rho - core[1], d[2] * rho - core[2]], turn.axis, turn.angle);
      const off = pieceOffset(seed, offset, c, gentle);
      const s = pieceScale(q);
      p = [0, 1, 2].map((j) => (core[j] + local[j] * s + off[j]) * GEOM.stationR);
      advance = cloudAdvance(offset, c);
      bulk.push(m);
    }
    A.set([group, offset, flight, advance], m * 4);
    B.set([p[0], p[1], p[2], rand()], m * 4);
  }
  // The bulk lands in the order it was released (roughly), at a rate that makes the landed share
  // exactly landed(u): the next planet grows as fast as its dust arrives.
  const order = bulk.map((m) => [m, A[m * 4 + 1] + 0.03 * rand()]).sort((a, b) => a[1] - b[1]);
  order.forEach(([m], j) => {
    const at = lerp(c.accrete[0], c.accrete[1], unsmooth((j + 0.5) / order.length));
    A[m * 4 + 2] = Math.max(0.12, at - A[m * 4 + 1]);
  });
  return { A, B, count };
}

// Where mote m is at hop phase h (hops since the wheel started), with stations counted from the
// first planet's (0) and not wrapped. `at`:
//  'dots'    standing where the pre-loader's dots were (hop 0 only)
//  'planet'  hidden in a whole planet or on one of its pieces (station `to`)
//  'flight'  flying from `from` to `to`, f of the way
//  'shade'   hanging in a faint shade at station `to`
export function moteAt(plan, m, h, c = ORBIT) {
  const [group, offset, flight] = plan.A.subarray(m * 4, m * 4 + 3);
  const leader = group === GROUP.leader;
  const q = h - offset;
  const k = Math.floor(q);
  const tau = q - k;
  const n = Math.floor(h);
  const u = h - n;
  const to = (leader ? k + 1 : Math.max(k, 0)) + 0;
  const state = { group, k, to, from: to - 1, f: 0 };
  if (k < 0 && !leader) return { ...state, at: 'dots' };
  if (tau < flight) return { ...state, at: 'flight', f: tau / flight };
  if (leader) return { ...state, at: 'shade' };
  if (group === GROUP.straggler) return { ...state, at: k >= n || u < c.seams ? 'planet' : 'shade' };
  return { ...state, at: 'planet' };
}

// Where the matter is at hop phase h, as shares of all motes:
//  old: bulk still in the planet that is about to burst or on its pieces; stragglers hidden in it
//  flying: in flight;  shade: in a faint shade;  fresh: landed on the planet that is forming
//  dots: still standing where the pre-loader's dots were
export function massAt(plan, h, c = ORBIT) {
  const n = Math.floor(h);
  const out = { old: 0, flying: 0, shade: 0, fresh: 0, dots: 0 };
  for (let m = 0; m < plan.count; m++) {
    const s = moteAt(plan, m, h, c);
    if (s.at === 'flight') out.flying++;
    else if (s.at === 'planet') out[s.to >= n ? 'fresh' : 'old']++;
    else out[s.at]++;
  }
  for (const k of Object.keys(out)) out[k] /= plan.count;
  return out;
}
