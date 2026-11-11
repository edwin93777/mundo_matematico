/**
 * Base class for game modes. A mode OWNS both halves of one activity:
 *   - its 3D stage (boards, pads, animations)
 *   - its HUD workspace (inputs/buttons) — and links them together.
 *
 * Contract used by the game state machine:
 *   mount(challenge, workspaceEl) · isReady() · payload() · markColumns(cols)
 *   rebuild() · unmount()
 *
 * ctx = { engine, sparkles, toast(msg), changed(), animating(promise) }
 */
import * as THREE from 'three';
import { SPEC } from '../three/blocks.js';

export const PLACE_BG = { thousands: 'bg-thousand', hundreds: 'bg-hundred', tens: 'bg-ten', units: 'bg-unit' };

export function el(tag, cls = '', text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/**
 * Answer digit inputs for column arithmetic, typed right-to-left like on
 * paper. `onChange(place, value|undefined)` fires on EVERY edit (typing or
 * clearing) so the 3D scene can mirror the box in real time.
 * @param {string[]} places most-significant first
 */
export function createDigitInputs(places, answer, onChange) {
  const inputs = places.map((p) => {
    const i = el('input', 'digit');
    i.inputMode = 'numeric';
    i.maxLength = 1;
    i.dataset.place = p;
    i.setAttribute('aria-label', `Resultado: ${SPEC[p].many}`);
    i.value = answer[p] ?? '';
    i.addEventListener('input', () => {
      i.value = i.value.replace(/\D/g, '').slice(-1);
      answer[p] = i.value === '' ? undefined : Number(i.value);
      i.classList.remove('is-ok', 'is-bad');
      onChange(p, answer[p]);
      if (i.value !== '') inputs[places.indexOf(p) - 1]?.focus();
    });
    return i;
  });
  return inputs;
}

/** Grid for column operations: a label column + one column per place. */
export function columnGrid(places) {
  const grid = el('div', 'mx-auto grid w-full max-w-[17rem] items-center gap-x-1.5 gap-y-1.5 text-center');
  grid.style.gridTemplateColumns = `2.6rem repeat(${places.length}, minmax(0, 1fr))`;
  return grid;
}

export class BaseMode {
  constructor(ctx) {
    this.ctx = ctx;
    this.objects = []; // disposables in the scene
  }

  /** Ascending places (units first) from the API's most-significant-first list. */
  static ascending(ch) { return [...ch.places].reverse(); }

  track(obj) { this.objects.push(obj); return obj; }

  /** Fit camera to the given boards (+ optional extra points). */
  frameBoards(boards, extra = []) {
    const box = new THREE.Box3();
    for (const b of boards) {
      const half = b.totalWidth / 2 + (b.title ? 3.2 : 0.8);
      box.expandByPoint(new THREE.Vector3(-half, 0, b.position.z - b.depth / 2 - 0.5));
      box.expandByPoint(new THREE.Vector3(half * 0.9, 3, b.position.z + b.depth / 2 + 1.4));
    }
    extra.forEach((p) => box.expandByPoint(p));
    box.expandByPoint(new THREE.Vector3(0, 6.2, -15)); // keep the portal archways + their titles in view
    this.ctx.engine.frame(box);
  }

  /** Column header chip (UM/C/D/U). */
  headerChip(p) {
    return el('span', `rounded-lg py-0.5 text-center text-xs font-black ${PLACE_BG[p]} ${p === 'units' ? 'text-ink' : 'text-white'}`, SPEC[p].short);
  }

  markColumns(columns = []) {
    for (const c of columns) {
      const input = this.workspace?.querySelector(`input[data-place="${c.place}"]`);
      if (!input) continue;
      input.classList.toggle('is-ok', !!c.ok);
      input.classList.toggle('is-bad', !c.ok);
    }
  }

  isReady() { return true; }

  unmount() {
    this.objects.forEach((o) => (o.dispose ? o.dispose() : o.parent?.remove(o)));
    this.objects = [];
    this.workspace?.replaceChildren();
  }
}
