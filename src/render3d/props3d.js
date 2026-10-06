// Procedural 3D obstacles and scenery for the 3D eras. Sizes match the gameplay hitboxes
// (config.OBSTACLES); origins sit on the ground at the obstacle's centre.
import * as THREE from 'three/webgpu';
import { color, mix, positionLocal, mx_noise_float, vec3, float, sin, positionWorld, smoothstep, abs, fract } from 'three/tsl';
import { createRng } from '../sim/rng.js';

const std = (opts) => new THREE.MeshStandardNodeMaterial(opts);
const phys = (opts) => new THREE.MeshPhysicalNodeMaterial(opts);

function mesh(geo, mat, { cast = true, receive = false } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

// ---------- obstacles ----------
export function makeMaterials() {
  const cukeNoise = mx_noise_float(positionLocal.mul(vec3(18, 30, 30)));
  return {
    cucumber: phys({ roughness: 0.45, clearcoat: 0.4, clearcoatRoughness: 0.3, colorNode: mix(color('#1d4d1a'), color('#4f8f2f'), cukeNoise.mul(0.5).add(0.5).mul(sin(positionLocal.x.mul(60)).mul(0.15).add(0.85))) }),
    cukeEnd: std({ color: '#a8c060', roughness: 0.6 }),
    pot: std({ color: '#b5583a', roughness: 0.8 }),
    potRim: std({ color: '#c9714a', roughness: 0.75 }),
    soil: std({ color: '#3a2618', roughness: 1 }),
    cactus: phys({ roughness: 0.55, sheen: 0.4, sheenColor: new THREE.Color('#bfe0a0'), colorNode: mix(color('#2f6e33'), color('#4f9a48'), sin(positionLocal.x.mul(40).add(positionLocal.z.mul(40))).mul(0.5).add(0.5)) }),
    flower: std({ color: '#ff5fa2', roughness: 0.5, emissive: new THREE.Color('#ff2f8a'), emissiveIntensity: 0.15 }),
    vacBody: phys({ color: '#2c3038', roughness: 0.35, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.15 }),
    vacTop: phys({ color: '#8a92a4', roughness: 0.5, metalness: 0.5 }),
    vacBumper: std({ color: '#15161a', roughness: 0.7 }),
    vacLed: std({ color: '#3ad0ff', emissive: new THREE.Color('#3ad0ff'), emissiveIntensity: 3 }),
    crow: phys({ color: '#121018', roughness: 0.45, sheen: 0.6, sheenColor: new THREE.Color('#4b3a8a'), iridescence: 0.35, iridescenceIOR: 1.4 }),
    beak: std({ color: '#d8a838', roughness: 0.5 }),
    eye: std({ color: '#ffffff', emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.3 }),
  };
}

export function makeObstacle(type, M) {
  const g = new THREE.Group();
  g.userData.type = type;
  if (type === 'cucumber') {
    const body = mesh(new THREE.CapsuleGeometry(0.13, 0.6, 8, 16), M.cucumber);
    body.rotation.z = Math.PI / 2;
    body.position.y = 0.13;
    body.scale.set(1, 1, 0.95);
    const tip = mesh(new THREE.SphereGeometry(0.05, 12, 8), M.cukeEnd);
    tip.position.set(0.43, 0.13, 0);
    g.add(body, tip);
    g.rotation.y = 0.3;
  } else if (type === 'pot') {
    const pts = [[0, 0], [0.2, 0], [0.26, 0.32], [0.3, 0.33], [0.3, 0.38], [0.26, 0.38], [0, 0.36]].map(([x, y]) => new THREE.Vector2(x, y));
    const pot = mesh(new THREE.LatheGeometry(pts, 28), M.pot);
    const soil = mesh(new THREE.CylinderGeometry(0.255, 0.255, 0.02, 24), M.soil);
    soil.position.y = 0.355;
    const trunk = mesh(new THREE.CapsuleGeometry(0.09, 0.36, 6, 14), M.cactus);
    trunk.position.y = 0.6;
    const armL = mesh(new THREE.CapsuleGeometry(0.05, 0.14, 4, 10), M.cactus);
    armL.position.set(-0.15, 0.66, 0);
    const armLb = mesh(new THREE.CapsuleGeometry(0.05, 0.1, 4, 10), M.cactus);
    armLb.position.set(-0.09, 0.57, 0);
    armLb.rotation.z = Math.PI / 2;
    const armR = mesh(new THREE.CapsuleGeometry(0.05, 0.12, 4, 10), M.cactus);
    armR.position.set(0.14, 0.62, 0);
    const armRb = mesh(new THREE.CapsuleGeometry(0.05, 0.09, 4, 10), M.cactus);
    armRb.position.set(0.09, 0.53, 0);
    armRb.rotation.z = Math.PI / 2;
    const flower = mesh(new THREE.IcosahedronGeometry(0.06, 1), M.flower);
    flower.position.y = 0.86;
    g.add(pot, soil, trunk, armL, armLb, armR, armRb, flower);
  } else if (type === 'vacuum') {
    const body = mesh(new THREE.CylinderGeometry(0.45, 0.47, 0.22, 48), M.vacBody);
    body.position.y = 0.15;
    const top = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 48), M.vacTop);
    top.position.y = 0.27;
    const lidar = mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.08, 24), M.vacBumper);
    lidar.position.set(0.12, 0.31, 0);
    const bumper = mesh(new THREE.TorusGeometry(0.465, 0.035, 8, 48, Math.PI), M.vacBumper);
    bumper.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    bumper.position.y = 0.1;
    const led = mesh(new THREE.SphereGeometry(0.025, 10, 8), M.vacLed, { cast: false });
    led.position.set(-0.36, 0.24, 0.2);
    g.add(body, top, lidar, bumper, led);
  } else if (type === 'crow') {
    const body = mesh(new THREE.SphereGeometry(0.2, 20, 14), M.crow);
    body.scale.set(1.25, 0.6, 0.6);
    body.position.y = 0.52;
    const head = mesh(new THREE.SphereGeometry(0.1, 16, 12), M.crow);
    head.position.set(-0.23, 0.6, 0);
    const beak = mesh(new THREE.ConeGeometry(0.035, 0.14, 10), M.beak);
    beak.rotation.z = Math.PI / 2;
    beak.position.set(-0.36, 0.59, 0);
    const tail = mesh(new THREE.ConeGeometry(0.08, 0.24, 4), M.crow);
    tail.rotation.z = -Math.PI / 2;
    tail.scale.z = 0.3;
    tail.position.set(0.32, 0.54, 0);
    const eyeL = mesh(new THREE.SphereGeometry(0.018, 8, 6), M.eye, { cast: false });
    eyeL.position.set(-0.29, 0.63, 0.06);
    const eyeR = eyeL.clone();
    eyeR.position.z = -0.06;
    const wingGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.12, 0, 0), new THREE.Vector3(0.18, 0, 0), new THREE.Vector3(0.05, 0, 0.42)]);
    wingGeo.setIndex([0, 1, 2, 2, 1, 0]);
    wingGeo.computeVertexNormals();
    const wingL = mesh(wingGeo, M.crow);
    const wingR = mesh(wingGeo, M.crow);
    wingR.scale.z = -1;
    for (const w of [wingL, wingR]) w.position.set(0, 0.56, 0);
    g.add(body, head, beak, tail, eyeL, eyeR, wingL, wingR);
    g.userData.wings = [wingL, wingR];
  }
  return g;
}

// ---------- scenery tiles ----------
export const TILE = 48;

export function makeSceneryMaterials(distU) {
  const wx = positionWorld.x.add(distU);
  const grassN = mx_noise_float(vec3(wx.mul(0.6), positionWorld.z.mul(0.6), 0));
  const fine = mx_noise_float(vec3(wx.mul(7), positionWorld.z.mul(7), 3));
  const path = float(1).sub(smoothstep(0.85, 1.15, abs(positionWorld.z)));
  const grass = mix(color('#2d4a1e'), color('#4f7a2c'), grassN.mul(0.5).add(0.5).add(fine.mul(0.15)));
  const dirt = mix(color('#5a4632'), color('#7a6044'), fine.mul(0.5).add(0.5));
  const stripes = fract(wx.mul(0.5)).lessThan(0.04).select(float(0.92), float(1));
  return {
    ground: std({ roughness: 0.95, colorNode: mix(grass, dirt.mul(stripes), path) }),
    wood: std({ color: '#7a5236', roughness: 0.85 }),
    wall: std({ color: '#e9dccb', roughness: 0.9 }),
    wall2: std({ color: '#c8d8e6', roughness: 0.9 }),
    roof: std({ color: '#9c3b2e', roughness: 0.7 }),
    roof2: std({ color: '#3b4f6e', roughness: 0.7 }),
    window: std({ color: '#1c2430', roughness: 0.2, metalness: 0.2, emissive: new THREE.Color('#ffcf7a'), emissiveIntensity: 0 }),
    trunk: std({ color: '#5a3d28', roughness: 0.9 }),
    leaves: std({ color: '#3f7a32', roughness: 0.8, flatShading: true }),
    leaves2: std({ color: '#5a8f2a', roughness: 0.8, flatShading: true }),
    hill: std({ color: '#3d5a3a', roughness: 1, flatShading: true }),
    hillFar: std({ color: '#5a6f86', roughness: 1, flatShading: true }),
  };
}

// One tile of scenery: fence just behind the path, trees, houses and far hills.
export function makeTile(seed, M) {
  const rng = createRng(seed);
  const g = new THREE.Group();
  // fence
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.9, 0.1), M.wood, Math.ceil(TILE / 1.2));
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < posts.count; i++) {
    m4.makeTranslation(i * 1.2, 0.45, -1.7);
    posts.setMatrixAt(i, m4);
  }
  posts.castShadow = true;
  posts.receiveShadow = true;
  g.add(posts);
  for (const y of [0.35, 0.7]) {
    const rail = mesh(new THREE.BoxGeometry(TILE, 0.07, 0.04), M.wood);
    rail.position.set(TILE / 2, y, -1.66);
    rail.receiveShadow = true;
    g.add(rail);
  }
  // trees
  for (let x = rng() * 4; x < TILE; x += 3 + rng() * 6) {
    const z = -3.5 - rng() * 5;
    const s = 0.8 + rng() * 0.8;
    const trunk = mesh(new THREE.CylinderGeometry(0.08 * s, 0.12 * s, 1.4 * s, 8), M.trunk);
    trunk.position.set(x, 0.7 * s, z);
    const crown = mesh(new THREE.IcosahedronGeometry(0.75 * s, 1), rng() < 0.5 ? M.leaves : M.leaves2);
    crown.position.set(x, 1.6 * s, z);
    crown.scale.y = 1.15;
    g.add(trunk, crown);
  }
  // houses
  for (let x = rng() * 5; x < TILE - 3; x += 4 + rng() * 5) {
    const w = 2.2 + rng() * 1.6;
    const h = 1.8 + rng() * 1.6;
    const d = 2.4;
    const z = -11 - rng() * 4;
    const walls = mesh(new THREE.BoxGeometry(w, h, d), rng() < 0.6 ? M.wall : M.wall2, { receive: true });
    walls.position.set(x, h / 2, z);
    const roofShape = new THREE.Shape([new THREE.Vector2(-w / 2 - 0.2, 0), new THREE.Vector2(w / 2 + 0.2, 0), new THREE.Vector2(0, 1.1)]);
    const roof = mesh(new THREE.ExtrudeGeometry(roofShape, { depth: d + 0.3, bevelEnabled: false }), rng() < 0.6 ? M.roof : M.roof2);
    roof.position.set(x, h, z - d / 2 - 0.15);
    g.add(walls, roof);
    for (let wy = 0.6; wy < h - 0.4; wy += 0.9) {
      for (let wx2 = -w / 2 + 0.5; wx2 < w / 2 - 0.3; wx2 += 0.8) {
        const win = mesh(new THREE.PlaneGeometry(0.42, 0.5), M.window, { cast: false });
        win.position.set(x + wx2 + 0.2, wy, z + d / 2 + 0.01);
        g.add(win);
      }
    }
  }
  // far hills
  for (let x = 0; x < TILE; x += 10 + rng() * 8) {
    const r = 8 + rng() * 8;
    const hill = mesh(new THREE.IcosahedronGeometry(r, 1), rng() < 0.5 ? M.hill : M.hillFar, { cast: false });
    hill.scale.set(1.4, 0.35 + rng() * 0.2, 0.6);
    hill.position.set(x, -r * 0.1, -30 - rng() * 20);
    g.add(hill);
  }
  return g;
}

