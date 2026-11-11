/**
 * HUD view layer: renders profile stats, module tabs, inline feedback card,
 * toasts and server status into the left glass panel. No game logic here.
 */
import { gsap } from 'gsap';
import { CONFIG } from '../config.js';

const $ = (id) => document.getElementById(id);
/** Ask the responsive layout to reveal the panel (drawer/sheet may be closed). */
const needAttention = () => window.dispatchEvent(new Event('hud:attention'));

const API_STATES = {
  ok: ['bg-hundred shadow-[0_0_0_4px_rgba(46,194,106,0.2)]', 'Servidor en línea'],
  down: ['bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,0.2)]', 'Sin conexión con el servidor'],
  waking: ['animate-pulse bg-amber-400 shadow-[0_0_0_4px_rgba(251,191,36,0.3)]', 'Despertando el servidor…'],
  checking: ['bg-ink-mute', 'Conectando…'],
};

export const MODULE_INFO = {
  // `color` drives BOTH the portal vortex and its game title glow/extrusion.
  value: { title: 'Valor posicional', short: 'Valor', icon: '🧱', color: '#22c55e', lines: ['VALOR', 'POSICIONAL'] },
  addition: { title: 'Suma llevando', short: 'Suma', icon: '➕', color: '#2f80ff', lines: ['¡SUMA', 'LLEVANDO!'] },
  subtraction: { title: 'Resta prestando', short: 'Resta', icon: '➖', color: '#ffa31a', lines: ['¡RESTA', 'PRESTANDO!'] },
};

export const hud = {
  $,

  renderProfile(p, activeModule, onSelect) {
    const prev = Number($('hud-stars').textContent);
    $('hud-level').textContent = p.level;
    $('hud-stars').textContent = p.stars;
    $('hud-coins').textContent = p.coins;
    $('hud-mini-level').textContent = p.level;
    $('hud-mini-stars').textContent = p.stars;
    $('hud-mini-coins').textContent = p.coins;
    const into = (p.stars % CONFIG.STARS_PER_LEVEL) / CONFIG.STARS_PER_LEVEL;
    $('hud-level-bar').style.width = `${Math.round(into * 100)}%`;
    if (p.stars > prev) gsap.fromTo('#hud-stars, #hud-coins, #hud-mini-stars, #hud-mini-coins', { scale: 1.6 }, { scale: 1, duration: 0.6, ease: 'elastic.out(1, 0.4)', stagger: 0.1 });
    document.querySelectorAll('.grade-btn').forEach((b) => {
      const on = Number(b.dataset.grade) === p.grade;
      b.className = `grade-btn rounded-lg px-2.5 py-1 transition ${on ? 'bg-white text-ink shadow' : 'text-ink-soft'}`;
    });
    this.renderTabs(p, activeModule, onSelect);
  },

  renderTabs(p, active, onSelect) {
    const nav = $('module-tabs');
    nav.replaceChildren();
    for (const [key, info] of Object.entries(MODULE_INFO)) {
      const locked = !p.unlockedPortals.includes(key);
      const b = document.createElement('button');
      b.className = `flex-1 whitespace-nowrap rounded-xl px-2 py-1.5 text-xs font-extrabold transition
        ${key === active ? 'bg-ink text-white shadow' : 'bg-white/60 text-ink hover:bg-white'} ${locked ? 'opacity-50' : ''}`;
      b.textContent = locked ? `🔒 ${info.short}` : `${info.icon} ${info.short}`;
      b.title = locked ? `${info.title}: se abre en el nivel ${CONFIG.PORTAL_UNLOCK_LEVEL[key]}` : info.title;
      b.onclick = () => onSelect(key);
      nav.append(b);
    }
  },

  setHeader(module, grade) {
    const info = MODULE_INFO[module];
    $('panel-module').textContent = `${info.icon} ${info.title} · ${grade}° grado`;
  },

  setPrompt(text) { $('panel-prompt').textContent = text; },

  /** @param {'ok'|'down'|'waking'|'checking'|boolean} state */
  setApi(state) {
    const key = state === true ? 'ok' : state === false ? 'down' : state;
    const [cls, title] = API_STATES[key] || API_STATES.checking;
    $('api-dot').className = `h-2.5 w-2.5 flex-none rounded-full ${cls}`;
    $('api-dot').title = title;
  },

  setAttempt(n) { $('panel-attempt').textContent = n > 1 ? `Intento ${n}` : ''; },

  /** Enable/disable controls from the state machine. */
  setControls({ check, next, rebuild }) {
    $('btn-check').disabled = !check;
    $('btn-new').disabled = !next;
    $('btn-rebuild').disabled = !rebuild;
  },

  toast(msg, ms = 3800) {
    needAttention();
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    gsap.fromTo(t, { y: 8, opacity: 0 }, { y: 0, opacity: 1, duration: 0.25 });
    t.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
  },

  hideFeedback() { $('feedback').classList.add('hidden'); },

  /** Inline feedback card — never blocks the 3D view. */
  showFeedback(res, outcome = {}) {
    needAttention();
    const card = $('feedback');
    card.className = `rounded-2xl p-4 ring-1 ${res.correct ? 'bg-gradient-to-br from-green-50 to-emerald-100/80 ring-hundred/30' : 'bg-amber-50/90 ring-amber-300/50'}`;
    const stars = $('fb-stars');
    stars.replaceChildren();
    if (res.correct) {
      for (let i = 0; i < 3; i++) {
        const s = document.createElement('span');
        s.textContent = i < res.stars_earned ? '⭐' : '☆';
        s.className = 'inline-block';
        stars.append(s);
      }
      gsap.fromTo(stars.children, { scale: 0, rotate: -45 }, { scale: 1, rotate: 0, duration: 0.5, stagger: 0.15, ease: 'back.out(3)' });
    } else {
      stars.textContent = '🤔';
    }
    $('fb-title').textContent = res.correct ? '¡Lo lograste!' : '¡Casi! Sigue intentando';
    $('fb-message').textContent = res.feedback_message;
    const hint = res.feedback?.hint;
    $('fb-hint').textContent = hint ? `💡 ${hint}` : '';
    $('fb-hint').classList.toggle('hidden', !hint);
    const extras = [];
    if (res.correct) extras.push(`+${res.stars_earned} ⭐  +${res.coins_earned} 💰`);
    if (outcome.leveledUp) extras.push('🎉 ¡Subiste de nivel!');
    (outcome.newPortals || []).forEach((m) => extras.push(`🌀 Nuevo portal: ${MODULE_INFO[m].title}`));
    $('fb-reward').textContent = extras.join(' · ');
    $('fb-reward').classList.toggle('hidden', !extras.length);
    $('fb-next').classList.toggle('hidden', !res.correct);
    gsap.fromTo(card, { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: 'power2.out' });
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (!res.correct) {
      const panel = $('panel');
      panel.classList.remove('shake'); void panel.offsetWidth; panel.classList.add('shake');
    }
  },
};
