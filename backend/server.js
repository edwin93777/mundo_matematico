/**
 * ============================================================================
 *  MATH 3D — Stateless Educational Engine (Backend)
 * ============================================================================
 *  Zero dependencies. Zero databases. Pure Node.js (>= 18) `node:http`.
 *
 *  Responsibilities
 *    - Generate randomized, pedagogically constrained challenges
 *      (place value, addition WITH carrying, subtraction WITH borrowing).
 *    - Re-compute every answer server-side and return structured,
 *      child-friendly feedback (Spanish UI copy, English code).
 *    - Sign challenges and rewards with HMAC so the server never needs to
 *      remember anything: all state lives in the client (localStorage) and
 *      in self-verifying tokens.
 *
 *  Endpoints
 *    GET  /                    service info
 *    GET  /api/health          health check (used by Render)
 *    GET  /api/challenges?grade=3|4&module=value|addition|subtraction
 *    POST /api/validate
 *
 *  Run:  npm start             (node server.js — PORT defaults to 5000)
 *  Env:  PORT                  port to bind (Render injects it)
 *        HOST                  optional bind address (default: all interfaces)
 *        GAME_SECRET           HMAC secret; set it in production so tokens
 *                              survive restarts / multiple instances
 *        ALLOWED_ORIGINS       comma-separated frontend origins allowed by CORS,
 *                              e.g. https://math3d-web.onrender.com
 *        ALLOW_LOCAL_ORIGINS   "false" to reject localhost/LAN origins (default: allowed)
 *        NODE_ENV              "production" on Render
 * ============================================================================
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// 1. Configuration
// ---------------------------------------------------------------------------
/** "https://a.com/, http://b.com" → ["https://a.com", "http://b.com"] */
function parseOrigins(value = '') {
  return value.split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);
}

const CONFIG = Object.freeze({
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5000,
  host: process.env.HOST || undefined,   // undefined → all interfaces (IPv4 + IPv6)
  // A random secret per boot works locally (tokens just expire on restart).
  // In production set GAME_SECRET so tokens survive restarts and free-tier sleeps.
  secret: process.env.GAME_SECRET || crypto.randomBytes(32).toString('hex'),
  secretFromEnv: Boolean(process.env.GAME_SECRET),
  allowedOrigins: parseOrigins(process.env.ALLOWED_ORIGINS ?? process.env.ALLOWED_ORIGIN ?? ''),
  allowLocalOrigins: process.env.ALLOW_LOCAL_ORIGINS !== 'false',
  maxBodyBytes: 16 * 1024,
  challengeTtlMs: 2 * 60 * 60 * 1000, // 2 hours
});

const MODULES = ['value', 'addition', 'subtraction'];
const GRADES = [3, 4];

// Least-significant first. Index === power of ten.
const PLACES = ['units', 'tens', 'hundreds', 'thousands'];
const PLACE_VALUE = { units: 1, tens: 10, hundreds: 100, thousands: 1000 };
const PLACE_LABEL = {
  units: { one: 'unidad', many: 'unidades' },
  tens: { one: 'decena', many: 'decenas' },
  hundreds: { one: 'centena', many: 'centenas' },
  thousands: { one: 'unidad de mil', many: 'unidades de mil' },
};

/** Number of place-value columns a grade works with. */
const columnsForGrade = (grade) => (grade === 4 ? 4 : 3);
const placesFor = (count) => PLACES.slice(0, count);

// ---------------------------------------------------------------------------
// 2. Small pure utilities
// ---------------------------------------------------------------------------
const randInt = (min, max) => crypto.randomInt(min, max + 1); // inclusive
const pick = (arr) => arr[randInt(0, arr.length - 1)];
const label = (place, n) => (n === 1 ? PLACE_LABEL[place].one : PLACE_LABEL[place].many);

/** 352 -> { units: 2, tens: 5, hundreds: 3 } */
function digitsOf(n, count) {
  const out = {};
  placesFor(count).forEach((p, i) => { out[p] = Math.floor(n / 10 ** i) % 10; });
  return out;
}

/** { hundreds: 3, tens: 5, units: 2 } -> 352  (accepts non-canonical counts) */
function valueOf(composition) {
  return PLACES.reduce((acc, p) => acc + (composition[p] || 0) * PLACE_VALUE[p], 0);
}

// Spanish number words (0 – 9 999) for "write the number" style prompts.
const SMALL = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho',
  'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco',
  'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
const TENS_W = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const HUNDREDS_W = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos',
  'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

function below100(n) {
  if (n < 30) return SMALL[n];
  const t = Math.floor(n / 10), u = n % 10;
  return u ? `${TENS_W[t]} y ${SMALL[u]}` : TENS_W[t];
}
function below1000(n) {
  if (n === 100) return 'cien';
  if (n < 100) return below100(n);
  const h = Math.floor(n / 100), r = n % 100;
  return r ? `${HUNDREDS_W[h]} ${below100(r)}` : HUNDREDS_W[h];
}
function toSpanishWords(n) {
  if (n < 1000) return below1000(n);
  const th = Math.floor(n / 1000), r = n % 1000;
  const head = th === 1 ? 'mil' : `${below1000(th)} mil`;
  return r ? `${head} ${below1000(r)}` : head;
}

// ---------------------------------------------------------------------------
// 3. Stateless signing (HMAC-SHA256)  — replaces any need for a database
// ---------------------------------------------------------------------------
const b64url = (buf) => Buffer.from(buf).toString('base64url');

function sign(payload) {
  const body = b64url(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', CONFIG.secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', CONFIG.secret).update(body).digest('base64url');
  const a = Buffer.from(mac || ''), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
}

// ---------------------------------------------------------------------------
// 4. Math engine — column algorithms exactly as taught in school
// ---------------------------------------------------------------------------
/**
 * Column addition. `regroups[place] === true` means "a 1 was carried INTO
 * this column" (the little 1 the child writes above it).
 */
function columnAddition(a, b, count) {
  const places = placesFor(count);
  const da = digitsOf(a, count), db = digitsOf(b, count);
  const digits = {}, regroups = {}, steps = [];
  let carry = 0;
  places.forEach((p, i) => {
    const s = da[p] + db[p] + carry;
    digits[p] = s % 10;
    steps.push({ place: p, top: da[p], bottom: db[p], carry_in: carry, sum: s });
    carry = s >= 10 ? 1 : 0;
    if (i + 1 < places.length) regroups[places[i + 1]] = carry === 1;
  });
  return { result: a + b, digits, regroups, steps };
}

/**
 * Column subtraction (standard borrowing). `regroups[place] === true` means
 * "this column LENT 1 to the column on its right" (the crossed-out digit).
 * Handles borrowing across zeros (e.g. 3005 - 1278).
 */
function columnSubtraction(a, b, count) {
  const places = placesFor(count);
  const da = digitsOf(a, count), db = digitsOf(b, count);
  const digits = {}, regroups = {}, steps = [];
  let borrowIn = 0;
  places.forEach((p, i) => {
    let top = da[p] - borrowIn;
    let borrowOut = 0;
    if (top < db[p]) { top += 10; borrowOut = 1; }
    digits[p] = top - db[p];
    steps.push({ place: p, top: da[p], bottom: db[p], lent: borrowIn, borrowed: borrowOut, working_top: top });
    if (i + 1 < places.length) regroups[places[i + 1]] = borrowOut === 1;
    borrowIn = borrowOut;
  });
  return { result: a - b, digits, regroups, steps };
}

const countTrue = (obj) => Object.values(obj).filter(Boolean).length;

// ---------------------------------------------------------------------------
// 5. Challenge generators (pedagogical constraints live here)
// ---------------------------------------------------------------------------
const GENERATORS = {
  value(grade) {
    const count = columnsForGrade(grade);
    const min = grade === 4 ? 1000 : 100;
    const max = grade === 4 ? 9999 : 999;
    let target = randInt(min, max);
    // ~30% of the time force an inner zero (e.g. 305, 4071): a classic misconception.
    if (Math.random() < 0.3) {
      const d = digitsOf(target, count);
      d[pick(placesFor(count).slice(0, count - 1))] = 0;
      target = valueOf(d);
    }
    const format = grade === 4 ? pick(['digits', 'words', 'expanded']) : pick(['digits', 'digits', 'expanded']);
    const d = digitsOf(target, count);
    const expanded = placesFor(count).slice().reverse()
      .map((p) => d[p] * PLACE_VALUE[p]).filter(Boolean).join(' + ');
    const shown = format === 'words' ? `"${toSpanishWords(target)}"` : format === 'expanded' ? expanded : String(target);
    return {
      prompt: { format, text: `Construye el número ${shown} con bloques.` },
      data: { target, target_words: toSpanishWords(target) },
      meta: { inner_zero: Object.values(d).slice(0, count - 1).includes(0) },
    };
  },

  addition(grade) {
    const count = columnsForGrade(grade);
    const [lo, hi, cap] = grade === 4 ? [1000, 8999, 9999] : [100, 899, 999];
    const minRegroups = grade === 4 ? 2 : 1;
    for (let tries = 0; tries < 500; tries++) {
      const a = randInt(lo, hi), b = randInt(lo, hi);
      if (a + b > cap) continue;
      const col = columnAddition(a, b, count);
      if (countTrue(col.regroups) < minRegroups) continue;
      return {
        prompt: { format: 'column', text: `Resuelve la suma llevando cuando sea necesario: ${a} + ${b}` },
        data: { operands: [a, b], operator: '+', digits: { top: digitsOf(a, count), bottom: digitsOf(b, count) } },
        meta: { regroups_required: countTrue(col.regroups) },
      };
    }
    throw new Error('Could not generate addition challenge');
  },

  subtraction(grade) {
    const count = columnsForGrade(grade);
    const [lo, hi] = grade === 4 ? [2000, 9999] : [200, 999];
    for (let tries = 0; tries < 500; tries++) {
      let a = randInt(lo, hi);
      // Grade 4: sometimes force zeros so the child must borrow across them.
      if (grade === 4 && Math.random() < 0.3) a = Math.floor(a / 1000) * 1000 + randInt(0, 9);
      const b = randInt(Math.floor(lo / 2), a - 1);
      const col = columnSubtraction(a, b, count);
      if (countTrue(col.regroups) < 1) continue;
      return {
        prompt: { format: 'column', text: `Resuelve la resta pidiendo prestado cuando sea necesario: ${a} − ${b}` },
        data: { operands: [a, b], operator: '-', digits: { top: digitsOf(a, count), bottom: digitsOf(b, count) } },
        meta: { regroups_required: countTrue(col.regroups) },
      };
    }
    throw new Error('Could not generate subtraction challenge');
  },
};

function createChallenge(module, grade) {
  const gen = GENERATORS[module](grade);
  const count = columnsForGrade(grade);
  const id = crypto.randomUUID();
  const token = sign({ id, module, grade, data: gen.data, iat: Date.now() });
  return {
    challenge_id: id,
    challenge_token: token,
    module,
    grade,
    places: placesFor(count).slice().reverse(), // most significant first, for UI columns
    ...gen,
  };
}

// ---------------------------------------------------------------------------
// 6. Validators — every answer is recomputed server-side
// ---------------------------------------------------------------------------
class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

const isInt = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;

/** Stars: base (3 perfect / 2 imperfect) minus one per extra attempt, floor of 1. */
const starsFor = (base, attempts) => Math.max(1, base - Math.min(attempts - 1, 2));

function buildReward(stars, grade, challengeId) {
  const coins = stars * 10 + (grade === 4 ? 5 : 0);
  const nonce = crypto.randomUUID();
  return { stars, coins, nonce, token: sign({ nonce, challenge_id: challengeId, stars, coins, iat: Date.now() }) };
}

/** Resolve the authoritative challenge data: signed token wins over raw client fields. */
function resolveChallenge(body) {
  if (body.challenge_token != null) {
    const payload = verify(body.challenge_token);
    if (!payload) throw new HttpError(400, 'Invalid challenge_token signature.');
    if (Date.now() - payload.iat > CONFIG.challengeTtlMs) throw new HttpError(410, 'Challenge expired. Request a new one.');
    if (payload.module !== body.module) throw new HttpError(400, 'challenge_token does not match module.');
    return { grade: payload.grade, data: payload.data, id: payload.id, signed: true };
  }
  // Unsigned mode (useful for tools like Postman / curl): validate raw inputs.
  const grade = body.grade === undefined ? null : Number(body.grade);
  if (grade !== null && !GRADES.includes(grade)) throw new HttpError(400, 'grade must be 3 or 4.');
  return { grade, data: body, id: null, signed: false };
}

const VALIDATORS = {
  value(body, ch, attempts) {
    const target = ch.data.target;
    if (!isInt(target, 1, 9999)) throw new HttpError(400, 'target must be an integer 1–9999.');
    const grade = ch.grade ?? (target >= 1000 ? 4 : 3);
    const count = columnsForGrade(grade);
    if (target >= 10 ** count) throw new HttpError(400, `target ${target} is out of range for grade ${grade}.`);
    const comp = body.client_composition;
    if (!comp || typeof comp !== 'object') throw new HttpError(400, 'client_composition object is required.');
    for (const p of PLACES) {
      if (comp[p] !== undefined && !isInt(comp[p], 0, 99)) throw new HttpError(400, `client_composition.${p} must be an integer 0–99.`);
    }

    const built = valueOf(comp);
    const expected = digitsOf(target, count);
    const canonical = placesFor(count).every((p) => (comp[p] || 0) === expected[p]) && valueOf(expected) === target;
    const correct = built === target;

    const columns = placesFor(count).slice().reverse().map((p) => ({
      place: p, label: PLACE_LABEL[p].many, received: comp[p] || 0,
      expected: correct || attempts >= 3 ? expected[p] : undefined,
      ok: (comp[p] || 0) === expected[p],
    }));

    let message, hint = null;
    if (correct && canonical) {
      message = `¡Excelente! ${target} = ${placesFor(count).slice().reverse()
        .map((p) => `${expected[p]} ${label(p, expected[p])}`).join(', ')}.`;
    } else if (correct) {
      message = `¡Correcto! Tu construcción vale ${target}.`;
      hint = 'Truco: 10 bloques de un tipo se pueden cambiar por 1 bloque del siguiente. ¡Intenta usar la menor cantidad de bloques!';
    } else {
      const diff = built - target;
      const wrong = columns.find((c) => !c.ok);
      message = diff > 0
        ? `Tu construcción vale ${built}. ¡Te pasaste por ${diff}!`
        : `Tu construcción vale ${built}. Te faltan ${-diff}.`;
      if (wrong) {
        hint = attempts >= 2
          ? `El número ${target} tiene ${expected[wrong.place]} ${label(wrong.place, expected[wrong.place])}, y tú pusiste ${wrong.received}.`
          : `Revisa los bloques de las ${wrong.label}.`;
      }
    }
    const base = canonical ? 3 : 2;
    return { correct, grade, base, message, hint, columns, solution: correct || attempts >= 3 ? { target, composition: expected } : undefined };
  },

  addition: (body, ch, attempts) => validateColumnOp('addition', body, ch, attempts),
  subtraction: (body, ch, attempts) => validateColumnOp('subtraction', body, ch, attempts),
};

function validateColumnOp(module, body, ch, attempts) {
  const ops = ch.data.operands;
  if (!Array.isArray(ops) || ops.length !== 2 || !ops.every((n) => isInt(n, 0, 9999))) {
    throw new HttpError(400, 'operands must be an array of two integers 0–9999.');
  }
  const [a, b] = ops;
  if (module === 'subtraction' && b > a) throw new HttpError(400, 'For subtraction, operands[0] must be >= operands[1].');
  const grade = ch.grade ?? (Math.max(a, b) >= 1000 ? 4 : 3);
  const count = columnsForGrade(grade);
  const places = placesFor(count);
  const col = module === 'addition' ? columnAddition(a, b, count) : columnSubtraction(a, b, count);
  if (col.result > 10 ** count - 1) throw new HttpError(400, 'Result exceeds the columns for this grade.');

  // Normalize answer: either an integer or { hundreds, tens, units, ... } digits.
  let answer = body.client_answer;
  if (Number.isInteger(answer)) answer = digitsOf(answer, count);
  if (!answer || typeof answer !== 'object') throw new HttpError(400, 'client_answer (integer or digit object) is required.');
  for (const p of places) {
    if (!isInt(answer[p], 0, 9)) throw new HttpError(400, `client_answer.${p} must be a digit 0–9.`);
  }
  const received = valueOf(answer);
  const correct = received === col.result;

  const regroupsGiven = body.client_regroups && typeof body.client_regroups === 'object';
  const regroupsOk = !regroupsGiven || places.slice(1).every((p) => Boolean(body.client_regroups[p]) === col.regroups[p]);

  const reveal = correct || attempts >= 3;
  const columns = places.slice().reverse().map((p) => ({
    place: p, label: PLACE_LABEL[p].many,
    received: answer[p], ok: answer[p] === col.digits[p],
    expected: reveal ? col.digits[p] : undefined,
    regroup_expected: p === 'units' ? undefined : (reveal ? col.regroups[p] : undefined),
    regroup_ok: p === 'units' || !regroupsGiven ? undefined : Boolean(body.client_regroups[p]) === col.regroups[p],
  }));

  const verb = module === 'addition' ? 'llevar' : 'pedir prestado';
  let message, hint = null;
  if (correct && regroupsOk) {
    message = module === 'addition'
      ? `¡Perfecto! ${a} + ${b} = ${col.result}. ¡Llevaste muy bien!`
      : `¡Perfecto! ${a} − ${b} = ${col.result}. ¡Pediste prestado como un experto!`;
  } else if (correct) {
    message = `¡El resultado ${col.result} es correcto!`;
    const bad = columns.find((c) => c.regroup_ok === false);
    hint = `Pero revisa las marcas de ${verb} en las ${bad.label}.`;
  } else {
    message = 'Casi lo logras. ¡Vamos a revisar columna por columna!';
    // First wrong column, right to left — like the child works.
    const idx = places.findIndex((p) => answer[p] !== col.digits[p]);
    const step = col.steps[idx];
    hint = attempts >= 2 ? explainStep(module, step, places[idx + 1]) : `Revisa la columna de las ${PLACE_LABEL[step.place].many}.`;
  }
  const base = regroupsOk ? 3 : 2;
  return {
    correct, grade, base, message, hint, columns,
    solution: reveal ? { result: col.result, digits: col.digits, regroups: col.regroups } : undefined,
  };
}

function explainStep(module, s, nextPlace) {
  const here = PLACE_LABEL[s.place].many;
  const next = nextPlace ? PLACE_LABEL[nextPlace].one : '';
  if (module === 'addition') {
    const carry = s.carry_in ? ' + 1 (que llevabas)' : '';
    return s.sum >= 10
      ? `En las ${here}: ${s.top} + ${s.bottom}${carry} = ${s.sum}. Escribe ${s.sum % 10} y lleva 1 a la siguiente columna.`
      : `En las ${here}: ${s.top} + ${s.bottom}${carry} = ${s.sum}.`;
  }
  let text = `En las ${here}: `;
  if (s.lent && s.top === 0) text += `tenías 0 y tuviste que prestar, así que primero pide 1 ${next}: 10, prestas 1 y te quedan 9. `;
  else if (s.lent) text += `esta columna prestó 1, ahora tiene ${s.top - 1}. `;
  if (s.borrowed && !(s.lent && s.top === 0)) {
    text += `${s.top - s.lent} es menor que ${s.bottom}, pide prestada 1 ${next}: tienes ${s.working_top}. `;
  }
  return `${text}${s.working_top} − ${s.bottom} = ${s.working_top - s.bottom}.`;
}

function validate(body) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'JSON body required.');
  if (!MODULES.includes(body.module)) throw new HttpError(400, `module must be one of: ${MODULES.join(', ')}.`);
  const attempts = body.attempt === undefined ? 1 : Number(body.attempt);
  if (!isInt(attempts, 1, 50)) throw new HttpError(400, 'attempt must be an integer 1–50.');

  const ch = resolveChallenge(body);
  const r = VALIDATORS[body.module](body, ch, attempts);
  const stars = r.correct ? starsFor(r.base, attempts) : 0;
  return {
    correct: r.correct,
    stars_earned: stars,
    coins_earned: r.correct ? stars * 10 + (r.grade === 4 ? 5 : 0) : 0,
    feedback_message: r.message,
    feedback: { hint: r.hint, columns: r.columns, attempt: attempts },
    solution: r.solution,
    verified_challenge: ch.signed,
    reward: r.correct ? buildReward(stars, r.grade, ch.id) : null,
  };
}

// ---------------------------------------------------------------------------
// 7. CORS middleware — explicit allowlist, credentials-safe
// ---------------------------------------------------------------------------
// Local development + LAN testing (phones on the same Wi-Fi), any port.
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|[\w-]+\.localhost|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})(:\d{1,5})?$/;

/**
 * @param {{ allowed?: string[], allowLocal?: boolean }} o
 *   allowed: exact origins (scheme://host[:port]); "*" reflects any origin.
 */
export function createCorsPolicy({ allowed = [], allowLocal = true } = {}) {
  const exact = new Set(allowed);
  const any = exact.has('*');
  return {
    isAllowed(origin) {
      if (!origin || origin === 'null') return false;
      return any || exact.has(origin) || (allowLocal && LOCAL_ORIGIN.test(origin));
    },
  };
}

const corsPolicy = createCorsPolicy({ allowed: CONFIG.allowedOrigins, allowLocal: CONFIG.allowLocalOrigins });

/**
 * CORS middleware. Echoes an ALLOWED origin (never "*", so credentialed
 * requests work) and answers preflights. Returns true if it ended the response.
 */
function cors(req, res) {
  const origin = req.headers.origin;
  const allowed = corsPolicy.isAllowed(origin);
  res.setHeader('Vary', 'Origin');
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  if (req.method !== 'OPTIONS') return false;
  if (!allowed) {
    send(res, 403, { error: 'Origin not allowed by CORS policy.' });
    return true;
  }
  res.writeHead(204, {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
  });
  res.end();
  return true;
}

// ---------------------------------------------------------------------------
// 8. HTTP layer (tiny router, JSON body parsing)
// ---------------------------------------------------------------------------
function send(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload === undefined ? '' : JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > CONFIG.maxBodyBytes) { reject(new HttpError(413, 'Payload too large.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new HttpError(400, 'Malformed JSON.')); }
    });
    req.on('error', reject);
  });
}

const ROUTES = {
  'GET /': async () => ({
    name: 'Math 3D — stateless educational engine',
    status: 'ok',
    endpoints: ['GET /api/health', 'GET /api/challenges?grade=3|4&module=value|addition|subtraction', 'POST /api/validate'],
  }),

  'GET /api/health': async () => ({
    status: 'ok', stateless: true, modules: MODULES, grades: GRADES, uptime_s: Math.round(process.uptime()),
  }),

  'GET /api/challenges': async (_req, url) => {
    const grade = Number(url.searchParams.get('grade') ?? 3);
    const module = url.searchParams.get('module') ?? 'value';
    if (!GRADES.includes(grade)) throw new HttpError(400, 'grade must be 3 or 4.');
    if (!MODULES.includes(module)) throw new HttpError(400, `module must be one of: ${MODULES.join(', ')}.`);
    return createChallenge(module, grade);
  },

  'POST /api/validate': async (req) => validate(await readJson(req)),
};

export function createServer() {
  const server = http.createServer(async (req, res) => {
    if (cors(req, res)) return;
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const handler = ROUTES[`${req.method === 'HEAD' ? 'GET' : req.method} ${path}`];
    if (!handler) return send(res, 404, { error: 'Not found' });
    try {
      send(res, 200, await handler(req, url));
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      send(res, status, { error: status === 500 ? 'Internal server error' : err.message });
    }
  });
  // Behind Render's load balancer: keep idle sockets open longer than the proxy does.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  return server;
}

/** Listen + graceful shutdown (Render sends SIGTERM on every deploy). */
export function start({ port = CONFIG.port, host = CONFIG.host } = {}) {
  const server = createServer();
  server.listen(port, host, () => {
    const { port: bound } = server.address();
    console.log(`🧮  Math 3D engine on port ${bound} [${CONFIG.env}] — stateless, no DB`);
    console.log(`    CORS: ${CONFIG.allowedOrigins.length ? CONFIG.allowedOrigins.join(', ') : '(no production origins)'}${CONFIG.allowLocalOrigins ? ' + localhost/LAN' : ''}`);
    if (CONFIG.env === 'production' && !CONFIG.allowedOrigins.length) {
      console.warn('⚠️  ALLOWED_ORIGINS is empty: browsers on your production frontend will be blocked by CORS.');
    }
    if (CONFIG.env === 'production' && !CONFIG.secretFromEnv) {
      console.warn('⚠️  GAME_SECRET is not set: challenge tokens become invalid every time the instance restarts.');
    }
  });
  const shutdown = (signal) => {
    console.log(`${signal} received — closing server…`);
    server.close(() => process.exit(0));
    server.closeIdleConnections?.();
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  return server;
}

// Exported for unit tests.
export { columnAddition, columnSubtraction, createChallenge, validate, toSpanishWords, parseOrigins };

if (process.argv[1] === fileURLToPath(import.meta.url)) start();
