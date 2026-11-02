import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';

async function importHandler() {
  return (await import(`../api/state.mjs?test=${Date.now()}`)).default;
}

test('la Function API Vercel non avvia listener né scrive sul disco', async (t) => {
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
  const state = await fetch(`${base}/api/state`);
  assert.equal(state.status, 200);
  const publicState = await state.json();
  assert.equal(publicState.source, 'simulation');
  assert.equal(publicState.storage, 'memory');
  const mutation = await fetch(`${base}/api/state`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-key' },
    body: '{}',
  });
  assert.equal(mutation.status, 200);
  assert.equal(existsSync(process.env.STATE_FILE), false);
});

test('la Function API restituisce errori come JSON senza stack trace', async () => {
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
  assert.equal(error.stack, undefined, 'lo stack resta nei log, non nella risposta pubblica');
  assert.doesNotMatch(response.body, /state\.mjs|node_modules|[A-Z]:\\/);
});

test('Vercel forza il routing statico e conserva soltanto la Function state', async () => {
  const { headers: securityHeaders, ...config } = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const headerFor = (source, key) => securityHeaders.filter((rule) => rule.source === source).flatMap((rule) => rule.headers).find((header) => header.key === key)?.value;
  // Home e pannello admin: niente framing (clickjacking), niente MIME sniffing, CSP restrittiva.
  for (const source of ['/', '/index.html', '/ops-:slug(.*)']) {
    assert.equal(headerFor(source, 'X-Frame-Options'), 'DENY', source);
    assert.equal(headerFor(source, 'X-Content-Type-Options'), 'nosniff', source);
    assert.match(headerFor(source, 'Content-Security-Policy'), /frame-ancestors 'none'.*object-src 'none'/, source);
  }
  assert.match(headerFor('/', 'Content-Security-Policy'), /frame-src https:\/\/player\.kick\.com https:\/\/dexscreener\.com/);
  assert.equal(headerFor('/assets/:path*', 'X-Content-Type-Options'), 'nosniff');
  assert.ok(securityHeaders.every((rule) => Array.isArray(rule.headers) && rule.headers.length > 0), 'nessuna regola vuota');
  assert.equal(headerFor('/ops-:slug(.*)', 'X-Robots-Tag'), 'noindex, nofollow');
  assert.equal(headerFor('/bt3-arena-bundle.js', 'Cache-Control'), 'public, max-age=31536000, immutable');
  assert.deepEqual({ ...config, headers: [] }, {
    version: 2,
    framework: null,
    buildCommand: 'npm run build',
    outputDirectory: 'public',
    rewrites: [
      { source: '/api/events', destination: '/api/state?events=1' },
      { source: '/api/(.*)', destination: '/api/$1' },
      {
        source: '/:path((?!$|api(?:/|$)|admin(?:/|$)|assets(?:/|$)|ops-[a-z0-9]+(?:/|$)|index\\.html$|runtime\\.html$|admin\\.html$|bt3-arena-bundle\\.js$|build-manifest\\.json$|og-preview\\.png$).*)',
        destination: 'https://dragonballbt3.online/:path',
      },
    ],
    headers: [],
  });
  assert.equal(existsSync(new URL('../api/state.mjs', import.meta.url)), true);
  assert.equal(existsSync(new URL('../api/index.mjs', import.meta.url)), false);
  const ignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.match(ignore, /^node_modules\/$/m);
  assert.match(ignore, /^artifacts\/$/m);
  assert.match(ignore, /^\.playwright\/$/m);
});

test('Vercel non rileva un server Node implicito nella radice', () => {
  for (const directory of ['../', '../src/']) {
    for (const extension of ['js', 'cjs', 'mjs', 'ts', 'cts', 'mts']) {
      const entrypoint = new URL(`${directory}server.${extension}`, import.meta.url);
      assert.equal(existsSync(entrypoint), false, `Entrypoint Vercel implicito: ${entrypoint.pathname}`);
    }
  }
});
