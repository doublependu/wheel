// The fancy loading wheel (stage B): the loading-ui.com Spiral and Twin Orbit spinners as a little
// solar system over a black mirror. A star at the hub with two twins circling it (Twin Orbit), and
// eight ring planets that form, mature and crumble in a clockwise wave (Spiral) while their dust,
// simulated on the GPU, flies on to the planets forming ahead. Motion: src/loader/orbitPhysics.js.
// Bodies and their materials: bodies.js. No bloom: the star is bright HDR under tone mapping.
import * as THREE from 'three/webgpu';
import {
  Fn, If, pass, uniform, uniformArray, instancedArray, instanceIndex, float, vec2, vec3, vec4, mix,
  smoothstep, sin, cos, mod, hash, length, uv, renderOutput, screenCoordinate, positionWorld, reflector, mx_noise_vec3, int,
} from 'three/tsl';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { film } from 'three/addons/tsl/display/FilmNode.js';
import { layout, hitchLag, clockFor, dustPlan, GEOM, stationAngle } from '../loader/orbitPhysics.js';
import { makeStar, makeIce, makeMercury, makeRing, bodyTier, LOOK_COLORS } from './bodies.js';
import { frameCamera } from './wheel.js';
import { createRng } from '../sim/rng.js';
import { LOADER } from '../config.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => x * x * (3 - 2 * x);
const backOut = (x) => 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2;
const DUST = { low: 512, medium: 2048, high: 8192, ultra: 24576 };
const HERO_TILT = -0.14; // the ring leans back a little once it has taken over from the flat dots
const LIGHT = 5;

export class Orbit {
  constructor(g) {
    this.g = g;
    this.renderer = g.renderer;
    this.t = g.tierSettings;
    this.bt = bodyTier(this.t);
    this.clock = clockFor(matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.hitches = [];
    this.handoffAt = null;
    this.decayAt = null;
    this.prevTw = null;
    this.#build();
  }

  #build() {
    const { renderer, bt } = this;
    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color('#000000');
    scene.environment = this.g.studioEnv();
    scene.environmentIntensity = 0.7;
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 80);

    const root = (this.root = new THREE.Group());
    scene.add(root);

    // Twin Orbit: the star (and the light) at the hub, the twins around it
    this.star = makeStar(bt);
    this.ice = makeIce(bt, scene.environment);
    this.mercury = makeMercury(bt, scene.environment);
    root.add(this.star.mesh, this.ice.mesh, this.mercury.mesh);
    const light = (this.light = new THREE.PointLight('#ffe2b8', LIGHT, 0, 1)); // falls off as 1/d: the physics is a bit different
    light.castShadow = bt.shadows;
    if (light.castShadow) {
      light.shadow.mapSize.set(512, 512);
      light.shadow.bias = -0.002;
      light.shadow.normalBias = 0.01;
      light.shadow.camera.near = GEOM.starR * 1.1;
      light.shadow.camera.far = 4;
    }
    root.add(light);
    // the star's corona: a soft camera-facing glow drawn behind it (in the scene, not a bloom pass)
    const coronaMat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const r = length(uv().sub(0.5)).mul(2);
    coronaMat.colorNode = vec3(1.0, 0.62, 0.28).mul(0.55);
    coronaMat.opacityNode = float(1).sub(r).max(0).pow(2.6);
    this.corona = new THREE.Sprite(coronaMat);
    root.add(this.corona);
    const rim = new THREE.DirectionalLight('#8fb2ff', 0.7);
    rim.position.set(2.5, 3, -4);
    scene.add(rim);

    // Spiral: eight ring planets
    this.ring = makeRing(bt);
    for (const m of this.ring.meshes) root.add(m);

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
    const floor0 = new THREE.Mesh(new THREE.CircleGeometry(6, 64), floorMat);
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

  // Dust: each mote leaves a crumbling ring planet and flies 1–4 stations clockwise into one that is
  // forming (orbitPhysics.dustPlan). A compute pass springs it after its guide path, which dips
  // toward the hub and corkscrews round the track, plus a little noise.
  #buildDust(root) {
    const N = DUST[this.t.name];
    const plan = instancedArray(N, 'vec4');
    plan.value.array.set(dustPlan(N, createRng(5), this.clock));
    const posB = instancedArray(N, 'vec3');
    const velB = instancedArray(N, 'vec3');
    const stateB = instancedArray(N, 'vec2'); // cycle time at the last step, visibility
    for (let i = 0; i < N; i++) stateB.value.array[i * 2] = -1;
    this.tU = uniform(0);
    this.dtU = uniform(0);
    this.decayU = uniform(0);
    const T = this.clock.ringPeriod;
    const STEP = (Math.PI * 2) / this.clock.stations;
    const R = GEOM.ringR;
    const { tU, dtU, decayU } = this;
    this.dustCompute = Fn(() => {
      const i = instanceIndex;
      const pl = plan.element(i);
      const P = posB.element(i);
      const V = velB.element(i);
      const S = stateB.element(i);
      const c = mod(tU.sub(pl.y), T).toVar();
      const f = c.div(pl.z).toVar();
      const s1 = hash(i.add(7919));
      const s2 = hash(i.add(104729));
      const s3 = hash(i.add(31337));
      const a = pl.x.add(pl.w.mul(smoothstep(0, 1, f))).mul(STEP);
      const arc = sin(f.mul(Math.PI));
      const dip = arc.mul(s1.mul(0.16).add(0.05));
      const hel = f.mul(Math.PI * 3).mul(s2.sub(0.5).mul(2)).add(s1.mul(Math.PI * 2));
      const hr = arc.mul(0.075).mul(s2.add(0.3));
      const rr = float(R).mul(float(1).sub(dip)).add(cos(hel).mul(hr));
      const guide = vec3(cos(a).mul(rr), sin(a).negate().mul(rr), sin(hel).mul(hr).mul(1.6));
      const off = vec3(s1.sub(0.5), s2.sub(0.5), s3.sub(0.5)).normalize().mul(GEOM.stationR * 0.55).mul(float(1).sub(f).pow(3));
      const target = guide.add(off).mul(float(1).sub(decayU)).toVar();
      If(f.lessThan(1), () => {
        // a new flight (the cycle wrapped since the last step): start on the source planet
        If(c.lessThan(S.x), () => {
          P.assign(target);
          V.assign(vec3(0));
        });
        const acc = target.sub(P).mul(70).sub(V.mul(9)).add(mx_noise_vec3(P.mul(4).add(tU)).mul(1.5));
        V.addAssign(acc.mul(dtU));
        P.addAssign(V.mul(dtU));
        S.assign(vec2(c, arc.pow(0.6)));
      }).Else(() => {
        S.assign(vec2(c, float(0)));
      });
    })().compute(N);

    const tints = uniformArray(LOOK_COLORS.map((h) => new THREE.Color(h)), 'color');
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    mat.positionNode = posB.toAttribute();
    const vis = stateB.toAttribute().y;
    const size = hash(instanceIndex.add(55)).mul(0.012).add(0.006);
    mat.scaleNode = size.mul(vis).mul(float(1).sub(this.decayU.mul(0.5)));
    const tint = mix(tints.element(int(plan.toAttribute().x)), vec3(1, 0.93, 0.8), 0.35);
    mat.colorNode = tint.mul(1.6);
    mat.opacityNode = float(1).sub(smoothstep(0.15, 0.5, length(uv().sub(0.5)))).mul(vis);
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
  }

  // The wheel's own clock: real time minus the lag of any hitch in progress.
  #time(now) {
    // a longer freeze catches up over longer, so the clock never runs backwards
    const catchUp = (h) => Math.max(0.4, h.freeze * 1.2);
    this.hitches = this.hitches.filter((h) => now - h.at < h.freeze + catchUp(h));
    return this.hitches.reduce((tw, h) => tw - hitchLag(now - h.at, h.freeze, catchUp(h)), now);
  }

  // Stage A → B: the ring takes over from the flat dots, the star and twins condense out of the hub.
  handoff(now) {
    this.handoffAt ??= now;
  }

  // A missed attempt: freeze for a moment (longer if the page really was busy), then catch up.
  hitch(now, freeze = LOADER.hitch) {
    this.hitches.push({ at: now, freeze });
  }

  // A hit: everything spirals into the star, which then shrinks to a point. Returns the duration.
  collapse(now) {
    this.decayAt ??= now;
    return LOADER.decay;
  }

  render(now) {
    const tw = this.#time(now);
    const dtw = this.prevTw === null ? 0 : Math.min(0.05, Math.max(0, tw - this.prevTw));
    this.prevTw = tw;
    const L = layout(tw, this.clock);
    const hk = this.handoffAt === null ? 0 : clamp01((now - this.handoffAt) / 0.6);
    const grow = Math.max(0.001, hk >= 1 ? 1 : backOut(hk));
    const dk = this.decayAt === null ? 0 : clamp01((now - this.decayAt) / LOADER.decay);
    const pull = 1 - dk * dk;
    const swirl = -1.8 * Math.PI * dk * dk;
    const shrink = Math.max(0.001, (1 - dk) ** 0.7);
    const place = (obj, p, r) => {
      const cs = Math.cos(swirl);
      const sn = Math.sin(swirl);
      obj.position.set((p[0] * cs - p[1] * sn) * pull, (p[0] * sn + p[1] * cs) * pull, p[2] * pull);
      obj.scale.setScalar(Math.max(0.0005, r));
    };
    const tideU = (U, tides, r) => tides.forEach((td, k) => U.tides[k].value.set(td.dir[0], td.dir[1], td.dir[2], td.amp / r));

    // star
    const starGone = 1 - smooth(clamp01((dk - 0.55) / 0.45));
    place(this.star.mesh, L.star.pos, L.star.r * grow * starGone);
    this.star.U.t.value = tw;
    this.star.U.spin.value = tw * 0.25;
    tideU(this.star.U, L.star.tides, L.star.r);
    this.light.intensity = LIGHT * starGone * Math.min(1, 0.25 + hk);
    this.corona.scale.setScalar(L.star.r * 5.5 * grow * starGone);

    // twins
    for (const [k, body] of [this.ice, this.mercury].entries()) {
      const tw0 = L.twins[k];
      place(body.mesh, tw0.pos, tw0.r * grow * shrink);
      body.U.t.value = tw;
      body.U.spin.value = tw * (k ? -0.9 : 0.7);
      tideU(body.U, tw0.tides, tw0.r);
    }
    this.ice.U.amp.value = 0.05 + 0.03 * Math.sin(tw * 0.9);

    // ring
    this.ring.U.t.value = tw;
    L.stations.forEach((s, i) => {
      const m = this.ring.meshes[i];
      m.visible = s.r > 0.002;
      place(m, s.pos, s.r * shrink);
      m.userData.life.set(s.heat, s.crack, m.userData.life.z, tw * (0.4 + 0.08 * i) + stationAngle(i));
      const td = s.tides[0];
      m.userData.tide.set(td.dir[0], td.dir[1], td.dir[2], s.r > 0 ? td.amp / s.r : 0);
    });

    // dust, mirror and the hero lean
    this.tU.value = tw;
    this.dtU.value = dtw;
    this.decayU.value = dk * dk;
    this.renderer.compute(this.dustCompute);
    this.mirrorU.value = hk;
    this.root.rotation.x = HERO_TILT * smooth(this.handoffAt === null ? 0 : clamp01((now - this.handoffAt) / 1.0));
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
