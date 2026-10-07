// The fancy loading wheel (stage B): a ring of eight stations over a black mirror, and one planet's
// worth of matter that goes round it. The planet at a station bursts into pieces, the pieces grind
// down to dust, and the dust (simulated on the GPU) streams clockwise to the next station and forms
// the next planet there. A whole planet has a faint shade of dust on either side: the planet before
// it, thinning, and the one to come, thickening. Motion: src/loader/orbitPhysics.js, on the wheel's
// own clock (src/loader/netSpeed.js), which speeds up and slows down like a connection. Planets and
// their material: bodies.js. No bloom: the explosion is geometry, glowing pieces, hot dust and a light.
import * as THREE from 'three/webgpu';
import {
  Fn, If, pass, uniform, uniformArray, instancedArray, instanceIndex, float, vec3, vec4, mix, smoothstep, clamp, select, step,
  sin, cos, floor, mod, hash, length, uv, varying, renderOutput, screenCoordinate, positionWorld, reflector, int,
} from 'three/tsl';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { film } from 'three/addons/tsl/display/FilmNode.js';
import { layout, dustPlan, spiralScale, innerGlow, onRing, stationAngle, GEOM } from '../loader/orbitPhysics.js';
import { makeRing, bodyTier, LOOK_COLORS } from './bodies.js';
import { warp3 } from './noise.js';
import { frameCamera } from './wheel.js';
import { createRng } from '../sim/rng.js';
import { LOADER, ORBIT, SPIRAL } from '../config.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => x * x * (3 - 2 * x);
const TAU = Math.PI * 2;
const DUST = { low: 512, medium: 2048, high: 8192, ultra: 24576 };
const HERO_TILT = -0.14; // the ring leans back a little once it has taken over from the flat dots
const BLAST = 9; // the explosion's light at its peak
// What the wheel shows while it warms up on the hidden canvas, before its clock starts: a whole
// planet with both its faint neighbours and dust in flight, so every pipeline gets compiled.
const SHOWCASE = 4.86 * ORBIT.hop;
const WHITE = 8; // the pre-loader's dots, as a ninth dust colour

export class Orbit {
  constructor(g, clock) {
    this.g = g;
    this.renderer = g.renderer;
    this.t = g.tierSettings;
    this.bt = bodyTier(this.t);
    this.clock = clock;
    this.reduced = clock.reduced;
    this.gentle = this.reduced ? 0.45 : 1; // reduced motion: the pieces drift apart instead of blasting
    this.handoffAt = null;
    this.decayAt = null;
    this.prevW = null;
    this.wasStarted = false;
    this.small = 1;
    this.#build();
    this.#pose(0);
  }

  #build() {
    const { renderer, bt } = this;
    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color('#000000');
    scene.environment = this.g.studioEnv();
    scene.environmentIntensity = 1.6; // the mirror-like looks (chrome, pearl, crystal) need something to reflect
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 80);

    const root = (this.root = new THREE.Group());
    scene.add(root);

    // the planets, and the faint shades of the one before and the one to come
    this.ring = makeRing(bt, this.gentle);
    for (const m of this.ring.solids) root.add(m);
    for (const m of this.ring.shades) root.add(m);

    // Light: a warm key from the upper left front, a cool rim from behind, and the explosion itself
    // (a point light at the bursting planet that falls off as 1/d: the physics is a bit different).
    const key = new THREE.DirectionalLight('#fff0dc', 2.6);
    key.position.set(-3, 4, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight('#8fb2ff', 0.7);
    rim.position.set(2.5, 3, -4);
    scene.add(rim);
    this.blast = new THREE.PointLight('#ffb070', 0, 0, 1);
    root.add(this.blast);

    this.#buildDust(root);

    // the black mirror: invisible itself, it only carries the reflection, fading with distance
    this.mirrorU = uniform(0);
    const reflection = reflector({ resolutionScale: { low: 0.35, medium: 0.5, high: 0.5, ultra: 0.6 }[this.t.name], generateMipmaps: true });
    reflection.target.rotateX(-Math.PI / 2);
    reflection.target.position.y = GEOM.floorY;
    scene.add(reflection.target);
    const floorMat = new THREE.MeshBasicNodeMaterial();
    // Fade by how deep the reflected image lies below the floor (seen through this floor point from
    // the camera), so the bottom of the wheel reflects brightest whatever the screen's aspect.
    this.camDU = uniform(10);
    this.camHU = uniform(1.67); // camera height above the floor
    const z = positionWorld.z.min(this.camDU.mul(0.95));
    const depth = this.camHU.mul(z.max(0)).div(this.camDU.sub(z));
    const fade = float(1).sub(smoothstep(0.0, 2.7, depth)).pow(2.2).mul(float(1).sub(smoothstep(1.4, 2.8, positionWorld.x.abs())));
    floorMat.colorNode = reflection.level(1.6).rgb.min(1.2).mul(0.34).mul(fade).mul(this.mirrorU);
    // (wide enough for a far camera: on a tall, narrow screen the reflection reaches well toward it)
    const floor0 = new THREE.Mesh(new THREE.CircleGeometry(30, 64), floorMat);
    floor0.rotation.x = -Math.PI / 2;
    floor0.position.y = GEOM.floorY;
    scene.add(floor0);

    // post: tone mapping, FXAA, a little grain and output dither. No TRAA: fast dust would ghost,
    // and its velocity pass and history cost start-up time, which here is the page's load time.
    const pipeline = (this.pipeline = new THREE.RenderPipeline(renderer));
    pipeline.outputColorTransform = false;
    const scenePass = pass(scene, this.camera);
    let srgb = renderOutput(scenePass.getTextureNode('output'));
    srgb = fxaa(srgb);
    srgb = film(srgb, float(0.02));
    srgb = vec4(srgb.rgb.add(hash(screenCoordinate.x.add(screenCoordinate.y.mul(4096))).sub(0.5).div(255)), 1);
    pipeline.outputNode = srgb;
  }

  // Dust. Every mote repeats one routine per hop (orbitPhysics.dustPlan): a flight from one station
  // to the next, and a rest. A compute pass works out where its routine wants it and springs it
  // after that point, with a little noise. In flight the point runs along the ring, dipping toward
  // the hub and corkscrewing round the track; bulk dust starts on its piece and spirals onto the
  // forming planet; stragglers and leaders hang in a slowly turning ball the size of a planet (the
  // faint shades). In the first hop the dust starts where the pre-loader's flat dots stood.
  #buildDust(root) {
    const N = DUST[this.t.name];
    const plan = dustPlan(N, this.ring.seeds, createRng(5), ORBIT, this.gentle);
    // The schedule is only read: two vec4 per mote, [group, offset, flight, advance] and the release
    // point (bulk) or a point in the unit ball. On WebGL2, where compute is transform feedback with
    // at most four outputs, it sits in a texture ("PBO") so that it doesn't count as one (and it is
    // one buffer because only the first such texture reads back right there).
    const both = new Float32Array(N * 8);
    for (let m = 0; m < N; m++) {
      both.set(plan.A.subarray(m * 4, m * 4 + 4), m * 8);
      both.set(plan.B.subarray(m * 4, m * 4 + 4), m * 8 + 4);
    }
    const schedule = instancedArray(both, 'vec4').setPBO(true).toReadOnly();
    const posB = instancedArray(N, 'vec4'); // position, and the two looks its colour runs between
    const velB = instancedArray(N, 'vec3');
    const stateB = instancedArray(N, 'vec4'); // cycle time at the last step, visibility, colour mix, heat
    for (let i = 0; i < N; i++) stateB.value.array[i * 4] = -1;
    this.hU = uniform(0); // hop phase: hops since the wheel started
    this.dtU = uniform(0);
    this.tU = uniform(0);
    this.firstU = uniform(0);
    this.decayU = uniform(0);
    this.resetU = uniform(1);
    this.smallU = uniform(1); // > 1 where the wheel covers few pixels: bigger motes (see resize)
    this.introCdf = uniformArray([1, 1, 1, 1, 1], 'float'); // which flat dot a mote of the first hop comes from…
    this.introSize = uniformArray([0.5, 0, 0, 0, 0, 0], 'float'); // …and how big that dot was
    const { hU, dtU, tU, firstU, decayU, resetU, introCdf, introSize } = this;
    const c = ORBIT;
    const STEP = TAU / c.stations;
    const R = GEOM.ringR;
    const RS = GEOM.stationR;
    // a point (or a direction) given in the frame of the station at angle a: forward, outward, toward the viewer
    const turn = (cs, sn, l) => vec3(sn.negate().mul(l.x).add(cs.mul(l.y)), cs.negate().mul(l.x).sub(sn.mul(l.y)), l.z);
    const frame = (a, l) => turn(cos(a), sin(a), l).add(vec3(cos(a).mul(R), sin(a).mul(R).negate(), 0));

    this.dustCompute = Fn(() => {
      const i = instanceIndex;
      const pa = schedule.element(i.mul(2));
      const pb = schedule.element(i.mul(2).add(1));
      const P = posB.element(i);
      const V = velB.element(i);
      const S = stateB.element(i);
      const s1 = hash(i.add(7919));
      const s2 = hash(i.add(104729));
      const s3 = hash(i.add(31337));
      const leader = pa.x.greaterThan(2.5);
      const straggler = pa.x.greaterThan(1.5).and(leader.not());
      const bulk = pa.x.lessThan(1.5);
      const core = bulk.and(pa.x.greaterThan(0.5));
      const n = floor(hU);
      const u = hU.sub(n);
      const q = hU.sub(pa.y);
      const kRaw = floor(q);
      const tau = q.sub(kRaw).toVar();
      // before its first flight a mote stands where the pre-loader's dots were
      const standing = kRaw.lessThan(0).and(leader.not());
      const gathering = kRaw.lessThan(0).and(leader); // …and a leader drifts from there to the first station
      const inFlight = kRaw.greaterThanEqual(0).and(tau.lessThan(pa.z));
      const k = select(leader, kRaw, kRaw.max(0));
      const f = select(standing, float(0), clamp(tau.div(pa.z), 0, 1)).toVar();
      const lead = select(leader, float(1), float(0));
      const toStation = firstU.add(k).add(lead);
      const aTo = toStation.mul(STEP);

      // the flat dot a mote of the first hop comes from: j stations behind the first planet's
      const j = float(0).toVar();
      for (let d = 0; d < 5; d++) j.addAssign(step(introCdf.element(int(d)), s3));
      const firstHop = k.lessThan(0.5).and(leader.not());
      const dotA = s1.mul(TAU);
      const dotL = vec3(cos(dotA), sin(dotA), 0).mul(s2.sqrt()).mul(introSize.element(int(j))).mul(RS);
      const aDot = firstU.sub(j).mul(STEP);
      const aFrom = select(firstHop, aDot, aTo.sub(STEP).add(pa.w.mul(STEP)));

      // where it hangs in a shade: a point of a slowly turning ball
      const sw = tU.mul(0.5).add(s1.mul(TAU));
      const hangL = vec3(pb.x.mul(cos(sw)).sub(pb.y.mul(sin(sw))), pb.x.mul(sin(sw)).add(pb.y.mul(cos(sw))), pb.z).mul(RS * 1.05);
      // a flight: from its start (piece, shade or flat dot) along the ring to its end (a spiral onto
      // the planet, or a place in the shade ahead)
      const startL = select(firstHop, dotL, select(bulk, pb.xyz, hangL));
      const spiral = float(1).sub(f).mul(TAU * 0.9).add(s2.mul(TAU));
      const rho = mix(1.9, 0.5, f).mul(RS);
      const landL = vec3(cos(spiral).mul(rho), sin(spiral).mul(rho), s3.sub(0.5).mul(rho).mul(0.5));
      const endL = select(leader, hangL, landL);
      const a = mix(aFrom, aTo, smoothstep(0, 1, f));
      const arc = sin(f.mul(Math.PI));
      const dip = arc.mul(s1.mul(0.16).add(0.05)).mul(R);
      const hel = f.mul(Math.PI * 3).mul(s2.sub(0.5).mul(2)).add(s1.mul(TAU));
      const hr = arc.mul(0.075).mul(s2.add(0.3));
      const l = startL.mul(float(1).sub(f).pow(2)).add(endL.mul(smoothstep(0.3, 1, f)))
        .add(vec3(0, cos(hel).mul(hr).sub(dip), sin(hel).mul(hr).mul(1.6)));
      const flightPos = frame(a, l);
      const hangPos = frame(aTo, hangL);
      const gatherPos = mix(frame(aDot, dotL), hangPos, smoothstep(0, s2.mul(0.2).add(0.25), hU));
      const moving = standing.or(inFlight);
      const target = select(gathering, gatherPos, select(moving, flightPos, hangPos)).mul(float(1).sub(decayU)).toVar();

      // Visible: in flight, and at rest in a shade. Hidden: bulk in a planet or on its piece, and a
      // straggler that has landed, until that planet bursts.
      const landedNow = k.greaterThan(n.sub(0.5));
      const hiddenRest = bulk.or(straggler.and(landedNow.or(u.lessThan(c.seams))));
      const fadeIn = select(firstHop, float(1), smoothstep(0, 0.06, f));
      const inFlightVis = select(bulk, fadeIn.mul(float(1).sub(smoothstep(0.85, 1, f))), select(straggler, float(1).sub(smoothstep(0.8, 1, f)), float(1)));
      const vis = select(standing.or(gathering), float(1), select(inFlight, inFlightVis, select(hiddenRest, float(0), float(1)))).toVar();

      // its colour runs from the look of the station it left to that of the one it flies to
      const toLook = mod(toStation.add(16), 8);
      const fromLook = select(firstHop.or(gathering), float(WHITE), mod(toLook.add(7), 8));
      const look = fromLook.add(toLook.mul(16));
      const blend = select(moving, f, select(gathering, smoothstep(0, 0.4, hU), float(1)));
      // the core sprays out hot; dust that hangs in a shade is marked −1 (it is drawn fainter)
      const heat = select(core.and(inFlight), float(1).sub(f).pow(3), select(moving.or(gathering), float(0), float(-1)));

      // a new flight of bulk dust starts on its piece, flung outward
      const fresh = bulk.and(inFlight).and(tau.lessThan(S.x));
      If(resetU.greaterThan(0.5).or(fresh), () => {
        P.assign(vec4(target, look));
        V.assign(turn(cos(aFrom), sin(aFrom), pb.xyz.normalize().mul(select(core, float(2.2), float(0.6)))).mul(select(fresh, float(1), float(0))));
      });
      If(vis.greaterThan(0.001), () => {
        const acc = target.sub(P.xyz).mul(70).sub(V.mul(9)).add(warp3(P.xyz.mul(4).add(tU)).mul(1.5));
        V.addAssign(acc.mul(dtU));
        const p = P.xyz.add(V.mul(dtU));
        P.assign(vec4(p.x, p.y.max(GEOM.floorY + 0.02), p.z, look)); // dust stays above the mirror
      });
      S.assign(vec4(tau, vis, blend, heat));
    })().compute(N);

    const tints = uniformArray([...LOOK_COLORS, '#e9e9ef'].map((h) => new THREE.Color(h)), 'color');
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const P = posB.toAttribute();
    const S = stateB.toAttribute();
    mat.positionNode = P.xyz;
    const vis = S.y;
    const code = P.w.add(0.25);
    const tint = mix(tints.element(int(mod(code, 16))), tints.element(int(code.div(16))), S.z);
    const hot = S.w.max(0);
    // more motes, each a little dimmer, so the dust is about as bright on every tier
    const gain = Math.min(2.2, 1.6 * (2048 / N) ** 0.45);
    const glow = mix(tint, vec3(1, 0.93, 0.8), 0.35).mul(gain).mul(select(S.w.lessThan(-0.5), float(0.55), float(1)))
      .add(vec3(1.0, 0.42, 0.1).mul(hot.mul(4 * gain / 1.6)));
    mat.colorNode = varying(glow);
    const size = hash(instanceIndex.add(55)).mul(0.012).add(0.006);
    mat.scaleNode = size.mul(vis).mul(hot.add(1)).mul(this.smallU).mul(float(1).sub(decayU.mul(0.5)));
    mat.opacityNode = float(1).sub(smoothstep(0.15, 0.5, length(uv().sub(0.5)))).mul(varying(vis));
    const sprite = (this.dust = new THREE.Sprite(mat));
    sprite.count = N;
    sprite.frustumCulled = false;
    root.add(sprite);
  }

  async compile() {
    await this.g.compile(this.scene, this.camera, [this.dustCompute]);
  }

  resize(w, h) {
    this.camDU.value = frameCamera(this.camera, w, h);
    this.camHU.value = this.camera.position.y - GEOM.floorY;
    // Rendered pixels per world unit, against a desktop window's (about 140). On a phone, or at a
    // low render scale, a planet is only some 30 pixels wide: motes are drawn bigger there and the
    // faint shades show more of their pixels, or neither would read.
    const unit = 0.34 * Math.min(0.58 * Math.min(w, h), 540) * this.renderer.getPixelRatio();
    this.small = Math.min(2.3, Math.max(1, 140 / unit));
    this.smallU.value = this.small;
  }

  // Stage A → B: the wheel becomes visible. The pre-loader's flat dots turn to dust where they stand
  // (see #intro), the ring leans back and the reflection fades up.
  handoff(now) {
    this.handoffAt ??= now;
  }

  // A hit: everything spirals into the hub and vanishes. Returns the duration.
  collapse(now) {
    this.decayAt ??= now;
    return LOADER.decay;
  }

  // The first hop's dust comes from the pre-loader's dots as they were when the clock started: up
  // to six of them, from the first planet's station back along the ring.
  #intro() {
    const period = SPIRAL.period * (this.reduced ? 2 : 1);
    const N = ORBIT.stations;
    const size = [];
    for (let j = 0; j < 6; j++) size.push(spiralScale((((this.clock.first - j) % N) + N) % N, this.clock.t0, period));
    const total = size.reduce((s, v) => s + v * v, 0);
    if (total < 1e-4) return; // no dot was showing: the dust starts at the first station
    let sum = 0;
    for (let j = 0; j < 5; j++) {
      sum += (size[j] * size[j]) / total;
      this.introCdf.array[j] = sum;
    }
    for (let j = 0; j < 6; j++) this.introSize.array[j] = size[j];
  }

  // Put everything where the wheel's clock says.
  #pose(now) {
    const { clock, ring } = this;
    const started = clock.started;
    if (started !== this.wasStarted) {
      this.wasStarted = started;
      this.prevW = null;
      this.#intro();
    }
    const w = started ? clock.at(now) : SHOWCASE;
    // the surface morphs on a softer clock, so a planet still looks alive when the wheel all but stalls
    const soft = started ? 0.35 * clock.real(now) * clock.rate + 0.65 * w : SHOWCASE;
    const reset = this.prevW === null;
    const dtw = reset ? 0 : Math.min(0.05, Math.max(0, w - this.prevW));
    this.prevW = w;
    const L = layout(w, started ? clock.first : 0);

    const hk = this.handoffAt === null ? 0 : clamp01((now - this.handoffAt) / 0.6);
    const dk = this.decayAt === null ? 0 : clamp01((now - this.decayAt) / LOADER.decay);
    const pull = 1 - dk * dk;
    const swirl = -1.8 * Math.PI * dk * dk;
    const shrink = Math.max(0.001, (1 - dk) ** 0.7);
    const cs = Math.cos(swirl);
    const sn = Math.sin(swirl);
    const place = (obj, p, r) => {
      obj.position.set((p[0] * cs - p[1] * sn) * pull, (p[0] * sn + p[1] * cs) * pull, p[2] * pull);
      obj.scale.setScalar(Math.max(0.0005, r));
    };

    for (const m of ring.solids) m.visible = false;
    for (const m of ring.shades) m.visible = false;
    for (const p of L.planets) {
      const m = ring.solids[p.i];
      const d = m.userData;
      m.visible = true;
      place(m, p.pos, p.r * shrink);
      m.rotation.z = -(p.angle + Math.PI / 2); // into its station's frame: x forward along the ring
      if (p.u < ORBIT.seams) d.surfaceT = soft; // the surface freezes at the burst: a piece keeps its patch
      d.life.set(p.heat, p.u, d.life.z, d.surfaceT * (0.4 + 0.08 * p.i) + stationAngle(p.i));
      d.aux.set(0, d.surfaceT, this.reduced ? 0.4 * innerGlow(p.u) : innerGlow(p.u), 0);
    }
    for (const s of L.shades) {
      const m = ring.shades[s.i];
      const d = m.userData;
      const a = stationAngle(s.i);
      m.visible = true;
      place(m, onRing(a), GEOM.stationR * shrink);
      m.rotation.z = -(a + Math.PI / 2);
      const t = s.remnant ? ring.solids[s.i].userData.surfaceT : soft; // the old planet as it was when it burst
      d.life.set(0, -1, d.life.z, t * (0.4 + 0.08 * s.i) + a);
      d.aux.set(Math.min(0.4, ORBIT.shade * this.small) * s.strength, t, 0, 0);
    }
    place(this.blast, L.blast.pos, 1);
    this.blast.intensity = this.reduced ? 0 : BLAST * L.blast.power * (1 - dk);

    this.hU.value = L.h;
    this.dtU.value = dtw;
    this.tU.value = soft;
    this.firstU.value = started ? clock.first : 0;
    this.decayU.value = dk * dk;
    this.resetU.value = reset ? 1 : 0;
    if (!this.reduced) ring.frame.value = (ring.frame.value + 7919) % 100003; // the shades' grain shimmers
    this.mirrorU.value = hk;
    this.root.rotation.x = HERO_TILT * smooth(this.handoffAt === null ? 0 : clamp01((now - this.handoffAt) / 1.0));
  }

  render(now) {
    this.#pose(now);
    this.renderer.compute(this.dustCompute);
    this.pipeline.render();
  }

  dispose() {
    this.pipeline.dispose();
    this.scene.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
  }
}
