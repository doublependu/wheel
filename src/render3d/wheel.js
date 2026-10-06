// The SUPER donut: the loading wheel as a studio product shot. A lacquered rainbow torus with
// engraved segment grooves, a ring of anodized-aluminium bars that rise around it (a progress ring
// while loading, then a travelling wave), soft studio lighting from a procedural softbox
// environment, real shadows and a satin floor. No bloom: highlights come from the lighting.
// On start it gets "crunched" down to 1-bit pixels.
import * as THREE from 'three/webgpu';
import {
  pass, mrt, output, velocity, normalView, directionToColor, colorToDirection, uniform, uniformArray, screenUV, screenSize,
  floor, vec2, vec3, vec4, float, mix, dot, fract, renderOutput, convertToTexture, Fn, color, smoothstep, length, clamp,
  luminance, step, atan, int, positionLocal, positionWorld, reflector, uv, min, mx_noise_float, hash, screenCoordinate, sample,
} from 'three/tsl';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { film } from 'three/addons/tsl/display/FilmNode.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { WHEEL } from '../config.js';

export const RAINBOW = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#007aff', '#5856d6', '#af52de', '#ff2d55', '#ff5e3a'];

// Donut proportions (world units). The ring's outer edge is 1.0; bars start just outside it.
const R = 0.82;
const TUBE = 0.18;
const BAR_R = 1.05;
const BAR_MAX = 0.42;
const FLOOR_Y = -1.75;

// Pixelate, posterize and finally threshold to 1-bit as `amount` goes 0 → 1.
export const crunchNode = (input, amount) =>
  Fn(() => {
    const tex = convertToTexture(input);
    const px = mix(float(1), float(48), amount.mul(amount));
    const cell = floor(screenUV.mul(screenSize).div(px));
    const uvq = cell.add(0.5).mul(px).div(screenSize);
    const c = tex.sample(uvq).rgb.toVar();
    const levels = mix(float(64), float(2), clamp(amount.mul(1.4), 0, 1));
    const d = fract(dot(cell, vec2(0.5, 0.25)).add(fract(cell.y.mul(0.5)).mul(0.5))).sub(0.5);
    const q = floor(c.mul(levels).add(d.mul(amount))).div(levels.sub(1).max(1));
    const mono = step(0.45, luminance(c).add(d.mul(0.4)));
    const oneBit = mix(vec3(0.051), vec3(0.949), mono);
    const keep = amount.lessThan(0.001);
    const res = mix(q, oneBit, smoothstep(0.7, 0.95, amount));
    return vec4(keep.select(c, res), 1);
  })();

// A photo studio as an environment map: dark walls, a big overhead softbox, a strip light and a
// warm bounce card. Rendered once into a PMREM, so it costs no download.
function studioEnvironment(renderer) {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(20, 12, 20), new THREE.MeshBasicMaterial({ color: '#16161c', side: THREE.BackSide }));
  room.position.y = 4;
  env.add(room);
  const panel = (w, h, c, intensity, pos, look) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.lookAt(...look);
    env.add(m);
  };
  panel(7, 4, '#fff6ea', 9, [-3, 8, 4], [0, 0, 0]); // key softbox, upper left front
  panel(1.2, 9, '#dfe9ff', 7, [7, 3, -3], [0, 1, 0]); // strip light, right back (rim)
  panel(5, 3, '#ffd9b0', 1.6, [-8, 1, -2], [0, 1, 0]); // warm bounce card
  panel(9, 2, '#ffffff', 1.2, [0, 3, -9.5], [0, 2, 0]); // background sweep glow
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
  return tex;
}

export class Wheel {
  constructor(g) {
    this.g = g;
    this.renderer = g.renderer;
    this.t = g.tierSettings;
    this.spin = 0;
    this.crunch = uniform(0);
    this.crunchStart = 0;
    this.crunchDur = 0;
    this.targetProgress = 0;
    this.ready = false;
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    this.bars = this.t.name === 'low' ? 48 : this.t.name === 'ultra' ? 96 : 64;
    this.h = new Float32Array(this.bars).fill(0.03);
    this.v = new Float32Array(this.bars);
    this.#build();
    window.addEventListener('pointermove', (e) => {
      this.pointer.tx = (e.clientX / innerWidth - 0.5) * 2;
      this.pointer.ty = (e.clientY / innerHeight - 0.5) * 2;
    });
  }

  #build() {
    const { renderer, t } = this;
    const scene = (this.scene = new THREE.Scene());
    scene.backgroundNode = mix(color('#26263a'), color('#030306'), smoothstep(0.0, 1.0, length(screenUV.sub(vec2(0.5, 0.42)).mul(vec2(1.5, 1)))));
    scene.environment = studioEnvironment(renderer);
    scene.environmentIntensity = 0.85;

    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 80);

    const donut = (this.donut = new THREE.Group());
    donut.rotation.x = -0.26; // tilted back like a product shot
    scene.add(donut);
    const spinner = (this.spinner = new THREE.Group());
    donut.add(spinner);

    // ---- the ring: one torus, rainbow lacquer by angle with engraved grooves between segments ----
    const N = RAINBOW.length;
    const seg = atan(positionLocal.y, positionLocal.x).div(Math.PI * 2).add(0.5).mul(N);
    const segId = floor(seg);
    const edge = min(fract(seg), float(1).sub(fract(seg)));
    const groove = float(1).sub(smoothstep(0.004, 0.02, edge));
    const palette = uniformArray(RAINBOW.map((c) => new THREE.Color(c)), 'color');
    const smudge = mx_noise_float(positionLocal.mul(7)).mul(0.5).add(0.5);
    const ringMat = new THREE.MeshPhysicalNodeMaterial({ metalness: 0, clearcoat: 1 });
    ringMat.colorNode = mix(palette.element(int(segId).mod(N)), vec3(0.02), groove.mul(0.85));
    ringMat.roughnessNode = mix(float(0.3).add(smudge.mul(0.12)), float(0.75), groove);
    ringMat.clearcoatRoughnessNode = float(0.04).add(smudge.mul(0.06)).add(groove.mul(0.4));
    this.glow = uniform(0); // lifts the lacquer a touch while loading completes
    ringMat.emissiveNode = ringMat.colorNode.mul(this.glow);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R, TUBE, t.name === 'low' ? 32 : 48, t.name === 'low' ? 120 : 200), ringMat);
    ring.castShadow = ring.receiveShadow = t.shadows > 0;
    spinner.add(ring);

    // ---- bars: anodized brushed aluminium, one instanced draw, tinted by angle ----
    const barGeo = new RoundedBoxGeometry(0.07, 1, 0.12, 2, 0.025);
    barGeo.translate(0, 0.5, 0);
    const barMat = new THREE.MeshPhysicalNodeMaterial({ metalness: 0.85, roughness: 0.3, anisotropy: 0.7, clearcoat: 0.4, clearcoatRoughness: 0.15 });
    const bars = (this.barMesh = new THREE.InstancedMesh(barGeo, barMat, this.bars));
    bars.castShadow = bars.receiveShadow = t.shadows > 0;
    bars.frustumCulled = false;
    for (let i = 0; i < this.bars; i++) {
      // clockwise from 12 o'clock, coloured like the ring segment beside it
      const a = Math.PI / 2 - (i / this.bars) * Math.PI * 2;
      const u = ((a / (Math.PI * 2) + 0.5) % 1 + 1) % 1;
      bars.setColorAt(i, new THREE.Color(RAINBOW[Math.floor(u * N) % N]));
    }
    this.barAngles = Array.from({ length: this.bars }, (_, i) => Math.PI / 2 - (i / this.bars) * Math.PI * 2);
    spinner.add(bars);
    this.#placeBars();

    // ---- floor: dark satin with a soft blurred reflection and a contact shadow ----
    const floorMat = new THREE.MeshPhysicalNodeMaterial({ color: '#08080c', roughness: 0.5, metalness: 0, specularIntensity: 0.3 });
    const fade = float(1).sub(smoothstep(1.0, 5.0, length(positionWorld.xz)));
    if (t.shadows) {
      const reflection = reflector({ resolutionScale: 0.35, generateMipmaps: true });
      reflection.target.rotateX(-Math.PI / 2);
      reflection.target.position.y = FLOOR_Y;
      scene.add(reflection.target);
      floorMat.emissiveNode = reflection.level(2.5).rgb.mul(0.16).mul(fade);
    }
    floorMat.opacityNode = fade;
    floorMat.transparent = true;
    const floor0 = new THREE.Mesh(new THREE.CircleGeometry(9, 64), floorMat);
    floor0.rotation.x = -Math.PI / 2;
    floor0.position.y = FLOOR_Y;
    floor0.receiveShadow = t.shadows > 0;
    scene.add(floor0);
    const blobMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, color: '#000000' });
    const r = length(uv().sub(0.5)).mul(2);
    blobMat.opacityNode = float(1).sub(smoothstep(0.0, 1.0, r)).pow(2).mul(0.55);
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.6), blobMat);
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = FLOOR_Y + 0.002;
    scene.add(blob);

    // ---- lights: key spot (shadows), cool rim ----
    const key = (this.key = new THREE.SpotLight('#fff3e0', 60, 30, 0.42, 0.85, 1.6));
    key.position.set(-4, 7, 6);
    key.target.position.set(0, -0.3, 0);
    key.castShadow = t.shadows > 0;
    if (key.castShadow) {
      key.shadow.mapSize.set(Math.min(2048, t.shadows), Math.min(2048, t.shadows));
      key.shadow.bias = -0.0004;
      key.shadow.normalBias = 0.02;
      key.shadow.radius = 4;
      key.shadow.camera.near = 4;
      key.shadow.camera.far = 20;
    }
    scene.add(key, key.target);
    const rimL = new THREE.DirectionalLight('#9cbcff', 1.6);
    rimL.position.set(5, 3, -5);
    scene.add(rimL);

    this.#buildPipeline();
  }

  // Bar transforms from the current spring heights.
  #placeBars() {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const z = new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < this.bars; i++) {
      const a = this.barAngles[i];
      q.setFromAxisAngle(z, a - Math.PI / 2);
      p.set(Math.cos(a) * BAR_R, Math.sin(a) * BAR_R, 0);
      s.set(1, Math.max(0.02, this.h[i]), 1);
      m.compose(p, q, s);
      this.barMesh.setMatrixAt(i, m);
    }
    this.barMesh.instanceMatrix.needsUpdate = true;
  }

  #buildPipeline() {
    const { renderer, scene, camera, t } = this;
    const pipeline = (this.pipeline = new THREE.RenderPipeline(renderer));
    pipeline.outputColorTransform = false;
    const scenePass = pass(scene, camera);
    scenePass.setMRT(mrt(t.ao ? { output, normal: directionToColor(normalView), velocity } : { output, velocity }));
    const depth = scenePass.getTextureNode('depth');
    const vel = scenePass.getTextureNode('velocity');
    let out = scenePass.getTextureNode('output');
    if (t.ao) {
      const normalTex = scenePass.getTextureNode('normal');
      const aoPass = ao(depth, sample((suv) => colorToDirection(normalTex.sample(suv))), camera);
      aoPass.resolutionScale = 0.5;
      out = out.mul(vec4(vec3(mix(float(1), aoPass.getTextureNode().r, 0.9)), 1));
    }
    if (t.traa) out = traa(out, depth, vel, camera);
    if (t.dof) {
      this.focusU = uniform(8);
      out = dof(out, scenePass.getViewZNode(), this.focusU, uniform(4), uniform(0.6));
    }
    let srgb = renderOutput(out);
    if (!t.traa) srgb = fxaa(srgb);
    srgb = film(srgb, float(0.025));
    // ±½ LSB of noise so the dark studio gradient doesn't band in 8-bit output
    srgb = vec4(srgb.rgb.add(hash(screenCoordinate.x.add(screenCoordinate.y.mul(4096))).sub(0.5).div(255)), 1);
    pipeline.outputNode = crunchNode(srgb, this.crunch);
  }

  // Frame the donut where the CSS donut sits (index.html: centred at 42 % height, ring outer
  // diameter = 0.68 × min(58vmin, 540px)), so the cross-fade lines up.
  resize(w, h) {
    const cam = this.camera;
    cam.aspect = w / h;
    const box = Math.min(0.58 * Math.min(w, h), 540);
    const unitPx = 0.34 * box; // css px per world unit at the donut
    const D = h / (unitPx * 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    cam.position.set(0, 0.35, D);
    cam.lookAt(0, 0, 0);
    cam.setViewOffset(w, h, 0, (0.5 - 0.42) * h, w, h);
    cam.updateProjectionMatrix();
    this.camD = D;
    if (this.focusU) this.focusU.value = D;
  }

  setProgress(p) {
    this.targetProgress = p;
  }

  setReady(r) {
    this.ready = r;
  }

  startCrunch(start, dur) {
    this.crunchStart = start;
    this.crunchDur = dur;
  }

  // Spring each bar towards its target height: a progress ring while loading, then a wave.
  #animateBars(now, dt) {
    const n = this.bars;
    const fill = Math.min(this.targetProgress, now / WHEEL.minRun);
    const crunching = this.crunchDur > 0;
    const reduced = this.reduced ??= matchMedia('(prefers-reduced-motion: reduce)').matches;
    const amp = reduced ? 0.4 : 1;
    for (let i = 0; i < n; i++) {
      const f = i / n;
      let target;
      if (crunching) target = BAR_MAX;
      else if (!this.ready) {
        const lit = f < fill;
        const lead = lit && f > fill - 1.5 / n;
        target = lit ? 0.16 + 0.05 * Math.sin(now * 5 - f * 18) * amp + (lead ? 0.18 : 0) : 0.03;
      } else {
        const w1 = Math.sin(now * 2.6 * amp - f * Math.PI * 4);
        const w2 = Math.sin(now * 4.1 * amp + f * Math.PI * 10 + Math.sin(i * 12.9898) * 3);
        target = 0.12 + (0.17 * (w1 * 0.5 + 0.5) + 0.07 * (w2 * 0.5 + 0.5)) * amp;
      }
      // critically-ish damped spring, sub-stepped for stability
      for (let k = 0; k < 2; k++) {
        const h = dt / 2;
        this.v[i] += ((target - this.h[i]) * 160 - this.v[i] * 17) * h;
        this.h[i] += this.v[i] * h;
      }
    }
    this.#placeBars();
    this.glow.value = this.ready ? 0.06 : 0.02;
  }

  render(now, dt) {
    const crunching = this.crunchDur > 0;
    const k = crunching ? Math.min(1, (now - this.crunchStart) / this.crunchDur) : 0;
    this.crunch.value = k;
    const spinSpeed = crunching ? 1.4 + k * 12 : 1.4;
    this.spin -= spinSpeed * Math.min(dt, 0.1);
    this.spinner.rotation.z = this.spin;
    this.#animateBars(now, Math.min(dt, 1 / 30));
    const p = this.pointer;
    p.x += (p.tx - p.x) * Math.min(1, dt * 3);
    p.y += (p.ty - p.y) * Math.min(1, dt * 3);
    this.donut.rotation.y = p.x * 0.25;
    this.donut.rotation.x = -0.26 + p.y * 0.12;
    this.donut.position.y = Math.sin(now * 1.3) * 0.03;
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
