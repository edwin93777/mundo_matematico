/**
 * Base-ten block factory.
 *
 *   units      yellow  1×1×1  cube
 *   tens       blue    1×1×10 shaft   (= 10 units in a line along Z)
 *   hundreds   green   10×1×10 grid   (= 10 tens side by side along X)
 *   thousands  orange  10×10×10 cube  (= 10 hundreds stacked along Y)
 *
 * Each block is ONE InstancedMesh of rounded cubelets (1 draw call), pivot
 * at bottom-center. `partOffsets(type)` gives where the 10 smaller blocks sit
 * inside a bigger one — used both to MERGE (10 → 1) and FRACTURE (1 → 10).
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const U = 0.3;      // world size of one unit cube
export const GAP = 0.04;   // spacing between blocks in a pile

export const PLACES = ['units', 'tens', 'hundreds', 'thousands']; // ascending
export const NEXT = { units: 'tens', tens: 'hundreds', hundreds: 'thousands' };
export const PREV = { tens: 'units', hundreds: 'tens', thousands: 'hundreds' };

export const SPEC = {
  units:     { color: '#ffc21a', dims: [1, 1, 1],    one: 'unidad',        many: 'Unidades',        short: 'U',  layout: { cols: 5, rows: 2 } },
  tens:      { color: '#1f6fff', dims: [1, 1, 10],   one: 'decena',        many: 'Decenas',         short: 'D',  layout: { cols: 10, rows: 1 } },
  hundreds:  { color: '#12b04a', dims: [10, 1, 10],  one: 'centena',       many: 'Centenas',        short: 'C',  layout: { cols: 1, rows: 1, gapY: 0.1 } },
  thousands: { color: '#ff7a1a', dims: [10, 10, 10], one: 'unidad de mil', many: 'Unidades de mil', short: 'UM', layout: { cols: 3, rows: 1 } },
};

const cubelet = new RoundedBoxGeometry(U * 0.94, U * 0.94, U * 0.94, 2, U * 0.14);
/** Shared rounded unit-cube geometry (also used to build the portal archways). */
export const CUBELET = cubelet;
/** Self-illumination so blocks "pop" even on their shadowed faces. */
export const BASE_EMISSIVE = 0.14;

// Opaque cartoon PBR: no transparency (no sorting, no wash-out), matte-ish
// roughness so the sun gives a soft highlight instead of a white glare.
const sharedMaterials = Object.fromEntries(Object.entries(SPEC).map(([k, s]) => [k,
  new THREE.MeshStandardMaterial({
    color: s.color, roughness: 0.58, metalness: 0,
    emissive: s.color, emissiveIntensity: BASE_EMISSIVE,
    transparent: false, opacity: 1,
  })]));
// ONE shared warning material for every "invented" block (one shader program).
export const RED_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xff0000, roughness: 0.2, metalness: 0, emissive: 0x7a0000, emissiveIntensity: 0.6,
});
const _m = new THREE.Matrix4();

/** Size of a block in world units [x, y, z]. */
export const blockSize = (type) => SPEC[type].dims.map((d) => d * U);

/**
 * Create one base-ten block (THREE.Group, pivot bottom-center).
 * `red: true` → a warning block that does NOT exist in the operation
 * (the child typed more than the column physically has).
 */
export function createBlock(type, { red = false } = {}) {
  const [nx, ny, nz] = SPEC[type].dims;
  const mesh = new THREE.InstancedMesh(cubelet, red ? RED_MATERIAL : sharedMaterials[type], nx * ny * nz);
  let i = 0;
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) {
    _m.makeTranslation((x - (nx - 1) / 2) * U, (y + 0.5) * U, (z - (nz - 1) / 2) * U);
    mesh.setMatrixAt(i++, _m);
  }
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  const group = new THREE.Group();
  group.add(mesh);
  group.userData.type = type;
  group.userData.mesh = mesh;
  group.userData.red = red;
  return group;
}

/**
 * Give a block its own material clone so it can glow/fade independently of
 * every other block of the same type. Returns the material.
 */
export function ownMaterial(block) {
  const mesh = block.userData.mesh;
  if (!block.userData.ownsMaterial) {
    mesh.material = mesh.material.clone();
    block.userData.ownsMaterial = true;
  }
  return mesh.material;
}

/** Tween a block's own material from a white charge back to its base look. */
export function settleGlow(block, duration = 0.6) {
  const mat = ownMaterial(block);
  const base = new THREE.Color(SPEC[block.userData.type].color);
  return [
    { target: mat.emissive, vars: { r: base.r, g: base.g, b: base.b, duration } },
    { target: mat, vars: { emissiveIntensity: BASE_EMISSIVE, duration } },
  ];
}

/** Remove a block from its parent and free per-block resources. */
export function disposeBlock(block) {
  block.parent?.remove(block);
  const mesh = block.userData.mesh;
  if (block.userData.ownsMaterial) mesh.material.dispose();
  mesh.dispose();
}

/**
 * Local offsets (relative to a `type` block's pivot) of the 10 blocks of the
 * previous place that compose it. E.g. partOffsets('tens') → 10 unit cubes in
 * a line along Z: exactly where the shaft's cubelets are.
 */
export function partOffsets(type) {
  return Array.from({ length: 10 }, (_, i) => {
    const k = (i - 4.5) * U;
    if (type === 'tens') return new THREE.Vector3(0, 0, k);
    if (type === 'hundreds') return new THREE.Vector3(k, 0, 0);
    return new THREE.Vector3(0, i * U, 0); // thousands: 10 stacked plates
  });
}
