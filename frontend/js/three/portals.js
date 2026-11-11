/**
 * Portal archways — stargate-style level selectors BUILT FROM base-ten blocks.
 *
 *   value        green hundreds slabs standing upright (pillars + lintel)
 *   addition     blue tens shafts (pillars + lintel) with yellow unit chevrons
 *   subtraction  yellow unit-cube towers; the lintel's right shaft is "borrowed":
 *                broken into 10 cubes that float above it
 *
 * Each arch is expanded into cubelet matrices and drawn as ONE InstancedMesh
 * per block type (≤ 3 draw calls per arch, 12-triangle cubes, no shadow pass). Inside every arch spins a soft
 * particle vortex (dynamic BufferGeometry) that slowly spirals inward.
 *
 * All layouts are authored in native block units (U = 0.3) and scaled.
 */
import * as THREE from 'three';
import { SPEC, U } from './blocks.js';
import { softDotTexture } from './fx.js';
import { createGameTitle } from './titles.js';

const DOT = softDotTexture();
// Background props: a plain 12-triangle cube is plenty at this distance
// (the rounded play-block cube is ~25× heavier and the value arch has 1000).
const PORTAL_CUBE = new THREE.BoxGeometry(U * 0.9, U * 0.9, U * 0.9);
const P = 3.06;       // pitch between 3-long blocks (tiny gap reads as separate blocks)
const Q = 0.32;       // pitch between 1-wide blocks
const UP = [Math.PI / 2, 0, 0];   // stand a block up (its Z length becomes height)
const ALONG_X = [0, Math.PI / 2, 0]; // lay a block along X

// ------------------------------------------------------------------ layouts
/** @returns {{ bricks: {type, pos:number[], rot?:number[]}[], floaters?: number[][], opening:{cy:number, r:number}, scale:number, height:number, width:number }} */
const LAYOUTS = {
  value() {
    const bricks = [];
    for (const x of [-1.5 * P, 1.5 * P]) for (const y of [0.5 * P, 1.5 * P]) bricks.push({ type: 'hundreds', pos: [x, y, 0], rot: UP });
    for (const x of [-1.5, -0.5, 0.5, 1.5]) bricks.push({ type: 'hundreds', pos: [x * P, 2.5 * P, 0], rot: UP });
    return { bricks, opening: { cy: P, r: 2.75 }, scale: 0.42, height: 3 * P, width: 4 * P };
  },

  addition() {
    const bricks = [];
    const px = [3.0 + Q / 2, 3.0 + Q * 1.5];
    for (const s of [-1, 1]) for (const x of px) for (const y of [0.5 * P, 1.5 * P]) {
      bricks.push({ type: 'tens', pos: [s * x, y, 0], rot: UP });
    }
    const ly = [2 * P + Q / 2, 2 * P + Q * 1.5];
    for (const y of ly) for (const x of [-P / 2, P / 2]) bricks.push({ type: 'tens', pos: [x, y, 0], rot: ALONG_X });
    // Yellow unit corners + chevrons
    for (const s of [-1, 1]) for (const x of px) for (const y of ly) bricks.push({ type: 'units', pos: [s * x, y, 0] });
    for (let i = -4; i <= 4; i++) bricks.push({ type: 'units', pos: [i * 0.75, 2 * P + Q * 2.6, 0] });
    for (const s of [-1, 1]) for (const x of px) bricks.push({ type: 'units', pos: [s * x, -Q * 0.1, 0.35] });
    return { bricks, opening: { cy: P, r: 2.7 }, scale: 0.62, height: 2 * P + Q * 3.2, width: 7.3 };
  },

  subtraction() {
    const bricks = [];
    const px = [3.0 + Q / 2, 3.0 + Q * 1.5];
    const rows = 19;
    for (const s of [-1, 1]) for (const x of px) for (let k = 0; k < rows; k++) {
      bricks.push({ type: 'units', pos: [s * x, Q / 2 + k * Q, 0] });
    }
    const ly = [rows * Q + Q / 2, rows * Q + Q * 1.5];
    bricks.push({ type: 'tens', pos: [-P / 2, ly[0], 0], rot: ALONG_X });
    bricks.push({ type: 'tens', pos: [-P / 2, ly[1], 0], rot: ALONG_X });
    bricks.push({ type: 'tens', pos: [P / 2, ly[0], 0], rot: ALONG_X });
    for (const s of [-1, 1]) for (const x of px) for (const y of ly) bricks.push({ type: 'units', pos: [s * x, y, 0] });
    // The borrowed shaft: its 10 cubes float apart above the right half.
    const floaters = Array.from({ length: 10 }, (_, i) => [0.15 + i * 0.3, ly[1] + 0.35, 0]);
    return { bricks, floaters, opening: { cy: rows * Q / 2, r: 2.7 }, scale: 0.62, height: ly[1] + 1, width: 7.3 };
  },
};

// ------------------------------------------------------------------ helpers
const _r = new THREE.Matrix4(), _t = new THREE.Matrix4(), _e = new THREE.Euler();

/** Expand one brick into the world matrices of its cubelets. */
function cubeletMatrices({ type, pos, rot = [0, 0, 0] }) {
  const [nx, ny, nz] = SPEC[type].dims;
  _r.makeRotationFromEuler(_e.set(rot[0], rot[1], rot[2]));
  const base = new THREE.Matrix4().makeTranslation(pos[0], pos[1], pos[2]).multiply(_r);
  const out = [];
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) {
    _t.makeTranslation((x - (nx - 1) / 2) * U, (y - (ny - 1) / 2) * U, (z - (nz - 1) / 2) * U);
    out.push(base.clone().multiply(_t));
  }
  return out;
}

function instanced(matrices, material) {
  const mesh = new THREE.InstancedMesh(PORTAL_CUBE, material, matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.receiveShadow = true; // no shadow casting: far background, saves a full shadow pass
  mesh.computeBoundingSphere();
  return mesh;
}

const glowMaterial = (color) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3, roughness: 0.45 });

// ------------------------------------------------------------------ vortex
function createVortex(radius, color) {
  const N = 320;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  const r = new Float32Array(N), a = new Float32Array(N), w = new Float32Array(N), ph = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    r[i] = radius * (0.2 + 0.8 * Math.sqrt(Math.random()));
    a[i] = Math.random() * Math.PI * 2;
    w[i] = 0.8 + Math.random() * 0.8;
    ph[i] = Math.random() * Math.PI * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.3, map: DOT, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  points.frustumCulled = false;
  const discMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(radius * 1.02, 48), discMat);
  const group = new THREE.Group();
  group.add(disc, points);

  const tint = (c) => {
    const base = new THREE.Color(c), white = new THREE.Color('#ffffff'), tmp = new THREE.Color();
    for (let i = 0; i < N; i++) {
      tmp.copy(base).lerp(white, Math.random() * 0.55).multiplyScalar(1.5); // HDR → soft bloom
      tmp.toArray(col, i * 3);
    }
    geo.attributes.color.needsUpdate = true;
    discMat.color.set(c);
  };
  tint(color);

  return {
    group, tint, discMat,
    /** Spiral: rotate (inner faster) and drift inward; respawn at the rim. */
    update(dt, t, speed) {
      for (let i = 0; i < N; i++) {
        const k = 1.6 - r[i] / radius;
        a[i] += w[i] * k * speed * dt * 1.8;
        r[i] -= dt * 0.35 * speed * (0.5 + k);
        if (r[i] < radius * 0.12) { r[i] = radius * (0.85 + Math.random() * 0.15); a[i] = Math.random() * Math.PI * 2; }
        pos[i * 3] = Math.cos(a[i]) * r[i];
        pos[i * 3 + 1] = Math.sin(a[i]) * r[i];
        pos[i * 3 + 2] = Math.sin(a[i] * 3 + ph[i] + t) * 0.12;
      }
      geo.attributes.position.needsUpdate = true;
      group.rotation.z = t * 0.2 * speed;
    },
  };
}

// ------------------------------------------------------------------ portal
/**
 * @param {{ kind: 'value'|'addition'|'subtraction', color: string, lines: [string, string] }} o
 *   color: the vortex color — also the title's glow/extrusion color.
 */
export function createPortal({ kind, color, lines }) {
  const layout = LAYOUTS[kind]();
  const portal = new THREE.Group();
  const arch = new THREE.Group();
  arch.scale.setScalar(layout.scale);
  portal.add(arch);

  // Blocks → one InstancedMesh per block type.
  const materials = {};
  const byType = {};
  for (const b of layout.bricks) (byType[b.type] ||= []).push(...cubeletMatrices(b));
  for (const [type, mats] of Object.entries(byType)) {
    materials[type] = glowMaterial(SPEC[type].color);
    arch.add(instanced(mats, materials[type]));
  }
  let floaters = null;
  if (layout.floaters) {
    materials.units ||= glowMaterial(SPEC.units.color);
    floaters = instanced(layout.floaters.map(([x, y, z]) => new THREE.Matrix4().makeTranslation(x, y, z)), materials.units);
    floaters.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    arch.add(floaters);
  }

  // Energy vortex inside the opening.
  const vortex = createVortex(layout.opening.r, color);
  vortex.group.position.set(0, layout.opening.cy, 0.05);
  arch.add(vortex.group);

  // Stone plinth + label (unscaled, in world units).
  const width = layout.width * layout.scale;
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.8, 0.24, 1.8),
    new THREE.MeshStandardMaterial({ color: '#d8c7ab', roughness: 0.9 }),
  );
  plinth.position.y = 0.12;
  plinth.receiveShadow = plinth.castShadow = true;
  arch.position.y = 0.24;
  const title = createGameTitle({ lines, color });
  const titleY = layout.height * layout.scale + 2.1;
  title.userData.title.setBaseY(titleY);
  portal.add(plinth, title);

  // Invisible, generous hit volume: hovering NEAR the arch or its title counts.
  const hit = new THREE.Mesh(
    new THREE.BoxGeometry(Math.max(width + 2.2, 6), titleY + 1.6, 3.2),
    new THREE.MeshBasicMaterial(),
  );
  hit.position.y = (titleY + 1.6) / 2;
  hit.visible = false; // not rendered, but still raycast
  portal.add(hit);

  const baseColors = Object.fromEntries(Object.keys(materials).map((t) => [t, new THREE.Color(SPEC[t].color)]));
  const grey = new THREE.Color('#a3aab8');
  const target = new THREE.Vector3(1, 1, 1);
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);

  portal.userData.portal = {
    locked: false, selected: false,
    setState({ locked, selected, unlockLevel }) {
      const changedLock = locked !== this.locked;
      this.locked = locked; this.selected = selected;
      for (const [t, m] of Object.entries(materials)) {
        m.color.copy(locked ? grey : baseColors[t]);
        m.emissive.copy(locked ? grey : baseColors[t]);
      }
      if (changedLock || !this.tinted) { vortex.tint(locked ? '#64748b' : color); this.tinted = true; }
      title.userData.title.setState({ locked, selected, unlockLevel });
    },
    hovered: false,
    hover(on) {
      if (on === this.hovered) return;
      this.hovered = on;
      title.userData.title.hover(on);
    },
    jump() { title.userData.title.jump(); },
    update(t, dt) {
      title.userData.title.update(t);
      const speed = this.locked ? 0.25 : (this.selected ? 1.7 : 1) * (this.hovered ? 1.8 : 1);
      vortex.update(dt, t, speed);
      vortex.discMat.opacity = this.locked ? 0.08 : this.selected ? 0.32 + Math.sin(t * 3) * 0.08 : 0.2;
      const glow = this.locked ? 0.05 : this.selected || this.hovered ? 0.55 + Math.sin(t * 3.2) * 0.25 : 0.28;
      for (const m of Object.values(materials)) m.emissiveIntensity = glow;
      target.setScalar(this.selected ? 1.08 : 1);
      portal.scale.lerp(target, 0.08);
      if (floaters) {
        layout.floaters.forEach(([x, y, z], i) => {
          _p.set(x, y + Math.sin(t * 2 + i * 0.7) * 0.18 + (this.locked ? 0 : 0.1), z);
          _q.setFromEuler(_e.set(t * 0.8 + i, t * 0.6 + i * 0.5, 0));
          floaters.setMatrixAt(i, _m.compose(_p, _q, _s));
        });
        floaters.instanceMatrix.needsUpdate = true;
      }
    },
  };
  return portal;
}
