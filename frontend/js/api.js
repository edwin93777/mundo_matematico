/**
 * Backend API client — the ONLY place that talks to the network.
 * Every fetch() is built from API_BASE_URL (config.js → local or production).
 *
 * Production-hardening:
 *   - per-request timeouts (AbortController)
 *   - `ready()` wakes a sleeping Render free instance once (health ping with a
 *     long timeout + retries) and caches the result for every later call
 *   - normalized ApiError { message, status } for the UI
 */
import { API_BASE_URL, CONFIG } from './config.js';

export class ApiError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(path, { method = 'GET', body, timeout = CONFIG.REQUEST_TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      mode: 'cors',
      credentials: 'include', // the API answers with an explicit origin + Allow-Credentials
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error || `HTTP ${res.status}`, res.status);
    return data;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(err.name === 'AbortError' ? 'El servidor tardó demasiado en responder.' : 'No se pudo conectar con el servidor de retos.');
  } finally {
    clearTimeout(timer);
  }
}

let readyPromise = null;

export const api = {
  baseUrl: API_BASE_URL,

  health: () => request('/api/health'),

  /**
   * Resolves once the API answers. Shared by every caller; on failure the
   * cache is cleared so the next call (🔄 button) tries again.
   * @param {{ onSlow?: () => void }} o  called if waking takes a while
   */
  ready({ onSlow } = {}) {
    if (!readyPromise) {
      readyPromise = (async () => {
        const slow = setTimeout(() => onSlow?.(), CONFIG.SLOW_START_MS);
        try {
          for (let attempt = 1; ; attempt++) {
            try {
              return await request('/api/health', { timeout: CONFIG.WAKE_TIMEOUT_MS });
            } catch (err) {
              if (attempt >= CONFIG.WAKE_ATTEMPTS) throw err;
              await sleep(1500 * attempt);
            }
          }
        } finally {
          clearTimeout(slow);
        }
      })();
      readyPromise.catch(() => { readyPromise = null; });
    }
    return readyPromise;
  },

  /** @param {{grade: 3|4, module: 'value'|'addition'|'subtraction'}} q */
  getChallenge: ({ grade, module }) =>
    request(`/api/challenges?${new URLSearchParams({ grade: String(grade), module })}`),

  /** @param {object} payload see backend /api/validate */
  validate: (payload) => request('/api/validate', { method: 'POST', body: payload }),
};
