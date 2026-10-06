// The four obstacles from the asset pipeline (public/models/obstacles.glb + obstacles.json, made
// by tools/blender/import_obstacles.py and export_obstacles.py). Each obstacle is cloned per use,
// sharing geometry and materials; the materials get the stage's readability rim (see world3d.js).
// When the files are absent the procedural obstacles (props3d.js) are used instead.
import * as THREE from 'three/webgpu';
import { output, vec4 } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OBSTACLES } from '../config.js';

export async function loadObstacleModels(rim) {
  const base = new URL('models/', document.baseURI);
  const metaRes = await fetch(new URL('obstacles.json', base)).catch(() => null);
  if (!metaRes?.ok || !(metaRes.headers.get('content-type') ?? '').includes('json')) return null;
  const meta = await metaRes.json();
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(new URL(meta.file ?? 'obstacles.glb', base).href);
  return new ObstacleModels(gltf, meta, rim);
}

// A standard glTF material as a node material with `rim` added to its final colour (after fog,
// and as outputNode so the PS1 retro pass, which rebuilds materials, keeps it too).
export const addRim = (material, rim) => {
  material.outputNode = vec4(output.rgb.add(rim), output.a);
  return material;
};

// Obstacle meshes also live on this layer; world3d.js renders it alone as a mask for the ink.
export const OBSTACLE_LAYER = 2;

function withRim(m, rim) {
  const n = new THREE.MeshStandardNodeMaterial({
    name: m.name, color: m.color, map: m.map, roughness: m.roughness, metalness: m.metalness, side: m.side,
    alphaTest: m.alphaTest, transparent: m.transparent, emissive: m.emissive, emissiveMap: m.emissiveMap, normalMap: m.normalMap,
  });
  return addRim(n, rim);
}

class ObstacleModels {
  constructor(gltf, meta, rim) {
    this.credits = meta.credits ?? [];
    this.templates = {};
    const mats = new Map();
    for (const type of Object.keys(OBSTACLES)) {
      const node = gltf.scene.getObjectByName(type);
      if (!node) continue;
      node.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        o.layers.enable(OBSTACLE_LAYER);
        if (!mats.has(o.material)) mats.set(o.material, withRim(o.material, rim));
        o.material = mats.get(o.material);
      });
      // keep node transforms: mesh quantization stores each mesh's offset and scale there
      this.templates[type] = node;
    }
  }

  has(type) {
    return !!this.templates[type];
  }

  // A new obstacle group: origin on the ground at its centre, flying ones lifted to their height.
  make(type) {
    const g = new THREE.Group();
    g.userData.type = type;
    const model = this.templates[type].clone();
    const lift = new THREE.Group(); // a wrapper, so the model's own (quantization) transform stays
    lift.position.y = OBSTACLES[type].y ?? 0;
    lift.add(model);
    g.add(lift);
    if (type === 'crow') {
      // [far, near]: world3d flaps wings[0] by +a and wings[1] by −a, which lifts both
      g.userData.wings = [model.getObjectByName('crow_wing_far'), model.getObjectByName('crow_wing_near')];
    }
    return g;
  }
}
