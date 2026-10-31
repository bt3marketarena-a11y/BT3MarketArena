import test from 'node:test';
import assert from 'node:assert/strict';
import { BT3InputBridge, BUTTONS } from '../bt3InputBridge.js';

function fakeWindow() {
  return {
    navigator: { getGamepads: () => [] },
    performance: { now: () => 1000 },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    dispatchEvent: () => true,
  };
}

test('install espone due gamepad a 16 bottoni, annuncia entrambi e ripristina il navigator', () => {
  const window = fakeWindow();
  const events = [];
  window.dispatchEvent = (event) => { events.push(event); return true; };
  window.GamepadEvent = class { constructor(type, init) { this.type = type; this.gamepad = init.gamepad; } };
  const original = window.navigator.getGamepads;
  const bridge = new BT3InputBridge({ window, autoStart: false });
  bridge.install();
  const pads = window.navigator.getGamepads();
  assert.equal(pads.length, 2);
  assert.equal(pads[0].id, 'BT3 Virtual Buyer (Standard Mapping)');
  assert.equal(pads[1].index, 1);
  assert.equal(pads[0].buttons.length, 16);
  assert.equal(pads[0].axes.length, 4);
  assert.deepEqual(events.map((event) => event.gamepad.index), [0, 1]);
  bridge.destroy();
  assert.equal(window.navigator.getGamepads, original);
});

test('setButton aggiorna stato pressed, value e timestamp', () => {
  const bridge = new BT3InputBridge({ window: fakeWindow(), autoStart: false });
  bridge.install();
  bridge.setButton(0, 'square', true);
  const pad = bridge.getPad(0);
  assert.equal(pad.buttons[BUTTONS.square].pressed, true);
  assert.equal(pad.buttons[BUTTONS.square].value, 1);
  assert.equal(pad.timestamp, 1000);
  bridge.setButton(0, 'square', false);
  assert.equal(pad.buttons[BUTTONS.square].value, 0);
});

test('KeyboardEvent raggiunge sia window sia il canvas WebGL', () => {
  const window = fakeWindow();
  const targets = [];
  const canvas = { dispatchEvent: (event) => { targets.push(['canvas', event.type, event.code]); } };
  window.dispatchEvent = (event) => { targets.push(['window', event.type, event.code]); };
  window.document = { querySelector: (selector) => selector === 'canvas' ? canvas : null };
  window.KeyboardEvent = class { constructor(type, init) { Object.assign(this, { type, ...init }); } };
  const bridge = new BT3InputBridge({ window, autoStart: false });
  bridge.install();
  bridge.setButton(0, 'square', true);
  assert.deepEqual(targets.filter((event) => event[2] === 'KeyJ'), [
    ['window', 'keydown', 'KeyJ'], ['canvas', 'keydown', 'KeyJ'],
  ]);
});

test('le macro avanzano frame per frame e rilasciano i pulsanti precedenti', () => {
  const bridge = new BT3InputBridge({ window: fakeWindow(), autoStart: false });
  bridge.install();
  bridge.playMacro(0, 'rushCombo');
  bridge.stepFrame();
  assert.equal(bridge.getPad(0).buttons[BUTTONS.square].pressed, true);
  bridge.stepFrame();
  bridge.stepFrame();
  assert.equal(bridge.getPad(0).buttons[BUTTONS.square].pressed, false);
});

test('zCounterLoop attiva guardia e direzione nello stato neutro', () => {
  const bridge = new BT3InputBridge({ window: fakeWindow(), autoStart: false });
  bridge.install();
  bridge.setMode(0, 'neutral');
  bridge.stepFrame();
  assert.equal(bridge.getPad(0).buttons[BUTTONS.guard].pressed, true);
  assert.equal(bridge.getPad(0).buttons[BUTTONS.left].pressed, true);
});

test('il combattimento riattiva periodicamente il lock-on L1 su entrambi i pad', () => {
  const bridge = new BT3InputBridge({ window: fakeWindow(), autoStart: false, lockOnIntervalFrames: 3 });
  bridge.install();
  bridge.setMode(0, 'neutral');
  bridge.setMode(1, 'vulnerable');
  bridge.stepFrame();
  assert.equal(bridge.getPad(0).buttons[BUTTONS.l1].pressed, true);
  assert.equal(bridge.getPad(1).buttons[BUTTONS.l1].pressed, true);
  bridge.stepFrame();
  assert.equal(bridge.getPad(0).buttons[BUTTONS.l1].pressed, false);
  bridge.stepFrame();
  bridge.stepFrame();
  assert.equal(bridge.getPad(0).buttons[BUTTONS.l1].pressed, true);
  assert.equal(bridge.getPad(1).buttons[BUTTONS.l1].pressed, true);
  bridge.setMode(0, 'idle');
  bridge.setMode(1, 'idle');
  bridge.stepFrame();
  assert.equal(bridge.getPad(0).buttons[BUTTONS.l1].pressed, false);
  assert.equal(bridge.getPad(1).buttons[BUTTONS.l1].pressed, false);
});
