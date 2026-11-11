/**
 * Runtime configuration — environment-aware API routing.
 *
 *   Local (localhost, 127.0.0.1, *.localhost, LAN IPs like 192.168.x.x)
 *     → http://<same host>:5000   (so a phone on your Wi-Fi works too)
 *     → `?api=http://host:port` may override it (handy to test a remote API)
 *   Production (e.g. https://math3d-web.onrender.com)
 *     → ENV.API_BASE_URL, injected at build time from Render's env vars
 *     → fallback: PRODUCTION_API_FALLBACK below
 *
 * The `?api=` override is ignored in production so a crafted link can't
 * point the deployed game at someone else's server.
 */
import { ENV } from './env.js';

const { hostname, protocol, search } = window.location;

const PRIVATE_IP = /^(10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})$/;

export const IS_LOCAL =
  hostname === 'localhost' ||
  hostname === '127.0.0.1' ||
  hostname === '[::1]' ||
  hostname.endsWith('.localhost') ||
  hostname.endsWith('.local') ||
  PRIVATE_IP.test(hostname);

export const LOCAL_API_PORT = 5000;
export const PRODUCTION_API_FALLBACK = 'https://math3d-api.onrender.com';

const clean = (url) => url.trim().replace(/\/+$/, '');

function resolveApiBase() {
  if (IS_LOCAL) {
    const override = new URLSearchParams(search).get('api');
    if (override) return clean(override);
    return `${protocol === 'https:' ? 'https' : 'http'}://${hostname}:${LOCAL_API_PORT}`;
  }
  return clean(ENV.API_BASE_URL || PRODUCTION_API_FALLBACK);
}

/** Base URL every fetch() in api.js is built from. */
export const API_BASE_URL = resolveApiBase();

export const CONFIG = Object.freeze({
  API_BASE: API_BASE_URL, // backwards-compatible alias
  IS_LOCAL,
  STORAGE_KEY: 'math_game_progression',
  STORAGE_VERSION: 1,
  // Normal requests. Generous in production: mobile networks + Render's proxy.
  REQUEST_TIMEOUT_MS: IS_LOCAL ? 8_000 : 20_000,
  // Free Render instances sleep after ~15 min idle and take up to ~1 min to wake.
  WAKE_TIMEOUT_MS: IS_LOCAL ? 4_000 : 70_000,
  WAKE_ATTEMPTS: IS_LOCAL ? 1 : 3,
  SLOW_START_MS: 2_500, // show "waking the server…" after this
  STARS_PER_LEVEL: 6,
  // Which level unlocks each portal (module).
  PORTAL_UNLOCK_LEVEL: { value: 1, addition: 2, subtraction: 3 },
});
