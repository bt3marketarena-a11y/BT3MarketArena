import test from 'node:test';
import assert from 'node:assert/strict';
import { createInjectionBundle } from '../injectionBundle.mjs';

test('il bundle Playwright conserva il bootstrap MAIN-world esistente', async () => {
  const bundle = await createInjectionBundle();
  assert.match(bundle, /__BT3_MARKET_ARENA__/);
  assert.match(bundle, /gamepadconnected/);
  assert.doesNotMatch(bundle, /require\("node:|require\("fs"/);
});

test('il bundle web include driver e monitor senza dipendenze Node', async () => {
  const bundle = await createInjectionBundle({ web: true });
  assert.match(bundle, /__BT3_MARKET_ARENA__/);
  assert.match(bundle, /visual-hp-zero/);
  assert.match(bundle, /Character Select/);
  assert.doesNotMatch(bundle, /require\("node:|require\("fs"|require\("path"/);
});
