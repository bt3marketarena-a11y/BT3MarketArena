import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { CloudStateStore } from '../cloudState.mjs';

const VALID_CA = 'So11111111111111111111111111111111111111112';

async function temporaryState(t) {
  const directory = await mkdtemp(path.join(process.cwd(), 'artifacts', 'test-state-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return path.join(directory, 'state.json');
}

test('lo stato cloud valida e persiste soltanto la configurazione pubblica', async (t) => {
  const stateFile = await temporaryState(t);
  const store = new CloudStateStore({ stateFile });
  const updated = await store.update({ source: 'pumpportal', ca: VALID_CA, whaleThreshold: 25_000 });
  assert.equal(updated.ca, VALID_CA);
  assert.equal(updated.revision, 1);
  const restored = new CloudStateStore({ stateFile });
  assert.equal((await restored.get()).ca, VALID_CA);
  assert.equal((await restored.get()).whaleThreshold, 25_000);
  assert.equal(Object.hasOwn(updated, 'adminKey'), false);
});

test('lo stato cloud permette il timeout zero per combattere fino al KO', async () => {
  const store = new CloudStateStore({ stateFile: null });
  assert.equal((await store.get()).roundDurationSec, 0);
  assert.equal((await store.update({ roundDurationSec: 0 })).roundDurationSec, 0);
});

test('lo stato rifiuta segreti, mint e sorgenti non validi', async () => {
  const store = new CloudStateStore({ stateFile: null });
  await assert.rejects(store.update({ adminKey: 'secret' }), /non consentiti/);
  await assert.rejects(store.update({ source: 'pumpportal', ca: 'not-a-mint' }), /mint Solana/);
  await assert.rejects(store.update({ source: 'unknown' }), /Sorgente/);
});
