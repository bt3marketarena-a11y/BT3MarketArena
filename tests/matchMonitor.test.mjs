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

test('se il nuovo match è già attivo ma resta postmatch, riavvia HUD e pad senza menu', async () => {
  const png = new PNG({ width: 960, height: 540 });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = 35;
    png.data[index + 1] = 130;
    png.data[index + 2] = 55;
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
  paint(164, 412, 35, 55, [40, 210, 55]);
  paint(548, 796, 35, 55, [40, 210, 55]);
  paint(460, 500, 35, 70, [240, 240, 240]);

  let closed = false;
  let stateReads = 0;
  const evaluations = [];
  const page = {
    isClosed: () => closed,
    waitForTimeout: async () => { closed = true; },
    screenshot: async () => { throw new Error('Non deve cercare di nuovo il menu dei risultati.'); },
    keyboard: { down: () => {}, up: () => {} },
    evaluate: async (fn, arg) => {
      evaluations.push({ source: fn.toString(), arg });
      stateReads += 1;
      if (stateReads === 1) {
        return { phase: 'postmatch', round: 1, durationMs: 0, features: { autoRematch: true, visualKO: true } };
      }
      return undefined;
    },
  };

  await monitorPostMatch(page, { capture: async () => PNG.sync.write(png) });

  assert.equal(evaluations.some(({ source }) => source.includes('match.restart()')), true);
  assert.equal(evaluations.some(({ source }) => source.includes("setMode(0, 'neutral')")), true);
});

test('una HP assente sospende i pad ma il KO attende il menu finale a sei voci', async () => {
  const combat = new PNG({ width: 960, height: 540 });
  combat.data.fill(0);
  for (let index = 3; index < combat.data.length; index += 4) combat.data[index] = 255;
  for (let y = 55; y < 67; y += 1) {
    for (let x = 164; x < 412; x += 1) {
      const offset = (y * combat.width + x) * 4;
      combat.data[offset] = 40;
      combat.data[offset + 1] = 210;
      combat.data[offset + 2] = 55;
    }
  }
  const results = new PNG({ width: 960, height: 540 });
  for (let index = 0; index < results.data.length; index += 4) {
    results.data[index] = 35;
    results.data[index + 1] = 130;
    results.data[index + 2] = 55;
    results.data[index + 3] = 255;
  }
  const paint = (x0, x1, y0, y1, color) => {
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
      const offset = (y * results.width + x) * 4;
      [results.data[offset], results.data[offset + 1], results.data[offset + 2]] = color;
    }
  };
  paint(170, 790, 145, 400, [12, 35, 55]);
  [225, 252, 284, 311, 342, 371].forEach((center, index) => {
    paint(310, 650, center - 5, center + 5, index === 0 ? [230, 220, 40] : [220, 225, 230]);
  });

  const originalNow = Date.now;
  let now = 0;
  Date.now = () => now;
  let closed = false;
  let captures = 0;
  let waits = 0;
  let stateReads = 0;
  const notifyAt = [];
  const frames = [combat, combat, results];
  const page = {
    isClosed: () => closed,
    waitForTimeout: async (ms) => {
      now += ms * 2;
      waits += 1;
      if (waits >= 3) closed = true;
    },
    keyboard: { down: () => {}, up: () => {} },
    evaluate: async (fn) => {
      if (fn.toString().includes('notifyKO')) notifyAt.push(captures);
      stateReads += 1;
      if (stateReads === 1 || fn.toString().includes("phase: window.marketArena")) {
        return { phase: 'fighting', round: 1, durationMs: 0, features: { autoRematch: true, visualKO: true } };
      }
      return undefined;
    },
  };
  try {
    await monitorPostMatch(page, { capture: async () => PNG.sync.write(frames[Math.min(captures++, frames.length - 1)]) });
  } finally {
    Date.now = originalNow;
  }
  assert.deepEqual(notifyAt, [3]);
});
