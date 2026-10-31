import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudConfigClient } from '../cloudClient.js';

const PUBLIC_STATE = { source: 'simulation', ca: '', revision: 3 };

test('il client invia ADMIN_KEY soltanto nell’header della mutazione', async () => {
  let request;
  const client = new CloudConfigClient({
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => PUBLIC_STATE };
    },
  });
  const state = await client.update({ ca: '', source: 'simulation' }, 'secret-admin');
  assert.equal(request.url, '/api/state');
  assert.equal(request.options.headers.Authorization, 'Bearer secret-admin');
  assert.doesNotMatch(request.options.body, /secret-admin/);
  assert.deepEqual(state, PUBLIC_STATE);
  assert.equal(Object.hasOwn(client, 'adminKey'), false);
});

test('il client decodifica gli eventi state SSE e restituisce la chiusura', () => {
  const listeners = new Map();
  let closed = false;
  class FakeEventSource {
    constructor(url) { this.url = url; }
    addEventListener(name, callback) { listeners.set(name, callback); }
    close() { closed = true; }
  }
  const states = [];
  const client = new CloudConfigClient({ EventSourceImpl: FakeEventSource });
  const close = client.subscribe((state) => states.push(state));
  listeners.get('state')({ data: JSON.stringify(PUBLIC_STATE) });
  assert.deepEqual(states, [PUBLIC_STATE]);
  close();
  assert.equal(closed, true);
});
