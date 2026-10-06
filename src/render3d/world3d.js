// The 3D eras: 5 (PS1-style polygons), 6 (smooth PBR at dawn) and 7 (HDR sunrise), plus the
// hero transitions: 4→5 pop-out (pixels → voxels → 3D), 5→6 focus pull, 6→7 sunrise.
import * as THREE from 'three/webgpu';
import {
  pass, mrt, output, velocity, normalView, directionToColor, colorToDirection, uniform, vec2, vec3, vec4, float, mix, color,
  screenUV, screenSize, renderOutput, smoothstep, length, floor, fract, dot, max, exp, sRGBTransferOETF, texture,
  uv, attribute, int, hash, atan, cos, normalLocal,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { motionBlur } from 'three/addons/tsl/display/MotionBlur.js';
import { retroPass } from 'three/addons/tsl/display/RetroPassNode.js';
import { godrays } from 'three/addons/tsl/display/GodraysNode.js';
import { makeMaterials, makeObstacle, makeSceneryMaterials, makeTile, TILE } from './props3d.js';
import { makeCatMaterials, ProceduralCat } from './cat3d.js';
import { loadGltfCat } from './gltfCat.js';
import { PPU } from '../config.js';
import { crunchNode } from './wheel.js';

const C = (h) => new THREE.Color(h);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.min(1, Math.max(0, t));

// Look per era: sky gradient (top, horizon), fog, lights, camera rig.
const LOOK = {
  5: { top: '#07081c', mid: '#1c1a44', horizon: '#4a2f58', fog: '#1b1838', fogNear: 10, fogFar: 42, hemiSky: '#5a5aa0', hemiGround: '#141018', hemi: 1.3, sunColor: '#a8b4ff', sun: 1.6, sunDir: [-0.4, 0.9, 0.6], exposure: 1.0, stars: 1, fov: 30, yaw: 0, pitch: 0.02, distMul: 1.0, lift: 0, shadow: 0, windows: 1.2, sunElev: -0.5 },
  6: { top: '#1d3a6e', mid: '#5f86bd', horizon: '#e6c9b8', fog: '#a9b9d4', fogNear: 22, fogFar: 90, hemiSky: '#c8dcff', hemiGround: '#4a3a28', hemi: 1.6, sunColor: '#ffe6cc', sun: 2.2, sunDir: [-0.35, 0.75, 0.55], exposure: 1.0, stars: 0, fov: 36, yaw: -0.16, pitch: 0.08, distMul: 0.98, lift: 0.4, shadow: 1, windows: 0.5, sunElev: -0.05 },
  7: { top: '#2b5d9c', mid: '#8fb4d8', horizon: '#ffc58a', fog: '#f2c49a', fogNear: 30, fogFar: 140, hemiSky: '#ffe2bd', hemiGround: '#3c2c20', hemi: 1.15, sunColor: '#ffd3a1', sun: 5.0, sunDir: [-0.25, 0.32, -0.9], exposure: 1.05, stars: 0, fov: 40, yaw: -0.22, pitch: 0.05, distMul: 0.92, lift: 0.1, shadow: 1, windows: 0.15, sunElev: 0.16 },
};

export async function createWorld3D(g) {
  const w = new World3D(g);
  await w.load();
  return w;
}

class World3D {
  constructor(g) {
    this.g = g;
    this.renderer = g.renderer;
    this.tier = g.tierSettings;
    this.ready = { 5: false, 6: false, 7: false };
    this.pipelines = {};
    this.obstacleMeshes = new Map();
    this.pools = {};
    this.credits = [];
    this.transition = null;
    this.popout = null;
    this.era = 5;
    this.look = { ...LOOK[5] };
  }

  async load() {
    this.#buildScene();
    try {
      this.gltfCat = await loadGltfCat(this.catMats);
      if (this.gltfCat) {
        this.scene.add(this.gltfCat.object);
        this.gltfCat.object.visible = false;
        this.credits.push(...this.gltfCat.credits);
      }
    } catch (e) {
      console.warn('glTF cat unavailable, using the procedural cat', e);
    }
    this.resize(this.g.view);
    await this.#warmUp();
  }

  // ---------- scene ----------
  #buildScene() {
    const scene = (this.scene = new THREE.Scene());
    const camera = (this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 400));
    this.distU = uniform(0);
    // sky: screen-space gradient + stars + HDR sun glow
    this.skyTop = uniform(C(LOOK[5].top));
    this.skyMid = uniform(C(LOOK[5].mid));
    this.skyHorizon = uniform(C(LOOK[5].horizon));
    this.starsU = uniform(1);
    this.sunScreen = uniform(new THREE.Vector2(0.7, 0.2));
    this.sunGlow = uniform(0);
    this.sunColorU = uniform(C('#ffd3a1'));
    const y = screenUV.y.oneMinus();
    const sky = mix(this.skyHorizon, this.skyMid, smoothstep(0.25, 0.6, y)).toVar();
    const skyTop = mix(sky, this.skyTop, smoothstep(0.6, 1.0, y));
    const cell = floor(screenUV.mul(screenSize).div(2));
    const star = hash(cell.x.add(cell.y.mul(1931))).greaterThan(0.9975).select(float(1), float(0)).mul(smoothstep(0.45, 0.8, y));
    const d = length(screenUV.sub(this.sunScreen).mul(vec2(screenSize.x.div(screenSize.y), 1)));
    const glow = exp(d.mul(-9)).mul(this.sunGlow).add(exp(d.mul(-40)).mul(this.sunGlow).mul(4));
    scene.backgroundNode = skyTop.add(vec3(star.mul(this.starsU))).add(this.sunColorU.mul(glow));
    scene.fog = new THREE.Fog(LOOK[5].fog, LOOK[5].fogNear, LOOK[5].fogFar);

    this.hemi = new THREE.HemisphereLight(LOOK[5].hemiSky, LOOK[5].hemiGround, LOOK[5].hemi);
    scene.add(this.hemi);
    const sun = (this.sun = new THREE.DirectionalLight(LOOK[5].sunColor, LOOK[5].sun));
    sun.castShadow = this.tier.shadows > 0;
    if (sun.castShadow) {
      sun.shadow.mapSize.set(this.tier.shadows, this.tier.shadows);
      const cam = sun.shadow.camera;
      cam.left = -12;
      cam.right = 22;
      cam.top = 12;
      cam.bottom = -6;
      cam.near = 0.5;
      cam.far = 80;
      sun.shadow.bias = -0.0006;
      sun.shadow.normalBias = 0.02;
      sun.shadow.intensity = 0;
    }
    scene.add(sun, sun.target);

    // ground strip that scrolls via the distance uniform
    this.sceneryMats = makeSceneryMaterials(this.distU);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 140), this.sceneryMats.ground);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(40, 0, -40);
    ground.receiveShadow = true;
    scene.add(ground);

    // three scenery tiles that wrap around the cat
    this.tiles = [0, 1, 2].map((i) => {
      const t = makeTile(1000 + i * 17, this.sceneryMats);
      scene.add(t);
      return t;
    });

    // sun-wheel in the sky (era 7): an emissive rainbow pinwheel
    const wheelGeo = new THREE.CircleGeometry(6, 64);
    const wheelMat = new THREE.MeshBasicNodeMaterial({ fog: false });
    const p = uv().sub(0.5);
    const a = atan(p.y, p.x).div(Math.PI * 2).add(0.5);
    const seg = fract(a.mul(10).add(this.distU.mul(0.01)));
    const hue = floor(a.mul(10)).div(10);
    const rainbow = vec3(cos(hue.mul(6.283)), cos(hue.mul(6.283).add(2.09)), cos(hue.mul(6.283).add(4.19))).mul(0.5).add(0.5);
    this.sunWheelI = uniform(0);
    wheelMat.colorNode = mix(vec3(1, 0.85, 0.6), rainbow, 0.55).mul(smoothstep(0.02, 0.06, seg).mul(0.25).add(0.75)).mul(this.sunWheelI);
    this.sunWheel = new THREE.Mesh(wheelGeo, wheelMat);
    this.sunWheel.visible = false;
    scene.add(this.sunWheel);

    // obstacles and cats
    this.obMats = makeMaterials();
    this.catMats = makeCatMaterials();
    this.catLow = new ProceduralCat(this.catMats, true);
    this.catSmooth = new ProceduralCat(this.catMats, false);
    scene.add(this.catLow.object, this.catSmooth.object);
    this.catSmooth.object.visible = false;
    this.warmRT = new THREE.RenderTarget(64, 64);
  }

  #catFor(era) {
    if (era >= 6 && this.gltfCat) return this.gltfCat;
    return era >= 6 ? this.catSmooth : this.catLow;
  }

  // ---------- pipelines ----------
  setTier(tier) {
    this.tier = tier;
    for (const p of Object.values(this.pipelines)) p.dispose();
    this.pipelines = {};
  }

  #output(node, hdrGain) {
    // SDR: tone map + sRGB. HDR (extended canvas): add highlight energy above SDR white.
    if (!this.g.hdr) return renderOutput(node);
    const lin = renderOutput(node, THREE.NeutralToneMapping, THREE.LinearSRGBColorSpace);
    const extra = max(node.rgb.sub(1), vec3(0)).mul(hdrGain);
    return vec4(sRGBTransferOETF(lin.rgb.add(extra)), 1);
  }

  #pipeline(kind) {
    if (this.pipelines[kind]) return this.pipelines[kind];
    const { renderer, scene, camera, tier } = this;
    const pl = new THREE.RenderPipeline(renderer);
    pl.outputColorTransform = false;
    this.exposureU ??= uniform(1);
    this.hdrGain ??= uniform(0);
    this.bloomU ??= uniform(0.15);
    this.mixU ??= uniform(0);

    const retroOut = () => {
      const rp = retroPass(scene, camera);
      rp.setResolutionScale(this.#retroScale());
      this.retro = rp;
      (this.retroPasses ??= []).push(rp);
      this.retroScaleU ??= uniform(this.#retroScale());
      const c = renderOutput(rp);
      // 15-bit colour with ordered dither, like the console's framebuffer
      const cell = floor(screenUV.mul(screenSize).mul(this.retroScaleU));
      const dth = fract(dot(cell, vec2(0.5, 0.25)).add(fract(cell.y.mul(0.5)).mul(0.5))).sub(0.5);
      return vec4(floor(c.rgb.mul(31).add(dth.mul(0.9))).div(31), 1);
    };

    const smoothOut = (era7) => {
      const sp = pass(scene, camera);
      const useAO = tier.ao && era7;
      sp.setMRT(mrt(useAO ? { output, normal: directionToColor(normalView), velocity } : { output, velocity }));
      const col = sp.getTextureNode('output');
      const depth = sp.getTextureNode('depth');
      const vel = sp.getTextureNode('velocity');
      let out = col;
      if (useAO) {
        const aoPass = ao(depth, colorToDirection(sp.getTextureNode('normal')), camera);
        aoPass.resolutionScale = 0.5;
        out = out.mul(vec4(vec3(mix(float(1), aoPass.getTextureNode().r, 0.8)), 1));
      }
      if (era7 && tier.godrays && this.sun.castShadow) {
        const gr = godrays(depth, camera, this.sun);
        gr.density.value = 0.5;
        gr.maxDensity.value = 0.45;
        out = out.add(vec4(gr.getTextureNode().rgb.mul(this.sunColorU).mul(this.sunGlow.mul(0.6)), 0));
      }
      if (tier.traa) out = traa(out, depth, vel, camera);
      if (era7 && tier.dof) {
        this.focusU ??= uniform(15);
        out = dof(out, sp.getViewZNode(), this.focusU, uniform(9), uniform(0.8));
      }
      if (era7 && tier.motionBlur) out = motionBlur(out, vel.mul(0.5), int(8));
      out = out.add(bloom(out, era7 ? this.bloomU : 0.1, 0.35, era7 ? 1.3 : 1.2));
      let o = this.#output(out.mul(vec4(vec3(this.exposureU), 1)), this.hdrGain);
      if (!tier.traa) o = fxaa(o);
      return o;
    };

    this.crunchU ??= uniform(0);
    let o;
    if (kind === 5) o = retroOut();
    else if (kind === 6) o = smoothOut(false);
    else if (kind === 7) o = smoothOut(true);
    else if (kind === 'focus') o = mix(retroOut(), smoothOut(false), this.mixU);
    // restart: crunch back down to 1-bit
    pl.outputNode = crunchNode(o, this.crunchU);
    this.pipelines[kind] = pl;
    return pl;
  }

  // Compile each era's shaders off-screen, one per frame, so era changes never hitch.
  async #warmUp() {
    const fakeWorld = { dist: 0, era: 5, alive: true, obstacles: [], cat: { y: 0, phase: 0, onGround: true, vy: 0 } };
    for (const type of ['cucumber', 'pot', 'vacuum', 'crow']) {
      fakeWorld.obstacles.push({ id: -1 - fakeWorld.obstacles.length, type, x: 3 + fakeWorld.obstacles.length * 2, def: { y: 0 } });
    }
    for (const era of [5, 6, 7]) {
      this.#applyLook(LOOK[era], era);
      this.#sync(fakeWorld, era, 0, 0);
      this.#rig(era, 1);
      try {
        await this.renderer.compileAsync(this.scene, this.camera);
      } catch {
        /* compileAsync is an optimisation only */
      }
      const pl = this.#pipeline(era);
      this.renderer.setRenderTarget(this.warmRT);
      pl.render();
      this.renderer.setRenderTarget(null);
      this.ready[era] = true;
      await new Promise((r) => setTimeout(r, 30));
    }
    for (const o of fakeWorld.obstacles) this.#releaseObstacle(o.id);
    this.#applyLook(LOOK[5], 5);
  }

  isReady(era) {
    return this.ready[era];
  }

  setCrunch(k) {
    if (this.crunchU) this.crunchU.value = k;
  }

  resize(view) {
    this.view = view;
    this.camera.aspect = view.cssW / view.cssH;
    this.camera.updateProjectionMatrix();
    for (const rp of this.retroPasses ?? []) rp.setResolutionScale(this.#retroScale());
    if (this.retroScaleU) this.retroScaleU.value = this.#retroScale();
  }

  // PS1-ish internal resolution: about 640 pixels across.
  #retroScale() {
    const w = this.renderer.domElement.width || this.view?.cssW || 1280;
    return Math.min(1, Math.max(0.2, 640 / w));
  }

  // ---------- look & camera ----------
  #applyLook(L, era) {
    this.look = L;
    this.skyTop.value.set(L.top);
    this.skyMid.value.set(L.mid);
    this.skyHorizon.value.set(L.horizon);
    this.starsU.value = L.stars;
    this.scene.fog.color.set(L.fog);
    this.scene.fog.near = L.fogNear;
    this.scene.fog.far = L.fogFar;
    this.hemi.color.set(L.hemiSky);
    this.hemi.groundColor.set(L.hemiGround);
    this.hemi.intensity = L.hemi;
    this.sun.color.set(L.sunColor);
    this.sun.intensity = L.sun;
    this.sunDir = L.sunDir;
    if (this.sun.castShadow) this.sun.shadow.intensity = L.shadow;
    this.sceneryMats.window.emissiveIntensity = L.windows;
    if (this.exposureU) this.exposureU.value = L.exposure;
    this.sunElev = L.sunElev;
    this.era = era;
  }

  #blendLook(a, b, t) {
    const L = {};
    for (const k of Object.keys(a)) {
      if (typeof a[k] === 'number') L[k] = lerp(a[k], b[k], t);
      else if (Array.isArray(a[k])) L[k] = a[k].map((v, i) => lerp(v, b[k][i], t));
      else L[k] = '#' + C(a[k]).lerp(C(b[k]), t).getHexString();
    }
    return L;
  }

  // Camera: side-on framing that matches the 2D view, then orbited by the era's yaw/pitch.
  #rig(era, t = 1, from = null) {
    const L = this.look;
    const v = this.view;
    const cam = this.camera;
    const fov = from ? lerp(from.fov, L.fov, t) : L.fov;
    cam.fov = fov;
    cam.updateProjectionMatrix();
    const D = v.viewH / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
    const cx = v.viewW / 2 - v.catX;
    const cy = v.viewH / 2 - v.below;
    const yaw = from ? lerp(from.yaw, L.yaw, t) : L.yaw;
    const pitch = from ? lerp(from.pitch, L.pitch, t) : L.pitch;
    const dist = D * (from ? lerp(from.distMul, L.distMul, t) : L.distMul);
    const lift = from ? lerp(from.lift, L.lift, t) : L.lift;
    let tx = cx * (1 - Math.abs(yaw) * 0.6);
    let ty = cy - lift * 0.3;
    const place = () => {
      cam.position.set(tx + Math.sin(yaw) * dist, ty + Math.sin(pitch) * dist + lift, Math.cos(yaw) * Math.cos(pitch) * dist);
      cam.lookAt(tx, ty, 0);
      cam.updateMatrixWorld();
    };
    place();
    // Keep the cat where the 2D view has it (x) and the ground line at the same height (y).
    const want = { x: -1 + (2 * v.catX) / v.viewW, y: -1 + (2 * (v.below + 0.25)) / v.viewH };
    const pt = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    for (let i = 0; i < 3; i++) {
      pt.set(0, 0.25, 0).project(cam);
      const depth = cam.position.distanceTo(new THREE.Vector3(0, 0.25, 0));
      const halfH = depth * Math.tan(THREE.MathUtils.degToRad(fov) / 2);
      const halfW = halfH * cam.aspect;
      right.setFromMatrixColumn(cam.matrixWorld, 0);
      up.setFromMatrixColumn(cam.matrixWorld, 1);
      const dx = (pt.x - want.x) * halfW;
      const dy = (pt.y - want.y) * halfH;
      tx += right.x * dx + up.x * dy;
      ty += right.y * dx + up.y * dy;
      place();
    }
    this.camD = dist;
  }

  // Exact 2D framing (for the start of the pop-out): long lens from far away ≈ orthographic.
  #rig2D() {
    const v = this.view;
    const cam = this.camera;
    cam.fov = 8;
    cam.updateProjectionMatrix();
    const D = v.viewH / (2 * Math.tan(THREE.MathUtils.degToRad(8) / 2));
    const cx = v.viewW / 2 - v.catX;
    const cy = v.viewH / 2 - v.below;
    cam.position.set(cx, cy, D);
    cam.lookAt(cx, cy, 0);
    return { fov: 8, yaw: 0, pitch: 0, distMul: 1, lift: 0 };
  }

  // ---------- per-frame sync ----------
  #acquireObstacle(o) {
    let m = this.obstacleMeshes.get(o.id);
    if (m) return m;
    const pool = (this.pools[o.type] ??= []);
    m = pool.pop() ?? makeObstacle(o.type, this.obMats);
    if (!m.parent) this.scene.add(m);
    m.visible = true;
    this.obstacleMeshes.set(o.id, m);
    return m;
  }

  #releaseObstacle(id) {
    const m = this.obstacleMeshes.get(id);
    if (!m) return;
    m.visible = false;
    this.obstacleMeshes.delete(id);
    (this.pools[m.userData.type] ??= []).push(m);
  }

  #sync(world, era, now, dt) {
    const dist = world.dist;
    this.distU.value = dist % 2000;
    const L3 = TILE * 3;
    this.tiles.forEach((t, i) => {
      t.position.x = ((((i * TILE - dist) % L3) + L3) % L3) - TILE;
    });
    const live = new Set();
    for (const o of world.obstacles) {
      const rx = o.x - dist;
      if (rx > 40 || rx < -12) continue;
      live.add(o.id);
      const m = this.#acquireObstacle(o);
      m.position.set(rx, 0, 0);
      if (m.userData.wings) {
        const a = Math.sin(now * 14 + o.id) * 0.9;
        m.userData.wings[0].rotation.x = a;
        m.userData.wings[1].rotation.x = -a;
        m.position.y = Math.sin(now * 3 + o.id) * 0.03;
      }
    }
    for (const id of [...this.obstacleMeshes.keys()]) if (!live.has(id)) this.#releaseObstacle(id);

    const cat = this.#catFor(era);
    for (const c of [this.catLow, this.catSmooth, this.gltfCat]) if (c) c.object.visible = c === cat && !this.hideCat;
    cat.update(world.cat, world.alive, dt);
    cat.object.position.set(0, world.cat.y, 0);

    // sun direction and light follow the cat
    const sd = this.sunDir;
    this.sun.position.set(sd[0] * 30, sd[1] * 30, sd[2] * 30);
    this.sun.target.position.set(4, 0, 0);
    this.sun.position.x += 4;
  }

  // Place the sun-wheel low in the sky behind the town and project it for the glow.
  #sunWheel(elev, intensity) {
    const sw = this.sunWheel;
    sw.visible = intensity > 0.001;
    const cam = this.camera;
    const dir = new THREE.Vector3(-0.15, elev, -1).normalize();
    sw.position.copy(cam.position).addScaledVector(dir, 150);
    sw.position.z = Math.min(sw.position.z, -120);
    sw.lookAt(cam.position);
    sw.rotation.z += 0;
    this.sunWheelI.value = intensity;
    const p = sw.position.clone().project(cam);
    this.sunScreen.value.set(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
    this.sunGlow.value = intensity * 0.35;
  }

  // ---------- transitions ----------
  startTransition(from, to, now) {
    this.transition = { from, to, start: now, dur: to === 7 ? 3.2 : 2.4, fromLook: { ...this.look } };
  }

  startPopOut(r2d, world, now, onCovered) {
    const ev = r2d.snapshot(4);
    if (!ev) {
      onCovered?.();
      return;
    }
    // freeze the era-4 frame without the cat
    r2d.renderEra(4, world, now, { cat: false });
    const snap = document.createElement('canvas');
    snap.width = ev.vw;
    snap.height = ev.vh;
    snap.getContext('2d').drawImage(ev.canvas, 0, 0);
    const tex = new THREE.CanvasTexture(snap);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;

    const v = this.view;
    const ppu = PPU[4];
    // tiles of the frozen frame, laid on the z = 0.6 plane in front of the cat
    const nx = 24;
    const ny = Math.max(8, Math.round((nx * v.viewH) / v.viewW));
    const tw = (ev.vw * ev.px) / v.zoom / nx; // world units per tile (frame may overhang the screen)
    const th = (ev.vh * ev.px) / v.zoom / ny;
    const left = -v.catX;
    const top = v.viewH - v.below;
    const tileMat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false, depthTest: false, depthWrite: false });
    const off = attribute('tileOffset', 'vec2');
    tileMat.colorNode = texture(tex, uv().div(vec2(nx, ny)).add(off)).rgb;
    const tiles = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), tileMat, nx * ny);
    const offsets = new Float32Array(nx * ny * 2);
    const tileData = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      offsets[k * 2] = i / nx;
      offsets[k * 2 + 1] = 1 - (j + 1) / ny;
      const x = left + (i + 0.5) * tw;
      const y = top - (j + 0.5) * th;
      tileData.push({ x, y, delay: Math.hypot(x - 0, (y - 0.5) * 1.6) * 0.06 + Math.random() * 0.08, spin: (Math.random() - 0.5) * 6 });
    }
    tiles.geometry.setAttribute('tileOffset', new THREE.InstancedBufferAttribute(offsets, 2));
    tiles.frustumCulled = false;
    tiles.renderOrder = 10;
    this.scene.add(tiles);

    // voxels from the current cat sprite frame
    const sp = r2d.sprites[4].cat;
    const c = world.cat;
    const frame = !c.onGround ? sp.jump[c.vy > 3 ? 0 : c.vy < -3 ? 2 : 1] : sp.run[Math.floor(c.phase * sp.run.length) % sp.run.length];
    const fctx = frame.canvas.getContext('2d', { willReadFrequently: true });
    const img = fctx.getImageData(0, 0, frame.canvas.width, frame.canvas.height);
    const vox = [];
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      const k = (y * img.width + x) * 4;
      if (img.data[k + 3] < 128) continue;
      vox.push({ x: (x - frame.ox + 0.5) / ppu, y: (frame.oy - y - 0.5) / ppu + c.y, col: new THREE.Color(`rgb(${img.data[k]},${img.data[k + 1]},${img.data[k + 2]})`).convertSRGBToLinear(), depth: 0.08 + Math.random() * 0.22 });
    }
    const voxMat = new THREE.MeshBasicNodeMaterial({ fog: false, depthTest: false, depthWrite: false });
    // fake face shading so the extruded voxels read as 3D (instance colour multiplies this)
    voxMat.colorNode = vec3(normalLocal.z.mul(0.25).add(normalLocal.y.mul(0.15)).add(0.8));
    const voxels = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), voxMat, Math.max(1, vox.length));
    vox.forEach((p, i) => voxels.setColorAt(i, p.col));
    voxels.frustumCulled = false;
    voxels.renderOrder = 11;
    this.scene.add(voxels);

    this.popout = { start: now, dur: 2.6, tiles, tileData, tw, th, voxels, vox, tex, from: this.#rig2D(), covered: onCovered, coveredDone: false };
    this.#applyLook(LOOK[5], 5);
    this.hideCat = true;
  }

  #updatePopOut(now) {
    const P = this.popout;
    const t = (now - P.start) / P.dur;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const pos = new THREE.Vector3();
    // tiles flip and fall away, nearest to the cat first
    P.tileData.forEach((d, i) => {
      const k = clamp01((t * P.dur - 0.25 - d.delay) / 0.9);
      const f = ease(k);
      e.set(f * 1.4, f * d.spin * 0.3, f * d.spin * 0.2);
      q.setFromEuler(e);
      pos.set(d.x + f * d.spin * 0.3, d.y - f * f * 6, 0.3 + f * 3);
      const sc = 1 - f;
      s.set(P.tw * sc + 1e-4, P.th * sc + 1e-4, 1);
      m4.compose(pos, q, s);
      P.tiles.setMatrixAt(i, m4);
    });
    P.tiles.instanceMatrix.needsUpdate = true;
    // voxels extrude, then collapse into the 3D cat
    const ext = ease(clamp01(t / 0.25));
    const col = ease(clamp01((t - 0.35) / 0.4));
    q.identity();
    P.vox.forEach((p, i) => {
      const size = 1 / PPU[4];
      const sc = size * (1 - col) + 1e-4;
      pos.set(lerp(p.x, p.x * 0.4, col), lerp(p.y, 0.45, col), 0);
      s.set(sc, sc, lerp(size, p.depth, ext) * (1 - col) + 1e-4);
      m4.compose(pos, q, s);
      P.voxels.setMatrixAt(i, m4);
    });
    P.voxels.instanceMatrix.needsUpdate = true;
    this.hideCat = col < 0.5;
    // camera: from the flat 2D framing to the era-5 rig
    this.#rig(5, ease(clamp01((t - 0.2) / 0.7)), P.from);
    if (t >= 1) {
      this.scene.remove(P.tiles, P.voxels);
      P.tiles.geometry.dispose();
      P.voxels.geometry.dispose();
      P.tex.dispose();
      this.popout = null;
      this.hideCat = false;
    }
  }

  // ---------- render ----------
  render(world, era, now, dt) {
    let kind = era;
    if (this.popout) {
      this.#sync(world, 5, now, dt);
      this.#updatePopOut(now);
      if (!this.popout) this.#rig(5);
    } else if (this.transition) {
      const T = this.transition;
      const t = clamp01((now - T.start) / T.dur);
      const L = this.#blendLook(T.fromLook, LOOK[T.to], ease(t));
      this.#applyLook(L, T.to);
      this.#sync(world, t < 0.5 && T.to === 6 ? 5 : T.to, now, dt);
      this.#rig(T.to, ease(t), T.fromLook);
      if (T.to === 6) {
        kind = 'focus';
        this.#pipeline('focus');
        this.mixU.value = ease(clamp01((t - 0.15) / 0.75));
        const rs = lerp(this.#retroScale(), 1, ease(t));
        this.retro?.setResolutionScale(rs);
        this.retroScaleU.value = rs;
      } else kind = T.to;
      if (t >= 1) {
        this.transition = null;
        this.#applyLook(LOOK[T.to], T.to);
        for (const rp of this.retroPasses ?? []) rp.setResolutionScale(this.#retroScale());
        if (this.retroScaleU) this.retroScaleU.value = this.#retroScale();
      }
    } else {
      if (this.era !== era) this.#applyLook(LOOK[era], era);
      this.#sync(world, era, now, dt);
      this.#rig(era);
    }
    // sunrise: the wheel rises as the sun in era 7
    const sunrise = this.transition?.to === 7 ? ease(clamp01((now - this.transition.start) / this.transition.dur)) : era === 7 ? 1 : 0;
    this.#sunWheel(lerp(-0.08, this.look.sunElev ?? 0.16, sunrise), sunrise * 6);
    this.hdrGain.value = sunrise * 0.6;
    this.bloomU.value = 0.1 + sunrise * 0.12;
    if (this.focusU) this.focusU.value = this.camD ?? 15;
    this.#pipeline(kind).render();
    if (this.popout && !this.popout.coveredDone) {
      this.popout.coveredDone = true;
      this.popout.covered?.();
    }
  }
}

