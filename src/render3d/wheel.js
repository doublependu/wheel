// The SUPER wheel of death: a giant rainbow pinwheel rendered like a product shot.
// Clearcoat candy segments, a dispersive glass dome, an iridescent ring, an anisotropic brushed
// hub, image-based lighting, GPU-compute sparkles and a full post chain (TRAA, motion blur,
// bloom, film grain). On start it gets "crunched" down to 1-bit pixels.
import * as THREE from 'three/webgpu';
import {
  pass, mrt, output, velocity, uniform, screenUV, screenSize, floor, vec2, vec3, vec4, float, mix, dot, fract, sin, cos,
  renderOutput, convertToTexture, Fn, color, instancedArray, instanceIndex, hash, smoothstep, length, clamp, luminance,
  step, atan, int, positionWorld, reflector,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { motionBlur } from 'three/addons/tsl/display/MotionBlur.js';
import { film } from 'three/addons/tsl/display/FilmNode.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const RAINBOW = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#007aff', '#5856d6', '#af52de', '#ff2d55', '#ff5e3a'];

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

export class Wheel {
  constructor(g) {
    this.g = g;
    this.renderer = g.renderer;
    this.t = g.tierSettings;
    this.spin = 0;
    this.spinSpeed = 5.4;
    this.progress = uniform(0);
    this.crunch = uniform(0);
    this.crunchStart = 0;
    this.crunchDur = 0;
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    this.#build();
    window.addEventListener('pointermove', (e) => {
      this.pointer.tx = (e.clientX / innerWidth - 0.5) * 2;
      this.pointer.ty = (e.clientY / innerHeight - 0.5) * 2;
    });
  }

  #build() {
    const { renderer } = this;
    const scene = (this.scene = new THREE.Scene());
    scene.backgroundNode = mix(color('#24243c'), color('#020205'), smoothstep(0.0, 1.0, length(screenUV.sub(vec2(0.5, 0.4)).mul(vec2(1.5, 1)))));
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.45;

    const camera = (this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60));
    camera.position.set(0, 1.0, 7.4);

    const wheel = (this.wheel = new THREE.Group());
    wheel.position.set(0, 1.45, 0);
    scene.add(wheel);
    const spinner = (this.spinner = new THREE.Group());
    wheel.add(spinner);

    // candy segments
    this.segMats = [];
    const N = RAINBOW.length;
    const gap = 0.018;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2 + gap;
      const a1 = ((i + 1) / N) * Math.PI * 2 - gap;
      const s = new THREE.Shape();
      s.absarc(0, 0, 1, a0, a1, false);
      s.absarc(0, 0, 0.22, a1, a0, true);
      s.closePath();
      const geo = new THREE.ExtrudeGeometry(s, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.025, bevelSegments: 5, curveSegments: 32 });
      geo.translate(0, 0, -0.07);
      const mat = new THREE.MeshPhysicalNodeMaterial({
        color: RAINBOW[i], roughness: 0.32, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04,
        emissive: new THREE.Color(RAINBOW[i]), emissiveIntensity: 0,
      });
      this.segMats.push(mat);
      const m = new THREE.Mesh(geo, mat);
      spinner.add(m);
    }
    // glass dome (dispersive transmission on capable tiers)
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1.04, 96, 48, 0, Math.PI * 2, 0, Math.PI / 2),
      this.t.transmission
        ? new THREE.MeshPhysicalNodeMaterial({ transmission: 1, thickness: 0.5, ior: 1.5, dispersion: 5, roughness: 0.02, metalness: 0, clearcoat: 1, color: '#ffffff' })
        : new THREE.MeshPhysicalNodeMaterial({ transparent: true, opacity: 0.05, roughness: 0.03, metalness: 0, color: '#ffffff', depthWrite: false }),
    );
    dome.rotation.x = Math.PI / 2;
    dome.scale.set(1, 0.24, 1);
    dome.position.z = 0.1;
    wheel.add(dome);
    // brushed anisotropic hub + chrome rim + iridescent ring
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 0.32, 64),
      new THREE.MeshPhysicalNodeMaterial({ color: '#d8d8de', metalness: 1, roughness: 0.3, anisotropy: 0.9, clearcoat: 0.6 }),
    );
    hub.rotation.x = Math.PI / 2;
    spinner.add(hub);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.045, 24, 160), new THREE.MeshPhysicalNodeMaterial({ color: '#f4f4f8', metalness: 1, roughness: 0.12 }));
    wheel.add(rim);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.3, 0.03, 16, 96),
      new THREE.MeshPhysicalNodeMaterial({ color: '#202024', metalness: 1, roughness: 0.15, iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [200, 600] }),
    );
    ring.position.z = 0.1;
    spinner.add(ring);

    // glossy studio floor
    // glossy black floor: a planar reflection of the wheel (unlit, so no environment glare)
    const fade = float(1).sub(smoothstep(0.8, 4.2, length(positionWorld.xz)));
    const floorMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    if (this.t.shadows) {
      const reflection = reflector({ resolutionScale: 0.35 });
      reflection.target.rotateX(-Math.PI / 2);
      scene.add(reflection.target);
      floorMat.colorNode = reflection.rgb.mul(0.13).add(color('#040406'));
    } else floorMat.colorNode = color('#040406');
    floorMat.opacityNode = fade;
    const floor0 = new THREE.Mesh(new THREE.CircleGeometry(10, 64), floorMat);
    floor0.rotation.x = -Math.PI / 2;
    scene.add(floor0);

    // lights
    const key = new THREE.SpotLight('#fff3e0', 34, 20, 0.32, 0.8, 1.6);
    key.position.set(-3.5, 6, 4.5);
    key.target.position.set(0, 1, 0);
    scene.add(key, key.target);
    const rimL = new THREE.DirectionalLight('#7aa8ff', 2.2);
    rimL.position.set(4, 3, -4);
    scene.add(rimL);

    // GPU-compute sparkles orbiting the wheel (WebGPU only)
    const count = this.renderer.backend.isWebGPUBackend ? this.t.sparkles : 0;
    if (count) {
      const pos = instancedArray(count, 'vec3');
      const seed = instancedArray(count, 'vec3');
      this.dtU = uniform(0);
      this.initSparkles = Fn(() => {
        const i = instanceIndex;
        const a = hash(i).mul(Math.PI * 2);
        const r = hash(i.add(7)).mul(0.9).add(1.15);
        pos.element(i).assign(vec3(cos(a).mul(r), sin(a).mul(r), hash(i.add(13)).sub(0.5).mul(0.8)));
        seed.element(i).assign(vec3(hash(i.add(3)), hash(i.add(5)), hash(i.add(11))));
      })().compute(count);
      this.updateSparkles = Fn(() => {
        const i = instanceIndex;
        const p = pos.element(i);
        const s = seed.element(i);
        const r = length(p.xy);
        const a = atan(p.y, p.x).add(this.dtU.mul(s.x.mul(0.8).add(0.4)));
        const rr = r.add(sin(a.mul(3).add(s.y.mul(20))).mul(0.002));
        p.assign(vec3(cos(a).mul(rr), sin(a).mul(rr), p.z));
      })().compute(count);
      const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      mat.positionNode = pos.toAttribute();
      const sd = seed.toAttribute();
      mat.scaleNode = sd.z.mul(0.025).add(0.008);
      const tw = sin(sd.y.mul(100).add(this.dtU.mul(0))).mul(0.5).add(0.5);
      mat.colorNode = vec4(mix(vec3(1.0, 0.85, 0.6), vec3(0.6, 0.8, 1.0), sd.x).mul(tw.mul(2).add(1).mul(this.progress.mul(2).add(1))), 1);
      const sprites = new THREE.Sprite(mat);
      sprites.count = count;
      sprites.frustumCulled = false;
      wheel.add(sprites);
      this.sparklesReady = false;
    }

    this.#buildPipeline();
  }

  #buildPipeline() {
    const { renderer, scene, camera, t } = this;
    const pipeline = (this.pipeline = new THREE.RenderPipeline(renderer));
    pipeline.outputColorTransform = false;
    const scenePass = pass(scene, camera);
    scenePass.setMRT(mrt({ output, velocity }));
    let col = scenePass.getTextureNode('output');
    const vel = scenePass.getTextureNode('velocity');
    const depth = scenePass.getTextureNode('depth');
    let out = col;
    if (t.traa) out = traa(out, depth, vel, camera);
    if (t.motionBlur) out = motionBlur(out, vel.mul(0.6), int(10));
    out = out.add(bloom(out, 0.22, 0.3, 1.1));
    let srgb = renderOutput(out);
    if (!t.traa) srgb = fxaa(srgb);
    srgb = film(srgb, float(0.03));
    pipeline.outputNode = crunchNode(srgb, this.crunch);
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    // keep the wheel a similar size in portrait and landscape
    this.camera.fov = w / h < 1 ? 30 / Math.max(0.55, w / h) : 30;
    this.camera.updateProjectionMatrix();
  }

  setProgress(p) {
    this.targetProgress = p;
  }

  startCrunch(start, dur) {
    this.crunchStart = start;
    this.crunchDur = dur;
  }

  render(now, dt) {
    const { renderer } = this;
    if (this.initSparkles && !this.sparklesReady) {
      renderer.compute(this.initSparkles);
      this.sparklesReady = true;
    }
    if (this.updateSparkles) {
      this.dtU.value = dt;
      renderer.compute(this.updateSparkles);
    }
    const crunching = this.crunchDur > 0;
    const k = crunching ? Math.min(1, (now - this.crunchStart) / this.crunchDur) : 0;
    this.crunch.value = k;
    this.spinSpeed = crunching ? 5.4 + k * 14 : 5.4;
    this.spin -= this.spinSpeed * dt;
    this.spinner.rotation.z = this.spin;
    const p = this.pointer;
    p.x += (p.tx - p.x) * Math.min(1, dt * 3);
    p.y += (p.ty - p.y) * Math.min(1, dt * 3);
    this.wheel.rotation.y = p.x * 0.35;
    this.wheel.rotation.x = p.y * 0.2;
    this.wheel.position.y = 1.45 + Math.sin(now * 1.3) * 0.03;
    this.camera.position.set(Math.sin(now * 0.2) * 0.4, 1.0, 7.4);
    this.camera.lookAt(0, 1.2, 0);
    const prog = (this.progressValue = (this.progressValue ?? 0) + ((this.targetProgress ?? 0) - (this.progressValue ?? 0)) * Math.min(1, dt * 2));
    this.progress.value = prog;
    this.segMats.forEach((m, i) => {
      const lit = Math.min(1, Math.max(0, prog * this.segMats.length - i));
      m.emissiveIntensity = lit * 0.35 + 0.15 * Math.max(0, Math.sin(now * 3 - i * 0.6)) * lit;
    });
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
