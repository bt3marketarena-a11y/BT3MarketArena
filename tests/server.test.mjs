import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createArenaServer, injectBundle } from '../scripts/arenaServer.mjs';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  server.close();
  await once(server, 'close');
}

async function fixture(t) {
  const upstream = http.createServer((req, res) => {
    if (req.url.startsWith('/runtime.html')) {
      const body = '<!doctype html><html><head><meta charset="utf-8"><script src="/engine.js"></script></head><body><canvas></canvas></body></html>';
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Content-Security-Policy': "script-src 'self'",
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Opener-Policy': 'same-origin',
      });
      res.end(body);
      return;
    }
    if (req.url === '/asset.wasm?x=1') {
      assert.equal(req.headers.range, 'bytes=0-3');
      res.writeHead(206, { 'Content-Type': 'application/wasm', 'Content-Range': 'bytes 0-3/8' });
      res.end(Buffer.from([0, 97, 115, 109]));
      return;
    }
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: `${upstreamBase}/runtime.html?hud=0` });
      res.end();
      return;
    }
    res.writeHead(404).end();
  });
  const upstreamBase = await listen(upstream);
  const arena = createArenaServer({
    upstreamOrigin: upstreamBase,
    bundle: 'window.__BT3_TEST_BUNDLE__=1;',
    adminKey: 'test-admin-key',
    stateFile: null,
  });
  const base = await listen(arena);
  t.after(async () => { await close(arena); await close(upstream); });
  return { base, upstreamBase };
}

test('injectBundle posiziona il bundle nel primo head prima degli script', () => {
  const html = injectBundle('<html><head><script src="engine.js"></script></head></html>', 'window.INJECTED=1;');
  assert.ok(html.indexOf('window.INJECTED=1') < html.indexOf('<script src'));
});

test('il proxy inietta il runtime e rimuove soltanto gli header HTML non più validi', async (t) => {
  const { base } = await fixture(t);
  const response = await fetch(`${base}/runtime.html?hud=0`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.ok(html.indexOf('__BT3_TEST_BUNDLE__') < html.indexOf('<script src'));
  assert.equal(response.headers.get('content-security-policy'), null);
  assert.equal(response.headers.get('content-length'), null);
  assert.equal(response.headers.get('cross-origin-embedder-policy'), 'require-corp');
  assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin');
});

test('il proxy conserva byte Wasm, query, Range e status parziale', async (t) => {
  const { base } = await fixture(t);
  const response = await fetch(`${base}/asset.wasm?x=1`, { headers: { Range: 'bytes=0-3' } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 0-3/8');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([0, 97, 115, 109]));
});

test('la root apre il runtime e i redirect upstream restano same-origin', async (t) => {
  const { base } = await fixture(t);
  const root = await fetch(base, { redirect: 'manual' });
  assert.equal(root.status, 302);
  assert.match(root.headers.get('location'), /^\/runtime\.html\?hud=0/);
  const redirect = await fetch(`${base}/redirect`, { redirect: 'manual' });
  assert.equal(redirect.headers.get('location'), '/runtime.html?hud=0');
});

test('healthz risponde senza contattare il motore upstream', async (t) => {
  const { base } = await fixture(t);
  const response = await fetch(`${base}/healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test('la mutazione CA richiede ADMIN_KEY e non la espone nello stato', async (t) => {
  const { base } = await fixture(t);
  const unauthorized = await fetch(`${base}/api/state`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(unauthorized.status, 401);
  const ca = 'So11111111111111111111111111111111111111112';
  const response = await fetch(`${base}/api/state`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-key' },
    body: JSON.stringify({ source: 'pumpportal', ca }),
  });
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.equal(state.ca, ca);
  assert.doesNotMatch(JSON.stringify(state), /test-admin-key/);
  const publicState = await (await fetch(`${base}/api/state`)).json();
  assert.equal(publicState.ca, ca);
  assert.doesNotMatch(JSON.stringify(publicState), /test-admin-key/);
});

test('SSE invia lo stato iniziale e trasmette subito il nuovo CA', async (t) => {
  const { base } = await fixture(t);
  const response = await fetch(`${base}/api/events`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const nextEvent = async () => {
    while (!buffer.includes('\n\n')) {
      const { done, value } = await reader.read();
      assert.equal(done, false);
      buffer += decoder.decode(value, { stream: true });
    }
    const [event] = buffer.split('\n\n');
    buffer = buffer.slice(event.length + 2);
    return event;
  };
  assert.match(await nextEvent(), /event: state/);
  const ca = 'So11111111111111111111111111111111111111112';
  await fetch(`${base}/api/state`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': 'test-admin-key' },
    body: JSON.stringify({ source: 'pumpportal', ca }),
  });
  const update = await nextEvent();
  assert.match(update, new RegExp(ca));
  await reader.cancel();
});

test('la pagina admin remota carica stato e invia la password senza includerla nel markup', async (t) => {
  const { base } = await fixture(t);
  const response = await fetch(`${base}/admin`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /type="password"/);
  assert.match(html, /\/api\/state/);
  assert.doesNotMatch(html, /test-admin-key/);
});

test('inject=0 riservato al launcher evita una seconda automazione nel container', async (t) => {
  const { base } = await fixture(t);
  const html = await (await fetch(`${base}/runtime.html?inject=0`)).text();
  assert.doesNotMatch(html, /__BT3_TEST_BUNDLE__/);
  assert.match(html, /<script src="\/engine\.js">/);
});

test('il server web accetta host e porta inoltrati da npm run dev', async () => {
  const { resolveListenOptions } = await import('../scripts/arenaServer.mjs');
  assert.deepEqual(resolveListenOptions(['--host', '0.0.0.0', '--port', '7100'], {}), { host: '0.0.0.0', port: 7100 });
  assert.deepEqual(resolveListenOptions(['--port=7200'], { PORT: '3000' }), { host: '0.0.0.0', port: 7200 });
});
