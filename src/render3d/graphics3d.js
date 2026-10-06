// Lazy three.js entry: WebGPU renderer (WebGL2 fallback), quality tier, the SUPER wheel on the
// title screen and the 3D eras (5–7).
import * as THREE from 'three/webgpu';
import { TIERS, initialTier, Benchmark, DynamicResolution } from './quality.js';
import { Wheel } from './wheel.js';

export async function createGraphics3D({ canvas, view, dpr, params }) {
  const g = new Graphics3D(canvas, params);
  await g.init(view, dpr);
  return g;
}

class Graphics3D {
  constructor(canvas, params) {
    this.canvas = canvas;
    this.params = params;
    this.world3d = null;
    this.worldLoading = null;
    this.onWheelVisible = null;
    this.wheelFrames = 0;
    this.credits = [];
  }

  async init(view, dpr) {
    const wantHdr = matchMedia('(dynamic-range: high)').matches && !!navigator.gpu && this.params.get('hdr') !== '0';
    const renderer = new THREE.WebGPURenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: 'high-performance',
      outputType: wantHdr ? THREE.HalfFloatType : undefined,
      forceWebGL: this.params.get('webgl') === '1',
    });
    await renderer.init();
    this.renderer = renderer;
    this.hdr = wantHdr && renderer.backend.isWebGPUBackend;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    const { tier, forced } = initialTier(renderer, this.params);
    this.tier = tier;
    this.tierForced = forced;
    this.tierSettings = TIERS[tier];
    this.bench = forced ? null : new Benchmark();
    this.drs = new DynamicResolution(0.5, 1);
    this.dpr = dpr;
    this.resize(view, dpr);
    this.wheel = new Wheel(this);
    this.wheel.resize(view.cssW, view.cssH);
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
    this.world3d?.resize(view);
  }

  #setTier(tier) {
    if (tier === this.tier) return;
    this.tier = tier;
    this.tierSettings = TIERS[tier];
    this.resize(this.view, this.dpr);
    if (this.wheel && !this.wheelHidden) {
      const old = this.wheel;
      this.wheel = new Wheel(this);
      this.wheel.resize(this.view.cssW, this.view.cssH);
      old.dispose();
    }
    this.world3d?.setTier(this.tierSettings);
  }

  // ---------- title wheel ----------
  showWheel() {
    this.wheelHidden = false;
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

  setLoadProgress(p) {
    this.wheel?.setProgress(p);
  }

  renderWheel(now, dt) {
    if (this.wheelHidden || !this.wheel) return;
    this.wheel.render(now, dt);
    this.wheelFrames++;
    if (this.wheelFrames === 3) this.onWheelVisible?.();
    if (this.bench) {
      const step = this.bench.add(dt * 1000);
      if (step) this.#setTier(Math.max(0, Math.min(TIERS.length - 1, this.tier + step)));
      if (this.bench.done) this.bench = null;
    }
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
