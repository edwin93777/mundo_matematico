/**
 * Subtraction with borrowing — finite blocks, moved only by the child's input.
 *
 *   Row A  minuend: the blocks you HAVE (the only pool answers are drawn from)
 *   Row B  subtrahend: what must stay behind / be taken away
 *   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *   "Tu respuesta" tray
 *
 *  RESULT box d  → d real blocks fly DOWN from row A's column into the tray
 *                  (red warning blocks for any excess). When the answer is
 *                  right, what is left in row A matches row B exactly.
 *  PRESTO toggle → shows 1 at once; one block of that column lifts, breaks
 *                  into 10 and they fly across into the column to its right.
 *                  An empty column refuses (borrow across zeros: the column
 *                  to ITS left must lend first).
 *  PRESTO off    → reverse: 10 blocks fuse back into one and return (cascades
 *                  if the right column already lent onwards).
 */
import * as THREE from 'three';
import { ColumnMode, LAYOUT } from './columnMode.js';
import { BaseMode, el, columnGrid, createDigitInputs } from './base.js';
import { SPEC, NEXT, PREV } from '../three/blocks.js';
import { gsap, done } from '../three/motion.js';

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export class SubtractionMode extends ColumnMode {
  mount(ch, workspace) {
    this.ch = ch;
    this.workspace = workspace;
    this.places = BaseMode.ascending(ch);
    this.answer = {};
    this.regroups = {};
    this.#build3D();
    this.#renderHud();
  }

  #build3D() {
    const [a, b] = this.ch.data.operands;
    this.buildStage({
      topTitle: String(a),
      bottomTitle: `− ${b}`,
      bottomTitleColors: { bg: 'rgba(239,68,68,0.95)', fg: '#ffffff' },
    });
    this.lent = {};
    this.frameBoards([this.rowA, this.rowB, this.result], [new THREE.Vector3(0, 4.5, LAYOUT.a)]);
  }

  // ------------------------------------------------- upper pool (hooks)
  upperCount(p) { return this.rowA.count(p); }
  takeUpper(p) { return this.rowA.take(p); }
  returnHome(block, p, { delay = 0 } = {}) { return done(this.rowA.receive(block, p, { delay, duration: 0.65 })); }

  // ------------------------------------------------------------------ HUD
  #renderHud() {
    const places = this.ch.places; // most-significant first
    const { bottom } = this.ch.data.digits;
    const grid = columnGrid(places);
    const add = (n) => grid.append(n);

    add(el('span'));
    places.forEach((p) => add(this.headerChip(p)));

    add(el('span', 'text-[11px] font-black uppercase leading-none text-ink-mute', 'presto'));
    this.prestoBoxes = {};
    places.forEach((p) => {
      if (p === 'units') return add(el('span'));
      const box = this.auxToggle(p, 'Presto', (on) => this.#requestPresto(p, on));
      this.prestoBoxes[p] = box;
      add(box);
    });

    // Minuend digits as notebook cells: when a column lends/receives, the
    // original digit shrinks to the top-right corner (muted) and the new
    // working value pops in large and centered.
    add(el('span'));
    this.topCells = {};
    const { top } = this.ch.data.digits;
    places.forEach((p) => {
      const cell = el('span', 'relative block h-12 w-full overflow-visible');
      const orig = el('span', 'absolute inset-0 grid place-items-center font-display text-3xl font-extrabold text-ink will-change-transform', String(top[p]));
      const now = el('span', 'absolute inset-0 grid place-items-center font-display text-3xl font-black text-ink opacity-0 will-change-transform');
      cell.append(orig, now);
      cell.setAttribute('aria-live', 'polite');
      this.topCells[p] = { cell, orig, now, value: top[p] };
      add(cell);
    });

    add(el('span', 'font-display text-3xl font-extrabold text-ink-mute', '−'));
    places.forEach((p) => add(el('span', 'font-display text-3xl font-extrabold', String(bottom[p]))));
    add(el('span'));
    places.forEach(() => add(el('span', 'h-1 rounded-full bg-ink')));

    add(el('span', 'font-display text-2xl text-ink-soft', '='));
    this.inputs = createDigitInputs(places, this.answer, (p) => this.onAnswer(p));
    this.inputs.forEach(add);

    // Shortcut buttons — they toggle the same PRESTO state.
    const actions = el('div', 'mt-3 space-y-2');
    for (const p of this.places) {
      const lender = NEXT[p];
      if (!lender || !this.places.includes(lender)) continue;
      const primary = p === 'units';
      const btn = el('button', `btn w-full justify-between text-left ${primary ? 'bg-gradient-to-r from-ten to-brand text-white' : 'btn-ghost'}`);
      btn.append(el('span', '', `⬅ Pedir prestado a la ${cap(SPEC[lender].one)}`), el('span', 'text-xs opacity-80', `para ${SPEC[p].many.toLowerCase()}`));
      btn.onclick = () => {
        if (this.lent[lender]) { this.ctx.toast(`La ${SPEC[lender].one} ya prestó. Toca su PRESTO para deshacerlo.`); return; }
        this.#requestPresto(lender, true);
      };
      actions.append(btn);
    }
    const tip = el('p', 'rounded-xl bg-brand-soft/70 p-2.5 text-sm font-bold text-ink-soft',
      '💡 Cada cifra que escribes baja esos bloques de arriba a “Tu respuesta”. Si te faltan, toca PRESTO en la columna de la izquierda: un bloque se rompe en 10. Al final, arriba deben quedar tantos bloques como en la fila roja. Los bloques rojos abajo no existen.');
    this.workspace.replaceChildren(grid, actions, tip);
    setTimeout(() => this.inputs.at(-1)?.focus(), 60);
  }

  /** Working value of a minuend column after loans (what the notebook shows). */
  #working(p) {
    return this.ch.data.digits.top[p] + (this.lent[NEXT[p]] ? 10 : 0) - (this.lent[p] ? 1 : 0);
  }

  /** Animate the notebook cells to their current working values. */
  #paintTop() {
    const { top } = this.ch.data.digits;
    for (const p of this.places) {
      const c = this.topCells[p];
      const value = this.#working(p);
      if (value === c.value) continue;
      const wasChanged = c.value !== top[p];
      c.value = value;
      c.cell.setAttribute('aria-label', value === top[p] ? String(top[p]) : `${top[p]} ahora es ${value}`);
      if (value !== top[p]) {
        // Original → small, muted, top-right corner.
        gsap.to(c.orig, { scale: 0.42, xPercent: 32, yPercent: -34, color: '#94a3b8', duration: 0.45, ease: 'power3.out' });
        // New value → large, bold, centered.
        c.now.textContent = String(value);
        gsap.fromTo(c.now, { scale: wasChanged ? 1.35 : 0.3, opacity: wasChanged ? 1 : 0, y: wasChanged ? 0 : 10 },
          { scale: 1, opacity: 1, y: 0, duration: 0.55, delay: wasChanged ? 0 : 0.12, ease: 'back.out(2.6)' });
      } else {
        // Back to the untouched digit.
        gsap.to(c.now, { scale: 0.3, opacity: 0, duration: 0.25, ease: 'power2.in' });
        gsap.to(c.orig, { scale: 1, xPercent: 0, yPercent: 0, color: '#1e293b', duration: 0.45, ease: 'back.out(2)' });
      }
    }
  }

  // ------------------------------------------------------------ input → 3D
  #requestPresto(L, on) {
    this.setAux(this.prestoBoxes[L], on, 'is-lent'); // instant: the box shows 1
    this.enqueue(async () => {
      if (on && !this.lent[L]) this.lent[L] = await this.#lend(L);
      else if (!on && this.lent[L]) this.lent[L] = !(await this.#unlend(L));
      this.regroups[L] = !!this.lent[L];
      this.setAux(this.prestoBoxes[L], !!this.lent[L], 'is-lent');
      this.#paintTop();
      this.ctx.changed();
    });
  }

  /** Column L lends: one block breaks into 10 that fly to the column on its right. */
  async #lend(L) {
    const R = PREV[L];
    if (this.available(L) === 0) {
      const left = NEXT[L] && this.places.includes(NEXT[L]) ? ` Primero toca PRESTO en las ${SPEC[NEXT[L]].many.toLowerCase()}.` : '';
      this.ctx.toast(`¡Las ${SPEC[L].many.toLowerCase()} están vacías, no pueden prestar!${left}`);
      this.rowA.pulse(L, { color: '#ef4444', intensity: 1, repeat: 2 });
      gsap.fromTo(this.prestoBoxes[L], { x: -6 }, { x: 0, duration: 0.45, ease: 'elastic.out(1, 0.3)' });
      return false;
    }
    const [big] = this.gather(L, 1);           // from row A, or back up from the tray
    const trayFix = this.reconcile(L);
    await done(gsap.to(big.position, { y: big.position.y + 2.4, duration: 0.45, ease: 'power2.out' }));
    const pieces = await this.fractureBlock(big, R);
    // Inter-column flight: the 10 parts cross over and land in the right column.
    await Promise.all(pieces.map((piece, k) => {
      piece.userData.home = { board: this.rowA };
      return done(this.rowA.receive(piece, R, { delay: k * 0.07, duration: 0.8, height: 2.2 }));
    }));
    this.rowA.pulse(R, { intensity: 0.8 });
    this.flashHud(this.prestoBoxes[L]);
    await trayFix;
    await this.reconcile(R); // more blocks up top → red ones can become real
    return true;
  }

  /** Undo a loan: 10 blocks of the right column fuse back into one L block. */
  async #unlend(L) {
    const R = PREV[L];
    if (this.available(R) < 10 && this.lent[R]) {
      const ok = await this.#unlend(R);
      this.lent[R] = !ok;
      this.regroups[R] = !ok;
      this.setAux(this.prestoBoxes[R], !ok, 'is-lent');
    }
    if (this.available(R) < 10) {
      this.ctx.toast(`Para devolver el préstamo hacen falta 10 ${SPEC[R].many.toLowerCase()}.`);
      return false;
    }
    const ten = this.gather(R, 10);
    const trayFix = this.reconcile(R);
    const point = new THREE.Vector3(this.rowA.zoneWorld(R).x, 2.6, LAYOUT.a);
    const merged = await this.mergeBlocks(ten, L, point);
    merged.userData.home = { board: this.rowA };
    await done(this.rowA.receive(merged, L, { duration: 0.8, height: 2 }));
    await trayFix;
    await this.reconcile(L);
    return true;
  }

  /** Only called by the state machine while NOT animating. */
  rebuild() {
    this.answer = {};
    this.regroups = {};
    this.#build3D();
    this.#renderHud();
    this.ctx.changed();
  }
}
