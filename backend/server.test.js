import { test } from 'node:test';
import assert from 'node:assert/strict';
import { columnAddition, columnSubtraction, createChallenge, validate, toSpanishWords } from './server.js';

test('column addition tracks carries into each column', () => {
  const r = columnAddition(357, 268, 3);
  assert.equal(r.result, 625);
  assert.deepEqual(r.digits, { units: 5, tens: 2, hundreds: 6 });
  assert.deepEqual(r.regroups, { tens: true, hundreds: true });
});

test('column subtraction borrows across zeros', () => {
  const r = columnSubtraction(3005, 1278, 4);
  assert.equal(r.result, 1727);
  assert.deepEqual(r.regroups, { tens: true, hundreds: true, thousands: true });
});

test('spanish number words', () => {
  assert.equal(toSpanishWords(352), 'trescientos cincuenta y dos');
  assert.equal(toSpanishWords(100), 'cien');
  assert.equal(toSpanishWords(4071), 'cuatro mil setenta y uno');
});

test('place value: canonical answer earns 3 stars, non-canonical 2', () => {
  const ok = validate({ module: 'value', target: 352, client_composition: { hundreds: 3, tens: 5, units: 2 } });
  assert.equal(ok.correct, true); assert.equal(ok.stars_earned, 3); assert.ok(ok.reward.token);
  const alt = validate({ module: 'value', target: 352, client_composition: { hundreds: 2, tens: 15, units: 2 } });
  assert.equal(alt.correct, true); assert.equal(alt.stars_earned, 2);
  const bad = validate({ module: 'value', target: 352, client_composition: { hundreds: 3, tens: 6, units: 2 } });
  assert.equal(bad.correct, false); assert.equal(bad.stars_earned, 0); assert.equal(bad.reward, null);
});

test('signed challenge round-trip and tamper detection', () => {
  for (const module of ['value', 'addition', 'subtraction']) {
    for (const grade of [3, 4]) {
      const ch = createChallenge(module, grade);
      assert.ok(ch.challenge_token);
      if (module !== 'value') assert.ok(ch.meta.regroups_required >= 1);
    }
  }
  const ch = createChallenge('addition', 3);
  const [a, b] = ch.data.operands;
  const res = validate({ module: 'addition', challenge_token: ch.challenge_token, operands: [1, 1], client_answer: a + b });
  assert.equal(res.correct, true, 'server must use signed operands, not client ones');
  assert.throws(() => validate({ module: 'addition', challenge_token: ch.challenge_token + 'x', client_answer: 1 }));
});

test('wrong regroup marks cost a star but stay correct', () => {
  const r = validate({ module: 'addition', operands: [357, 268], client_answer: 625, client_regroups: { tens: false, hundreds: true } });
  assert.equal(r.correct, true); assert.equal(r.stars_earned, 2);
});

// ---------------------------------------------------------------- production
import { createServer, createCorsPolicy, parseOrigins } from './server.js';

test('parseOrigins trims spaces and trailing slashes', () => {
  assert.deepEqual(parseOrigins(' https://a.onrender.com/ , http://localhost:5173 '), ['https://a.onrender.com', 'http://localhost:5173']);
  assert.deepEqual(parseOrigins(''), []);
});

test('CORS policy: exact production origin + local/LAN origins only', () => {
  const cors = createCorsPolicy({ allowed: ['https://math3d-web.onrender.com'], allowLocal: true });
  assert.equal(cors.isAllowed('https://math3d-web.onrender.com'), true);
  assert.equal(cors.isAllowed('http://localhost:5173'), true);
  assert.equal(cors.isAllowed('http://127.0.0.1:8080'), true);
  assert.equal(cors.isAllowed('http://192.168.1.20:5173'), true);
  assert.equal(cors.isAllowed('https://evil.example.com'), false);
  assert.equal(cors.isAllowed('https://math3d-web.onrender.com.evil.com'), false);
  assert.equal(cors.isAllowed(undefined), false);
  const strict = createCorsPolicy({ allowed: ['https://math3d-web.onrender.com'], allowLocal: false });
  assert.equal(strict.isAllowed('http://localhost:5173'), false);
});

test('HTTP: health, credentialed CORS preflight, rejected origin', async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await fetch(`${base}/api/health`, { headers: { Origin: 'http://localhost:5173' } });
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.equal(health.headers.get('access-control-allow-credentials'), 'true');
    assert.equal((await health.json()).status, 'ok');

    const pre = await fetch(`${base}/api/validate`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
    });
    assert.equal(pre.status, 204);
    assert.match(pre.headers.get('access-control-allow-methods'), /POST/);

    const evil = await fetch(`${base}/api/validate`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example.com' } });
    assert.equal(evil.status, 403);
    assert.equal(evil.headers.get('access-control-allow-origin'), null);

    const root = await fetch(`${base}/`);
    assert.equal(root.status, 200);
  } finally {
    server.close();
  }
});
