import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';

test('Vercel espone il server HTTP esistente senza persistenza filesystem', async (t) => {
  const { default: server } = await import('../api/index.mjs');
  assert.ok(server instanceof http.Server);
  assert.equal(server.listening, false);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.close();
    await once(server, 'close');
  });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test('Vercel instrada tutte le richieste alla funzione e ignora artefatti locali', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.rewrites, [{ source: '/(.*)', destination: '/api/index.mjs' }]);
  const ignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.match(ignore, /^node_modules\/$/m);
  assert.match(ignore, /^artifacts\/$/m);
  assert.match(ignore, /^\.playwright\/$/m);
});
