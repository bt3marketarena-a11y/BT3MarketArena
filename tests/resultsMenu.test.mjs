import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import {
  hasResultsMenuFrame,
  readExitPromptSelection,
  readResultsMenuSelection,
  runRematchSequence,
  waitForResultsMenu,
} from '../menuDriver.mjs';

const ROW_CENTERS = [225, 252, 284, 311, 342, 371];

function paint(png, x0, y0, x1, y1, [red, green, blue]) {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const offset = (y * png.width + x) * 4;
      png.data[offset] = red;
      png.data[offset + 1] = green;
      png.data[offset + 2] = blue;
      png.data[offset + 3] = 255;
    }
  }
}

function resultsFrame(selected = 1) {
  const png = new PNG({ width: 960, height: 540 });
  paint(png, 0, 0, 960, 540, [35, 130, 55]);
  paint(png, 170, 145, 790, 400, [12, 35, 55]);
  for (let index = 0; index < ROW_CENTERS.length; index += 1) {
    const color = index === selected ? [230, 220, 40] : [220, 225, 230];
    paint(png, 310, ROW_CENTERS[index] - 5, 650, ROW_CENTERS[index] + 5, color);
  }
  return png;
}

function exitFrame(selected = 1) {
  const png = new PNG({ width: 960, height: 540 });
  paint(png, 0, 0, 960, 540, [35, 130, 55]);
  paint(png, 300, 195, 660, 340, [12, 35, 55]);
  paint(png, 440, 270, 520, 282, selected === 0 ? [230, 220, 40] : [220, 225, 230]);
  paint(png, 440, 302, 520, 314, selected === 1 ? [230, 220, 40] : [220, 225, 230]);
  return png;
}

function fakePage(screenshot, events) {
  const previousWindow = globalThis.window;
  globalThis.window = {
    marketArena: {
      bridge: {
        setMode: () => {},
        setButton: (...args) => {
          events.push({ type: 'button', args, at: Date.now() });
        },
      },
    },
  };
  const page = {
    screenshot,
    waitForTimeout: async () => {},
    keyboard: {
      down: (key) => events.push({ type: 'key', args: [key, true] }),
      up: (key) => events.push({ type: 'key', args: [key, false] }),
    },
    evaluate: async (fn, arg) => arg === undefined ? undefined : fn(arg),
  };
  return {
    page,
    restore() {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    },
  };
}

test('il menu risultati largo è distinto dal pannello EXIT stretto', () => {
  assert.equal(hasResultsMenuFrame(resultsFrame()), true);
  assert.equal(hasResultsMenuFrame(exitFrame()), false);
});

test('il menu finale riconosce il testo grigio-azzurro del rendering compatto', () => {
  const png = resultsFrame();
  for (const center of [252, 284, 311, 342, 371]) {
    paint(png, 310, center - 5, 650, center + 5, [110, 125, 140]);
  }
  assert.equal(hasResultsMenuFrame(png), true);
});

test('il menu pausa a quattro voci non viene scambiato per il menu finale', () => {
  const png = new PNG({ width: 960, height: 540 });
  paint(png, 0, 0, 960, 540, [35, 130, 55]);
  paint(png, 170, 145, 790, 400, [12, 35, 55]);
  for (const center of [225, 252, 284, 311]) {
    paint(png, 310, center - 5, 650, center + 5, [220, 225, 230]);
  }
  assert.equal(hasResultsMenuFrame(png), false);
});

test('un pattern a sei voci con il timer ancora visibile non dichiara il KO', () => {
  const png = resultsFrame();
  paint(png, 460, 14, 500, 45, [240, 240, 240]);
  assert.equal(hasResultsMenuFrame(png), false);
});

test('la selezione Character Select viene letta senza assumere Fight Again', () => {
  for (const selected of [0, 1, 3, 5]) {
    assert.equal(readResultsMenuSelection(resultsFrame(selected)), selected);
  }
  assert.equal(readResultsMenuSelection(exitFrame()), null);
});

test('EXIT viene chiuso su No prima di leggere il menu risultati', async () => {
  const events = [];
  const { page, restore } = fakePage(async () => {
    const closed = events.some((event) => event.type === 'button' && event.args[1] === 'cross' && !event.args[2]);
    return PNG.sync.write(closed ? resultsFrame(1) : exitFrame(1));
  }, events);
  try {
    const selected = await waitForResultsMenu(page, { menuPlayer: 1, timeoutMs: 5_000, pollMs: 0 });
    assert.equal(selected, 1);
    assert.deepEqual(events.filter((event) => event.type === 'button').map((event) => event.args), [
      [1, 'cross', true], [1, 'cross', false],
    ]);
  } finally {
    restore();
  }
});

test('da Return to Main Menu il driver sale a Character Select con impulsi brevi e valida prima di Cross', async () => {
  const events = [];
  const { page, restore } = fakePage(async () => {
    const ups = events.filter((event) => event.type === 'button' && event.args[1] === 'up' && !event.args[2]).length;
    const confirmed = events.some((event) => event.type === 'button' && event.args[1] === 'cross' && !event.args[2]);
    if (confirmed) {
      const png = new PNG({ width: 960, height: 540 });
      paint(png, 0, 0, 960, 540, [35, 130, 55]);
      return PNG.sync.write(png);
    }
    return PNG.sync.write(resultsFrame(ups >= 2 ? 1 : 3));
  }, events);
  try {
    await runRematchSequence(page, {
      menuPlayer: 1,
      rosterSequence: async () => ({ verified: true }),
    });
    const buttons = events.filter((event) => event.type === 'button').map((event) => event.args);
    assert.deepEqual(buttons, [
      [1, 'up', true], [1, 'up', false],
      [1, 'up', true], [1, 'up', false],
      [1, 'cross', true], [1, 'cross', false],
    ]);
    const presses = events.filter((event) => event.type === 'button' && event.args[1] === 'up');
    for (let index = 0; index < presses.length; index += 2) {
      assert.ok(presses[index + 1].at - presses[index].at <= 200, 'la direzione non deve attivare auto-repeat');
    }
    const lastUp = events.findLastIndex((event) => event.type === 'button' && event.args[1] === 'up');
    const cross = events.findIndex((event) => event.type === 'button' && event.args[1] === 'cross');
    assert.ok(cross > lastUp);
  } finally {
    restore();
  }
});

test('il pannello EXIT distingue Yes da No', () => {
  assert.equal(readExitPromptSelection(exitFrame(0)), 0);
  assert.equal(readExitPromptSelection(exitFrame(1)), 1);
  assert.equal(readExitPromptSelection(resultsFrame(1)), null);
});

test('dopo Character Select il driver sceglie Yes su EXIT prima del roster', async () => {
  const events = [];
  const waits = [];
  const { page, restore } = fakePage(async () => {
    const confirmations = events.filter((event) => event.type === 'button' && event.args[1] === 'cross' && !event.args[2]).length;
    const movedToYes = events.some((event) => event.type === 'button' && event.args[1] === 'up' && !event.args[2]);
    return PNG.sync.write(confirmations === 0 ? resultsFrame(1) : exitFrame(movedToYes ? 0 : 1));
  }, events);
  page.waitForTimeout = async (ms) => { waits.push(ms); };
  try {
    await runRematchSequence(page, {
      menuPlayer: 1,
      rosterSequence: async () => ({ verified: true }),
    });
    const buttons = events.filter((event) => event.type === 'button').map((event) => event.args);
    assert.deepEqual(buttons, [
      [1, 'cross', true], [1, 'cross', false],
      [1, 'up', true], [1, 'up', false],
      [1, 'cross', true], [1, 'cross', false],
    ]);
    assert.equal(waits.includes(8_000), false, 'il roster deve attendere il proprio stato visivo, non 8 s fissi');
  } finally {
    restore();
  }
});

test('se P1 non muove il menu il driver prova P2 e conferma solo dopo il movimento', async () => {
  const events = [];
  const { page, restore } = fakePage(async () => {
    const moved = events.some((event) => event.type === 'button' && event.args[1] === 'down' && !event.args[2]);
    const confirmed = events.some((event) => event.type === 'button' && event.args[1] === 'cross' && !event.args[2]);
    if (confirmed) {
      const png = new PNG({ width: 960, height: 540 });
      paint(png, 0, 0, 960, 540, [35, 130, 55]);
      return PNG.sync.write(png);
    }
    return PNG.sync.write(resultsFrame(moved ? 1 : 0));
  }, events);
  try {
    await runRematchSequence(page, {
      menuPlayer: 0,
      rosterSequence: async () => ({ verified: true }),
    });
    const buttons = events.filter((event) => event.type === 'button').map((event) => event.args);
    assert.deepEqual(buttons, [
      [1, 'down', true], [1, 'down', false],
      [1, 'cross', true], [1, 'cross', false],
    ]);
  } finally {
    restore();
  }
});
