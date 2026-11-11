/**
 * Place value: the child builds a number with +/- steppers; blocks drop in live.
 */
import { BaseMode, el, PLACE_BG } from './base.js';
import { PlaceBoard } from '../three/board.js';
import { SPEC } from '../three/blocks.js';

export class ValueMode extends BaseMode {
  mount(ch, workspace) {
    this.ch = ch;
    this.workspace = workspace;
    this.composition = {};
    this.board = this.track(new PlaceBoard(BaseMode.ascending(ch)));
    this.board.position.z = 1.5;
    this.ctx.engine.scene.add(this.board);
    this.frameBoards([this.board]);
    this.#render();
  }

  #render() {
    const grid = el('div', 'grid gap-2');
    grid.style.gridTemplateColumns = `repeat(${this.ch.places.length}, minmax(0, 1fr))`;
    for (const p of this.ch.places) {
      const card = el('div', 'flex flex-col items-center rounded-2xl bg-white/70 p-2 ring-1 ring-ink/5');
      const head = el('div', 'flex items-center gap-1 text-[11px] font-black uppercase tracking-wide text-ink-soft');
      head.append(el('span', `inline-block h-2.5 w-2.5 rounded ${PLACE_BG[p]}`), el('span', '', SPEC[p].many));
      const count = el('b', 'font-display text-3xl', '0');
      const row = el('div', 'flex gap-1.5');
      const minus = el('button', 'btn btn-ghost h-9 w-9 !p-0 text-xl', '−');
      const plus = el('button', `btn h-9 w-9 !p-0 text-xl ${PLACE_BG[p]} ${p === 'units' ? 'text-ink' : 'text-white'}`, '+');
      minus.setAttribute('aria-label', `Quitar ${SPEC[p].one}`);
      plus.setAttribute('aria-label', `Agregar ${SPEC[p].one}`);
      const bump = (d) => {
        this.composition[p] = Math.max(0, Math.min(20, (this.composition[p] || 0) + d));
        count.textContent = this.composition[p];
        this.board.setComposition(this.composition, { stagger: 0 });
        if (d > 0) this.board.pulse(p, { intensity: 0.5 });
      };
      minus.onclick = () => bump(-1);
      plus.onclick = () => bump(1);
      row.append(minus, plus);
      card.append(head, count, row);
      card.dataset.place = p;
      grid.append(card);
    }
    this.workspace.replaceChildren(grid);
  }

  markColumns(columns = []) {
    for (const c of columns) {
      const card = this.workspace.querySelector(`[data-place="${c.place}"]`);
      card?.classList.toggle('!ring-2', true);
      card?.classList.toggle('!ring-red-400', !c.ok);
      card?.classList.toggle('!ring-hundred', !!c.ok);
    }
  }

  payload() {
    return { target: this.ch.data.target, client_composition: { ...this.composition } };
  }

  rebuild() {
    this.composition = {};
    this.board.setComposition({});
    this.#render();
  }
}
