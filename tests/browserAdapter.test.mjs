import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captureCanvasFrame,
  createBrowserPageAdapter,
  dispatchMenuKey,
  installCanvasFrameCapture,
} from '../browserPageAdapter.js';
import { PNG } from '../browserPng.js';

function fakeWindow() {
  const events = [];
  class FakeKeyboardEvent {
    constructor(type, init) { this.type = type; Object.assign(this, init); }
  }
  const gameCanvas = {
    width: 1920,
    height: 1080,
    pixels: [10, 20, 30, 255],
    dispatchEvent(event) { events.push({ target: 'canvas', event }); },
  };
  const offscreen = {
    width: 0,
    height: 0,
    getContext(kind) {
      assert.equal(kind, '2d');
      return {
        drawImage(source) { this.pixels = [...source.pixels]; },
        getImageData(x, y, width, height) {
          const data = new Uint8ClampedArray(width * height * 4);
          data.set(this.pixels);
          return { data };
        },
      };
    },
  };
  let rafCallback = null;
  const targetWindow = {
    KeyboardEvent: FakeKeyboardEvent,
    document: {
      querySelector(selector) { return selector === 'canvas' ? gameCanvas : null; },
      querySelectorAll(selector) { return selector === 'canvas' ? [gameCanvas] : []; },
      createElement(name) { assert.equal(name, 'canvas'); return offscreen; },
    },
    requestAnimationFrame(callback) { rafCallback = callback; return 1; },
    performance: { now: () => 100 },
    setTimeout,
    dispatchEvent(event) { events.push({ target: 'window', event }); },
  };
  return { targetWindow, gameCanvas, events, runAnimationFrame: (time = 100) => rafCallback(time) };
}

test('dispatchMenuKey replica un solo evento nativo che risale dal canvas a window', () => {
  const { targetWindow, events } = fakeWindow();
  dispatchMenuKey(targetWindow, 'ArrowDown', true);
  dispatchMenuKey(targetWindow, 'ArrowDown', false);
  assert.deepEqual(events.map(({ target, event }) => [target, event.type, event.key, event.code, event.bubbles]), [
    ['canvas', 'keydown', 'ArrowDown', 'ArrowDown', true],
    ['canvas', 'keyup', 'ArrowDown', 'ArrowDown', true],
  ]);
});

test('captureCanvasFrame riduce il canvas WebGL a RGBA 960x540', () => {
  const { targetWindow, gameCanvas } = fakeWindow();
  const frame = captureCanvasFrame(targetWindow, gameCanvas);
  assert.equal(frame.width, 960);
  assert.equal(frame.height, 540);
  assert.deepEqual([...frame.data.slice(0, 4)], [10, 20, 30, 255]);
  assert.equal(PNG.sync.read(frame), frame);
});

test('il hook requestAnimationFrame cattura dopo il rendering del gioco', () => {
  const { targetWindow, gameCanvas, runAnimationFrame } = fakeWindow();
  const capture = installCanvasFrameCapture(targetWindow, { intervalMs: 0 });
  targetWindow.requestAnimationFrame(() => { gameCanvas.pixels = [200, 100, 50, 255]; });
  runAnimationFrame();
  assert.deepEqual([...capture.read().data.slice(0, 4)], [200, 100, 50, 255]);
});

test("l'adapter espone la stessa interfaccia page usata dal menu driver", async () => {
  const { targetWindow } = fakeWindow();
  const adapter = createBrowserPageAdapter({ window: targetWindow });
  assert.equal(adapter.isClosed(), false);
  assert.equal(await adapter.evaluate((value) => value + 1, 4), 5);
  await adapter.keyboard.down('k');
  await adapter.keyboard.up('k');
  assert.equal(typeof (await adapter.screenshot()).width, 'number');
});

test('il contesto WebGL conserva il buffer per la lettura HP post-match', async () => {
  const { installPreserveDrawingBuffer } = await import('../browserPageAdapter.js');
  const calls = [];
  const targetWindow = {
    HTMLCanvasElement: {
      prototype: {
        getContext(type, options) { calls.push({ type, options }); return {}; },
      },
    },
  };
  installPreserveDrawingBuffer(targetWindow);
  targetWindow.HTMLCanvasElement.prototype.getContext('webgl2', { antialias: true });
  targetWindow.HTMLCanvasElement.prototype.getContext('2d', { alpha: false });
  assert.deepEqual(calls[0], { type: 'webgl2', options: { antialias: true, preserveDrawingBuffer: true } });
  assert.deepEqual(calls[1], { type: '2d', options: { alpha: false } });
});
