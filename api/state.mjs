import { createHash, timingSafeEqual } from 'node:crypto';
import { CloudStateStore } from '../cloudState.mjs';

const store = new CloudStateStore({ stateFile: null });
const sseClients = new Set();

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function authorized(request) {
  const expected = process.env.ADMIN_KEY;
  if (!expected) return false;
  const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? '')?.[1];
  const supplied = bearer ?? request.headers['x-admin-key'] ?? '';
  return timingSafeEqual(createHash('sha256').update(String(expected)).digest(), createHash('sha256').update(String(supplied)).digest());
}

async function readJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 64 * 1024) throw new Error('Payload admin superiore a 64 KiB.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function writeSse(response, state) {
  response.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
}

export default async function handler(request, response) {
  try {
    const requestUrl = new URL(request.url, 'http://arena.local');
    if ((requestUrl.pathname === '/api/events' || requestUrl.searchParams.get('events') === '1') && request.method === 'GET') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      });
      response.flushHeaders();
      sseClients.add(response);
      const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 25_000);
      request.on('close', () => { clearInterval(heartbeat); sseClients.delete(response); });
      writeSse(response, await store.get());
      return;
    }
    if (request.method === 'GET') {
      sendJson(response, 200, await store.get());
      return;
    }
    if (request.method === 'PATCH' || request.method === 'PUT') {
      if (!process.env.ADMIN_KEY) { sendJson(response, 503, { error: 'ADMIN_KEY non configurata sul server.' }); return; }
      if (!authorized(request)) { sendJson(response, 401, { error: 'ADMIN_KEY non valida o assente.' }); return; }
      const state = await store.update(await readJson(request));
      for (const client of sseClients) writeSse(client, state);
      sendJson(response, 200, state);
      return;
    }
    sendJson(response, 405, { error: 'Metodo non consentito.' });
  } catch (error) {
    if (response.headersSent) { response.destroy(error); return; }
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    });
  }
}
