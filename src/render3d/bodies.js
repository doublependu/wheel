// The fancy loading wheel's planets: one material with eight looks, on one mesh that is the planet
// whole and in pieces. The sphere is cut into solid wedges (the pieces); the vertex shader displaces
// its surface with procedural noise and, once the planet bursts, flies, tumbles and shrinks each
// wedge (the formulas of loader/orbitPhysics.js). The fragment shader evaluates the full surface
// again per pixel and takes its normal from the slope of that height (Mikkelsen's surface gradient),
// so light and clearcoat follow the moving shape. One evaluation per stage keeps the shader small,
// which matters on a cold shader cache.
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, float, vec3, vec4, mix, smoothstep, clamp, normalize, dot, cross, sin, cos, exp, select, max, attribute,
  positionGeometry, positionView, transformNormalToView, varyingProperty, modelScale, normalFlat, hash, color, screenCoordinate,
} from 'three/tsl';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { GEOM, PIECE, pieceSeeds, nearestSeed } from '../loader/orbitPhysics.js';
import { ORBIT } from '../config.js';
import { vnoise, fbm, warp3, cellular } from './noise.js';
import { createRng } from '../sim/rng.js';

const C = (h) => new THREE.Color(h);
// The ring's eight looks, clockwise from 3 o'clock. A: noise frequency, amplitude (radii), domain
// warp, Worley cells. B: latitude bands, sea level (−1: no sea), metalness, roughness. FX:
// iridescence, sheen, clearcoat, emissive. Colours: low, high and accent (lava glow, sea, facets,
// sheen…). `dot`: the planet's colour as one dot, for its dust, its faint shade and the CSS loader.
export const LOOKS = [
  { name: 'lava', A: [2.2, 0.06, 0.6, 0.7], B: [0, -1, 0, 0.85], FX: [0, 0, 0, 1], c: ['#140b08', '#3a2117', '#ff5a1a'], dot: '#ff6a2a' },
  { name: 'ocean', A: [1.6, 0.07, 0.5, 0], B: [0, 0.004, 0, 0.8], FX: [0, 0, 1, 0], c: ['#3f6a2c', '#cbb68a', '#0d3f91'], dot: '#3f7fd8' },
  { name: 'gas', A: [1.4, 0.025, 1.2, 0], B: [1, -1, 0, 0.55], FX: [0, 0.7, 0, 0], c: ['#b4682f', '#f4dfb8', '#ffd3a0'], dot: '#e9b980' },
  { name: 'crystal', A: [2.4, 0.07, 0.2, 1], B: [0, -1, 0.1, 0.12], FX: [0.25, 0, 1, 0], c: ['#16618c', '#9fe6ff', '#effcff'], dot: '#9fe6ff' },
  { name: 'pearl', A: [1.1, 0.05, 0.4, 0], B: [0, -1, 0, 0.22], FX: [1, 0, 0.6, 0], c: ['#eadbe4', '#fff7f0', '#ffffff'], dot: '#f6e6f0' },
  { name: 'chrome', A: [1.0, 0.09, 0.9, 0], B: [0, -1, 0.9, 0.16], FX: [0, 0, 0, 0], c: ['#b6bfcc', '#e8edf4', '#ffffff'], dot: '#dfe5ee' },
  { name: 'velvet', A: [1.8, 0.04, 0.5, 0], B: [0.3, -1, 0, 0.9], FX: [0, 1, 0, 0], c: ['#4c1239', '#8f2c66', '#ff9fd0'], dot: '#d0559a' },
  { name: 'rock', A: [2.8, 0.06, 0.3, 0.5], B: [0, -1, 0, 0.95], FX: [0, 0, 0, 0], c: ['#4d443d', '#a69a8a', '#2a2420'], dot: '#b0a493' },
];
export const LOOK_COLORS = LOOKS.map((l) => l.dot);

// The planet as solid wedges. Every triangle of an icosphere goes to the nearest piece (seed), and
// where two pieces meet each gets a wall down to its own apex at half the radius. At rest the wedges
// tile the sphere exactly, so the whole planet and its pieces are the same mesh.
//  aCell: the piece's direction and a random number; aPiece: two more, and 1 on its walls.
function wedges(detail, seeds) {
  const ico = new THREE.IcosahedronGeometry(1, detail);
  ico.deleteAttribute('uv');
  ico.deleteAttribute('normal');
  const sphere = mergeVertices(ico);
  ico.dispose();
  const pts = sphere.getAttribute('position').array;
  const idx = sphere.index.array;
  sphere.dispose();
  const tris = idx.length / 3;
  const cellOf = new Uint8Array(tris);
  const across = new Map(); // an edge → the triangle seen first on it, then both of them
  const edgeKey = (a, b) => (a < b ? a * 65536 + b : b * 65536 + a);
  for (let t = 0; t < tris; t++) {
    const [a, b, c] = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
    cellOf[t] = nearestSeed(seeds, [0, 1, 2].map((j) => pts[a * 3 + j] + pts[b * 3 + j] + pts[c * 3 + j]));
    for (const key of [edgeKey(a, b), edgeKey(b, c), edgeKey(c, a)]) {
      const seen = across.get(key);
      across.set(key, seen === undefined ? [t] : [seen[0], t]);
    }
  }
  const pos = [];
  const cell = [];
  const piece = [];
  const index = [];
  const push = (x, y, z, k, wall) => {
    const s = seeds[k];
    pos.push(x, y, z);
    cell.push(s.dir[0], s.dir[1], s.dir[2], s.r[0]);
    piece.push(s.r[1], s.r[2], wall);
    return pos.length / 3 - 1;
  };
  const made = new Map(); // (corner, piece, wall or not) → its vertex
  const vert = (id, k, wall) => {
    const key = (id * 64 + k) * 2 + wall;
    let v = made.get(key);
    if (v === undefined) made.set(key, (v = push(pts[id * 3], pts[id * 3 + 1], pts[id * 3 + 2], k, wall)));
    return v;
  };
  const apex = seeds.map((s, k) => push(s.dir[0] * 0.5, s.dir[1] * 0.5, s.dir[2] * 0.5, k, 1));
  for (let t = 0; t < tris; t++) {
    const k = cellOf[t];
    const abc = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
    index.push(vert(abc[0], k, 0), vert(abc[1], k, 0), vert(abc[2], k, 0));
    for (let e = 0; e < 3; e++) {
      const a = abc[e];
      const b = abc[(e + 1) % 3];
      const pair = across.get(edgeKey(a, b));
      const other = pair[0] === t ? pair[1] : pair[0];
      if (other !== undefined && cellOf[other] !== k) index.push(vert(b, k, 1), vert(a, k, 1), apex[k]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(pos, 3)); // unused: the material makes its own
  geo.setAttribute('aCell', new THREE.Float32BufferAttribute(cell, 4));
  geo.setAttribute('aPiece', new THREE.Float32BufferAttribute(piece, 3));
  geo.setIndex(index);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4); // the pieces fly well outside the sphere
  return geo;
}

// Rotate p about the y axis (a planet's spin), and v about the unit axis k by angle a (a tumble).
const spinY = (p, a) => vec3(p.x.mul(cos(a)).sub(p.z.mul(sin(a))), p.y, p.x.mul(sin(a)).add(p.z.mul(cos(a))));
const turned = (v, k, a) => v.mul(cos(a)).add(cross(k, v).mul(sin(a))).add(k.mul(dot(k, v)).mul(float(1).sub(cos(a))));

// A surface at unit-sphere point p: vec4(height in planet radii, fbm, cell edge, crack edge). `opt`
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
    const plates = smoothstep(0.0, 0.3, edge).sub(0.5).mul(U.amp);
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

// Displace the sphere and move its pieces (vertex stage), and give the material a per-pixel normal:
// on the surface from the slope of its height (Mikkelsen, "Bump Mapping Unparametrized Surfaces on
// the GPU", 2010, with screen-space derivatives of the height in view units), flat on a piece's
// walls. Returns the per-pixel surface fields. U.piece (a varying) receives vec3(how much of the
// piece is dust, 1 on a wall, 0).
function morph(material, opt, U) {
  const aCell = attribute('aCell', 'vec4');
  const aPiece = attribute('aPiece', 'vec3');
  const vP = varyingProperty('vec3', 'vMorphP'); // the point of the sphere: the look stays glued to its piece
  const vN = varyingProperty('vec3', 'vMorphN'); // the same, turned with the piece
  const vK = U.piece;
  const c = ORBIT;
  material.positionNode = Fn(() => {
    const p = normalize(positionGeometry);
    vP.assign(p);
    // a wall's apex lies inside the planet and is not part of its surface
    const base = select(positionGeometry.length().greaterThan(0.9), p.mul(surface(p, opt, U, true).x.add(1)), positionGeometry);
    const dir = aCell.xyz;
    const u = U.burst;
    const flown = float(1).sub(exp(u.sub(c.seams).max(0).mul(-PIECE.drag)));
    const seam = smoothstep(0, c.seams, u).mul(PIECE.seam);
    const away = normalize(dir.add(vec3(...PIECE.bias)));
    const off = dir.mul(seam).add(away.mul(mix(PIECE.blast[0], PIECE.blast[1], aCell.w)).mul(flown).mul(opt.gentle));
    const from = float(c.pieces[0] + PIECE.erodeFrom).add(float(1).sub(dir.x).mul(0.5 * PIECE.erodeLag)).add(aPiece.x.mul(0.03));
    const to = from.add(mix(PIECE.erode[0], PIECE.erode[1], aPiece.y)).min(c.pieces[1]);
    const eroded = clamp(u.sub(from).div(to.sub(from)), 0, 1);
    const axis = normalize(vec3(aCell.w.sub(0.5), aPiece.x.sub(0.5), aPiece.y.sub(0.5).add(1e-3)));
    const angle = flown.mul(mix(PIECE.spin[0], PIECE.spin[1], aPiece.x)).mul(select(aPiece.y.lessThan(0.5), float(-1), float(1))).mul(opt.gentle);
    const core = dir.mul(PIECE.core);
    vN.assign(turned(p, axis, angle));
    vK.assign(vec3(eroded, aPiece.z, 0));
    return core.add(turned(base.sub(core), axis, angle).mul(float(1).sub(eroded).pow(1 / 3))).add(off);
  })();
  const p = normalize(vP);
  const s = Fn(() => surface(p, opt, U, false))().toVar('surf');
  const H = s.x.mul(modelScale.x);
  material.normalNode = Fn(() => {
    const n = transformNormalToView(normalize(vN)).normalize();
    const sx = positionView.dFdx();
    const sy = positionView.dFdy();
    const r1 = sy.cross(n);
    const r2 = n.cross(sx);
    const det = sx.dot(r1);
    const grad = det.sign().mul(r1.mul(H.dFdx()).add(r2.mul(H.dFdy())));
    return select(vK.y.greaterThan(0.5), normalFlat, det.abs().mul(n).sub(grad).normalize());
  })();
  return s;
}

// 1 where h is at (or under) the sea surface.
const step01 = (h, level) => select(h.lessThanEqual(level.add(0.0005)), float(1), float(0));

// ---------- the ring: one material, eight looks through per-object uniforms ----------
// Returns a solid planet and a faint shade per station (same geometry and material). Per object:
//  life: heat (a forming planet), burst (the hop phase once its seams open; −1 while whole), seed, spin
//  aux: shade (the share of its pixels a faint shade shows; 0: solid), surface time, glow of the inside
// `gentle` < 1 (reduced motion): the pieces drift apart instead of blasting.
export function makeRing(tier, gentle = 1) {
  const per = (key, dflt) => uniform(dflt).onObjectUpdate(({ object }) => object.userData[key]);
  const A = per('A', new THREE.Vector4());
  const B = per('B', new THREE.Vector4());
  const FX = per('FX', new THREE.Vector4());
  const c0 = per('c0', C('#000'));
  const c1 = per('c1', C('#000'));
  const c2 = per('c2', C('#000'));
  const dust = per('dot', C('#000'));
  const life = per('life', new THREE.Vector4(0, -1, 0, 0));
  const aux = per('aux', new THREE.Vector4());
  const frame = uniform(0); // changes every frame: the shades' grain shimmers
  const t = aux.y;
  const vK = varyingProperty('vec3', 'vPiece');
  const U = {
    t, spin: life.w, seed: life.z, heat: life.x, burst: life.y, crack: vK.x, piece: vK,
    freq: A.x, amp: A.y, warp: A.z, cells: A.w, band: B.x, sea: B.y,
    seaLevel: B.y.add(sin(t.mul(0.9).add(life.z)).mul(0.022)),
  };
  const mat = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.5, metalness: 0, clearcoat: 1, iridescence: 1, sheen: 1 });
  const s = morph(mat, { octaves: tier.name === 'low' ? 2 : 3, cells: true, bands: true, sea: true, heat: true, crack: true, gentle }, U);
  const n = s.y;
  const wall = vK.y; // 1 on the inside of a piece
  const skin = float(1).sub(wall);
  const shade = select(aux.x.greaterThan(0), float(1), float(0));
  const isSea = select(B.y.greaterThan(-0.5), step01(s.x, U.seaLevel), float(0));
  let base = mix(c0, c1, smoothstep(-0.35, 0.35, n));
  base = mix(base, c2, A.w.mul(smoothstep(0.04, 0.3, s.z)).mul(0.6)); // facets catch the accent
  base = mix(base, c2.mul(mix(0.6, 1.1, smoothstep(-0.3, 0.3, n))), isSea);
  base = mix(base, color('#1b100c'), wall); // the inside is dark rock…
  mat.colorNode = mix(base, dust, shade.mul(0.35));
  mat.metalnessNode = B.z.mul(skin);
  mat.roughnessNode = mix(mix(B.w, float(0.05), isSea), float(0.9), wall);
  mat.clearcoatNode = FX.z.mul(select(B.y.greaterThan(-0.5), isSea, float(1))).mul(skin);
  mat.clearcoatRoughnessNode = float(0.05);
  mat.iridescenceNode = FX.x.mul(skin);
  mat.iridescenceIORNode = float(1.35);
  mat.iridescenceThicknessNode = mix(float(260), float(780), n.mul(0.5).add(0.5).add(sin(t.mul(1.3).add(life.z)).mul(0.25)));
  mat.sheenNode = c2.mul(FX.y).mul(skin);
  mat.sheenRoughnessNode = float(0.45);
  // lava glows in its cracks; a forming planet glows hot; a piece glows along its cracks as it
  // grinds down, and its inside glows like magma, cooling as it flies
  const lavaLines = float(1).sub(smoothstep(0.0, 0.07, s.z)).mul(FX.w).mul(sin(t.mul(3).add(n.mul(9))).mul(0.3).add(0.9));
  const crackLines = float(1).sub(smoothstep(0.0, 0.1, s.w)).mul(vK.x);
  const outside = c2.mul(lavaLines.mul(2.2))
    .add(color('#ff6a1c').mul(U.heat.pow(2).mul(4)))
    .add(color('#ff8a3a').mul(crackLines.mul(2.5)));
  const magma = mix(color('#ff2a00'), color('#ffb347'), aux.z.mul(smoothstep(-0.5, 0.5, n))).mul(aux.z.mul(aux.z).mul(3.2));
  mat.emissiveNode = mix(outside, magma, wall).add(dust.mul(shade.mul(0.9)));
  // A piece crumbles from its cracks as it grinds down (a dithered dissolve: no blending, nothing to
  // sort). A faint shade shows only a sparse, shimmering grain of the planet.
  const pixel = screenCoordinate.x.add(screenCoordinate.y.mul(1307));
  const crumbled = s.w.greaterThan(vK.x.mul(0.62).add(hash(pixel).mul(0.08).mul(vK.x)));
  mat.maskNode = select(aux.x.greaterThan(0), hash(pixel.add(frame)).lessThan(aux.x), crumbled);

  const seeds = pieceSeeds(tier.pieces, createRng(9));
  const geo = wedges(tier.ringDetail, seeds);
  const make = (look, i) => {
    const m = new THREE.Mesh(geo, mat);
    m.userData = {
      A: new THREE.Vector4(...look.A), B: new THREE.Vector4(...look.B), FX: new THREE.Vector4(...look.FX),
      c0: C(look.c[0]), c1: C(look.c[1]), c2: C(look.c[2]), dot: C(look.dot),
      life: new THREE.Vector4(0, -1, 11.3 + i * 4.7, 0), aux: new THREE.Vector4(), surfaceT: 0,
    };
    m.frustumCulled = false;
    m.visible = false;
    return m;
  };
  return { solids: LOOKS.map(make), shades: LOOKS.map(make), frame, seeds, material: mat };
}

// Icosphere detail (≈ 0.8k / 1.7k / 3.6k / 6.3k vertices before the cut) and pieces per tier.
export function bodyTier(t) {
  const ringDetail = { low: 8, medium: 12, high: 18, ultra: 24 }[t.name];
  const pieces = { low: 12, medium: 18, high: 26, ultra: 36 }[t.name];
  return { name: t.name, ringDetail, pieces };
}
