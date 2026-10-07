// Gameplay, timing and budget tunables. World units: the cat's body is ~1 unit long.

// ---- Music clock (eras are measured in bars) ----
export const BPM = 90;
export const BEAT = 60 / BPM;
export const BAR = BEAT * 4;
export const STEPS_PER_BAR = 16;
export const STEP = BAR / STEPS_PER_BAR;
export const CHILL_BARS = 6;
export const BUILD_BARS = 2;
export const EXTRA_CHILL_BARS = 2; // played when the next era isn't ready yet
export const ERA_COUNT = 7;
// The build-up is promised this many seconds before it starts (audio lookahead + spawner lead).
export const DECIDE_LEAD = 0.75;

// ---- Simulation ----
export const SIM_HZ = 120;
export const SIM_DT = 1 / SIM_HZ;
export const MAX_FRAME_DT = 0.25;

// Speed is the main difficulty knob: v = v0 * min(cap, 1 + ramp * (1 - e^(-t/tau)))
export const SPEED = { v0: 5.5, ramp: 0.3, tau: 240, cap: 1.3 };

// Tap jump: peak height and gravity. Holding the button while rising lowers gravity (higher jump).
export const JUMP = { peak: 2.8, gravity: 24, holdGravityScale: 0.72, holdMax: 0.22, buffer: 0.15 };

// Cat hitbox (75 % of the visual body, tail excluded). x is the cat's centre.
export const CAT = { w: 0.75, h: 0.52, visualW: 1.0, visualH: 0.7 };

// Visual size (w, h, y) and hitbox (75 %) per obstacle. y = bottom above ground.
export const OBSTACLES = {
  cucumber: { w: 0.9, h: 0.3, y: 0, hit: { w: 0.66, h: 0.22, y: 0 }, minEra: 1, weight: 3 },
  pot: { w: 0.6, h: 0.9, y: 0, hit: { w: 0.44, h: 0.66, y: 0 }, minEra: 1, weight: 3 },
  vacuum: { w: 0.95, h: 0.38, y: 0, hit: { w: 0.7, h: 0.28, y: 0 }, minEra: 2, weight: 2 },
  crow: { w: 0.8, h: 0.45, y: 0.3, hit: { w: 0.5, h: 0.32, y: 0.36 }, minEra: 3, weight: 2, flies: true },
};

// Seconds of travel between obstacles, per era [min, max].
export const GAPS = [null, [2.0, 3.0], [1.9, 2.8], [1.8, 2.6], [1.7, 2.5], [1.6, 2.4], [1.5, 2.2], [1.4, 2.0]];
export const FIRST_OBSTACLE_AT = 3.0; // seconds into a run
export const SPAWN_AHEAD = 24; // units ahead of the cat where obstacles are created
// No obstacle may reach the cat inside [drop - before, drop + after].
export const BREATHER = { before: 1.0, after: 2.0 };

export const SCORE_PER_UNIT = 2;
export const MILESTONE = 100;

// ---- Loading (seconds) ----
// A: a flat Spiral pre-loader while the fancy wheel loads. B: the fancy wheel plays, which counts as
// "page loading done" (spec: 2–3 s, 4 s at most), so B starts by `cap` at the latest (CSS fancy-lite
// if the 3D wheel isn't warm yet, or if its first frames would only begin within `warm` s of the
// cap). After `quiet` s of nothing but the wheel, each attempt (click,
// tap, Space) may open the menu: chance = base + perMiss·misses + perSec·(s since open), certain on
// attempt `sure`. Attempts closer than `debounce` count once. A hit also needs the menu to be loaded;
// after `need3D` s of B it may come up without the 3D donut.
export const LOADER = {
  cap: 3.5,
  warm: 0.8, // the 3D wheel's first frames may block the page this long (they compile its pipelines)
  quiet: 5,
  debounce: 0.25,
  odds: { base: 0.35, perMiss: 0.3, perSec: 0.08, sure: 3 },
  need3D: 12,
  handoff: 0.4, // A → B cross-fade
  hitch: 0.15, // a missed attempt freezes the wheel this long, as if the page were busy
  decay: 0.7, // a hit: everything spirals into the hub
  menuIn: 0.45, // then the donut springs out of the hub
};

// The pre-loader: loading-ui.com's Spiral, 8 dots growing and shrinking in a wave (index.html).
export const SPIRAL = { dots: 8, period: 1.5 };

// The fancy wheel: one planet's worth of matter goes round the ring's 8 stations (Spiral's dot
// positions). A hop takes it from one station to the next in `hop` s of wheel time; the windows
// below are shares of a hop.
export const ORBIT = {
  stations: 8,
  hop: 2.0,
  seams: 0.1, // the planet's seams open until it bursts
  pieces: [0.1, 0.48], // its pieces fly and grind down to dust
  accrete: [0.34, 0.74], // the dust lands on the next planet, which grows with it; then it rests
  // A tenth of the dust stays behind as a faint shade of the old planet and trickles after the rest:
  // it leaves within `leave` and has all landed by `land`, before the next burst (1 + seams).
  stragglers: { share: 0.1, leave: [0.7, 1.0], land: 1.08 },
  // Another tenth runs one station ahead and hangs there as a faint shade of the planet to come.
  leaders: { share: 0.1, leave: [0.35, 0.9], flight: 0.25 },
  shade: 0.13, // a faint neighbour shows this share of its planet's pixels
};

// The wheel's clock runs at a speed that changes like a connection's. Per state: speed (× real
// time) and duration (s) ranges, and how often it is picked (`pick`; these give about 58 % of the
// time steady, 18 % slow, 7 % stalled and 17 % bursting). A stall is always followed by a burst.
// Speeds ease down within `drop` s and up within `rise` s; the table repeats after about `length` s,
// and its mean speed is scaled to exactly 1. `calm` replaces all of it for reduced motion.
export const NET = {
  steady: { v: [0.8, 1.25], dur: [0.8, 1.8], pick: 0.36 },
  slow: { v: [0.35, 0.6], dur: [0.6, 1.4], pick: 0.32 },
  stall: { v: [0.08, 0.15], dur: [0.35, 0.8], pick: 0.15 },
  burst: { v: [1.7, 2.3], dur: [0.4, 0.9], pick: 0.19 },
  calm: { v: [0.7, 1.2], dur: [1.0, 2.2] },
  drop: 0.15,
  rise: 0.4,
  length: 60,
};

// ---- View ----
// Minimum visible world: width grows with aspect ratio (portrait 11 → wide 18), height 5.
export const VIEW = { minWPortrait: 11, minWWide: 18, minH: 5, catScreenX: 1.4 };

// ---- 2D eras: virtual pixels per world unit ----
export const PPU = [null, 24, 24, 32, 48];

// ---- Load budgets (bytes, gzip) checked by tools/check-budget.mjs ----
export const BUDGET = { html: 14 * 1024, core: 40 * 1024, audioCore: 10 * 1024 };

export const GITHUB_URL = 'https://github.com/doublependu/wheel';
