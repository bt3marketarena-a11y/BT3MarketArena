import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CloudStateStore } from './cloudState.mjs';

export const DEFAULT_UPSTREAM = 'https://dragonballbt3.online';
export const RUNTIME_PATH = '/runtime.html?hud=0&embedded=0&lang=it&env=BT3_SCALE%3D1%2CBT3_INTERP%3D0';

export function injectBundle(html, bundle) {
  const safeBundle = bundle.replace(/<\/script/gi, '<\\/script');
  const injection = `<script data-bt3-market-arena>${safeBundle}</script>`;
  if (/<head(?:\s[^>]*)?>/i.test(html)) return html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${injection}`);
  return `${injection}${html}`;
}

function upstreamHeaders(request, upstreamOrigin) {
  const headers = new Headers();
  const skipped = new Set(['host', 'connection', 'content-length', 'origin', 'referer', 'accept-encoding']);
  for (const [name, value] of Object.entries(request.headers)) {
    if (!skipped.has(name.toLowerCase()) && value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  headers.set('accept-encoding', 'identity');
  headers.set('referer', `${upstreamOrigin}/runtime.html`);
  return headers;
}

async function requestBody(request) {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function rewriteLocation(location, upstreamOrigin) {
  if (!location) return location;
  try {
    const target = new URL(location, upstreamOrigin);
    if (target.origin === upstreamOrigin) return `${target.pathname}${target.search}${target.hash}`;
  } catch { /* Conserva Location non standard senza bloccare la risposta. */ }
  return location;
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  response.end(body);
}

function isAuthorized(request, adminKey) {
  if (!adminKey) return false;
  const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? '')?.[1];
  const supplied = bearer ?? request.headers['x-admin-key'] ?? '';
  const expectedDigest = createHash('sha256').update(String(adminKey)).digest();
  const suppliedDigest = createHash('sha256').update(String(supplied)).digest();
  return timingSafeEqual(expectedDigest, suppliedDigest);
}

async function readJson(request) {
  const body = await requestBody(request);
  if (body.length > 64 * 1024) throw new Error('Payload admin superiore a 64 KiB.');
  return JSON.parse(body.toString('utf8') || '{}');
}

function writeSse(response, state) {
  response.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
}

export function createArenaServer({
  upstreamOrigin = process.env.UPSTREAM_ORIGIN ?? DEFAULT_UPSTREAM,
  fetchImpl = globalThis.fetch,
  bundle = null,
  adminKey = process.env.ADMIN_KEY ?? '',
  stateFile = process.env.VERCEL ? null : process.env.STATE_FILE === undefined ? path.join(process.cwd(), 'artifacts', 'cloud-state.json') : process.env.STATE_FILE || null,
} = {}) {
  const upstream = new URL(upstreamOrigin);
  if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password) throw new Error('UPSTREAM_ORIGIN non valido.');
  upstreamOrigin = upstream.origin;
  let bundlePromise = bundle === null ? null : Promise.resolve(bundle);
  const store = new CloudStateStore({ stateFile });
  const sseClients = new Set();

  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, 'http://arena.local');
    if (requestUrl.pathname === '/healthz') {
      sendJson(response, 200, { ok: true });
      return;
    }
    if (requestUrl.pathname === '/api/state') {
      try {
        if (request.method === 'GET') {
          sendJson(response, 200, await store.get());
          return;
        }
        if (request.method === 'PATCH' || request.method === 'PUT') {
          if (!adminKey) { sendJson(response, 503, { error: 'ADMIN_KEY non configurata sul server.' }); return; }
          if (!isAuthorized(request, adminKey)) { sendJson(response, 401, { error: 'ADMIN_KEY non valida o assente.' }); return; }
          const state = await store.update(await readJson(request));
          for (const client of sseClients) writeSse(client, state);
          sendJson(response, 200, state);
          return;
        }
        sendJson(response, 405, { error: 'Metodo non consentito.' });
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }
      return;
    }
    if (requestUrl.pathname === '/api/events' && request.method === 'GET') {
      try {
        const state = await store.get();
        response.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        response.flushHeaders();
        sseClients.add(response);
        request.on('close', () => sseClients.delete(response));
        writeSse(response, state);
      } catch (error) { sendJson(response, 500, { error: error.message }); }
      return;
    }
    if (requestUrl.pathname === '/admin' && request.method === 'GET') {
      try {
        const html = await readFile(new URL('./admin.html', import.meta.url), 'utf8');
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(html);
      } catch (error) { sendJson(response, 500, { error: error.message }); }
      return;
    }
    if (requestUrl.pathname === '/' && request.method === 'GET') {
      response.writeHead(302, { Location: RUNTIME_PATH, 'Cache-Control': 'no-store' });
      response.end();
      return;
    }
    if (requestUrl.pathname.startsWith('/api/')) {
      sendJson(response, 404, { error: 'Endpoint API non trovato.' });
      return;
    }

    try {
      const target = new URL(`${requestUrl.pathname}${requestUrl.search}`, upstreamOrigin);
      const upstreamResponse = await fetchImpl(target, {
        method: request.method,
        headers: upstreamHeaders(request, upstreamOrigin),
        body: await requestBody(request),
        redirect: 'manual',
        signal: AbortSignal.timeout(120_000),
      });
      const headers = new Headers(upstreamResponse.headers);
      // Node Fetch decodifica il body: lunghezza/encoding upstream non sono più validi.
      headers.delete('content-length');
      headers.delete('content-encoding');
      headers.delete('transfer-encoding');
      headers.delete('connection');
      const location = rewriteLocation(headers.get('location'), upstreamOrigin);
      if (location) headers.set('location', location);

      const contentType = headers.get('content-type') ?? '';
      if (/\btext\/html\b/i.test(contentType)) {
        const html = new TextDecoder().decode(await upstreamResponse.arrayBuffer());
        const injected = requestUrl.searchParams.get('inject') === '0' ? html : injectBundle(html, await (bundlePromise ??= import('./injectionBundle.mjs').then(({ createInjectionBundle }) => createInjectionBundle({ web: true, cloudSync: { enabled: true } }))));
        for (const name of ['content-security-policy', 'content-security-policy-report-only', 'etag', 'content-md5']) headers.delete(name);
        headers.set('content-type', 'text/html; charset=utf-8');
        headers.set('cache-control', 'no-cache');
        response.writeHead(upstreamResponse.status, Object.fromEntries(headers));
        response.end(injected);
        return;
      }

      response.writeHead(upstreamResponse.status, Object.fromEntries(headers));
      if (request.method === 'HEAD' || !upstreamResponse.body) {
        response.end();
        return;
      }
      Readable.fromWeb(upstreamResponse.body).on('error', () => response.destroy()).pipe(response);
    } catch (error) {
      if (!response.headersSent) sendJson(response, 502, { error: 'Upstream BT3 non raggiungibile.', detail: error.message });
      else response.destroy(error);
    }
  });
  const heartbeat = setInterval(() => {
    for (const client of sseClients) client.write(': heartbeat\n\n');
  }, 25_000);
  heartbeat.unref();
  server.on('close', () => {
    clearInterval(heartbeat);
    for (const client of sseClients) client.end();
    sseClients.clear();
  });
  server.requestTimeout = 130_000;
  server.headersTimeout = 20_000;
  return server;
}

export function resolveListenOptions(args = process.argv.slice(2), env = process.env) {
  let host = '0.0.0.0';
  let port = Number(env.PORT) || 3000;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--host') {
      if (args[index + 1] && !args[index + 1].startsWith('--')) host = args[++index];
    } else if (argument.startsWith('--host=')) {
      host = argument.slice('--host='.length);
    } else if (argument === '--port') {
      port = Number(args[++index]);
    } else if (argument.startsWith('--port=')) {
      port = Number(argument.slice('--port='.length));
    }
  }
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error('Porta HTTP non valida.');
  return { host, port };
}

if (!process.env.VERCEL && process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { host, port } = resolveListenOptions();
  const server = createArenaServer();
  server.listen(port, host, () => console.log(`[BT3 cloud] Web app e admin disponibili sulla porta ${port}`));
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
