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
// if the 3D wheel isn't warm yet). After `quiet` s of nothing but the wheel, each attempt (click,
// tap, Space) may open the menu: chance = base + perMiss·misses + perSec·(s since open), certain on
// attempt `sure`. Attempts closer than `debounce` count once. A hit also needs the menu to be loaded;
// after `need3D` s of B it may come up without the 3D donut.
export const LOADER = {
  cap: 3.5,
  quiet: 5,
  debounce: 0.25,
  odds: { base: 0.35, perMiss: 0.3, perSec: 0.08, sure: 3 },
  need3D: 12,
  handoff: 0.4, // A → B cross-fade
  hitch: 0.15, // a missed attempt freezes the wheel this long, as if the page were busy
  decay: 0.7, // a hit: everything spirals into the star
  menuIn: 0.45, // then the donut springs out of the hub
};

// The fancy wheel's clocks, as in the reference components (loading-ui.com Spiral: 8 dots, 1.5 s;
// Twin Orbit: 1 s per lap).
export const ORBIT = { stations: 8, ringPeriod: 1.5, twinPeriod: 1.0 };

// ---- View ----
// Minimum visible world: width grows with aspect ratio (portrait 11 → wide 18), height 5.
export const VIEW = { minWPortrait: 11, minWWide: 18, minH: 5, catScreenX: 1.4 };

// ---- 2D eras: virtual pixels per world unit ----
export const PPU = [null, 24, 24, 32, 48];

// ---- Load budgets (bytes, gzip) checked by tools/check-budget.mjs ----
export const BUDGET = { html: 14 * 1024, core: 40 * 1024, audioCore: 10 * 1024 };

export const GITHUB_URL = 'https://github.com/doublependu/wheel';
