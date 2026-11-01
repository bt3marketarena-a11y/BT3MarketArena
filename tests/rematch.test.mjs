import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { waitForResultsMenu } from '../menuDriver.mjs';

function menuFrame(withMenu, selected = 0) {
  const png = new PNG({ width: 960, height: 540 });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = 35;
    png.data[index + 1] = 130;
    png.data[index + 2] = 55;
    png.data[index + 3] = 255;
  }
  if (!withMenu) return png;
  for (let y = 175; y < 365; y += 1) {
    for (let x = 175; x < 785; x += 1) {
      const offset = (y * png.width + x) * 4;
      png.data[offset] = 12;
      png.data[offset + 1] = 35;
      png.data[offset + 2] = 55;
    }
  }
  // Testo tenue: il menu dei risultati reale è meno luminoso della pausa.
  const centers = [225, 252, 284, 311, 342, 371];
  for (const center of centers) {
    for (let y = center - 4; y < center + 4; y += 1) {
      for (let x = 325; x < 650; x += 1) {
        const offset = (y * png.width + x) * 4;
        png.data[offset] = 180;
        png.data[offset + 1] = 190;
        png.data[offset + 2] = 205;
      }
    }
  }
  for (let y = centers[selected] - 5; y < centers[selected] + 5; y += 1) {
    for (let x = 325; x < 650; x += 1) {
      const offset = (y * png.width + x) * 4;
      png.data[offset] = 230;
      png.data[offset + 1] = 220;
      png.data[offset + 2] = 40;
    }
  }
  return png;
}

test('il post-match attende tre frame finché compare il menu dei risultati', async () => {
  const frames = [menuFrame(false), menuFrame(false), menuFrame(true)];
  let captures = 0;
  const page = {
    screenshot: async () => PNG.sync.write(frames[Math.min(captures++, frames.length - 1)]),
    waitForTimeout: async () => {},
  };
  await waitForResultsMenu(page, { timeoutMs: 5_000, pollMs: 0 });
  assert.equal(captures, 3);
});

test('dopo il menu visibile P2 preme giù e Cross, senza tastiera né Rematch anticipato', async () => {
  const { runRematchSequence } = await import('../menuDriver.mjs');
  const frames = [menuFrame(false), menuFrame(false), menuFrame(true)];
  const events = [];
  const keys = [];
  const buttons = [];
  const previousWindow = globalThis.window;
  globalThis.window = {
    marketArena: {
      bridge: {
        setMode: () => {},
        setButton: (...args) => { buttons.push(args); events.push(`button:${args[1]}:${args[2]}`); },
      },
    },
  };
  let captures = 0;
  const page = {
    screenshot: async () => {
      events.push(`capture:${captures}`);
      const frameIndex = Math.min(captures++, frames.length - 1);
      const moved = buttons.some(([player, button, pressed]) => player === 1 && button === 'down' && !pressed);
      const confirmed = buttons.some(([player, button, pressed]) =>
        player === 1 && button === 'cross' && !pressed
      );
      if (frameIndex >= 2 && confirmed) return PNG.sync.write(menuFrame(false));
      return PNG.sync.write(frameIndex < 2 ? frames[frameIndex] : menuFrame(true, moved ? 1 : 0));
    },
    waitForTimeout: async () => {},
    keyboard: {
      down: (key) => { keys.push(`down:${key}`); },
      up: (key) => { keys.push(`up:${key}`); },
    },
    evaluate: async (fn, arg) => arg ? fn(arg) : undefined,
  };
  try {
    const plan = await runRematchSequence(page, {
      menuPlayer: 1,
      rosterSequence: async () => ({ verified: true }),
    });
    assert.deepEqual(plan, { verified: true });
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
  assert.deepEqual(keys, []);
  assert.deepEqual(buttons, [[1, 'down', true], [1, 'down', false], [1, 'cross', true], [1, 'cross', false]]);
  assert.ok(events.indexOf('button:down:true') > events.indexOf('capture:2'));
});

test('con Map Select già visibile il recovery riprende dalla mappa senza cercare i risultati', async () => {
  const { runRematchSequence } = await import('../menuDriver.mjs');
  const map = new PNG({ width: 960, height: 540 });
  for (let index = 0; index < map.data.length; index += 4) {
    map.data[index] = 55;
    map.data[index + 1] = 130;
    map.data[index + 2] = 65;
    map.data[index + 3] = 255;
  }
  for (let y = 180; y < 340; y += 1) {
    for (let x = 300; x < 660; x += 1) {
      const offset = (y * map.width + x) * 4;
      map.data[offset] = 180;
      map.data[offset + 1] = 100;
      map.data[offset + 2] = 35;
    }
  }
  for (let y = 30; y < 95; y += 1) {
    for (let x = 120; x < 390; x += 1) {
      const offset = (y * map.width + x) * 4;
      map.data[offset] = 200;
      map.data[offset + 1] = 90;
      map.data[offset + 2] = 30;
    }
  }
  const frames = [map, menuFrame(true, 1), menuFrame(false)];
  let captures = 0;
  const previousWindow = globalThis.window;
  globalThis.window = { marketArena: { bridge: { setMode: () => {}, setButton: () => {} } } };
  const page = {
    screenshot: async () => PNG.sync.write(frames[Math.min(captures++, frames.length - 1)]),
    waitForTimeout: async () => {},
    keyboard: { down: async () => {}, up: async () => {} },
    evaluate: async (fn, arg) => arg ? fn(arg) : undefined,
  };
  try {
    const result = await runRematchSequence(page, {
      mapSequence: async () => ({ resumed: 'map' }),
      rosterSequence: async () => ({ resumed: 'roster' }),
    });
    assert.deepEqual(result, { resumed: 'map' });
    assert.equal(captures, 1);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
