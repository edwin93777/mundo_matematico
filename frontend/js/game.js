/**
 * Game controller — a small explicit state machine that wires
 * HUD (DOM) ⇄ active Mode (3D + inputs) ⇄ API ⇄ LocalStorage.
 *
 *   boot ─► loading ─► playing ⇄ animating
 *                        │  ▲
 *                        ▼  │ (wrong)
 *                      checking ─► solved ─► loading …
 *   any ─► error (server unreachable) ─► loading (retry)
 */
import * as THREE from 'three';
import { CONFIG, IS_LOCAL, API_BASE_URL } from './config.js';
import { api } from './api.js';
import { store } from './storage.js';
import { Engine, webglAvailable } from './core/engine.js';
import { StarBurst } from './three/fx.js';
import { createPortal } from './three/portals.js';
import { hud, MODULE_INFO } from './ui/hud.js';
import { initLayout } from './ui/layout.js';
import { ValueMode } from './modes/valueMode.js';
import { AdditionMode } from './modes/additionMode.js';
import { SubtractionMode } from './modes/subtractionMode.js';

const MODES = { value: ValueMode, addition: AdditionMode, subtraction: SubtractionMode };
const $ = hud.$;

if (!webglAvailable()) {
  hud.setPrompt('Tu navegador no soporta WebGL 2. Prueba con Chrome, Edge o Firefox actualizados.');
  throw new Error('WebGL2 not available');
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------
const TRANSITIONS = {
  boot: ['loading'],
  loading: ['playing', 'error'],
  playing: ['animating', 'checking', 'loading'],
  animating: ['playing'],
  checking: ['playing', 'solved', 'error'],
  solved: ['loading'],
  error: ['loading'],
};

const game = {
  state: 'boot',
  module: 'value',
  challenge: null,
  mode: null,
  attempt: 1,
  pendingAnimations: 0,

  to(next) {
    if (!TRANSITIONS[this.state].includes(next)) {
      console.warn(`Ignored transition ${this.state} → ${next}`);
      return false;
    }
    this.state = next;
    this.refreshControls();
    return true;
  },

  refreshControls() {
    const s = this.state;
    hud.setControls({
      check: s === 'playing' && !!this.mode?.isReady(),
      next: ['playing', 'solved', 'error'].includes(s),
      rebuild: s === 'playing',
    });
  },
};

// ---------------------------------------------------------------------------
// 3D world
// ---------------------------------------------------------------------------
const engine = new Engine($('scene'));
const sparkles = new StarBurst(engine.scene);
engine.onUpdate((dt) => sparkles.update(dt));

const portals = {};
Object.entries(MODULE_INFO).forEach(([key, info], i) => {
  const p = createPortal({ kind: key, color: info.color, lines: info.lines });
  p.position.set((i - 1) * 10, 0, -15);
  engine.scene.add(p);
  engine.addPickable(p, () => { p.userData.portal.jump(); selectModule(key); });
  engine.addHoverable(p, (on) => p.userData.portal.hover(on));
  engine.onUpdate((dt, t) => p.userData.portal.update(t, dt));
  portals[key] = p;
});

// Responsive HUD (sidebar / drawer / sheet) — keeps the 3D view centered in
// whatever part of the screen the HUD leaves free.
const panel = $('panel');
initLayout({ panel, handle: $('panel-handle'), tab: $('panel-tab'), engine });

/** Context handed to modes: the only way they talk back to the game. */
const ctx = {
  engine,
  sparkles,
  toast: (m) => hud.toast(m),
  /** Tactile error: camera shake + HUD shiver + device vibration. */
  shake() {
    engine.shake();
    panel.classList.remove('shiver');
    void panel.offsetWidth; // restart the CSS animation
    panel.classList.add('shiver');
    clearTimeout(ctx.shiverTimer);
    ctx.shiverTimer = setTimeout(() => panel.classList.remove('shiver'), 450);
    navigator.vibrate?.(70);
  },
  changed: () => game.refreshControls(),
  /** Wrap a 3D animation: locks controls until it (and any parallel ones) finish. */
  animating(promise) {
    if (game.state === 'playing') game.to('animating');
    game.pendingAnimations += 1;
    return Promise.resolve(promise)
      .catch((e) => console.error('Animation error', e))
      .finally(() => {
        game.pendingAnimations -= 1;
        if (game.pendingAnimations === 0 && game.state === 'animating') game.to('playing');
      });
  },
};

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------
function renderProfile(p = store.get()) {
  hud.renderProfile(p, game.module, selectModule);
  for (const [key, portal] of Object.entries(portals)) {
    portal.userData.portal.setState({
      locked: !p.unlockedPortals.includes(key),
      selected: key === game.module,
      unlockLevel: CONFIG.PORTAL_UNLOCK_LEVEL[key],
    });
  }
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------
function selectModule(module) {
  if (!store.get().unlockedPortals.includes(module)) {
    hud.toast(`🔒 Llega al nivel ${CONFIG.PORTAL_UNLOCK_LEVEL[module]} para abrir el portal de ${MODULE_INFO[module].title}.`);
    return;
  }
  if (game.state === 'animating' || game.state === 'checking') {
    hud.toast('⏳ Espera a que los bloques terminen de moverse.');
    return;
  }
  if (module === game.module && game.challenge && game.state === 'playing') return;
  game.module = module;
  renderProfile();
  loadChallenge();
}

async function loadChallenge() {
  if (!game.to('loading')) return;
  const { grade } = store.get();
  hud.setHeader(game.module, grade);
  hud.setPrompt('Preparando reto…');
  hud.hideFeedback();
  hud.setAttempt(1);
  game.mode?.unmount();
  game.mode = null;
  try {
    // Wakes a sleeping production server once (Render free tier), then is instant.
    await api.ready({
      onSlow: () => {
        hud.setApi('waking');
        hud.setPrompt('Despertando el servidor de retos… ☕');
        $('workspace').replaceChildren(Object.assign(document.createElement('p'), {
          className: 'text-sm font-bold text-ink-soft',
          textContent: 'La primera visita del día puede tardar hasta un minuto. ¡Ya casi!',
        }));
      },
    });
    const ch = await api.getChallenge({ grade, module: game.module });
    hud.setApi(true);
    game.challenge = ch;
    game.attempt = 1;
    hud.setPrompt(ch.prompt.text);
    game.mode = new MODES[ch.module](ctx);
    game.mode.mount(ch, $('workspace'));
    game.to('playing');
  } catch (err) {
    hud.setApi(false);
    game.challenge = null;
    hud.setPrompt(`😕 ${err.message}`);
    $('workspace').replaceChildren(Object.assign(document.createElement('p'), {
      className: 'text-sm font-bold text-ink-soft',
      textContent: IS_LOCAL
        ? `Inicia el backend (cd backend && npm start → ${API_BASE_URL}) y pulsa 🔄.`
        : 'Revisa tu conexión a internet y pulsa 🔄 para intentarlo de nuevo.',
    }));
    game.to('error');
  }
}

async function checkAnswer() {
  if (game.state !== 'playing' || !game.mode?.isReady()) return;
  game.to('checking');
  store.recordAttempt();
  const ch = game.challenge;
  const payload = {
    module: ch.module, grade: ch.grade, challenge_token: ch.challenge_token, attempt: game.attempt,
    ...game.mode.payload(),
  };
  try {
    const res = await api.validate(payload);
    hud.setApi(true);
    game.mode.markColumns(res.feedback?.columns);
    if (res.correct) {
      const outcome = store.applyReward(res, ch.module);
      game.to('solved');
      celebrate();
      hud.showFeedback(res, outcome);
    } else {
      game.attempt += 1;
      hud.setAttempt(game.attempt);
      game.to('playing');
      hud.showFeedback(res);
    }
  } catch (err) {
    game.state = 'playing'; // network hiccup: let the child retry
    game.refreshControls();
    // The server restarted with a new secret, or the challenge is > 2 h old.
    if (err.status === 410 || (err.status === 400 && /challenge_token/i.test(err.message))) {
      hud.toast('⏰ Este reto caducó. ¡Aquí tienes uno nuevo!');
      loadChallenge();
      return;
    }
    hud.setApi(err.status ? true : false);
    hud.toast(`😕 ${err.message}`);
  }
}

function celebrate() {
  const target = engine.controls.target;
  for (let i = 0; i < 4; i++) {
    setTimeout(() => sparkles.burst(new THREE.Vector3(target.x + (Math.random() - 0.5) * 10, 2.5, target.z + (Math.random() - 0.5) * 6),
      { count: 120, speed: 7, up: 6, life: 1.6, colors: ['#ffd23f', '#3a86ff', '#2ec26a', '#ff5d73', '#ffffff'] }), i * 180);
  }
}

// ---------------------------------------------------------------------------
// Events & boot
// ---------------------------------------------------------------------------
$('btn-check').onclick = checkAnswer;
$('btn-new').onclick = () => loadChallenge(); // the state machine rejects it mid-animation
$('btn-rebuild').onclick = () => { if (game.state === 'playing') { hud.hideFeedback(); game.mode.rebuild(); } };
$('fb-next').onclick = () => loadChallenge();
document.querySelectorAll('.grade-btn').forEach((b) => {
  b.onclick = () => {
    if (game.state === 'animating' || game.state === 'checking') return;
    store.setGrade(Number(b.dataset.grade));
    loadChallenge();
  };
});
$('btn-reset-progress').onclick = () => {
  if (game.state === 'animating' || game.state === 'checking') return;
  if (!confirm('¿Borrar todo tu progreso (estrellas, monedas y nivel)?')) return;
  store.reset();
  game.module = 'value';
  renderProfile();
  loadChallenge();
};
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && game.state === 'playing' && e.target?.tagName !== 'BUTTON') checkAnswer();
});

store.subscribe(() => renderProfile());
store.load();          // auto-load the player profile from localStorage
renderProfile();
engine.start();
hud.setApi('checking');
loadChallenge();
