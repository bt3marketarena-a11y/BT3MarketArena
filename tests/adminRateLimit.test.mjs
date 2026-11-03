import test from 'node:test';
import assert from 'node:assert/strict';
import { clientIp, createFailureLimiter } from '../adminRateLimit.mjs';

test('dopo troppi ADMIN_KEY sbagliati lo stesso IP resta bloccato fino alla scadenza', async () => {
  let now = 0;
  const limiter = createFailureLimiter({ max: 3, windowSec: 60, now: () => now });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.equal(await limiter.blocked('1.2.3.4'), false);
    await limiter.fail('1.2.3.4');
  }
  assert.equal(await limiter.blocked('1.2.3.4'), true);
  assert.equal(await limiter.blocked('5.6.7.8'), false, 'gli altri IP non sono toccati');
  now = 61_000;
  assert.equal(await limiter.blocked('1.2.3.4'), false, 'il blocco scade');
});

test('con Redis il conteggio è condiviso e scade con EXPIRE', async () => {
  const store = new Map();
  const expires = [];
  const client = {
    get: async (key) => store.get(key) ?? null,
    incr: async (key) => { store.set(key, (store.get(key) ?? 0) + 1); return store.get(key); },
    expire: async (key, seconds) => { expires.push([key, seconds]); },
  };
  const limiter = createFailureLimiter({ client, max: 2, windowSec: 900 });
  await limiter.fail('9.9.9.9');
  await limiter.fail('9.9.9.9');
  assert.equal(await limiter.blocked('9.9.9.9'), true);
  assert.deepEqual(expires, [['bt3:admin-fail:9.9.9.9', 900]]);
});

test('l IP del client arriva dal primo x-forwarded-for di Vercel', () => {
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } }), '203.0.113.7');
  assert.equal(clientIp({ headers: { 'x-real-ip': '198.51.100.2' } }), '198.51.100.2');
});

test('su Vercel conta l IP scritto dalla piattaforma, non quello dichiarato dal client', () => {
  assert.equal(clientIp({ headers: { 'x-vercel-forwarded-for': '203.0.113.9', 'x-forwarded-for': '1.2.3.4' } }), '203.0.113.9');
  assert.equal(clientIp({ headers: { 'x-forwarded-for': 'a'.repeat(500) } }).length, 64);
});
