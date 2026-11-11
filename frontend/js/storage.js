/**
 * LocalStorage synchronizer — the client is the single source of truth for
 * player progression. The backend never stores anything.
 */
import { CONFIG } from './config.js';

const DEFAULT_PROFILE = () => ({
  version: CONFIG.STORAGE_VERSION,
  stars: 0,
  coins: 0,
  level: 1,
  grade: 3,
  unlockedPortals: ['value'],
  stats: { solved: 0, attempts: 0, byModule: { value: 0, addition: 0, subtraction: 0 } },
  redeemedRewards: [], // last N reward nonces — prevents double-crediting
  updatedAt: null,
});

const listeners = new Set();
let profile = null;

function safeRead() {
  try {
    const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function persist() {
  profile.updatedAt = new Date().toISOString();
  try { localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(profile)); } catch { /* private mode / quota */ }
  listeners.forEach((fn) => fn(profile));
}

function levelFor(stars) { return 1 + Math.floor(stars / CONFIG.STARS_PER_LEVEL); }

function portalsFor(level) {
  return Object.entries(CONFIG.PORTAL_UNLOCK_LEVEL).filter(([, lv]) => level >= lv).map(([m]) => m);
}

export const store = {
  /** Auto-load on boot: merge saved data over defaults (forward-compatible). */
  load() {
    const saved = safeRead();
    const base = DEFAULT_PROFILE();
    profile = saved && typeof saved === 'object'
      ? { ...base, ...saved, stats: { ...base.stats, ...(saved.stats || {}), byModule: { ...base.stats.byModule, ...(saved.stats?.byModule || {}) } } }
      : base;
    profile.level = levelFor(profile.stars);
    profile.unlockedPortals = portalsFor(profile.level);
    persist();
    return profile;
  },

  get: () => profile,

  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  setGrade(grade) { profile.grade = grade; persist(); },

  recordAttempt() { profile.stats.attempts += 1; persist(); },

  /**
   * Apply a reward ONLY when it comes from a successful backend validation.
   * Returns { applied, leveledUp, newPortals }.
   */
  applyReward(validation, module) {
    const reward = validation?.reward;
    if (!validation?.correct || !reward?.token || !reward.nonce) return { applied: false };
    if (profile.redeemedRewards.includes(reward.nonce)) return { applied: false };

    const prevLevel = profile.level;
    const prevPortals = new Set(profile.unlockedPortals);
    profile.stars += reward.stars;
    profile.coins += reward.coins;
    profile.level = levelFor(profile.stars);
    profile.unlockedPortals = portalsFor(profile.level);
    profile.stats.solved += 1;
    profile.stats.byModule[module] = (profile.stats.byModule[module] || 0) + 1;
    profile.redeemedRewards = [...profile.redeemedRewards, reward.nonce].slice(-50);
    persist();
    return {
      applied: true,
      leveledUp: profile.level > prevLevel,
      newPortals: profile.unlockedPortals.filter((p) => !prevPortals.has(p)),
    };
  },

  reset() { profile = DEFAULT_PROFILE(); persist(); return profile; },
};
