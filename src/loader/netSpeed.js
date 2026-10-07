// The loading wheel's clock. Wheel time runs faster and slower than real time, as if the wheel were
// fed by a connection whose speed keeps changing: steady stretches, slowdowns, short near-stalls
// and catch-up bursts (NET in config.js). A missed attempt adds a hitch on top. Pure and seeded; the
// 3D wheel and its CSS stand-in read the same clock, so one can take over from the other in phase.
import { NET, LOADER, SPIRAL } from '../config.js';

const lerp = (a, b, x) => a + (b - a) * x;

// Wheel time gained `tau` s into a segment that eases from speed v0 to v1 over `ramp` s (smoothstep)
// and then holds v1.
function gained(v0, v1, ramp, tau) {
  if (ramp <= 0) return v1 * tau;
  if (tau >= ramp) return (v0 + v1) * ramp * 0.5 + v1 * (tau - ramp);
  const x = tau / ramp;
  return v0 * tau + (v1 - v0) * ramp * x * x * x * (1 - x / 2);
}

// A table of speed segments. Segment k starts at t[k], eases from the previous segment's speed to
// v[k] over ramp[k] s and holds it; phi[k] is the wheel time at t[k]. The table lasts `period` s,
// in which the wheel also advances `period` s (a mean speed of exactly 1), and then repeats. It
// ends at the speed it starts with, so it loops without a jump. The same `rand` gives the same table.
export function speedPlan(rand = Math.random, { reduced = false } = {}, c = NET) {
  let segs;
  let length;
  const add = (state, dur, v) => {
    const s = c[state];
    const seg = { state, v: v ?? lerp(s.v[0], s.v[1], rand()), dur: dur ?? lerp(s.dur[0], s.dur[1], rand()) };
    segs.push(seg);
    length += seg.dur;
  };
  const draw = () => {
    segs = [];
    length = 0;
    if (reduced) {
      while (length < c.length) add('calm');
      add('calm', 1, segs[0].v);
      return;
    }
    // The opening: steady while the wheel takes over from the pre-loader, then every state once
    // within the first seconds, before anyone can click.
    add('steady', 0.8, 1);
    add('slow', lerp(0.6, 1.0, rand()));
    add('steady', lerp(0.8, 1.2, rand()));
    add('stall');
    const states = ['steady', 'slow', 'stall', 'burst'];
    const weight = states.reduce((s, k) => s + c[k].pick, 0);
    while (length < c.length) {
      const last = segs.at(-1).state;
      if (last === 'stall') {
        add('burst'); // what was held up arrives at once
        continue;
      }
      let r = rand() * weight;
      let state = states.find((k) => (r -= c[k].pick) <= 0) ?? 'steady';
      if (state === last && state !== 'steady') state = 'steady';
      add(state);
    }
    if (segs.at(-1).state === 'stall') add('burst');
    add('steady', 1, segs[0].v);
  };

  const plan = {};
  const fill = (scale) => {
    const n = segs.length;
    Object.assign(plan, { n, period: length, state: segs.map((s) => s.state), t: new Float64Array(n), v: new Float64Array(n), ramp: new Float64Array(n), phi: new Float64Array(n) });
    let t = 0;
    let phi = 0;
    for (let k = 0; k < n; k++) {
      const prev = segs[(k + n - 1) % n].v * scale;
      const v = segs[k].v * scale;
      plan.t[k] = t;
      plan.v[k] = v;
      plan.ramp[k] = Math.min(v < prev ? c.drop : c.rise, segs[k].dur * 0.8);
      plan.phi[k] = phi;
      phi += gained(prev, v, plan.ramp[k], segs[k].dur);
      t += segs[k].dur;
    }
    return phi / length; // the mean speed
  };
  // Draw tables until one averages within 5 % of 1×, then scale it to exactly 1×: that keeps every
  // state's speed close to its range.
  let mean;
  for (let tries = 0; tries < 50; tries++) {
    draw();
    mean = fill(1);
    if (Math.abs(mean - 1) <= 0.05) break;
  }
  fill(1 / mean);
  return plan;
}

// The segment in force at table time tt (0 ≤ tt < period).
function segment(plan, tt) {
  let lo = 0;
  let hi = plan.n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (plan.t[mid] <= tt) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// Wheel time (s) after t real seconds: the running total of the speed. Strictly increasing.
export function phaseAt(plan, t) {
  if (t <= 0) return 0;
  const laps = Math.floor(t / plan.period);
  const tt = t - laps * plan.period;
  const k = segment(plan, tt);
  return laps * plan.period + plan.phi[k] + gained(plan.v[(k + plan.n - 1) % plan.n], plan.v[k], plan.ramp[k], tt - plan.t[k]);
}

// The speed (× real time) at real time t, and the state the connection is in.
export function speedAt(plan, t) {
  const tt = ((t % plan.period) + plan.period) % plan.period;
  const k = segment(plan, tt);
  const prev = plan.v[(k + plan.n - 1) % plan.n];
  const x = plan.ramp[k] > 0 ? Math.min(1, (tt - plan.t[k]) / plan.ramp[k]) : 1;
  return prev + (plan.v[k] - prev) * x * x * (3 - 2 * x);
}
export const stateAt = (plan, t) => plan.state[segment(plan, ((t % plan.period) + plan.period) % plan.period)];

// A missed attempt: how far the clock lags real time s seconds into the hitch. Frozen for `freeze` s
// as if the page were busy, then it catches up over `catchUp` s with a slight overshoot.
const C1 = 1.70158;
const easeOutBack = (x) => 1 + (C1 + 1) * (x - 1) ** 3 + C1 * (x - 1) ** 2;
export function hitchLag(s, freeze = LOADER.hitch, catchUp = 0.4) {
  if (s <= 0) return 0;
  if (s < freeze) return s;
  const x = (s - freeze) / catchUp;
  if (x >= 1) return 0;
  return freeze * (1 - easeOutBack(x));
}
// a longer freeze catches up over longer, so the clock never runs backwards
export const hitchCatchUp = (freeze) => Math.max(0.4, freeze * 1.2);

// The station where the first planet forms: two ahead of the crest of the pre-loader's wave, whose
// dots then crumble into the dust it is made of. t: the performance.now() clock, in seconds.
export function firstStation(t, reduced = false) {
  const period = SPIRAL.period * (reduced ? 2 : 1);
  const crest = SPIRAL.dots * (t / period - 0.5);
  return (((Math.round(crest) + 2) % SPIRAL.dots) + SPIRAL.dots) % SPIRAL.dots;
}

// The wheel's clock: it starts when the fancy wheel takes over (stage B) and reads in wheel seconds.
// Reduced motion: half speed, on a calm table (see speedPlan).
export class WheelClock {
  constructor(plan, { reduced = false } = {}) {
    this.plan = plan;
    this.reduced = reduced;
    this.rate = reduced ? 0.5 : 1;
    this.t0 = null;
    this.first = 0;
    this.hitches = [];
    this.last = 0;
  }

  get started() {
    return this.t0 !== null;
  }

  // `first`: the station where the first planet forms.
  start(now, first = 0) {
    if (this.t0 !== null) return;
    this.t0 = now;
    this.first = first;
  }

  // A missed attempt: freeze for a moment (longer if the page really was busy), then catch up.
  hitch(now, freeze = LOADER.hitch) {
    this.hitches.push({ at: now, freeze });
  }

  // Real seconds since the start, less the lag of any hitch in progress. Never runs backwards.
  real(now) {
    if (this.t0 === null) return 0;
    this.hitches = this.hitches.filter((h) => now - h.at < h.freeze + hitchCatchUp(h.freeze));
    const t = this.hitches.reduce((s, h) => s - hitchLag(now - h.at, h.freeze, hitchCatchUp(h.freeze)), now - this.t0);
    this.last = Math.max(this.last, t);
    return this.last;
  }

  // Wheel seconds since the start.
  at(now) {
    return phaseAt(this.plan, this.real(now)) * this.rate;
  }
}
