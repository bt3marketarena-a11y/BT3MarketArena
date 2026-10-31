import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Orchestrator } from '../orchestrator.js';

const VALID_CA = 'So11111111111111111111111111111111111111112';

test('F2 aggiorna prima il server senza salvare ADMIN_KEY in locale', async () => {
  let sent;
  let applied;
  const fake = {
    config: { source: 'simulation', ca: '', whaleThreshold: 10_000 },
    cloud: {
      update: async (config, key) => {
        sent = { config, key };
        return { ...config, revision: 2 };
      },
    },
    applyCloudState: async (state) => { applied = state; },
    saveConfig: () => { throw new Error('Il cloud non deve salvare la configurazione admin in locale.'); },
  };
  await Orchestrator.prototype.applyConfig.call(fake, { source: 'pumpportal', ca: VALID_CA }, 'feed', 'secret');
  assert.equal(sent.key, 'secret');
  assert.equal(sent.config.ca, VALID_CA);
  assert.equal(Object.hasOwn(sent.config, 'adminKey'), false);
  assert.equal(applied.revision, 2);
});

test('lo stato SSE riconnette il feed e ignora una revisione già applicata', async () => {
  let connections = 0;
  const fake = {
    config: {},
    ui: { currentConfig: {}, setContract: () => {} },
    match: { roundDurationMs: 0 },
    market: { whaleThresholdUsd: 0 },
    appliedCloudRevision: -1,
    connectFeed: async () => { connections += 1; },
  };
  const state = { source: 'pumpportal', ca: VALID_CA, whaleThreshold: 20_000, roundDurationSec: 300, revision: 4 };
  await Orchestrator.prototype.applyCloudState.call(fake, state);
  await Orchestrator.prototype.applyCloudState.call(fake, state);
  assert.equal(connections, 1);
  assert.equal(fake.config.ca, VALID_CA);
  assert.equal(fake.market.whaleThresholdUsd, 20_000);
  assert.equal(fake.match.roundDurationMs, 300_000);
});

test('il form admin contiene una password non persistente', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const ui = await readFile(new URL('../broadcastUI.js', import.meta.url), 'utf8');
  assert.match(html, /name="adminKey"[^>]*type="password"|type="password"[^>]*name="adminKey"/);
  assert.match(html, /name="adminKey"[^>]*autocomplete="off"|autocomplete="off"[^>]*name="adminKey"/);
  assert.match(ui, /delete\s+values\.adminKey/);
  assert.match(ui, /onApply\(values, action, adminKey\)/);
});

test('destroy chiude anche la sottoscrizione SSE', () => {
  let closed = false;
  const fake = {
    cloudUnsubscribe: () => { closed = true; },
    pressureTimer: null,
    memoryTimer: null,
    overrideTimer: null,
    market: { stop: () => {} },
    match: { stop: () => {} },
    bridge: { destroy: () => {} },
  };
  Orchestrator.prototype.destroy.call(fake);
  assert.equal(closed, true);
});
