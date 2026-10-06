// The 3D cat. ProceduralCat is built from primitives and posed with the same gallop as the
// pixel sprites (catPose), so the 2D → 3D pop-out lines up frame for frame. GltfCat (loaded
// from the asset pipeline) replaces it in the smooth eras when available.
import * as THREE from 'three/webgpu';
import { catPose } from '../render2d/sprites.js';

export function makeCatMaterials() {
  return {
    fur: new THREE.MeshPhysicalNodeMaterial({ color: '#17171d', roughness: 0.62, sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color('#6a6f8a') }),
    furFlat: new THREE.MeshStandardNodeMaterial({ color: '#1d1d26', roughness: 0.9, flatShading: true }),
    eye: new THREE.MeshStandardNodeMaterial({ color: '#62f062', emissive: new THREE.Color('#5cf05c'), emissiveIntensity: 1.6 }),
    ear: new THREE.MeshStandardNodeMaterial({ color: '#d9789a', roughness: 0.7 }),
    nose: new THREE.MeshStandardNodeMaterial({ color: '#e88aa8', roughness: 0.5 }),
  };
}

export class ProceduralCat {
  constructor(M, lowPoly = false) {
    const seg = lowPoly ? [7, 5] : [28, 20];
    const fur = lowPoly ? M.furFlat : M.fur;
    const root = (this.object = new THREE.Group());
    const body = (this.body = new THREE.Group());
    root.add(body);
    const sph = (r) => new THREE.SphereGeometry(r, seg[0], seg[1]);
    const add = (geo, mat, parent = body) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    this.torso = add(sph(1), fur);
    this.chest = add(sph(1), fur);
    this.haunch = add(sph(1), fur);
    this.neck = add(sph(1), fur);
    this.head = new THREE.Group();
    body.add(this.head);
    const skull = add(sph(1), fur, this.head);
    skull.scale.set(0.15, 0.13, 0.13);
    const snout = add(sph(1), fur, this.head);
    snout.scale.set(0.075, 0.06, 0.07);
    snout.position.set(0.11, -0.045, 0);
    const nose = add(sph(0.018), M.nose, this.head);
    nose.position.set(0.185, -0.025, 0);
    for (const side of [-1, 1]) {
      const ear = add(new THREE.ConeGeometry(0.055, 0.16, lowPoly ? 4 : 16), fur, this.head);
      ear.position.set(-0.04 + (side > 0 ? 0.06 : 0), 0.15, side * 0.07);
      ear.rotation.set(side * -0.25, 0, -0.25);
      const inner = add(new THREE.ConeGeometry(0.03, 0.1, lowPoly ? 4 : 12), M.ear, this.head);
      inner.position.set(-0.025 + (side > 0 ? 0.06 : 0), 0.14, side * 0.075 + 0.0);
      inner.rotation.copy(ear.rotation);
      const eye = add(sph(0.022), M.eye, this.head);
      eye.position.set(0.075, 0.03, side * 0.075);
      eye.castShadow = false;
    }
    // legs: [far hind, far fore, near hind, near fore] like catPose
    this.legs = [];
    const limbGeo = new THREE.CylinderGeometry(0.042, 0.036, 1, lowPoly ? 5 : 12);
    for (let i = 0; i < 4; i++) {
      const far = i < 2;
      const z = far ? -0.075 : 0.075;
      const upper = add(limbGeo, fur);
      const lower = add(limbGeo, fur);
      const paw = add(sph(0.045), fur);
      paw.scale.set(1.3, 0.7, 1);
      this.legs.push({ upper, lower, paw, z });
    }
    this.tail = [];
    const tailGeo = new THREE.CylinderGeometry(0.035, 0.03, 1, lowPoly ? 5 : 10);
    for (let i = 0; i < 4; i++) this.tail.push(add(tailGeo, fur));
    this.tailTip = add(sph(0.032), fur);
    this.update({ phase: 0, onGround: true, vy: 0 }, true);
  }

  #limb(mesh, a, b, z) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1e-4;
    mesh.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z);
    mesh.scale.set(1, len, 1);
    mesh.rotation.set(0, 0, Math.atan2(dy, dx) - Math.PI / 2);
  }

  // cat: world.cat ({ phase, onGround, vy }), alive flag
  update(cat, alive = true) {
    const mode = !alive ? 'hit' : !cat.onGround ? 'jump' : 'run';
    const pose = catPose(cat.phase, mode, cat.vy);
    const { bob, stretch } = pose;
    const squash = mode === 'hit' ? 0.85 : 1;
    this.torso.position.set(-0.02, 0.41 + bob, 0);
    this.torso.scale.set(0.38 + stretch, 0.13 * squash, 0.15);
    this.chest.position.set(0.22 + stretch, 0.42 + bob, 0);
    this.chest.scale.set(0.15, 0.14 * squash, 0.14);
    this.haunch.position.set(-0.26 - stretch, 0.44 + bob, 0);
    this.haunch.scale.set(0.16, 0.14 * squash, 0.15);
    this.neck.position.set(0.37 + stretch, 0.53 + bob, 0);
    this.neck.scale.set(0.12, 0.09, 0.1);
    this.neck.rotation.z = 0.7;
    this.head.position.set(0.47 + stretch, 0.6 + bob, 0);
    for (let i = 0; i < 4; i++) {
      const l = pose.legs[i];
      const leg = this.legs[i];
      this.#limb(leg.upper, l.hip, l.knee, leg.z);
      this.#limb(leg.lower, l.knee, l.paw, leg.z);
      leg.paw.position.set(l.paw[0] + 0.02, Math.max(0.03, l.paw[1] + 0.02), leg.z);
    }
    // tail along the quadratic curve
    const [p0, p1, p2] = pose.tail;
    const pts = [];
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      const u = 1 - t;
      pts.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
    }
    for (let i = 0; i < 4; i++) this.#limb(this.tail[i], pts[i], pts[i + 1], 0);
    this.tailTip.position.set(pts[4][0], pts[4][1], 0);
    // jump tilt around the body centre (0, 0.4)
    const th = pose.tilt;
    this.body.rotation.z = th;
    this.body.position.set(0.4 * Math.sin(th), 0.4 - 0.4 * Math.cos(th), 0);
  }
}
