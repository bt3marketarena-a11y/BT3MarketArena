import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { monitorPostMatch } from '../matchMonitor.mjs';

function pauseFrame() {
  const png = new PNG({ width: 960, height: 540 });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = 35;
    png.data[index + 1] = 90;
    png.data[index + 2] = 45;
    png.data[index + 3] = 255;
  }
  const paint = (x0, x1, y0, y1, [red, green, blue]) => {
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const offset = (y * png.width + x) * 4;
        png.data[offset] = red;
        png.data[offset + 1] = green;
        png.data[offset + 2] = blue;
      }
    }
  };
  paint(175, 785, 175, 365, [12, 35, 55]);
  for (let row = 0; row < 4; row += 1) paint(325, 635, 225 + row * 27, 233 + row * 27, [230, 230, 225]);
  return png;
}

test('la pausa sospende i pad e preme Start senza dichiarare un KO', async () => {
  let closed = false;
  let stateReads = 0;
  const keys = [];
  const evaluations = [];
  const page = {
    isClosed: () => closed,
    waitForTimeout: async () => { closed = true; },
    keyboard: {
      down: (key) => { keys.push(`down:${key}`); },
      up: (key) => { keys.push(`up:${key}`); },
    },
    evaluate: async (fn, arg) => {
      evaluations.push({ source: fn.toString(), arg });
      stateReads += 1;
      if (stateReads === 1) {
        return { phase: 'fighting', round: 1, durationMs: 0, features: { autoRematch: true, visualKO: true } };
      }
      return undefined;
    },
  };

  await monitorPostMatch(page, { capture: async () => PNG.sync.write(pauseFrame()) });

  assert.deepEqual(keys, ['down:Enter', 'up:Enter']);
  assert.equal(evaluations.some(({ source }) => source.includes('notifyKO')), false);
  assert.equal(evaluations.some(({ source }) => source.includes("setMode(0, 'idle')")), true);
});
