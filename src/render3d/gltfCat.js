// Rigged cat from the asset pipeline (public/models/cat.glb + cat.json, made by
// tools/blender/export_cat.py). Its run cycle is driven by the sim's gallop phase so it stays in
// step with the gameplay. When the files are absent the procedural cat is used instead.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export async function loadGltfCat() {
  const base = new URL('models/', document.baseURI);
  const metaRes = await fetch(new URL('cat.json', base)).catch(() => null);
  if (!metaRes?.ok || !(metaRes.headers.get('content-type') ?? '').includes('json')) return null;
  const meta = await metaRes.json();
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(new URL(meta.file ?? 'cat.glb', base).href);
  return new GltfCat(gltf, meta);
}

class GltfCat {
  constructor(gltf, meta) {
    this.meta = meta;
    this.credits = meta.credits ?? [];
    this.object = new THREE.Group();
    const model = (this.model = gltf.scene);
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.frustumCulled = false;
      // eye and whisker meshes ship without UVs, but physical materials still read them
      const geo = o.geometry;
      if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
      const m = o.material;
      if (!m) return;
      if (meta.emissive !== undefined && m.emissive) m.emissiveIntensity = meta.emissive;
      const tinted = meta.tint && meta.tint.materials.some((n) => m.name.startsWith(n));
      if (tinted) {
        // fur: darken to the game's black cat and add a sheen for the HDR light
        const fur = new THREE.MeshPhysicalNodeMaterial({ map: m.map, color: meta.tint.color, roughness: 0.75, metalness: 0 });
        if (meta.sheen) {
          fur.sheen = meta.sheen;
          fur.sheenRoughness = 0.45;
          fur.sheenColor = new THREE.Color(meta.sheenColor ?? '#6a6f8a');
        }
        o.material = fur;
      }
    });
    // Normalise: face +x, body length ≈ meta.length (default 1.1), paws on the ground.
    model.rotation.y = meta.rotationY ?? 0;
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const s = (meta.length ?? 1.1) / Math.max(size.x, size.z);
    model.scale.setScalar(s);
    model.updateMatrixWorld(true);
    box.setFromObject(model);
    const c = box.getCenter(new THREE.Vector3());
    model.position.set(-c.x + (meta.offsetX ?? 0), -box.min.y, -c.z);
    this.object.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    const clip = (name) => gltf.animations.find((a) => a.name === meta.clips?.[name]) ?? gltf.animations.find((a) => a.name.toLowerCase().includes(name));
    this.actions = {};
    for (const name of ['run', 'jump', 'idle', 'hit']) {
      const c2 = clip(name);
      if (!c2) continue;
      const a = this.mixer.clipAction(c2);
      a.play();
      a.enabled = true;
      a.setEffectiveWeight(0);
      a.paused = true;
      this.actions[name] = a;
    }
    this.actions.run ??= gltf.animations[0] ? this.mixer.clipAction(gltf.animations[0]) : null;
    this.actions.run?.play();
    this.weights = { run: 1, jump: 0, hit: 0 };
  }

  update(cat, alive, dt = 0) {
    const target = !alive ? 'hit' : !cat.onGround && this.actions.jump ? 'jump' : 'run';
    const k = Math.min(1, dt * 12);
    for (const name of ['run', 'jump', 'hit']) {
      const a = this.actions[name];
      if (!a) continue;
      this.weights[name] += ((name === target || (!this.actions[target] && name === 'run') ? 1 : 0) - this.weights[name]) * k;
      a.setEffectiveWeight(this.weights[name]);
    }
    const run = this.actions.run;
    if (run) run.time = ((cat.phase + (this.meta.phaseOffset ?? 0)) % 1) * run.getClip().duration;
    const jump = this.actions.jump;
    if (jump) {
      const T = jump.getClip().duration;
      // map rising → falling onto the clip
      const f = Math.min(0.999, Math.max(0, 0.5 - (cat.vy ?? 0) / 20));
      jump.time = T * (this.meta.jumpRange ? this.meta.jumpRange[0] + f * (this.meta.jumpRange[1] - this.meta.jumpRange[0]) : f);
    }
    const hit = this.actions.hit;
    if (hit && !alive) hit.time = Math.min(hit.getClip().duration * 0.999, hit.time + dt);
    this.mixer.update(0);
  }
}
