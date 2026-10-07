// Quality tiers, device hints, the loading-wheel benchmark and dynamic resolution.
export const TIERS = [
  { name: 'low', dprCap: 1, scale: 0.7, aa: 'fxaa', traa: false, motionBlur: false, dof: false, ao: false, shadows: 0, transmission: false, sparkles: 0, godrays: false, hrtf: false },
  { name: 'medium', dprCap: 1.5, scale: 0.85, aa: 'fxaa', traa: false, motionBlur: false, dof: false, ao: false, shadows: 1024, transmission: false, sparkles: 1200, godrays: false, hrtf: false },
  { name: 'high', dprCap: 2, scale: 1, aa: 'traa', traa: true, motionBlur: true, dof: true, ao: true, shadows: 2048, transmission: true, sparkles: 4000, godrays: true, hrtf: true },
  { name: 'ultra', dprCap: 2, scale: 1, aa: 'traa', traa: true, motionBlur: true, dof: true, ao: true, shadows: 4096, transmission: true, sparkles: 9000, godrays: true, hrtf: true },
];

export function initialTier(renderer, params) {
  const forced = params?.get('tier');
  if (forced != null) {
    const i = TIERS.findIndex((t) => t.name === forced || String(TIERS.indexOf(t)) === forced);
    if (i >= 0) return { tier: i, forced: true };
  }
  const webgpu = !!renderer.backend?.isWebGPUBackend;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const mem = navigator.deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 8;
  let tier = webgpu ? 2 : 1;
  if (coarse) tier -= 1;
  if (mem <= 3 || cores <= 4) tier -= 1;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) tier = Math.min(tier, 2);
  return { tier: Math.max(0, Math.min(2, tier)), forced: false };
}

// Collects frame times; after warm-up it suggests one step down or up.
export class Benchmark {
  constructor() {
    this.samples = [];
    this.skip = 20;
    this.done = false;
  }

  add(dtMs) {
    if (this.done) return null;
    if (this.skip-- > 0) return null;
    this.samples.push(dtMs);
    if (this.samples.length < 75) return null;
    this.done = true;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const p75 = sorted[Math.floor(sorted.length * 0.75)];
    if (p75 > 24) return -1;
    if (p75 < 9) return 1;
    return 0;
  }
}

// Dynamic resolution: adjusts render scale from a frame-time average.
export class DynamicResolution {
  constructor(min = 0.5, max = 1) {
    this.min = min;
    this.max = max;
    this.scale = max;
    this.avg = 16;
    this.next = 0;
    this.misses = 0;
  }

  update(dtMs, now) {
    this.avg += (Math.min(dtMs, 100) - this.avg) * 0.05;
    if (now < this.next) return null;
    this.next = now + 1.5;
    let s = this.scale;
    if (this.avg > 19) {
      s = Math.max(this.min, s - 0.1);
      this.misses++;
    } else if (this.avg < 13 && s < this.max) s = Math.min(this.max, s + 0.05);
    else this.misses = 0;
    if (s !== this.scale) {
      this.scale = s;
      return s;
    }
    return null;
  }
}
