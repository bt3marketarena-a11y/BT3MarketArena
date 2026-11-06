import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';

const VALID_CA = 'So11111111111111111111111111111111111111112';
const ADMIN_KEY = 'test-admin-key-molto-lunga';
let instance = 0;

// Ogni test ha una Function nuova: stato, limitatore e SSE vivono nel modulo.
async function startApi(t, { adminKey = ADMIN_KEY } = {}) {
  const previous = process.env.ADMIN_KEY;
  if (adminKey === null) delete process.env.ADMIN_KEY; else process.env.ADMIN_KEY = adminKey;
  instance += 1;
  const { default: handler } = await import(`../api/state.mjs?api=${instance}`);
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    server.close();
    if (previous === undefined) delete process.env.ADMIN_KEY; else process.env.ADMIN_KEY = previous;
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const write = (body, { method = 'PATCH', key = ADMIN_KEY, headers = {} } = {}) => fetch(`${base}/api/state`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}), ...headers },
    body: JSON.stringify(body),
  });
  return { base, write, port: server.address().port };
}

function openSse(port) {
  return new Promise((resolve, reject) => {
    const request = http.get({ port, host: '127.0.0.1', path: '/api/events', agent: false }, (response) => {
      response.setEncoding('utf8');
      resolve({ request, response });
    });
    request.on('error', reject);
  });
}

test('GET è pubblico e non espone mai la chiave admin', async (t) => {
  const { base } = await startApi(t);
  const response = await fetch(`${base}/api/state`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const text = await response.text();
  assert.equal(text.includes(ADMIN_KEY), false);
  assert.equal(JSON.parse(text).revision, 0);
  assert.equal((await fetch(`${base}/api/state`, { method: 'HEAD' })).status, 200);
});

test('senza ADMIN_KEY sul server ogni scrittura è rifiutata', async (t) => {
  const { write } = await startApi(t, { adminKey: null });
  assert.equal((await write({ whaleThreshold: 5 })).status, 503);
});

test('la scrittura richiede la chiave giusta e accetta anche x-admin-key', async (t) => {
  const { base, write } = await startApi(t);
  assert.equal((await write({ whaleThreshold: 5 }, { key: null })).status, 401);
  assert.equal((await write({ whaleThreshold: 5 }, { key: 'sbagliata' })).status, 401);
  assert.equal((await (await fetch(`${base}/api/state`)).json()).revision, 0, 'nessuna scrittura è passata');
  const viaHeader = await write({ whaleThreshold: 5 }, { key: null, headers: { 'x-admin-key': ADMIN_KEY } });
  assert.equal(viaHeader.status, 200);
  assert.equal((await viaHeader.json()).whaleThreshold, 5);
});

test('il CA salvato torna identico e PUT funziona come PATCH', async (t) => {
  const { base, write } = await startApi(t);
  const saved = await (await write({ source: 'pumpportal', ca: VALID_CA }, { method: 'PUT' })).json();
  assert.equal(saved.ca, VALID_CA);
  assert.equal(saved.revision, 1);
  const read = await (await fetch(`${base}/api/state`)).json();
  assert.equal(read.ca, VALID_CA);
  assert.equal(read.source, 'pumpportal');
});

test('dopo 10 chiavi sbagliate lo stesso IP è bloccato, anche con la chiave giusta', async (t) => {
  const { write } = await startApi(t);
  const headers = { 'x-forwarded-for': '203.0.113.7' };
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal((await write({}, { key: 'sbagliata', headers })).status, 401);
  }
  assert.equal((await write({}, { key: ADMIN_KEY, headers })).status, 429);
  assert.equal((await write({}, { key: ADMIN_KEY, headers: { 'x-forwarded-for': '203.0.113.8' } })).status, 200, 'un altro IP non è toccato');
});

test('i client SSE ricevono lo stato iniziale e ogni salvataggio', async (t) => {
  const { port, write } = await startApi(t);
  const { request, response } = await openSse(port);
  t.after(() => request.destroy());
  assert.match(response.headers['content-type'], /text\/event-stream/);
  let received = '';
  const until = (pattern) => new Promise((resolve) => {
    const onData = (chunk) => { received += chunk; check(); };
    const check = () => { if (pattern.test(received)) { response.off('data', onData); resolve(); } };
    response.on('data', onData);
    check();
  });
  await until(/"revision":0/);
  await write({ whaleThreshold: 7 });
  await until(/"revision":1/);
  assert.match(received, /"whaleThreshold":7/);
});

test('oltre 100 connessioni SSE per istanza la successiva riceve 503, poi il posto si libera', async (t) => {
  const { port, base } = await startApi(t);
  const clients = await Promise.all(Array.from({ length: 100 }, () => openSse(port)));
  t.after(() => clients.forEach(({ request }) => request.destroy()));
  assert.equal((await fetch(`${base}/api/events`)).status, 503);
  assert.equal((await fetch(`${base}/api/state`)).status, 200, 'le letture normali restano servite');
  clients[0].request.destroy();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const again = await openSse(port);
  assert.equal(again.response.statusCode, 200);
  again.request.destroy();
});
