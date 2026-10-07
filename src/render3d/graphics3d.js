// Lazy three.js entry: WebGPU renderer (WebGL2 fallback), quality tier, the fancy loading wheel
// (stage B, on the wheel clock main.js owns), the SUPER donut on the menu and the 3D eras (5–7).
import * as THREE from 'three/webgpu';
import { TIERS, initialTier, Benchmark, DynamicResolution } from './quality.js';
import { Wheel, studioEnvironment } from './wheel.js';
import { Orbit } from './orbit.js';

// A WebGPU adapter worth using: Chrome on Linux without Vulkan hands out SwiftShader (the CPU),
// which is far slower than WebGL2 on the real GPU.
async function hardwareWebGPU() {
  if (!navigator.gpu) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return false;
    const info = adapter.info ?? {};
    if (adapter.isFallbackAdapter || info.isFallbackAdapter) return false;
    return !/swiftshader|llvmpipe|lavapipe|software/i.test(`${info.vendor} ${info.architecture} ${info.device} ${info.description}`);
  } catch {
    return false;
  }
}

export async function createGraphics3D({ canvas, view, dpr, params, clock, forceWebGL = false }) {
  const g = new Graphics3D(canvas, params);
  g.clock = clock;
  g.forceWebGL = forceWebGL;
  await g.init(view, dpr);
  return g;
}

class Graphics3D {
  constructor(canvas, params) {
    this.canvas = canvas;
    this.params = params;
    this.world3d = null;
    this.worldLoading = null;
    this.onLoaderVisible = null;
    this.loaderFrames = 0;
    this.menuBuilding = null;
    this.menuCompiled = false;
    this.menuReady = false;
    this.credits = [];
  }

  async init(view, dpr) {
    const webgpu = !this.forceWebGL && this.params.get('webgl') !== '1' && (await hardwareWebGPU());
    const wantHdr = matchMedia('(dynamic-range: high)').matches && webgpu && this.params.get('hdr') !== '0';
    const renderer = new THREE.WebGPURenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: 'high-performance',
      outputType: wantHdr ? THREE.HalfFloatType : undefined,
      forceWebGL: !webgpu,
    });
    performance.mark('3d:module');
    await renderer.init();
    performance.mark('3d:init');
    this.renderer = renderer;
    // A lost WebGPU device (e.g. a hybrid-GPU laptop whose discrete GPU can't share frames with the
    // display GPU) is reported once; main.js then rebuilds the 3D view on WebGL2.
    this.onLost = null;
    this.lost = null;
    renderer.backend.device?.lost.then((info) => {
      if (info.reason === 'destroyed') return;
      this.lost = info;
      this.onLost?.(info);
    });
    this.hdr = wantHdr && renderer.backend.isWebGPUBackend;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    const { tier, forced } = initialTier(renderer, this.params);
    this.tier = tier;
    this.tierForced = forced;
    this.tierSettings = this.#withFx(TIERS[tier]);
    this.bench = forced ? null : new Benchmark();
    this.drs = new DynamicResolution(0.5, 1);
    this.dpr = dpr;
    this.warmRT = new THREE.RenderTarget(64, 64);
    this.resize(view, dpr);
    // only the loading wheel is built now; it must play as early as possible
    this.orbit = new Orbit(this, this.clock);
    this.orbit.resize(view.cssW, view.cssH);
    performance.mark('3d:built');
    await this.orbit.compile();
    performance.mark('3d:compiled');
  }

  // Compile a scene's materials (and compute shaders) in the background, without blocking. Some
  // variants (multiple render targets, shadows, reflections) still compile at the first real render.
  async compile(scene, camera, computeNodes = []) {
    const jobs = [this.renderer.compileAsync(scene, camera)];
    if (computeNodes.length) jobs.push(this.renderer.compileComputeAsync(computeNodes));
    await Promise.all(jobs.map((j) => j.catch(() => {}))); // an optimisation only
  }

  // The procedural photo studio, shared by the loading wheel and the donut.
  studioEnv() {
    return (this.env ??= studioEnvironment(this.renderer));
  }

  // ?fx=nodof,nomb,notraa,noao,nogodrays switches single effects off on any tier (debugging).
  #withFx(t) {
    const off = (this.params.get('fx') ?? '').split(',');
    const map = { nodof: 'dof', nomb: 'motionBlur', notraa: 'traa', noao: 'ao', nogodrays: 'godrays' };
    const o = { ...t };
    for (const k of off) if (map[k]) o[map[k]] = false;
    return o;
  }

  get backendName() {
    return this.renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2';
  }

  resize(view, dpr) {
    this.view = view;
    this.dpr = dpr;
    const ratio = Math.min(dpr, this.tierSettings.dprCap) * this.tierSettings.scale * (this.drs?.scale ?? 1);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(view.cssW, view.cssH, false);
    this.wheel?.resize(view.cssW, view.cssH);
    this.orbit?.resize(view.cssW, view.cssH);
    this.world3d?.resize(view);
  }

  #setTier(tier) {
    if (tier === this.tier) return;
    this.tier = tier;
    this.tierSettings = this.#withFx(TIERS[tier]);
    // Only the resolution changes on screen: the loading wheel (and a donut already built) keep the
    // features they were built with, so nothing pops. The donut and the 3D world use the new tier.
    this.resize(this.view, this.dpr);
    this.world3d?.setTier(this.tierSettings);
  }

  // ---------- the loading wheel (stage B) ----------
  renderLoader(now, dt) {
    if (!this.orbit) return;
    this.orbit.render(now);
    this.loaderFrames++;
    if (this.loaderFrames <= 3) performance.mark(`3d:frame${this.loaderFrames}`);
    // three frames on the still-hidden canvas warm everything up before it may take over
    if (this.loaderFrames === 3) {
      this.loaderShownAt = now;
      this.onLoaderVisible?.();
    }
    if (this.loaderFrames > 3) this.#benchStep(dt);
    // the menu's donut is built once the benchmark has settled the tier, and not during the hand-off
    if (this.loaderFrames > 3 && !this.bench && now - this.loaderShownAt > 1.2) this.buildMenu();
  }

  loaderHandoff(now) {
    this.orbit?.handoff(now);
  }

  // Returns how long the collapse takes.
  loaderCollapse(now) {
    return this.orbit ? this.orbit.collapse(now) : 0;
  }

  disposeLoader() {
    this.orbit?.dispose();
    this.orbit = null;
  }

  // ---------- the menu's donut ----------
  // Built and compiled in the background while the loading wheel plays (menuCompiled). Its first
  // render still compiles a few pipeline variants synchronously, which would freeze the wheel; that
  // warm-up waits for a moment when the page may look busy anyway (warmMenu).
  buildMenu() {
    this.menuBuilding ??= (async () => {
      performance.mark('3d:menu-start');
      const w = new Wheel(this);
      w.resize(this.view.cssW, this.view.cssH);
      await this.compile(w.scene, w.camera);
      this.wheel = w;
      this.menuCompiled = true;
      performance.mark('menu:ready');
    })().catch((e) => {
      console.warn('menu donut unavailable', e);
      this.menuFailed = true;
    });
    return this.menuBuilding;
  }

  // Render the donut once off-screen (blocking). Returns how long it took, in seconds.
  warmMenu() {
    if (!this.menuCompiled || this.menuReady) return 0;
    const t0 = performance.now();
    this.renderer.setRenderTarget(this.warmRT);
    this.wheel.pipeline.render();
    this.renderer.setRenderTarget(null);
    this.menuReady = true;
    performance.mark('3d:menu-warm');
    return (performance.now() - t0) / 1000;
  }

  showWheel(now) {
    this.wheelHidden = false;
    this.wheel?.enter(now);
  }

  hideWheel() {
    this.wheelHidden = true;
  }

  crunch(now, dur) {
    this.wheel?.startCrunch(now, dur);
  }

  // Restart crunch for the 3D eras (0 → 1).
  setWorldCrunch(k) {
    this.world3d?.setCrunch(k);
  }

  renderWheel(now, dt) {
    if (this.wheelHidden || !this.wheel) return;
    this.wheel.render(now, dt);
    this.#benchStep(dt); // when the loader was skipped (?loader=skip)
  }

  #benchStep(dt) {
    if (!this.bench) return;
    const step = this.bench.add(dt * 1000);
    if (step) this.#setTier(Math.max(0, Math.min(TIERS.length - 1, this.tier + step)));
    if (this.bench.done) this.bench = null;
  }

  // ---------- 3D eras ----------
  prepareWorld() {
    if (this.worldLoading) return this.worldLoading;
    this.worldLoading = import('./world3d.js')
      .then((m) => m.createWorld3D(this))
      .then((w) => {
        this.world3d = w;
        this.credits = w.credits ?? [];
        return w;
      })
      .catch((e) => {
        console.warn('3D world unavailable', e);
        return null;
      });
    return this.worldLoading;
  }

  isReady(era) {
    return !!this.world3d?.isReady(era);
  }

  renderWorld(world, era, now, dt, section) {
    if (!this.world3d) return;
    if (!this.tierForced) {
      const s = this.drs.update(dt * 1000, now);
      if (s) this.resize(this.view, this.dpr);
    }
    this.world3d.render(world, era, now, dt, section);
  }

  startPopOut(r2d, world, now, onCovered) {
    this.world3d?.startPopOut(r2d, world, now, onCovered);
  }

  startTransition(from, to, now) {
    this.world3d?.startTransition(from, to, now);
  }
}
