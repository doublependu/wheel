// Compact procedural noise for the loading wheel's bodies, as real shader functions (setLayout), so
// each appears once per shader. MaterialX's generic noise is far bigger, and on a cold shader cache
// (a first visit) its compile time showed up directly in how soon the wheel could play.
import { Fn, vec2, vec3, float, floor, fract, mix, min, max, length, hash, int } from 'three/tsl';

// A pseudo-random value in [0, 1) for an integer lattice point (plus a channel k).
const cellHash = (c, k) => hash(int(c.x).mul(73856093).bitXor(int(c.y).mul(19349663)).bitXor(int(c.z).mul(83492791)).add(k * 1013).toUint());

// Value noise in [-1, 1] with quintic interpolation.
export const vnoise = Fn(([p]) => {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(f).mul(f.mul(f.mul(6).sub(15)).add(10));
  const h = (x, y, z) => cellHash(i.add(vec3(x, y, z)), 0);
  const x00 = mix(h(0, 0, 0), h(1, 0, 0), u.x);
  const x10 = mix(h(0, 1, 0), h(1, 1, 0), u.x);
  const x01 = mix(h(0, 0, 1), h(1, 0, 1), u.x);
  const x11 = mix(h(0, 1, 1), h(1, 1, 1), u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z).mul(2).sub(1);
}).setLayout({ name: 'wheelNoise', type: 'float', inputs: [{ name: 'p', type: 'vec3' }] });

// Fractal sum, unrolled in JS (octaves is a build-time constant). Roughly [-1, 1].
export function fbm(p, octaves) {
  let sum = float(0);
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum = sum.add(vnoise(p.mul(2 ** o).add(o * 17.3)).mul(amp));
    norm += amp;
    amp *= 0.5;
  }
  return sum.div(norm);
}

// A smooth random vector field for domain warping.
export const warp3 = (p) => vec3(vnoise(p), vnoise(p.add(vec3(31.4, 7.7, 2.9))), vnoise(p.add(vec3(-5.2, 19.1, 11.3))));

// Cellular noise: distances to the nearest and second-nearest feature point, searching the 2×2×2
// cells around p (Gustavson's fast variant; feature points stay near their cell centres).
export const cellular = Fn(([p]) => {
  const i = floor(p.sub(0.5));
  const f1 = float(9).toVar();
  const f2 = float(9).toVar();
  for (let x = 0; x < 2; x++) {
    for (let y = 0; y < 2; y++) {
      for (let z = 0; z < 2; z++) {
        const c = i.add(vec3(x, y, z));
        const jitter = vec3(cellHash(c, 1), cellHash(c, 2), cellHash(c, 3)).sub(0.5).mul(0.75);
        const d = length(p.sub(c.add(0.5).add(jitter)));
        f2.assign(min(f2, max(f1, d)));
        f1.assign(min(f1, d));
      }
    }
  }
  return vec2(f1, f2);
}).setLayout({ name: 'wheelCells', type: 'vec2', inputs: [{ name: 'p', type: 'vec3' }] });
