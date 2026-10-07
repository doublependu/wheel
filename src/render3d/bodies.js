// The fancy loading wheel's bodies: a star, two twins (ice and liquid mercury) and eight ring planets
// that share one material with eight looks. Every surface morphs: the vertex shader displaces the
// sphere with procedural noise and tidal bulges (Legendre P2, from orbitPhysics.js); the fragment
// shader evaluates the full surface again per pixel and takes its normal from the slope of that
// height (Mikkelsen's surface gradient), so light, clearcoat and refraction follow the moving
// shape. One evaluation per stage keeps the shaders small, which matters on a cold shader cache.
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, float, vec3, vec4, mix, smoothstep, clamp, normalize, dot, abs, sin, cos, select, max,
  positionGeometry, positionView, transformNormalToView, varyingProperty, modelScale, normalView,
  positionViewDirection, hash, color, screenCoordinate,
} from 'three/tsl';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { GEOM } from '../loader/orbitPhysics.js';
import { vnoise, fbm, warp3, cellular } from './noise.js';

const C = (h) => new THREE.Color(h);
// The ring's eight looks, clockwise from 3 o'clock. A: noise frequency, amplitude (radii), domain
// warp, Worley cells. B: latitude bands, sea level (−1: no sea), metalness, roughness. FX:
// iridescence, sheen, clearcoat, emissive. Colours: low, high and accent (lava glow, sea, facets,
// sheen…). `dot`: the planet's colour as one dot, for its dust and the CSS loader (index.html).
export const LOOKS = [
  { name: 'lava', A: [2.2, 0.06, 0.6, 0.7], B: [0, -1, 0, 0.85], FX: [0, 0, 0, 1], c: ['#140b08', '#3a2117', '#ff5a1a'], dot: '#ff6a2a' },
  { name: 'ocean', A: [1.6, 0.07, 0.5, 0], B: [0, 0.004, 0, 0.8], FX: [0, 0, 1, 0], c: ['#3f6a2c', '#cbb68a', '#0d3f91'], dot: '#3f7fd8' },
  { name: 'gas', A: [1.4, 0.025, 1.2, 0], B: [1, -1, 0, 0.55], FX: [0, 0.7, 0, 0], c: ['#b4682f', '#f4dfb8', '#ffd3a0'], dot: '#e9b980' },
  { name: 'crystal', A: [2.4, 0.07, 0.2, 1], B: [0, -1, 0.1, 0.12], FX: [0.25, 0, 1, 0], c: ['#16618c', '#9fe6ff', '#effcff'], dot: '#9fe6ff' },
  { name: 'pearl', A: [1.1, 0.05, 0.4, 0], B: [0, -1, 0, 0.22], FX: [1, 0, 0.6, 0], c: ['#eadbe4', '#fff7f0', '#ffffff'], dot: '#f6e6f0' },
  { name: 'chrome', A: [1.0, 0.09, 0.9, 0], B: [0, -1, 1, 0.07], FX: [0, 0, 0, 0], c: ['#b6bfcc', '#e8edf4', '#ffffff'], dot: '#dfe5ee' },
  { name: 'velvet', A: [1.8, 0.04, 0.5, 0], B: [0.3, -1, 0, 0.9], FX: [0, 1, 0, 0], c: ['#4c1239', '#8f2c66', '#ff9fd0'], dot: '#d0559a' },
  { name: 'rock', A: [2.8, 0.06, 0.3, 0.5], B: [0, -1, 0, 0.95], FX: [0, 0, 0, 0], c: ['#4d443d', '#a69a8a', '#2a2420'], dot: '#b0a493' },
];
export const LOOK_COLORS = LOOKS.map((l) => l.dot);

// An indexed unit icosphere (the vertex shader then runs once per vertex, not per corner).
const sphereCache = new Map();
function sphere(detail) {
  if (!sphereCache.has(detail)) {
    const g = new THREE.IcosahedronGeometry(1, detail);
    g.deleteAttribute('uv');
    sphereCache.set(detail, mergeVertices(g));
  }
  return sphereCache.get(detail);
}

// Rotate p about the y axis (a planet's spin).
const spinY = (p, a) => vec3(p.x.mul(cos(a)).sub(p.z.mul(sin(a))), p.y, p.x.mul(sin(a)).add(p.z.mul(cos(a))));

// A surface at unit-sphere point p: vec4(height in body radii, fbm, cell edge, crack edge). `opt`
// switches features on or off at build time (the vertex stage gets only the broad shape); `U`
// holds the nodes that drive them.
function surface(p, opt, U, vertex) {
  const q = spinY(p, U.spin);
  const qb = opt.bands ? q.mul(mix(vec3(1), vec3(0.35, 3.2, 0.35), U.band)) : q;
  const drift = vec3(0, U.t.mul(0.25), U.t.mul(0.11));
  const w = warp3(qb.mul(U.freq.mul(0.7)).add(U.seed).add(drift)).mul(U.warp);
  const n = fbm(qb.mul(U.freq).add(w).add(U.seed).sub(drift.mul(0.6)), vertex ? 2 : opt.octaves).toVar();
  const h = n.mul(U.amp).toVar();
  let edge = float(1);
  if (opt.cells && !vertex) {
    const wv = cellular(q.mul(U.freq.mul(1.3)).add(U.seed).add(w.mul(0.35)).add(drift.mul(0.3)));
    edge = wv.y.sub(wv.x);
    const plates = smoothstep(0.0, 0.3, edge).sub(0.5).mul(U.amp.mul(U.cellAmp ?? 1));
    h.assign(mix(h, plates, U.cells));
  }
  if (opt.sea) h.assign(select(U.sea.greaterThan(-0.5), max(h, U.seaLevel), h));
  if (opt.heat) h.addAssign(vnoise(q.mul(3.5).add(U.t.mul(1.7)).add(U.seed)).mul(U.heat).mul(0.3));
  let crack = float(1);
  if (opt.crack && !vertex) {
    const wc = cellular(q.mul(2.2).add(U.seed.mul(1.7)));
    crack = wc.y.sub(wc.x);
    h.subAssign(U.crack.mul(0.18).mul(float(1).sub(smoothstep(0.0, 0.12, crack))));
  }
  const lim = opt.heat ? float(GEOM.morph).mul(U.heat.mul(2).add(1)) : float(GEOM.morph);
  return vec4(clamp(h, lim.negate(), lim), n, edge, crack);
}

// Tidal bulge at unit-sphere point p: Σ amp·P2(p·dir), amp in radii.
const tideAt = (p, tides) => tides.reduce((acc, td) => acc.add(td.w.mul(dot(p, td.xyz).pow(2).mul(1.5).sub(0.5))), float(0));

// Displace the unit sphere (vertex stage), and give the material a per-pixel normal from the full
// surface's slope: Mikkelsen, "Bump Mapping Unparametrized Surfaces on the GPU" (2010), with screen-
// space derivatives of the height in view units. Returns the per-pixel surface fields.
function morph(material, opt, U, tides) {
  const vP = varyingProperty('vec3', 'vMorphP');
  material.positionNode = Fn(() => {
    const p = normalize(positionGeometry);
    vP.assign(p);
    return p.mul(surface(p, opt, U, true).x.add(1).add(tideAt(p, tides)));
  })();
  const p = normalize(vP);
  const s = Fn(() => surface(p, opt, U, false))().toVar('surf');
  const H = s.x.add(tideAt(p, tides)).mul(modelScale.x);
  material.normalNode = Fn(() => {
    const n = transformNormalToView(p).normalize();
    const sx = positionView.dFdx();
    const sy = positionView.dFdy();
    const r1 = sy.cross(n);
    const r2 = n.cross(sx);
    const det = sx.dot(r1);
    const grad = det.sign().mul(r1.mul(H.dFdx()).add(r2.mul(H.dFdy())));
    return det.abs().mul(n).sub(grad).normalize();
  })();
  return s;
}

// Uniforms every body has. `tides` holds up to two vec4(dir, amp in radii).
function commonUniforms(seed) {
  return { t: uniform(0), spin: uniform(0), seed: uniform(seed), tides: [uniform(new THREE.Vector4(1, 0, 0, 0)), uniform(new THREE.Vector4(0, 1, 0, 0))] };
}

// ---------- the star: unlit plasma, boiling granulation, limb darkening, two tidal bulges ----------
export function makeStar(tier) {
  const U = { ...commonUniforms(3.1), freq: float(3.2), amp: float(0.025), warp: float(0.5), cells: float(1), cellAmp: 1.2, glow: uniform(1) };
  const mat = new THREE.MeshBasicNodeMaterial();
  const s = morph(mat, { octaves: 2, cells: true }, U, U.tides);
  const gran = smoothstep(0.0, 0.45, s.z); // bright cell interiors, darker lanes
  const mu = abs(dot(normalView, positionViewDirection));
  const limb = float(1).sub(float(1).sub(mu).pow(1.5).mul(0.8)); // limb darkening
  const flick = vnoise(vec3(U.t.mul(2.3), U.t.mul(1.1), 0)).mul(0.08).add(1);
  const spots = smoothstep(0.25, 0.6, s.y).mul(0.35); // faint active regions
  const hot = mix(color('#ff4d00'), color('#ffd27a'), limb.mul(mix(0.7, 1.0, gran)));
  mat.colorNode = hot.mul(limb).mul(mix(0.72, 1.0, gran)).mul(float(1).sub(spots)).mul(6).mul(flick).mul(U.glow);
  const mesh = new THREE.Mesh(sphere(tier.detail), mat);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return { mesh, U };
}

// ---------- twin A: ice. Transmission + dispersion on High and up, subsurface scattering below ----------
export function makeIce(tier, env) {
  const U = { ...commonUniforms(7.7), freq: float(2.1), amp: uniform(0.06), warp: float(0.25), cells: float(1), cellAmp: 1.4 };
  const glass = tier.transmission;
  const mat = glass
    ? new THREE.MeshPhysicalNodeMaterial({ transmission: 0.7, thickness: 0.5, ior: 1.31, dispersion: 6, roughness: 0.08, metalness: 0, color: '#e4f7ff', attenuationColor: '#58c4ff', attenuationDistance: 0.4, clearcoat: 1, clearcoatRoughness: 0.03 })
    : new THREE.MeshSSSNodeMaterial({ color: '#bfeaff', roughness: 0.14, metalness: 0 });
  if (!glass) {
    mat.thicknessColorNode = color('#4fc6ff');
    mat.thicknessDistortionNode = float(0.2);
    mat.thicknessAmbientNode = float(0.15);
    mat.thicknessAttenuationNode = float(0.9);
    mat.thicknessPowerNode = float(2.5);
    mat.thicknessScaleNode = float(6);
  }
  const s = morph(mat, { octaves: 2, cells: true }, U, U.tides);
  const frost = smoothstep(0.0, 0.06, s.z); // the grooves between facets are frosted
  mat.roughnessNode = mix(float(0.45), float(glass ? 0.04 : 0.14), frost);
  if (!glass) mat.colorNode = mix(color('#86cbe8'), color('#e6f8ff'), frost);
  litByStudio(mat, env, 1.6);
  const mesh = new THREE.Mesh(sphere(tier.detail), mat);
  mesh.castShadow = mesh.receiveShadow = tier.shadows;
  return { mesh, U };
}

// The twins mirror a bright studio of their own, so their curves read against black space.
function litByStudio(mat, env, intensity) {
  if (!env) return;
  mat.envMap = env;
  mat.envMapIntensity = intensity;
}

// ---------- twin B: liquid mercury, lava-lamp blobs ----------
export function makeMercury(tier, env) {
  const U = { ...commonUniforms(1.3), freq: float(1.15), amp: float(0.1), warp: float(1.1) };
  const mat = new THREE.MeshPhysicalNodeMaterial({ metalness: 1, roughness: 0.05, color: '#d3d9e2', clearcoat: 0 });
  const s = morph(mat, { octaves: 2 }, U, U.tides);
  mat.roughnessNode = float(0.06).add(smoothstep(0.2, 0.6, s.y).mul(0.06));
  litByStudio(mat, env, 2.2);
  const mesh = new THREE.Mesh(sphere(tier.detail), mat);
  mesh.castShadow = mesh.receiveShadow = tier.shadows;
  return { mesh, U };
}

// 1 where h is at (or under) the sea surface.
const step01 = (h, level) => select(h.lessThanEqual(level.add(0.0005)), float(1), float(0));

// ---------- the ring: one material, eight looks through per-object uniforms ----------
export function makeRing(tier) {
  const per = (key, dflt) => uniform(dflt).onObjectUpdate(({ object }) => object.userData[key]);
  const A = per('A', new THREE.Vector4());
  const B = per('B', new THREE.Vector4());
  const FX = per('FX', new THREE.Vector4());
  const c0 = per('c0', C('#000'));
  const c1 = per('c1', C('#000'));
  const c2 = per('c2', C('#000'));
  const life = per('life', new THREE.Vector4()); // heat, crack, seed, spin
  const tide0 = per('tide', new THREE.Vector4(1, 0, 0, 0));
  const t = uniform(0);
  const U = {
    t, spin: life.w, seed: life.z, heat: life.x, crack: life.y,
    freq: A.x, amp: A.y, warp: A.z, cells: A.w, band: B.x, sea: B.y,
    seaLevel: B.y.add(sin(t.mul(0.9).add(life.z)).mul(0.022)),
  };
  const mat = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.5, metalness: 0, clearcoat: 1, iridescence: 1, sheen: 1 });
  const s = morph(mat, { octaves: tier.name === 'low' ? 2 : 3, cells: true, bands: true, sea: true, heat: true, crack: true }, U, [tide0]);
  const n = s.y;
  const isSea = select(B.y.greaterThan(-0.5), step01(s.x, U.seaLevel), float(0));
  let base = mix(c0, c1, smoothstep(-0.35, 0.35, n));
  base = mix(base, c2, A.w.mul(smoothstep(0.04, 0.3, s.z)).mul(0.6)); // facets catch the accent
  base = mix(base, c2.mul(mix(0.6, 1.1, smoothstep(-0.3, 0.3, n))), isSea);
  mat.colorNode = base;
  mat.metalnessNode = B.z;
  mat.roughnessNode = mix(B.w, float(0.05), isSea);
  mat.clearcoatNode = FX.z.mul(select(B.y.greaterThan(-0.5), isSea, float(1)));
  mat.clearcoatRoughnessNode = float(0.05);
  mat.iridescenceNode = FX.x;
  mat.iridescenceIORNode = float(1.35);
  mat.iridescenceThicknessNode = mix(float(260), float(780), n.mul(0.5).add(0.5).add(sin(t.mul(1.3).add(life.z)).mul(0.25)));
  mat.sheenNode = c2.mul(FX.y);
  mat.sheenRoughnessNode = float(0.45);
  // lava glows in its cracks; a forming planet glows hot; a crumbling one glows along its cracks
  const lavaLines = float(1).sub(smoothstep(0.0, 0.07, s.z)).mul(FX.w).mul(sin(t.mul(3).add(n.mul(9))).mul(0.3).add(0.9));
  const crackLines = float(1).sub(smoothstep(0.0, 0.1, s.w)).mul(U.crack);
  mat.emissiveNode = c2.mul(lavaLines.mul(2.2))
    .add(color('#ff6a1c').mul(U.heat.pow(2).mul(4)))
    .add(color('#ff8a3a').mul(crackLines.mul(2.5)));
  // break-up: a dithered dissolve that eats the planet from its cracks (no blending, nothing to sort)
  const dither = hash(screenCoordinate.x.add(screenCoordinate.y.mul(1307)));
  mat.maskNode = s.w.greaterThan(U.crack.mul(0.62).add(dither.mul(0.08).mul(U.crack)));
  const geo = sphere(tier.ringDetail);
  const meshes = LOOKS.map((look, i) => {
    const m = new THREE.Mesh(geo, mat);
    m.userData = {
      A: new THREE.Vector4(...look.A), B: new THREE.Vector4(...look.B), FX: new THREE.Vector4(...look.FX),
      c0: C(look.c[0]), c1: C(look.c[1]), c2: C(look.c[2]),
      life: new THREE.Vector4(0, 0, 11.3 + i * 4.7, 0), tide: new THREE.Vector4(1, 0, 0, 0),
    };
    m.castShadow = m.receiveShadow = tier.shadows;
    return m;
  });
  return { meshes, U: { t }, material: mat };
}

// Icosphere detail (≈ 1.2k / 2.9k / 6.3k / 10.9k vertices) and features per tier.
export function bodyTier(t) {
  const detail = { low: 10, medium: 16, high: 24, ultra: 32 }[t.name];
  const ringDetail = { low: 8, medium: 12, high: 18, ultra: 24 }[t.name];
  return { name: t.name, detail, ringDetail, shadows: t.shadows > 0 && t.name !== 'medium', transmission: !!t.transmission };
}
