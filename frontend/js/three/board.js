/**
 * PlaceBoard — one row of place-value zones (UM | C | D | U) holding piles
 * of real block objects. Blocks can be taken out (to world space), and
 * received back with a flight animation; zone labels count in real time.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SPEC, GAP, blockSize, createBlock, disposeBlock } from './blocks.js';
import { createLabel } from './fx.js';
import { gsap, flyTo, popIn } from './motion.js';

const ZONE_GAP = 1.4;
const ORDER = ['thousands', 'hundreds', 'tens', 'units']; // left → right, like on paper

export class PlaceBoard extends THREE.Group {
  /**
   * @param {string[]} places  places to show (any order)
   * @param {{ title?: string, titleColors?: {bg:string, fg:string}, tray?: string, labels?: boolean }} opts
   *   tray: color of a raised rounded tray under the whole row (visually separates a row).
   */
  constructor(places, { title, titleColors, tray, labels = true } = {}) {
    super();
    this.places = ORDER.filter((p) => places.includes(p));
    this.piles = {};
    this.zones = {};
    let cursor = 0;
    for (const p of this.places) {
      const [sx, , sz] = blockSize(p);
      const { cols, rows } = SPEC[p].layout;
      const width = cols * (sx + GAP) - GAP;
      const depth = Math.max(rows * (sz + GAP) - GAP, 3);
      // Opaque pastel pad (tint of the block color) — no transparency wash.
      const padMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(SPEC[p].color).lerp(new THREE.Color('#ffffff'), 0.8), emissive: SPEC[p].color, emissiveIntensity: 0, roughness: 0.75,
      });
      const pad = new THREE.Mesh(new THREE.BoxGeometry(width + 0.6, 0.06, depth + 0.6), padMat);
      pad.position.set(cursor + width / 2, 0.235, 0); // 0.205–0.265: never coplanar with the mat top (0.2) → no z-fighting
      pad.receiveShadow = true;
      this.add(pad);
      let label = null;
      if (labels) {
        label = createLabel('', { scale: 0.62 });
        label.position.set(cursor + width / 2, 0.55, depth / 2 + 0.95);
        this.add(label);
      }
      this.zones[p] = { x: cursor, width, depth, pad, label };
      this.piles[p] = [];
      cursor += width + ZONE_GAP;
    }
    const total = cursor - ZONE_GAP;
    this.children.forEach((c) => { c.position.x -= total / 2; });
    Object.values(this.zones).forEach((z) => { z.x -= total / 2; });
    this.totalWidth = total;
    this.depth = Math.max(...Object.values(this.zones).map((z) => z.depth)) + 0.6;
    if (tray) {
      const geo = new RoundedBoxGeometry(total + 1.2, 0.18, this.depth + 0.6, 3, 0.09);
      const slab = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: tray, roughness: 0.7 }));
      slab.position.y = 0.12;
      slab.receiveShadow = true;
      this.add(slab);
      this.position.y = 0.18; // the row sits ON the tray
    }
    if (title) {
      this.title = createLabel(title, { bg: titleColors?.bg ?? 'rgba(30,41,59,0.92)', fg: titleColors?.fg ?? '#ffffff', scale: 0.7, width: 448 });
      this.title.position.set(-total / 2 - 2.2, 0.75, 0);
      this.add(this.title);
    }
    this.places.forEach((p) => this.updateLabel(p));
  }

  // -------------------------------------------------------------- geometry
  slotLocal(place, n) {
    const [sx, sy, sz] = blockSize(place);
    const { cols, rows, gapY = GAP } = SPEC[place].layout;
    const perLayer = cols * rows;
    const layer = Math.floor(n / perLayer), k = n % perLayer;
    const col = k % cols, row = Math.floor(k / cols);
    return new THREE.Vector3(
      this.zones[place].x + col * (sx + GAP) + sx / 2,
      0.26 + layer * (sy + gapY),
      (row - (rows - 1) / 2) * (sz + GAP),
    );
  }

  slotWorld(place, n) { this.updateMatrixWorld(); return this.localToWorld(this.slotLocal(place, n)); }

  /** World-space point at the center of a zone, `y` above the mat. */
  zoneWorld(place, y = 0.3) {
    const z = this.zones[place];
    this.updateMatrixWorld();
    return this.localToWorld(new THREE.Vector3(z.x + z.width / 2, y, 0));
  }

  /** Number of blocks that have landed in a zone (in-flight ones excluded). */
  count(place) { return this.piles[place].filter((b) => b.userData.landed).length; }

  /** Landed blocks that physically exist (not red warning blocks). */
  realCount(place) { return this.piles[place].filter((b) => b.userData.landed && !b.userData.red).length; }

  updateLabel(place) {
    const label = this.zones[place].label;
    if (!label) return;
    const n = this.count(place);
    const red = this.piles[place].some((b) => b.userData.red);
    label.userData.setText(`${SPEC[place].many}: ${n}${red ? ' ⚠' : ''}`,
      red ? { bg: 'rgba(239,68,68,0.95)', fg: '#ffffff' } : {});
  }

  // -------------------------------------------------------------- building
  /** Instantly (with a staggered drop-in) build a composition. */
  setComposition(composition, { stagger = 0.03 } = {}) {
    let delay = 0;
    for (const p of this.places) {
      const want = Math.max(0, Math.min(composition[p] || 0, 99));
      const pile = this.piles[p];
      while (pile.length > want) this.#remove(pile.pop());
      while (pile.length < want) {
        const block = createBlock(p);
        block.userData.slot = pile.length;
        block.position.copy(this.slotLocal(p, pile.length));
        block.userData.landed = true;
        this.add(block);
        pile.push(block);
        const y = block.position.y;
        block.position.y = y + 2.2;
        popIn(block, { delay, duration: 0.45 });
        gsap.to(block.position, { y, duration: 0.5, delay, ease: 'bounce.out' });
        delay += stagger;
      }
      this.updateLabel(p);
    }
  }

  /** Detach the top block of a pile into world space (the scene). */
  take(place) {
    const pile = this.piles[place];
    return pile.length ? this.detach(place, pile[pile.length - 1]) : null;
  }

  /** Detach a SPECIFIC block of a pile into world space (the scene). */
  detach(place, block) {
    const pile = this.piles[place];
    const i = pile.indexOf(block);
    if (i < 0) return null;
    pile.splice(i, 1);
    gsap.killTweensOf(block.position);
    gsap.killTweensOf(block.scale);
    block.scale.setScalar(1);
    this.parent.attach(block);
    this.updateLabel(place);
    return block;
  }

  /** Fly a world-space block into the next free slot of a zone. */
  receive(block, place, opts = {}) { return this.land(block, place, this.piles[place].length, opts); }

  /**
   * Fly a world-space block into a SPECIFIC slot of a zone (the caller keeps
   * slots unique). Returns the gsap tween; `onLand` fires once it is parked.
   */
  land(block, place, slot, { delay = 0, duration = 0.7, height = 1.8, onLand } = {}) {
    block.userData.landed = false;
    block.userData.slot = slot;
    this.piles[place].push(block);
    return flyTo(block, this.slotWorld(place, slot), {
      delay, duration, height, spin: Math.PI * 0.5,
      onComplete: () => {
        block.rotation.set(0, 0, 0);
        block.scale.setScalar(1);
        this.attach(block);
        block.position.copy(this.slotLocal(place, slot));
        block.userData.landed = true;
        this.updateLabel(place);
        gsap.fromTo(block.scale, { x: 1.15, y: 0.8, z: 1.15 }, { x: 1, y: 1, z: 1, duration: 0.35, ease: 'elastic.out(1, 0.5)' });
        onLand?.(block);
      },
    });
  }

  /** Slide a block that already lives in this board to another slot. */
  moveToSlot(block, place, slot, duration = 0.35) {
    block.userData.slot = slot;
    const to = this.slotLocal(place, slot);
    if (block.position.distanceToSquared(to) < 1e-6) return null;
    return gsap.to(block.position, { x: to.x, y: to.y, z: to.z, duration, ease: 'power2.inOut' });
  }

  /** Create a block directly in a slot (used for red "invented" blocks). */
  spawn(place, slot, { red = false, delay = 0 } = {}) {
    const block = createBlock(place, { red });
    block.userData.slot = slot;
    block.userData.landed = true;
    block.position.copy(this.slotLocal(place, slot));
    this.add(block);
    this.piles[place].push(block);
    popIn(block, { delay, duration: 0.4 });
    this.updateLabel(place);
    return block;
  }

  /** Remove a resident block with a shrink and free it. */
  vanish(place, block) {
    const pile = this.piles[place];
    const i = pile.indexOf(block);
    if (i >= 0) pile.splice(i, 1);
    this.updateLabel(place);
    gsap.killTweensOf(block.scale);
    return gsap.to(block.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.22, ease: 'back.in(2)', onComplete: () => disposeBlock(block) });
  }

  /** Keep the pile array ordered by slot (so take() returns the top one). */
  sortPile(place) { this.piles[place].sort((a, b) => a.userData.slot - b.userData.slot); }

  /** Glow a zone's pad (used to show which column is being worked). */
  pulse(place, { color, intensity = 0.8, repeat = 1 } = {}) {
    const mat = this.zones[place].pad.material;
    if (color) mat.emissive.set(color); else mat.emissive.set(SPEC[place].color);
    return gsap.fromTo(mat, { emissiveIntensity: 0 }, { emissiveIntensity: intensity, duration: 0.3, yoyo: true, repeat: repeat * 2 - 1, ease: 'sine.inOut' });
  }

  #remove(block) { gsap.killTweensOf(block.position); gsap.killTweensOf(block.scale); disposeBlock(block); }

  dispose() {
    Object.values(this.piles).flat().forEach((b) => this.#remove(b));
    this.traverse((o) => {
      if (o.isSprite) o.userData.dispose?.();
      if (o.isMesh && !o.isInstancedMesh) { o.geometry.dispose(); o.material.dispose(); }
    });
    this.parent?.remove(this);
  }
}
