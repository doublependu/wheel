// Boot, screen state machine, game loop and progressive loading.
import { Input } from './input.js';
import { Hud } from './ui/hud.js';
import { World } from './sim/world.js';
import { Renderer2D } from './render2d/renderer2d.js';
import { computeView } from './view.js';
import { SIM_DT, MAX_FRAME_DT, ERA_COUNT, WHEEL } from './config.js';
import { createAutopilot, parseCrash } from './sim/autopilot.js';
import { loadObstacleAtlas } from './render2d/obstacleAtlas.js';

const params = new URLSearchParams(location.search);
const intParam = (k) => (params.has(k) ? parseInt(params.get(k), 10) : NaN);
const START_ERA = Math.min(ERA_COUNT, Math.max(1, intParam('era') || 1));
const FIXED_SEED = intParam('seed');
const AUTOPILOT = params.has('autopilot');
const CRASH = parseCrash(params.get('crash')); // autopilot: when to stop jumping (recordings)
const TIMESCALE = import.meta.env.DEV && params.has('timescale') ? Number(params.get('timescale')) || 1 : 1;
const MUTE_KEY = 'wheel.muted';

const $ = (id) => document.getElementById(id);
const body = document.body;
const hud = new Hud();
const input = new Input(window);
const r2d = new Renderer2D($('c2d'));

let view = null;
let dpr = 1;
let screen = 'title';
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
// title: Play shows once the donut has run a while (see WHEEL in config.js)
let playShown = false;
let atlasDone = false;
let pendingAtlas = null;
let wheel3dAt = 0;
let g3dFailed = false;
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
  const next = [2, 3, 4].find((e) => !r2d.isReady(e));
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
      g3d = g;
      g.onLost = (info) => {
        if (g3d !== g || forceWebGL) return;
        console.warn('WebGPU device lost, switching to WebGL2:', info.message);
        // a canvas keeps its first context type, so WebGL2 needs a fresh one
        const fresh = document.createElement('canvas');
        fresh.id = 'c3d';
        $('c3d').replaceWith(fresh);
        body.classList.remove('wheel-3d');
        wheel3dAt = 0;
        g3d = null;
        g3dLoading = null;
        load3D(true);
      };
      if (g.lost) {
        g.onLost(g.lost);
        return null;
      }
      if (screen === 'title') {
        g3d.showWheel();
        g3d.setReady(playShown);
        body.classList.add('show-3d');
        g3d.onWheelVisible = () => {
          body.classList.add('wheel-3d');
          wheel3dAt = performance.now() / 1000;
          performance.mark('wheel:3d');
        };
      }
      g3d.prepareWorld().then(() => hud.setCredits(g3d.credits ?? []));
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
  unlockAudio();
  if (screen === 'title' && body.classList.contains('ready')) {
    input.clear();
    if (START_ERA >= 5 && !g3d?.isReady(START_ERA)) return;
    crunchUntil = now + (g3d ? 1.1 : 0.6);
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

// Title donut progress: core, obstacle sprites, audio, 3D donut, 3D world.
function loadProgress() {
  let p = 0.2;
  if (atlasDone) p += 0.2;
  if (audio) p += 0.2;
  if (g3d || g3dFailed) p += 0.2;
  if (g3d?.isReady(7) || g3dFailed) p += 0.2;
  return p;
}

// Play appears after the donut has run for WHEEL.minRun s, the obstacle sprites are in and the
// 3D donut has been on screen for WHEEL.min3D s; never later than WHEEL.cap s.
function checkPlay(now) {
  if (playShown) return;
  const donutOk = g3dFailed || (wheel3dAt > 0 && now - wheel3dAt >= WHEEL.min3D);
  if (now < WHEEL.cap && !(now >= WHEEL.minRun && atlasDone && donutOk)) return;
  playShown = true;
  hud.setReady('Tap or press Space to play');
  g3d?.setReady(true);
  performance.mark('wheel:interactive');
}

// ---------- loop ----------
function handleEvents(now) {
  for (const e of world.consumeEvents()) {
    if (e.type === 'era') showEra(e.era, now);
    else if (e.type === 'hit') gameOver(now);
    audio?.event(e, world);
  }
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
  } else if (g3d && (screen === 'title' || screen === 'crunch')) {
    g3d.setLoadProgress(loadProgress());
    g3d.renderWheel(now, dt);
  }
  if (screen === 'title') checkPlay(performance.now() / 1000);
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
r2d.prepare(Math.min(START_ERA, 4));
loadObstacleAtlas()
  .then((atlas) => {
    // never swap sprites under a running game; the next run picks them up
    if (screen === 'run' || screen === 'paused') pendingAtlas = atlas;
    else r2d.setObstacleAtlas(atlas);
  })
  .catch((e) => console.warn('obstacle sprites unavailable, using the procedural ones', e))
  .finally(() => (atlasDone = true));
requestAnimationFrame(frame);
// Progressive loading after first paint: audio core, then three.js for the wheel and 3D eras.
setTimeout(() => {
  loadAudio().catch((e) => console.warn('audio unavailable', e));
  load3D();
}, 0);
