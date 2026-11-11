/**
 * ColumnMode — shared stage + ASSET-CONSERVING mechanics for column operations.
 *
 *   Row A   (top number)            ← finite physical blocks
 *   Row B   (bottom number)         ← finite physical blocks
 *   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   ← the "line" of written math (3D bar)
 *   [ Tu respuesta ] tray
 *
 * Blocks are never created for the answer. Typing a digit d in a result box
 * PULLS d real blocks of that column down from the operation (Bézier flight)
 * into the tray; lowering d sends them back home. If d exceeds what the
 * column physically holds, the missing ones appear as RED warning blocks
 * ("you are inventing these"). Whatever is left up top after answering is a
 * visible clue that the answer is incomplete/wrong.
 *
 * Every block carries `userData.home` (where it really belongs), and every
 * tray block a `userData.slot`. `reconcile(place)` is the single function
 * that makes the tray match the typed digit; it is idempotent and runs
 * after every input and after every carry/borrow.
 *
 * Subclasses provide the "upper pool" of a column:
 *   upperCount(p) · takeUpper(p) → block (world space) · returnHome(block, p, opts)
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BaseMode, el } from './base.js';
import { PlaceBoard } from '../three/board.js';
import { SPEC, blockSize, createBlock, disposeBlock, ownMaterial, partOffsets, settleGlow } from '../three/blocks.js';
import { gsap, flyTo, done } from '../three/motion.js';

export const LAYOUT = { a: -3.4, b: 1.3, divider: 4.55, result: 7.4 };

export class ColumnMode extends BaseMode {
  /** Build rows A/B, divider bar and the result tray. */
  buildStage({ topTitle, bottomTitle, bottomTitleColors }) {
    this.objects.forEach((o) => o.dispose?.());
    this.objects = [];
    this.queue = Promise.resolve();
    const scene = this.ctx.engine.scene;
    const { top, bottom } = this.ch.data.digits;

    this.rowA = this.track(new PlaceBoard(this.places, { title: topTitle }));
    this.rowB = this.track(new PlaceBoard(this.places, { title: bottomTitle, titleColors: bottomTitleColors }));
    this.result = this.track(new PlaceBoard(this.places, {
      title: '= Tu respuesta', tray: '#e9e5ff', titleColors: { bg: 'rgba(109,93,252,0.95)', fg: '#ffffff' },
    }));
    this.rowA.position.z = LAYOUT.a;
    this.rowB.position.z = LAYOUT.b;
    this.result.position.z = LAYOUT.result;
    scene.add(this.rowA, this.rowB, this.result);
    this.rowA.setComposition(top);
    this.rowB.setComposition(bottom);
    for (const row of [this.rowA, this.rowB]) {
      for (const p of this.places) row.piles[p].forEach((b) => { b.userData.home = { board: row }; });
    }

    const width = this.rowA.totalWidth + 1.4;
    const bar = new THREE.Mesh(
      new RoundedBoxGeometry(width, 0.16, 0.3, 2, 0.07),
      new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.5 }),
    );
    bar.position.set(0, 0.32, LAYOUT.divider);
    bar.castShadow = true;
    bar.dispose = () => { bar.geometry.dispose(); bar.material.dispose(); scene.remove(bar); };
    scene.add(this.track(bar));
  }

  // ------------------------------------------------------------ tray state
  /** Real (non-red) blocks currently in the tray for a place, top slot last. */
  trayReal(p) {
    return this.result.piles[p].filter((b) => !b.userData.red).sort((a, b) => a.userData.slot - b.userData.slot);
  }

  /** Pull up to n REAL blocks back out of the tray (into world space). */
  pullFromTray(p, n) {
    const out = [];
    const real = this.trayReal(p);
    while (out.length < n && real.length) out.push(this.result.detach(p, real.pop()));
    return out;
  }

  /** Take up to n blocks of a column: operation rows first, then the tray. */
  gather(p, n) {
    const got = [];
    while (got.length < n && this.upperCount(p) > 0) got.push(this.takeUpper(p));
    return got.concat(this.pullFromTray(p, n - got.length));
  }

  /** Blocks of a column that physically exist anywhere (rows/pad + tray). */
  available(p) { return this.upperCount(p) + this.trayReal(p).length; }

  /**
   * Make the tray of `p` hold exactly answer[p] blocks:
   *   real = min(digit, real-in-tray + still-up-top)   ← pulled down / sent home
   *   red  = digit − real                               ← warning blocks
   */
  async reconcile(p) {
    const want = Number.isInteger(this.answer[p]) ? this.answer[p] : 0;
    const real = this.trayReal(p);
    const red = this.result.piles[p].filter((b) => b.userData.red).sort((a, b) => a.userData.slot - b.userData.slot);
    const targetReal = Math.min(want, real.length + this.upperCount(p));
    const targetRed = want - targetReal;
    const jobs = [];

    while (red.length > targetRed) jobs.push(done(this.result.vanish(p, red.pop())));
    let k = 0;
    while (real.length > targetReal) {
      const blk = this.result.detach(p, real.pop());
      jobs.push(this.returnHome(blk, p, { delay: k++ * 0.06 }));
    }
    // Compact: real blocks first, red ones right after the reserved real slots.
    real.forEach((b, i) => this.result.moveToSlot(b, p, i));
    red.forEach((b, i) => this.result.moveToSlot(b, p, targetReal + i));

    for (let i = real.length; i < targetReal; i++) {
      const blk = this.takeUpper(p);
      jobs.push(done(this.result.land(blk, p, i, { delay: (i - real.length) * 0.08, duration: 0.75, height: 2 })));
    }
    for (let i = red.length; i < targetRed; i++) {
      this.result.spawn(p, targetReal + i, { red: true, delay: (i - red.length) * 0.06 });
    }
    if (targetRed > red.length) {
      // New invented blocks → red pulse + tactile shake (camera, HUD, vibration).
      this.result.pulse(p, { color: '#ef4444', intensity: 1, repeat: 2 });
      this.ctx.shake();
    }

    await Promise.all(jobs);
    this.result.sortPile(p);
    this.result.updateLabel(p);
  }

  async reconcileAll() {
    for (const p of this.places) await this.reconcile(p);
  }

  /** Run a scene mutation after any pending one; locks "Comprobar" meanwhile. */
  enqueue(task) {
    const run = this.queue.then(task).catch((e) => { console.error(e); return false; });
    this.queue = run;
    this.ctx.animating(run);
    return run;
  }

  /** Point above the middle of the operation rows, over a place's column. */
  mergePoint(place, y = 2.4) {
    return new THREE.Vector3(this.rowA.zoneWorld(place).x, y, (LAYOUT.a + LAYOUT.b) / 2);
  }

  // ------------------------------------------------------------ animations
  /** 10 world-space blocks fly into the shape of ONE `bigType` block and fuse. */
  async mergeBlocks(blocks, bigType, point) {
    const scene = this.ctx.engine.scene;
    const offsets = partOffsets(bigType);
    await Promise.all(blocks.map((b, k) =>
      done(flyTo(b, point.clone().add(offsets[k]), { height: 1.3, duration: 0.6, delay: k * 0.05, spin: Math.PI }))));
    blocks.forEach((b) => b.rotation.set(0, 0, 0));
    const mats = blocks.map((b) => { const m = ownMaterial(b); m.emissive.set('#ffffff'); return m; });
    await done(gsap.to(mats, { emissiveIntensity: 1.1, duration: 0.25, ease: 'power2.in' }));
    const center = point.clone().add(new THREE.Vector3(0, blockSize(bigType)[1] / 2, 0));
    this.ctx.sparkles.burst(center, { count: 45, speed: 3, up: 2, life: 0.8, colors: ['#ffffff', SPEC[bigType].color] });
    blocks.forEach(disposeBlock);

    const merged = createBlock(bigType);
    merged.position.copy(point);
    scene.add(merged);
    const mat = ownMaterial(merged);
    mat.emissive.set('#ffffff');
    mat.emissiveIntensity = 1.1;
    gsap.fromTo(merged.scale, { x: 1.25, y: 1.25, z: 1.25 }, { x: 1, y: 1, z: 1, duration: 0.45, ease: 'back.out(3)' });
    await Promise.all(settleGlow(merged, 0.5).map(({ target, vars }) => done(gsap.to(target, vars))));
    return merged;
  }

  /** A world-space block glows and breaks into its 10 parts (pop + scatter). */
  async fractureBlock(big, smallType) {
    const scene = this.ctx.engine.scene;
    const mat = ownMaterial(big);
    mat.emissive.set('#ffffff');
    await done(gsap.timeline()
      .to(big.rotation, { z: 0.06, duration: 0.05, yoyo: true, repeat: 7, ease: 'none' })
      .to(mat, { emissiveIntensity: 1.1, duration: 0.4, ease: 'power2.in' }, 0));
    big.rotation.set(0, 0, 0);

    const origin = big.position.clone();
    const center = new THREE.Box3().setFromObject(big).getCenter(new THREE.Vector3());
    const parts = partOffsets(big.userData.type).map((o) => {
      const part = createBlock(smallType);
      part.position.copy(origin).add(o);
      scene.add(part);
      return part;
    });
    disposeBlock(big);
    this.ctx.sparkles.burst(center, { count: 70, speed: 4.5, up: 2, life: 0.9, colors: ['#ffffff', SPEC[smallType].color] });

    await Promise.all(parts.map((part, k) => {
      const dir = part.position.clone().sub(center).setY(0).normalize().multiplyScalar(0.35);
      return done(gsap.timeline({ delay: k * 0.025 })
        .to(part.scale, { x: 0.5, y: 0.5, z: 0.5, duration: 0.12, ease: 'power2.in' })
        .to(part.position, { x: `+=${dir.x}`, z: `+=${dir.z}`, y: '+=0.25', duration: 0.3, ease: 'power2.out' })
        .to(part.scale, { x: 1, y: 1, z: 1, duration: 0.3, ease: 'back.out(3)' }, '<'));
    }));
    return parts;
  }

  // ------------------------------------------------------------------ HUD
  /**
   * LLEVO / PRESTO box: a toggle. Click (or Space/Enter, or typing 1)
   * requests ON and the box shows "1" at once; click again / 0 / Backspace
   * requests OFF. `onRequest(on)` decides; the mode repaints with setAux().
   */
  auxToggle(place, label, onRequest) {
    const box = el('button', 'aux-box', '·');
    box.type = 'button';
    box.dataset.aux = place;
    box.setAttribute('aria-pressed', 'false');
    box.setAttribute('aria-label', `${label} en ${SPEC[place].many}`);
    box.addEventListener('click', () => onRequest(box.getAttribute('aria-pressed') !== 'true'));
    box.addEventListener('keydown', (e) => {
      if (e.key === '1') { e.preventDefault(); onRequest(true); }
      else if (['0', 'Backspace', 'Delete'].includes(e.key)) { e.preventDefault(); onRequest(false); }
      else if (/^[2-9]$/.test(e.key)) {
        e.preventDefault();
        this.ctx.toast(`En "${label}" solo puede ir un 1: siempre se agrupa de 10 en 10.`);
        gsap.fromTo(box, { x: -6 }, { x: 0, duration: 0.4, ease: 'elastic.out(1, 0.3)' });
      }
    });
    return box;
  }

  /** Paint a toggle: on → shows 1 immediately. */
  setAux(box, on, onClass = 'is-on') {
    box.textContent = on ? '1' : '·';
    box.setAttribute('aria-pressed', String(on));
    box.classList.toggle(onClass, on);
  }

  flashHud(node) {
    gsap.fromTo(node, { scale: 1.45 }, { scale: 1, duration: 0.55, ease: 'elastic.out(1, 0.45)' });
  }

  /** Answer inputs → reconcile that column's tray (queued, in order). */
  onAnswer(p) {
    this.enqueue(() => this.reconcile(p));
    this.ctx.changed();
  }

  isReady() { return this.ch.places.every((p) => Number.isInteger(this.answer[p])); }

  payload() {
    return { operands: this.ch.data.operands, client_answer: { ...this.answer }, client_regroups: { ...this.regroups } };
  }
}
