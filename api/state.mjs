import { createHash, timingSafeEqual } from 'node:crypto';
import { CloudStateStore, StateValidationError } from '../cloudState.mjs';
import { Redis } from '@upstash/redis';
import { createRedisStateStore, findRedisCredentials } from '../redisCloudState.mjs';
import { clientIp, createFailureLimiter } from '../adminRateLimit.mjs';

const redisCredentials = findRedisCredentials();
const store = redisCredentials ? createRedisStateStore(redisCredentials) : new CloudStateStore({ stateFile: null });
const limiter = createFailureLimiter({ client: redisCredentials ? new Redis(redisCredentials) : null });
const sseClients = new Set();
// Ogni connessione SSE tiene viva la funzione: oltre questo numero per istanza si rifiuta.
const MAX_SSE_CLIENTS = 100;
const publicState = (state) => ({ ...state, storage: store.mode });

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

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readJson(request) {
  if (!/^application\/json(;|\s|$)/i.test(String(request.headers['content-type'] ?? ''))) throw new RequestError(415, 'Usa Content-Type: application/json.');
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 16 * 1024) throw new RequestError(413, 'Payload admin superiore a 16 KiB.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new RequestError(400, 'JSON non valido.');
  }
}

function writeSse(response, state) {
  response.write(`event: state\ndata: ${JSON.stringify(publicState(state))}\n\n`);
}

export default async function handler(request, response) {
  try {
    const requestUrl = new URL(request.url, 'http://arena.local');
    if ((requestUrl.pathname === '/api/events' || requestUrl.searchParams.get('events') === '1') && request.method === 'GET') {
      if (sseClients.size >= MAX_SSE_CLIENTS) { sendJson(response, 503, { error: 'Troppe connessioni live: riprova più tardi.' }); return; }
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
    if (request.method === 'GET' || request.method === 'HEAD') {
      sendJson(response, 200, publicState(await store.get()));
      return;
    }
    if (request.method === 'PATCH' || request.method === 'PUT') {
      if (!process.env.ADMIN_KEY) { sendJson(response, 503, { error: 'ADMIN_KEY non configurata sul server.' }); return; }
      // Troppi tentativi sbagliati dallo stesso IP: 15 minuti di blocco prima di confrontare la chiave.
      const ip = clientIp(request);
      if (await limiter.blocked(ip)) { sendJson(response, 429, { error: 'Troppi tentativi: riprova tra 15 minuti.' }); return; }
      if (!authorized(request)) { await limiter.fail(ip); sendJson(response, 401, { error: 'ADMIN_KEY non valida o assente.' }); return; }
      const state = await store.update(await readJson(request));
      for (const client of sseClients) writeSse(client, state);
      sendJson(response, 200, publicState(state));
      return;
    }
    response.setHeader('Allow', 'GET, HEAD, PATCH, PUT');
    sendJson(response, 405, { error: 'Metodo non consentito.' });
  } catch (error) {
    if (response.headersSent) { response.destroy(error); return; }
    // Al client tornano solo errori previsti (richiesta o validazione, già autenticata):
    // il resto resta nei log di Vercel e in risposta c'è un messaggio generico.
    if (error instanceof RequestError) { sendJson(response, error.status, { error: error.message }); return; }
    if (error instanceof StateValidationError) { sendJson(response, 400, { error: error.message }); return; }
    console.error('[BT3 state]', error);
    sendJson(response, 500, { error: 'Errore interno del server.' });
  }
}
