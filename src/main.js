// Boot, screen state machine, game loop and progressive loading.
//
// Screens: preload (stage A: the flat CSS Spiral while the fancy wheel loads) → loading (stage B: the
// fancy wheel plays, which counts as "page loading done"; after LOADER.quiet s an attempt may get
// through) → decay (the wheel collapses) → title (the menu: the donut and Play) → crunch → run ⇄
// paused → over.
import { Input } from './input.js';
import { Hud } from './ui/hud.js';
import { World } from './sim/world.js';
import { Renderer2D } from './render2d/renderer2d.js';
import { computeView } from './view.js';
import { SIM_DT, MAX_FRAME_DT, ERA_COUNT, LOADER } from './config.js';
import { createAutopilot, parseCrash } from './sim/autopilot.js';
import { loadObstacleAtlas } from './render2d/obstacleAtlas.js';
import { Gate, menuReady } from './loader/gate.js';
import { createRng } from './sim/rng.js';

const params = new URLSearchParams(location.search);
const intParam = (k) => (params.has(k) ? parseInt(params.get(k), 10) : NaN);
const START_ERA = Math.min(ERA_COUNT, Math.max(1, intParam('era') || 1));
const FIXED_SEED = intParam('seed');
const AUTOPILOT = params.has('autopilot');
const CRASH = parseCrash(params.get('crash')); // autopilot: when to stop jumping (recordings)
const TIMESCALE = import.meta.env.DEV && params.has('timescale') ? Number(params.get('timescale')) || 1 : 1;
const MUTE_KEY = 'wheel.muted';
// ?loader=skip goes straight to the menu (so do ?era= and ?contrast); ?loader=lite forces the CSS
// fancy wheel; ?loader=quiet:N shortens the quiet period (dev server only).
const LOADER_PARAM = params.get('loader') ?? '';
const SKIP_LOADER = LOADER_PARAM === 'skip' || params.has('era') || params.has('contrast');
const FORCE_LITE = LOADER_PARAM === 'lite';
const QUIET = import.meta.env.DEV && LOADER_PARAM.startsWith('quiet:') ? Number(LOADER_PARAM.slice(6)) : LOADER.quiet;

const $ = (id) => document.getElementById(id);
const body = document.body;
const hud = new Hud();
const input = new Input(window);
const r2d = new Renderer2D($('c2d'));

let view = null;
let dpr = 1;
let screen = 'preload';
let audioCtx = null; // created inside the first user gesture
let audio = null; // lazy audio engine
let g3d = null; // lazy three.js graphics
let g3dLoading = null;
let shownEra = 0;
let overAt = 0;
let crunchUntil = 0;
let crunchStart = 0;
let last = performance.now() / 1000;
let acc = 0;
let autopilot = null;
let muted = false;
let atlasDone = false;
let pendingAtlas = null;
let g3dFailed = false;
// the loaders
let loaderMode = null; // stage B: '3d' (the three.js wheel) or 'lite' (CSS)
let loaderStart = 0;
let decayUntil = 0;
let menuAt = 0;
let busyTimer = 0;
const menuGate = new Gate({ quiet: Number.isFinite(QUIET) ? QUIET : LOADER.quiet, random: Number.isFinite(FIXED_SEED) ? createRng(FIXED_SEED + 1) : Math.random });
try {
  muted = localStorage.getItem(MUTE_KEY) === '1';
} catch {
  /* ignore */
}
hud.setMuted(muted);

const gate = (era) => (era <= 4 ? r2d.isReady(era) : !!g3d?.isReady(era));
const newSeed = () => (Number.isFinite(FIXED_SEED) ? FIXED_SEED : (Math.random() * 2 ** 31) | 0);
const world = new World({ seed: newSeed(), gate, startEra: START_ERA });

// ---------- layout ----------
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  view = computeView(window.innerWidth, window.innerHeight);
  r2d.resize(view, dpr);
  g3d?.resize(view, dpr);
}
window.addEventListener('resize', resize);
resize();

// ---------- idle work queue (progressive loading) ----------
const idle = window.requestIdleCallback ? (fn) => requestIdleCallback(fn, { timeout: 500 }) : (fn) => setTimeout(fn, 30);
function prepare2DEras() {
  const next = [1, 2, 3, 4].find((e) => !r2d.isReady(e));
  if (next) idle(() => {
    r2d.prepare(next);
    prepare2DEras();
  });
}

function load3D(forceWebGL = false) {
  if (g3dLoading) return g3dLoading;
  g3dLoading = import('./render3d/graphics3d.js')
    .then((m) => m.createGraphics3D({ canvas: $('c3d'), view, dpr, params, forceWebGL }))
    .then((g) => {
      g.onLost = (info) => {
        if (g3d !== g || forceWebGL) return;
        console.warn('WebGPU device lost, switching to WebGL2:', info.message);
        // a canvas keeps its first context type, so WebGL2 needs a fresh one
        const fresh = document.createElement('canvas');
        fresh.id = 'c3d';
        $('c3d').replaceWith(fresh);
        body.classList.remove('wheel-3d', 'show-3d');
        if (screen === 'loading') setLoaderMode('lite', performance.now() / 1000);
        g3d = null;
        g3dLoading = null;
        load3D(true);
      };
      if (g.lost) {
        g.onLost(g.lost);
        return null;
      }
      // after three warm-up frames on the hidden canvas the fancy wheel may take over
      g.onLoaderVisible = () => {
        const now = performance.now() / 1000;
        if (screen === 'preload' && !FORCE_LITE) beginLoading(now, '3d');
        else if (screen === 'loading' && loaderMode === 'lite' && !FORCE_LITE) setLoaderMode('3d', now);
      };
      g3d = g;
      performance.mark('3d:backend', { detail: `${g.backendName} ${g.tierSettings.name}` });
      if (screen === 'title' || SKIP_LOADER) {
        // the loader was skipped or is already over: straight to the menu's donut
        g.disposeLoader();
        g.buildMenu();
        g.prepareWorld().then(() => hud.setCredits(g.credits ?? []));
      }
      return g;
    })
    .catch((err) => {
      console.warn('3D graphics unavailable', err);
      g3dFailed = true;
      return null;
    });
  return g3dLoading;
}

function loadAudio() {
  return import('./audio/engine.js').then((m) => {
    if (!audio) audio = m.createAudio({ muted });
    if (audioCtx) audio.attach(audioCtx);
    return audio;
  });
}

// ---------- audio unlock (must happen inside a user gesture) ----------
function unlockAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      audioCtx = new AC({ latencyHint: 'interactive' });
    } catch {
      return;
    }
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'ambient';
    } catch {
      /* not supported */
    }
    audio?.attach(audioCtx);
  }
  if (audioCtx.state !== 'running') audioCtx.resume().catch(() => {});
}

// ---------- screens ----------
function setScreen(name) {
  screen = name;
  hud.setScreen(name);
}

// ---------- the loaders ----------
// Stage B: the fancy wheel plays. This is "page loading done"; everything else loads behind it.
function beginLoading(now, mode) {
  if (screen !== 'preload') return;
  setScreen('loading');
  loaderStart = now;
  menuGate.begin(now);
  performance.mark('loader:fancy', { detail: mode });
  setLoaderMode(mode, now);
  // the rest of the page, now that it no longer competes with the wheel
  loadAudio().catch((e) => console.warn('audio unavailable', e));
  prepare2DEras();
}

function setLoaderMode(mode, now) {
  loaderMode = mode;
  body.classList.toggle('loader-lite', mode === 'lite');
  body.classList.toggle('loader-3d', mode === '3d');
  body.classList.toggle('show-3d', mode === '3d');
  if (mode === '3d') g3d?.loaderHandoff(now);
}

function attemptMenu(now) {
  const ready = menuReady({
    atlas: atlasDone,
    donut: !!g3d?.menuCompiled,
    threeD: !g3dFailed && !g3d?.menuFailed,
    sinceStart: now - loaderStart,
  });
  const result = menuGate.attempt(now, ready);
  if (result === 'ignored' || result === 'merged') return;
  // The donut's last blocking warm-up happens here, where a busy moment is expected anyway: inside
  // the hitch of a miss, or just before the collapse of a hit.
  const busy = g3d?.warmMenu() ?? 0;
  if (result === 'miss') hitch(now, busy);
  else collapse(performance.now() / 1000);
}

// A missed attempt: the wheel stalls for a moment as if the page were busy (plus however long it
// really was busy), then catches up.
function hitch(now, busy = 0) {
  if (loaderMode === '3d') g3d?.loaderHitch(now, LOADER.hitch + busy);
  else {
    const anims = $('loader').getAnimations({ subtree: true });
    for (const a of anims) a.pause();
    setTimeout(() => {
      for (const a of anims) {
        a.updatePlaybackRate(1.6); // catch up again
        a.play();
      }
      setTimeout(() => anims.forEach((a) => a.updatePlaybackRate(1)), 250);
    }, LOADER.hitch * 1000);
  }
  body.classList.add('loader-busy');
  clearTimeout(busyTimer);
  busyTimer = setTimeout(() => body.classList.remove('loader-busy'), 600);
}

// A hit: everything spirals into the hub, then the menu.
function collapse(now) {
  setScreen('decay');
  const dur = loaderMode === '3d' && g3d ? g3d.loaderCollapse(now) : LOADER.decay;
  body.classList.add('loader-out');
  decayUntil = now + dur;
  performance.mark('loader:hit');
}

function enterMenu(now) {
  setScreen('title');
  menuAt = now;
  document.title = 'Wheel';
  body.classList.remove('loader-lite', 'loader-3d', 'loader-open', 'loader-busy', 'loader-out');
  hud.setReady('Tap or press Space to play');
  r2d.prepare(Math.min(START_ERA, 4));
  if (g3d) {
    g3d.disposeLoader();
    g3d.warmMenu();
    if (g3d.menuReady) showDonut(now);
    else {
      body.classList.remove('show-3d');
      g3d.buildMenu();
    }
    g3d.prepareWorld().then(() => hud.setCredits(g3d?.credits ?? []));
  } else body.classList.remove('show-3d');
  performance.mark('menu');
}

// The 3D donut springs out of the hub (or replaces the CSS donut once it is ready).
function showDonut(now) {
  g3d.showWheel(now);
  body.classList.add('show-3d', 'wheel-3d');
}

function startRun(now) {
  if (pendingAtlas) {
    r2d.setObstacleAtlas(pendingAtlas);
    pendingAtlas = null;
  }
  world.reset({ seed: newSeed(), gate, startEra: START_ERA });
  autopilot = AUTOPILOT ? createAutopilot({ human: params.get('autopilot') === 'human', crash: CRASH, seed: world.seed }) : null;
  acc = 0;
  input.clear();
  shownEra = 0;
  setScreen('run');
  showEra(world.era, now, false);
  if (audio && g3d) audio.hrtf = g3d.tierSettings.hrtf;
  audio?.startRun(world);
  prepare2DEras();
  g3d?.prepareWorld();
}

function showEra(era, now, animate = true) {
  const from = shownEra;
  shownEra = era;
  hud.setEra(era);
  const is3D = era >= 5;
  if (is3D && !g3d) {
    // only reachable with ?era=5+ before the 3D module loaded
    load3D();
  }
  body.classList.toggle('show-3d', is3D);
  body.classList.toggle('show-2d', !is3D || (animate && from === 4));
  if (!animate || !from) return;
  if (to2D(from) && to2D(era)) r2d.startTransition(from, era, now);
  else if (g3d) {
    if (from === 4) g3d.startPopOut(r2d, world, now, () => body.classList.remove('show-2d'));
    else g3d.startTransition(from, era, now);
  }
}
const to2D = (era) => era <= 4;

function pause() {
  if (screen !== 'run') return;
  setScreen('paused');
  audio?.pause(true);
}

function resume() {
  if (screen !== 'paused') return;
  setScreen('run');
  input.clear();
  last = performance.now() / 1000;
  audio?.pause(false, world);
}

function gameOver(now) {
  setScreen('over');
  overAt = now;
  hud.gameOver(world.score);
  audio?.hit(world);
}

input.onPress = () => {
  const now = performance.now() / 1000;
  unlockAudio(); // silent: nothing plays before the run
  if (screen === 'preload' || screen === 'loading' || screen === 'decay') {
    input.clear();
    if (screen === 'loading') attemptMenu(now);
  } else if (screen === 'title' && body.classList.contains('ready') && now - menuAt > 0.35) {
    input.clear();
    if (START_ERA >= 5 && !g3d?.isReady(START_ERA)) return;
    crunchUntil = now + (g3d?.wheel && !g3d.wheelHidden ? 1.1 : 0.6);
    g3d?.crunch(now, crunchUntil - now);
    audio?.crunch(crunchUntil - now);
    body.classList.add('crunch');
    screen = 'crunch';
  } else if (screen === 'over' && now - overAt > 0.6) {
    input.clear();
    crunchStart = now;
    crunchUntil = now + 0.5;
    audio?.crunch(0.5, true);
    screen = 'crunch';
    hud.setScreen('run');
  } else if (screen === 'paused') {
    input.clear();
    resume();
  }
};

input.onKey = (code) => {
  if (code === 'Escape' || code === 'KeyP') {
    if (screen === 'run') pause();
    else if (screen === 'paused') resume();
  } else if (code === 'KeyM') toggleMute();
  else if (code === 'Enter') input.onPress('key');
};

function toggleMute() {
  muted = !muted;
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    /* ignore */
  }
  hud.setMuted(muted);
  audio?.setMuted(muted);
}
hud.muteBtn.addEventListener('click', toggleMute);
$('play').addEventListener('click', () => input.onPress('button'));
hud.pauseBtn.addEventListener('click', () => pause());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pause();
    audio?.suspend(true);
  } else audio?.suspend(false);
});
// Hands-free runs (recordings) keep going when another window takes focus.
window.addEventListener('blur', () => AUTOPILOT || pause());

// ---------- loop ----------
function handleEvents(now) {
  for (const e of world.consumeEvents()) {
    if (e.type === 'era') showEra(e.era, now);
    else if (e.type === 'hit') gameOver(now);
    audio?.event(e, world);
  }
}

function loaderTick(now) {
  // stage B starts by LOADER.cap at the latest: the CSS fancy-lite wheel if 3D isn't warm yet
  if (screen === 'preload' && (now >= LOADER.cap || g3dFailed || FORCE_LITE)) beginLoading(now, 'lite');
  if (screen === 'loading' && menuGate.isOpen(now) && !body.classList.contains('loader-open')) {
    body.classList.add('loader-open');
    performance.mark('loader:open');
  }
  if (screen === 'decay' && now >= decayUntil) enterMenu(now);
}

function frame(ms) {
  const now = ms / 1000;
  const dt = Math.min(MAX_FRAME_DT, now - last);
  last = now;

  if (screen === 'crunch' && shownEra) {
    const k = Math.min(1, (now - crunchStart) / Math.max(0.01, crunchUntil - crunchStart));
    r2d.crunch = k;
    g3d?.setWorldCrunch(k);
  }
  if (screen === 'crunch' && now >= crunchUntil) {
    r2d.crunch = 0;
    g3d?.setWorldCrunch(0);
    body.classList.remove('crunch');
    g3d?.hideWheel();
    body.classList.remove('wheel-3d');
    startRun(now);
  }

  if (screen === 'run') {
    acc += dt * TIMESCALE;
    while (acc >= SIM_DT && world.alive) {
      const press = input.takePress() || (autopilot ? autopilot(world) : false);
      world.step({ press, held: input.held || press });
      acc -= SIM_DT;
      handleEvents(now);
    }
    hud.setScore(world.score);
  }

  const inGame = screen === 'run' || screen === 'paused' || screen === 'over' || (screen === 'crunch' && shownEra);
  if (inGame) {
    const section = world.section;
    if (shownEra <= 4 || body.classList.contains('show-2d')) r2d.draw(world, Math.min(shownEra, 4), now, section);
    if (g3d && shownEra >= 5) g3d.renderWorld(world, shownEra, now, dt, section);
  } else if (screen === 'preload' || screen === 'loading' || screen === 'decay') {
    // in stage A this warms the wheel up on the hidden canvas (not needed when the CSS one is forced)
    if (!(FORCE_LITE && g3d?.loaderFrames >= 3)) g3d?.renderLoader(now, dt);
    loaderTick(now);
  } else if (g3d && (screen === 'title' || screen === 'crunch')) {
    if (screen === 'title' && g3d.menuCompiled && !body.classList.contains('wheel-3d')) {
      g3d.warmMenu();
      showDonut(now);
    }
    g3d.renderWheel(now, dt);
  }
  audio?.update(world, screen, now);
  requestAnimationFrame(frame);
}

// Dev: ?contrast measures obstacle/background contrast in every stage (see src/dev/contrast.js).
if (import.meta.env.DEV && params.has('contrast')) {
  setTimeout(async () => {
    const { runContrast } = await import('./dev/contrast.js');
    for (let e = 1; e <= 4; e++) r2d.prepare(e);
    const atlas = await loadObstacleAtlas().catch(() => null);
    if (atlas) r2d.setObstacleAtlas(atlas);
    window.__contrast = await runContrast({ r2d, g3d: await load3D() });
  }, 0);
}

// Debug handle for automated checks in development builds.
if (import.meta.env.DEV) {
  window.__wheel = { world, r2d, get audio() { return audio; }, get g3d() { return g3d; }, get screen() { return screen; } };
}

// ---------- boot ----------
// Stage A: only the fancy wheel loads (three.js, build, compile, warm-up); the rest waits for stage B.
load3D();
loadObstacleAtlas()
  .then((atlas) => {
    // never swap sprites under a running game; the next run picks them up
    if (screen === 'run' || screen === 'paused') pendingAtlas = atlas;
    else r2d.setObstacleAtlas(atlas);
  })
  .catch((e) => console.warn('obstacle sprites unavailable, using the procedural ones', e))
  .finally(() => (atlasDone = true));
if (SKIP_LOADER) {
  enterMenu(performance.now() / 1000);
  loadAudio().catch((e) => console.warn('audio unavailable', e));
  prepare2DEras();
}
requestAnimationFrame(frame);
