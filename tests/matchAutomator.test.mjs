import test from 'node:test';
import assert from 'node:assert/strict';
import { MatchAutomator, WasmMemoryBridge, createRosterPlan } from '../matchAutomator.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('il timeout di sicurezza non anticipa il timer reale di 240 secondi', () => {
  const automator = new MatchAutomator();
  assert.equal(automator.roundDurationMs, 300_000);
});

test('createRosterPlan genera posizioni valide per 161 personaggi', () => {
  const values = [0, 0.999999, 0.4, 0.5, 0.2, 0.8];
  const plan = createRosterPlan(() => values.shift() ?? 0.5);
  assert.equal(plan.p1, 0);
  assert.equal(plan.p2, 160);
  assert.ok(plan.stage >= 0 && plan.stage < 16);
  assert.ok(plan.p1Steps <= 161 && plan.p2Steps <= 161);
});

test('dopo il KO attende Character Select senza confermare Rematch', async () => {
  let resets = 0;
  let menuMacros = 0;
  const phases = [];
  const automator = new MatchAutomator({
    inputBridge: { playMacro: async () => { menuMacros += 1; } },
    onReset: () => { resets += 1; },
    onPhase: (phase) => phases.push(phase),
    koDelayMs: 0,
    menuDelayMs: 0,
    autoStart: false,
  });
  automator.start();
  automator.notifyKO(1);
  await wait(20);
  assert.equal(resets, 0);
  assert.equal(menuMacros, 0);
  assert.equal(automator.phase, 'postmatch');
  assert.deepEqual(phases, ['fighting', 'ko', 'postmatch']);
  automator.restart();
  assert.equal(resets, 1);
  assert.equal(automator.round, 2);
  assert.equal(automator.phase, 'fighting');
  automator.stop();
});

test('stop invalida un riavvio già pianificato', async () => {
  let resets = 0;
  const automator = new MatchAutomator({
    inputBridge: { playMacro: async () => {} },
    onReset: () => { resets += 1; },
    koDelayMs: 0,
    menuDelayMs: 20,
    autoStart: false,
  });
  automator.start();
  automator.notifyKO(1);
  automator.stop();
  await wait(30);
  assert.equal(resets, 0);
  assert.equal(automator.phase, 'idle');
});

test('il timeout del round precedente non interrompe il round riavviato', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let timeouts = 0;
  const automator = new MatchAutomator({
    inputBridge: { playMacro: async () => {} },
    onTimeout: () => { timeouts += 1; },
    koDelayMs: 0,
    menuDelayMs: 30,
    roundDurationMs: 50,
    autoStart: false,
  });
  automator.start();
  automator.notifyKO(1);
  context.mock.timers.tick(0);
  assert.equal(automator.phase, 'postmatch');
  automator.restart();
  context.mock.timers.tick(30);
  assert.equal(automator.phase, 'fighting');
  context.mock.timers.tick(19);
  assert.equal(timeouts, 0);
  assert.equal(automator.phase, 'fighting');
  automator.stop();
});

test('WasmMemoryBridge legge fase e HP dagli offset configurati', () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const view = new DataView(memory.buffer);
  view.setUint8(16, 2);
  view.setInt16(20, 750, true);
  view.setInt16(24, 500, true);
  const bridge = new WasmMemoryBridge({
    getMemory: () => memory,
    offsets: { phase: 16, hp1: 20, hp2: 24 },
  });
  assert.deepEqual(bridge.read(), { phase: 2, hp1: 750, hp2: 500 });
});
