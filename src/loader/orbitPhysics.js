// The fancy loading wheel's motion. It builds the two loading-ui.com reference spinners as a small
// solar system whose physics is a bit different:
//  - Spiral: 8 dots at fixed angles round a ring, each growing and shrinking (scale and opacity
//    0 → 1 → 0, easeInOut halves, 1.5 s), dot i delayed by i/8 of a period, so a wave runs clockwise.
//    Here every dot is a planet's life: it accretes from dust, matures and crumbles, and its dust
//    flies clockwise into the planets forming ahead of it. The planets don't orbit; their matter does.
//  - Twin Orbit: two markers the size of a centre dot circle it at 1.55 diameters with CSS `ease`
//    timing (they sling away from 3 o'clock and brake back into it), the second half a lap behind.
//    Here a star and two twins, whose orbit plane leans back and slowly precesses.
// Tides are exaggerated, the star raises them on its planets and they on it.
//
// Pure functions of the wheel's clock t (seconds on the performance.now() clock), shared by the 3D
// scene and the tests. World units: the menu donut's ring has outer radius 1 (0.34 of the CSS box),
// centred on the origin, facing +z, y up. Angles run clockwise on screen from 3 o'clock.
import { ORBIT, LOADER } from '../config.js';

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
export const EASE = cubicBezier(0.25, 0.1, 0.25, 1); // CSS `ease` (Twin Orbit)
export const EASE_IN_OUT = cubicBezier(0.42, 0, 0.58, 1); // Motion's easeInOut (Spiral)

// CSS box fraction per world unit: the menu donut's ring has outer radius 0.34 of the box.
export const BOX = 0.34;

export const GEOM = {
  ringR: 0.3125 / BOX, // Spiral: dots sit at 31.25 % of the box from its centre
  stationR: 0.27, // a ring planet at full size (Spiral's dots are 18.75 % of the box wide: 0.276)
  starR: 0.13,
  twinR: 0.13, // Twin Orbit: the markers are the size of the centre dot…
  twinOrbit: 1.55 * 0.26, // …and circle it at translate(155%) of their own size
  twinTilt: 0.45, // rad the twins' orbit plane leans back
  precession: 9, // s per turn of the lean's axis
  morph: 0.12, // surface displacement never exceeds this share of a body's radius…
  tideMax: 0.12, // …nor does a tidal bulge
  floorY: -1.32,
};

// Big G for the tides (exaggerated on purpose).
const G = 0.01;

const TAU = Math.PI * 2;
export const onRing = (a, r) => [r * Math.cos(a), -r * Math.sin(a), 0];
export const stationAngle = (i, n = ORBIT.stations) => (i / n) * TAU;

// A ring planet's life: Spiral's scale wave as accretion (hot and lumpy while small) and break-up.
export function stationLife(i, t, c = ORBIT) {
  const since = t - (i / c.stations) * c.ringPeriod;
  if (since < 0) return { phase: 0, scale: 0, heat: 1, crack: 0 };
  const phase = (since / c.ringPeriod) % 1;
  const growing = phase < 0.5;
  const k = growing ? phase * 2 : phase * 2 - 1;
  const scale = growing ? EASE_IN_OUT(k) : 1 - EASE_IN_OUT(k);
  return { phase, scale, heat: growing ? (1 - k) ** 1.5 : 0, crack: growing ? 0 : k ** 1.2 };
}

// Twin Orbit: rotate(0 → 360deg) with `ease`, twin k half a period behind. Unlike the reference,
// the late twin doesn't wait on top of the first at 3 o'clock: they have been circling forever.
export function twinAngle(k, t, c = ORBIT) {
  const u = (t - (k * c.twinPeriod) / 2) / c.twinPeriod;
  return TAU * EASE(u - Math.floor(u));
}

// Rodrigues: v rotated by angle a about the unit axis u.
function rotateAbout(v, u, a) {
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  const d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const x = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  return [0, 1, 2].map((j) => v[j] * cs + x[j] * sn + u[j] * d * (1 - cs));
}

export function twinPos(k, t, c = ORBIT) {
  const v = onRing(twinAngle(k, t, c), GEOM.twinOrbit);
  const psi = (TAU * t) / (GEOM.precession * (c.ringPeriod / ORBIT.ringPeriod));
  return rotateAbout(v, [Math.cos(psi), Math.sin(psi), 0], GEOM.twinTilt);
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

// Tidal bulge on `body` raised by mass m at `pos`: height amp·P2(n·dir) along the surface normal n.
function tide(body, pos, m) {
  const d = sub(pos, body.pos);
  const dist = len(d);
  const amp = Math.min(GEOM.tideMax * body.r, (G * m * body.r) / dist ** 3);
  return { dir: d.map((v) => v / dist), amp };
}

// Every body at time t: positions, radii, life and up to two tides each.
export function layout(t, c = ORBIT) {
  const star = { pos: [0, 0, 0], r: GEOM.starR, m: 1 };
  const twins = [0, 1].map((k) => ({ pos: twinPos(k, t, c), r: GEOM.twinR, m: 1 }));
  const stations = [];
  for (let i = 0; i < c.stations; i++) {
    const life = stationLife(i, t, c);
    stations.push({ pos: onRing(stationAngle(i, c.stations), GEOM.ringR), r: GEOM.stationR * life.scale, m: life.scale ** 3, ...life });
  }
  star.tides = twins.map((w) => tide(star, w.pos, w.m));
  twins[0].tides = [tide(twins[0], star.pos, star.m), tide(twins[0], twins[1].pos, twins[1].m)];
  twins[1].tides = [tide(twins[1], star.pos, star.m), tide(twins[1], twins[0].pos, twins[0].m)];
  for (const s of stations) {
    const near = len(sub(twins[0].pos, s.pos)) < len(sub(twins[1].pos, s.pos)) ? twins[0] : twins[1];
    s.tides = s.r > 0 ? [tide(s, near.pos, near.m)] : [{ dir: [1, 0, 0], amp: 0 }];
  }
  return { star, twins, stations };
}

// Dust: each mote is shed by a crumbling ring planet and flies 1–4 stations clockwise into a planet
// that is forming when it arrives. The schedule repeats every ring period. Per mote: source station,
// release time (s, in the cycle that starts at t = 0), flight time and hops.
export const DUST_FLIGHT = [0.3, 1.2];
export function dustPlan(count, rand, c = ORBIT) {
  const T = c.ringPeriod;
  const n = c.stations;
  const out = new Float32Array(count * 4);
  for (let m = 0; m < count; m++) {
    const src = m % n;
    const release = (src / n) * T + T * (0.5 + 0.45 * rand()); // during the source's break-up
    const options = [];
    for (let hops = 1; hops <= 4; hops++) {
      // the target's accretion windows start at ((src + hops)/n + k)·T and last T/2
      let start = ((src + hops) / n) * T;
      while (start + T / 2 <= release + DUST_FLIGHT[0]) start += T;
      const a = Math.max(release + DUST_FLIGHT[0], start);
      const b = Math.min(start + T / 2, release + DUST_FLIGHT[1]);
      if (b - a > 0.05) options.push({ hops, a, b });
    }
    const o = options[Math.floor(rand() * options.length)];
    const arrive = o.a + (o.b - o.a) * (0.1 + 0.8 * rand());
    out.set([src, release, arrive - release, o.hops], m * 4);
  }
  return out;
}

// A missed attempt: how far the wheel's clock lags real time s seconds into the hitch. Frozen for
// `freeze` s as if the page were busy, then it catches up over `catchUp` s with a slight overshoot.
const C1 = 1.70158;
const easeOutBack = (x) => 1 + (C1 + 1) * (x - 1) ** 3 + C1 * (x - 1) ** 2;
export function hitchLag(s, freeze = LOADER.hitch, catchUp = 0.4) {
  if (s <= 0) return 0;
  if (s < freeze) return s;
  const x = (s - freeze) / catchUp;
  if (x >= 1) return 0;
  return freeze * (1 - easeOutBack(x));
}

// Reduced motion: everything at half speed.
export const clockFor = (reduced) => (reduced ? { ...ORBIT, ringPeriod: ORBIT.ringPeriod * 2, twinPeriod: ORBIT.twinPeriod * 2 } : ORBIT);
