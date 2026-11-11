/**
 * Addition with carrying — finite blocks, moved only by the child's input.
 *
 * Upper pool of a column p = row B pile + row A pile + the block carried
 * INTO p (sitting on p's floating "Llevo" pad).
 *
 *  RESULT box d  → d real blocks of the column fly DOWN into "Tu respuesta"
 *                  (red warning blocks for any excess). A correct answer
 *                  empties the operation completely; leftovers = a clue.
 *  LLEVO toggle  → shows 1 at once; 10 blocks of the column to the right
 *                  (rows first, then from the tray if the child already
 *                  wrote too many) fuse into ONE block of this column and
 *                  arc up to its Llevo pad. Refused if fewer than 10 exist.
 *  LLEVO off     → reverse: the block comes back down, breaks into 10, each
 *                  piece returns to its home; the trays re-reconcile (so a
 *                  digit that relied on the carry turns red).
 */
import * as THREE from 'three';
import { ColumnMode, LAYOUT } from './columnMode.js';
import { BaseMode, el, columnGrid, createDigitInputs } from './base.js';
import { SPEC, NEXT, PREV, disposeBlock } from '../three/blocks.js';
import { createLabel } from '../three/fx.js';
import { gsap, flyTo, done, wait } from '../three/motion.js';

const PAD = { y: 4.3, dz: -4.6 };

export class AdditionMode extends ColumnMode {
  mount(ch, workspace) {
    this.ch = ch;
    this.workspace = workspace;
    this.places = BaseMode.ascending(ch); // units first
    this.answer = {};
    this.regroups = {};
    this.#build3D();
    this.#renderHud();
  }

  // ------------------------------------------------------------------ 3D
  #build3D() {
    const [a, b] = this.ch.data.operands;
    this.buildStage({ topTitle: String(a), bottomTitle: `+ ${b}` });
    this.carried = {}; // place → { block|null, origins[10], consumed, inTray }
    const scene = this.ctx.engine.scene;

    this.pads = {};
    for (const p of this.places.slice(1)) {
      const w = Math.max(this.rowA.zones[p].width + 0.5, 3.6);
      const group = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: '#f5f3ff', emissive: '#7c6cff', emissiveIntensity: 0.2, roughness: 0.35 });
      const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, 3.8), mat);
      const label = createLabel('Llevo: 0', { bg: 'rgba(109,93,252,0.95)', fg: '#ffffff', scale: 0.62 });
      label.position.set(0, 0.85, 2.3);
      group.add(slab, label);
      group.position.set(this.rowA.zoneWorld(p).x, PAD.y, LAYOUT.a + PAD.dz);
      group.dispose = () => {
        gsap.killTweensOf(group.position);
        slab.geometry.dispose(); mat.dispose(); label.userData.dispose();
        scene.remove(group);
      };
      scene.add(group);
      gsap.to(group.position, { y: PAD.y + 0.18, duration: 1.8, yoyo: true, repeat: -1, ease: 'sine.inOut' });
      this.track(group);
      this.pads[p] = { group, mat, label };
    }
    this.frameBoards([this.rowA, this.rowB, this.result], [new THREE.Vector3(0, PAD.y + 1, LAYOUT.a + PAD.dz - 2)]);
  }

  #padText(p, text) { this.pads[p].label.userData.setText(text); }

  // ------------------------------------------------- upper pool (hooks)
  #padReady(p) {
    const e = this.carried[p];
    return !!(e && e.block && !e.consumed && !e.inTray);
  }

  upperCount(p) { return this.rowA.count(p) + this.rowB.count(p) + (this.#padReady(p) ? 1 : 0); }

  takeUpper(p) {
    if (this.rowB.count(p) > 0) return this.rowB.take(p);
    if (this.rowA.count(p) > 0) return this.rowA.take(p);
    if (this.#padReady(p)) {
      const e = this.carried[p];
      e.inTray = true;                 // it is on its way down to the tray
      this.ctx.engine.scene.attach(e.block);
      return e.block;
    }
    return null;
  }

  returnHome(block, p, { delay = 0 } = {}) {
    const home = block.userData.home;
    if (home.board) return done(home.board.receive(block, p, { delay, duration: 0.65 }));
    // Home is a Llevo pad.
    const pad = this.pads[home.pad].group;
    const to = pad.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.1, 0));
    return done(flyTo(block, to, { delay, height: 1.6, duration: 0.75 })).then(() => {
      block.rotation.set(0, 0, 0);
      pad.attach(block);
      block.position.set(0, 0.08, 0);
      Object.assign(this.carried[home.pad], { block, consumed: false, inTray: false });
      this.#padText(home.pad, 'Llevo: 1');
    });
  }

  // ------------------------------------------------------------------ HUD
  #renderHud() {
    const places = this.ch.places; // most-significant first
    const { top, bottom } = this.ch.data.digits;
    const grid = columnGrid(places);
    const add = (n) => grid.append(n);

    add(el('span'));
    places.forEach((p) => add(this.headerChip(p)));

    add(el('span', 'text-[11px] font-black uppercase text-ink-mute', 'llevo'));
    this.carryBoxes = {};
    places.forEach((p) => {
      if (p === 'units') return add(el('span'));
      const box = this.auxToggle(p, 'Llevo', (on) => this.#requestCarry(p, on));
      this.carryBoxes[p] = box;
      add(box);
    });

    add(el('span'));
    places.forEach((p) => add(el('span', 'font-display text-3xl font-extrabold', String(top[p]))));
    add(el('span', 'font-display text-3xl font-extrabold text-ink-mute', '+'));
    places.forEach((p) => add(el('span', 'font-display text-3xl font-extrabold', String(bottom[p]))));
    add(el('span'));
    places.forEach(() => add(el('span', 'h-1 rounded-full bg-ink')));

    add(el('span', 'font-display text-2xl text-ink-soft', '='));
    this.inputs = createDigitInputs(places, this.answer, (p) => this.onAnswer(p));
    this.inputs.forEach(add);

    const tip = el('p', 'mt-3 rounded-xl bg-brand-soft/70 p-2.5 text-sm font-bold text-ink-soft',
      '💡 Cada cifra que escribes baja esos bloques a “Tu respuesta”. Si hay 10 o más en una columna, toca LLEVO de la siguiente: 10 se juntan en 1. Al terminar no debe quedar ningún bloque arriba. Los rojos son bloques que no existen.');
    this.workspace.replaceChildren(grid, tip);
    setTimeout(() => this.inputs.at(-1)?.focus(), 60);
  }

  // ------------------------------------------------------------ input → 3D
  #requestCarry(p, on) {
    this.setAux(this.carryBoxes[p], on); // instant visual: the box shows 1
    this.enqueue(async () => {
      if (on && !this.carried[p]) {
        const ok = await this.#carry(p);
        this.regroups[p] = ok;
      } else if (!on && this.carried[p]) {
        await this.#uncarry(p);
        this.regroups[p] = false;
      }
      this.setAux(this.carryBoxes[p], !!this.carried[p]);
      this.ctx.changed();
    });
  }

  async #carry(p) {
    const src = PREV[p];
    const have = this.available(src);
    if (have < 10) {
      this.ctx.toast(`En las ${SPEC[src].many.toLowerCase()} hay ${have} bloques: necesitas 10 para formar 1 ${SPEC[p].one}. Aquí no se lleva.`);
      this.rowA.pulse(src, { color: '#ef4444', intensity: 1, repeat: 2 });
      this.rowB.pulse(src, { color: '#ef4444', intensity: 1, repeat: 2 });
      gsap.fromTo(this.carryBoxes[p], { x: -6 }, { x: 0, duration: 0.45, ease: 'elastic.out(1, 0.3)' });
      return false;
    }
    // 10 blocks of the column: rows (and its Llevo pad) first, then the tray.
    const parts = this.gather(src, 10);
    for (const b of parts) {
      if (b.userData.home.pad) {
        Object.assign(this.carried[b.userData.home.pad], { block: null, consumed: true, inTray: false });
        this.#padText(src, 'Llevo: 1 ✓');
      }
    }
    const origins = parts.map((b) => b.userData.home);
    const trayFix = this.reconcile(src); // blocks taken from the tray → it may turn red

    const merged = await this.mergeBlocks(parts, p, this.mergePoint(src));
    merged.userData.home = { pad: p };
    await wait(0.2);

    const pad = this.pads[p];
    const landing = pad.group.position.clone().add(new THREE.Vector3(0, 0.1, 0));
    await done(flyTo(merged, landing, { height: 3, duration: 0.95, ease: 'power2.inOut', spin: Math.PI * 2 }));
    merged.rotation.set(0, 0, 0);
    pad.group.attach(merged);
    merged.position.set(0, 0.08, 0);
    this.carried[p] = { block: merged, origins, consumed: false, inTray: false };
    this.ctx.sparkles.burst(pad.group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.6, 0)),
      { count: 110, speed: 6, up: 5, colors: ['#fff3a3', '#ffd23f', '#ffffff', '#b8acff'] });
    this.#padText(p, 'Llevo: 1');
    gsap.fromTo(pad.mat, { emissiveIntensity: 1.4 }, { emissiveIntensity: 0.35, duration: 1.2, ease: 'power2.out' });
    this.flashHud(this.carryBoxes[p]);
    await trayFix;
    await this.reconcile(p); // the carried block may now fill this column's tray
    return true;
  }

  async #uncarry(p) {
    const entry = this.carried[p];
    if (!entry) return;
    const next = NEXT[p];
    if (entry.consumed && next) {
      // This block was fused into the next carry: undo that one first.
      await this.#uncarry(next);
      this.regroups[next] = false;
      this.setAux(this.carryBoxes[next], false);
    }
    const scene = this.ctx.engine.scene;
    const src = PREV[p];
    const block = entry.block;
    if (entry.inTray) this.result.detach(p, block); else scene.attach(block);
    delete this.carried[p];
    this.#padText(p, 'Llevo: 0');
    const trayFix = this.reconcile(p); // without the carry this column may turn red

    await done(flyTo(block, this.mergePoint(src), { height: 1.5, duration: 0.8, ease: 'power2.inOut', spin: -Math.PI }));
    block.rotation.set(0, 0, 0);
    const pieces = await this.fractureBlock(block, src);
    await Promise.all(pieces.map((piece, k) => {
      piece.userData.home = entry.origins[k];
      return this.returnHome(piece, src, { delay: k * 0.05 });
    }));
    await trayFix;
    await this.reconcile(src);
  }

  /** Only called by the state machine while NOT animating. */
  rebuild() {
    Object.values(this.carried).forEach((e) => e.block && !e.inTray && disposeBlock(e.block));
    this.answer = {};
    this.regroups = {};
    this.#build3D();
    this.#renderHud();
    this.ctx.changed();
  }

  unmount() {
    Object.values(this.carried || {}).forEach((e) => e.block && !e.inTray && disposeBlock(e.block));
    super.unmount();
  }
}
