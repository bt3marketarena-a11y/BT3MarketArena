import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';

async function importHandler() {
  return (await import(`../api/index.mjs?test=${Date.now()}`)).default;
}

test('Vercel espone un handler HTTP che non avvia listener né scrive sul disco', async (t) => {
  const previous = { vercel: process.env.VERCEL, stateFile: process.env.STATE_FILE, adminKey: process.env.ADMIN_KEY };
  process.env.VERCEL = '1';
  process.env.STATE_FILE = 'artifacts/vercel-forbidden/cloud-state.json';
  process.env.ADMIN_KEY = 'test-admin-key';
  const handler = await importHandler();
  assert.equal(typeof handler, 'function');
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.close();
    await once(server, 'close');
    if (previous.vercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = previous.vercel;
    if (previous.stateFile === undefined) delete process.env.STATE_FILE; else process.env.STATE_FILE = previous.stateFile;
    if (previous.adminKey === undefined) delete process.env.ADMIN_KEY; else process.env.ADMIN_KEY = previous.adminKey;
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${base}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });
  const mutation = await fetch(`${base}/api/state`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-key' },
    body: '{}',
  });
  assert.equal(mutation.status, 200);
  assert.equal(existsSync(process.env.STATE_FILE), false);
});

test('Vercel restituisce errori dell’handler come JSON diagnostico', async () => {
  const handler = await importHandler();
  const response = {
    headersSent: false,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; },
  };
  await handler({ url: 'http://[invalid', headers: {}, on() {} }, response);
  assert.equal(response.status, 500);
  const error = JSON.parse(response.body);
  assert.match(error.error, /Invalid URL/);
  assert.match(error.stack, /server\.mjs/);
});

test('il cold boot Vercel carica server e bundler soltanto dentro al handler protetto', async () => {
  const api = await readFile(new URL('../api/index.mjs', import.meta.url), 'utf8');
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(api, /^import \{ createArenaServer \}/m);
  assert.match(api, /import\('\.\.\/server\.mjs'\)/);
  assert.doesNotMatch(server, /^import \{ createInjectionBundle \}/m);
  assert.match(server, /import\('\.\/injectionBundle\.mjs'\)/);
});

test('Vercel esternalizza gli asset pesanti, include i file runtime e ignora artefatti locali', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.rewrites.at(-1), { source: '/(.*)', destination: '/api/index.mjs' });
  for (const extension of ['wasm', 'data', 'bin', 'pak', 'mp3', 'ogg', 'png']) {
    const rewrite = config.rewrites.find((item) => item.source === `/:path*.${extension}`);
    assert.deepEqual(rewrite, { source: `/:path*.${extension}`, destination: `https://dragonballbt3.online/:path*.${extension}` });
  }
  assert.equal(config.functions['api/index.mjs'].maxDuration, 300);
  assert.equal(config.functions['api/index.mjs'].includeFiles, '{*.js,*.mjs,*.html,*.css}');
  const ignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.match(ignore, /^node_modules\/$/m);
  assert.match(ignore, /^artifacts\/$/m);
  assert.match(ignore, /^\.playwright\/$/m);
});
