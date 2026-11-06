import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import {
  createMenuControls,
  hasCharacterSelectionFrame,
  hasCustomSelectFrame,
  hasMapSelectionFrame,
  hasSelectColorFrame,
  runMapSelectionSequence,
  runRosterSequence,
} from '../menuDriver.mjs';

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

function rosterFrame() {
  const png = new PNG({ width: 960, height: 540 });
  paint(png, 0, 0, 960, 540, [55, 130, 65]);
  paint(png, 120, 35, 840, 105, [20, 70, 190]);
  paint(png, 120, 440, 840, 520, [170, 25, 100]);
  return png;
}

function addCustomSelect(png, player) {
  const x0 = player === 0 ? 140 : 540;
  paint(png, x0, 155, x0 + 280, 340, player === 0 ? [15, 45, 85] : [90, 15, 65]);
  for (const center of [181, 224, 267, 309]) {
    paint(png, x0 + 65, center - 5, x0 + 215, center + 5, [225, 170, 220]);
  }
}

function addSelectColor(png, player) {
  const x0 = player === 0 ? 140 : 540;
  paint(png, x0, 160, x0 + 280, 280, player === 0 ? [15, 45, 85] : [90, 15, 65]);
  // Il titolo reale ha un fondo magenta chiaro: non è una riga del pannello scuro.
  paint(png, x0, 165, x0 + 280, 195, [180, 40, 120]);
  paint(png, x0 + 65, 176, x0 + 215, 186, [240, 220, 225]);
  paint(png, x0 + 85, 219, x0 + 195, 231, [240, 220, 225]);
  // Il bordo inferiore può cadere nella fascia 267: non è una riga Custom 2.
  paint(png, x0 + 70, 263, x0 + 140, 271, [240, 220, 225]);
}

test('il roster base è distinto dai pannelli Custom Select e Select Color', () => {
  const png = rosterFrame();
  assert.equal(hasCharacterSelectionFrame(png), true);
  assert.equal(hasCustomSelectFrame(png, 0), false);
  assert.equal(hasCustomSelectFrame(png, 1), false);
  assert.equal(hasSelectColorFrame(png, 0), false);
  assert.equal(hasSelectColorFrame(png, 1), false);
});

test('il roster resta valido quando il viewport compatto espone solo 16 campioni magenta', () => {
  const png = rosterFrame();
  paint(png, 120, 440, 840, 520, [55, 130, 65]);
  for (let index = 0; index < 16; index += 1) {
    paint(png, 115 + index * 6, 442, 121 + index * 6, 446, [170, 25, 100]);
  }
  assert.equal(hasCharacterSelectionFrame(png), true);
});

test('il roster senza magenta usa i nomi dei lottatori e non diventa Map Select', () => {
  const png = rosterFrame();
  paint(png, 120, 440, 840, 520, [55, 130, 65]);
  paint(png, 450, 30, 560, 95, [200, 90, 30]);
  paint(png, 160, 299, 400, 319, [15, 45, 85]);
  paint(png, 205, 304, 355, 314, [225, 170, 220]);
  assert.equal(hasCharacterSelectionFrame(png), true);
  assert.equal(hasMapSelectionFrame(png), false);
});

test('Custom Select viene riconosciuto sul lato del rispettivo giocatore', () => {
  const png = rosterFrame();
  addCustomSelect(png, 0);
  assert.equal(hasCustomSelectFrame(png, 0), true);
  assert.equal(hasCustomSelectFrame(png, 1), false);
  assert.equal(hasSelectColorFrame(png, 0), false);
  assert.equal(hasCharacterSelectionFrame(png), false);
});

test('tre frammenti scuri sul personaggio non formano un pannello Custom Select', () => {
  const png = rosterFrame();
  for (const center of [224, 267, 309]) {
    paint(png, 160, center - 10, 400, center + 10, [15, 45, 85]);
    paint(png, 205, center - 5, 355, center + 5, [225, 170, 220]);
  }
  assert.equal(hasCustomSelectFrame(png, 0), false);
  assert.equal(hasCharacterSelectionFrame(png), true);
});

test('Select Color non viene confuso con le quattro righe di Custom Select', () => {
  const png = rosterFrame();
  addCustomSelect(png, 0);
  addSelectColor(png, 1);
  assert.equal(hasSelectColorFrame(png, 0), false);
  assert.equal(hasSelectColorFrame(png, 1), true);
  assert.equal(hasCustomSelectFrame(png, 0), true);
  assert.equal(hasCustomSelectFrame(png, 1), false);
});

test('il D-pad gamepad di P2 non invia frecce tastiera anche a P1 nei menu', async () => {
  const keyboardStates = [];
  const previousWindow = globalThis.window;
  globalThis.window = {
    marketArena: {
      bridge: {
        keyboardEvents: true,
        setButton(player, button, pressed) {
          keyboardStates.push({ player, button, pressed, keyboardEvents: this.keyboardEvents });
        },
      },
    },
  };
  const page = {
    evaluate: async (fn, arg) => fn(arg),
    waitForTimeout: async () => {},
    keyboard: { down: async () => {}, up: async () => {} },
  };
  try {
    const { padTap } = createMenuControls(page, () => {});
    await padTap('right', 0);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
  assert.deepEqual(keyboardStates.map(({ player, button, pressed, keyboardEvents }) => ({ player, button, pressed, keyboardEvents })), [
    { player: 1, button: 'right', pressed: true, keyboardEvents: false },
    { player: 1, button: 'right', pressed: false, keyboardEvents: false },
  ]);
});

test('Map Select è colorato e non contiene più roster o pannelli colore', () => {
  const png = new PNG({ width: 960, height: 540 });
  paint(png, 0, 0, 960, 540, [55, 130, 65]);
  paint(png, 300, 180, 660, 340, [180, 100, 35]);
  assert.equal(hasMapSelectionFrame(png), true);
  assert.equal(hasMapSelectionFrame(rosterFrame()), false);
});

test('Map Select non viene confuso col roster compatto anche con blu e magenta', () => {
  const png = rosterFrame();
  paint(png, 200, 30, 600, 95, [200, 90, 30]);
  assert.equal(hasCharacterSelectionFrame(png), false);
  assert.equal(hasMapSelectionFrame(png), true);
});

test('la conferma mappa lascia l’icona BGM con ArrowLeft prima di premere K', async () => {
  const events = [];
  const previousWindow = globalThis.window;
  globalThis.window = {
    __BT3_MARKET_ARENA__: { automationError: null },
    marketArena: {
      bridge: { keyboardEvents: true, setButton: () => {}, setMode: () => {} },
      match: { running: false, start: () => {}, restart: () => {} },
    },
  };
  const map = new PNG({ width: 960, height: 540 });
  paint(map, 0, 0, 960, 540, [55, 130, 65]);
  paint(map, 120, 30, 390, 95, [200, 90, 30]);
  paint(map, 300, 180, 660, 340, [180, 100, 35]);
  const combat = rosterFrame();
  paint(combat, 120, 35, 840, 105, [55, 130, 65]);
  paint(combat, 120, 440, 840, 520, [55, 130, 65]);
  paint(combat, 170, 18, 410, 45, [50, 220, 70]);
  paint(combat, 550, 18, 790, 45, [50, 220, 70]);
  const page = {
    waitForTimeout: async () => {},
    keyboard: {
      down: async () => {},
      up: async (key) => { events.push(key); },
    },
    evaluate: async (fn, arg) => fn(arg),
    screenshot: async () => PNG.sync.write(events.includes('k') ? combat : map),
  };
  try {
    await runMapSelectionSequence(page, { random: () => 0 });
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
  const mapConfirm = events.indexOf('k');
  const lastDirection = events.slice(0, mapConfirm).lastIndexOf('ArrowLeft');
  assert.ok(mapConfirm > 0, 'conferma mappa non inviata');
  assert.ok(lastDirection >= 0, 'manca ArrowLeft per uscire dall’icona BGM');
});

test('P2 senza Select Color è già pronto dopo Normal e non riceve altre conferme', async () => {
  const events = [];
  const states = [];
  const previousWindow = globalThis.window;
  globalThis.window = {
    marketArena: {
      bridge: {
        keyboardEvents: true,
        setButton: (player, button, pressed) => {
          if (player === 1 && button === 'cross' && !pressed) events.push({ type: 'button', value: 'cross' });
        },
        setMode: () => {},
      },
      match: { running: false, start: () => {}, restart: () => {} },
    },
  };
  const count = (type, value) => events.filter((event) => event.type === type && event.value === value).length;
  const page = {
    waitForTimeout: async () => {},
    keyboard: {
      down: async () => {},
      up: async (key) => { events.push({ type: 'key', value: key }); },
    },
    evaluate: async (fn, arg) => fn(arg),
    screenshot: async () => {
      const p1 = Math.max(0, count('key', 'k') - 1);
      const p2 = count('button', 'cross');
      const png = rosterFrame();
      if (p1 === 1 && p2 >= 0) { addCustomSelect(png, 0); states.push('custom:p1'); }
      if (p1 === 1 && p2 === 1) { addCustomSelect(png, 1); states.push('custom:both'); }
      if (p1 === 2 && p2 >= 2) {
        const map = new PNG({ width: 960, height: 540 });
        paint(map, 0, 0, 960, 540, [55, 130, 65]);
        paint(map, 300, 180, 660, 340, [180, 100, 35]);
        states.push('map');
        return PNG.sync.write(map);
      }
      if (p1 >= 3) {
        paint(png, 120, 35, 840, 105, [55, 130, 65]);
        paint(png, 120, 440, 840, 520, [55, 130, 65]);
        paint(png, 170, 18, 410, 45, [50, 220, 70]);
        paint(png, 550, 18, 790, 45, [50, 220, 70]);
        states.push('combat');
      }
      return PNG.sync.write(png);
    },
  };
  try {
    await runRosterSequence(page, { random: () => 0 });
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
  assert.ok(states.includes('map'), `mappa non raggiunta: ${states.join(', ')}`);
  assert.ok(states.includes('combat'), `combattimento non raggiunto: ${states.join(', ')}`);
  assert.equal(count('button', 'cross'), 2);
});

test('il percorso roster attende ogni stato visivo e non usa le lunghe attese fisse', async () => {
  const events = [];
  const states = [];
  const waits = [];
  const previousWindow = globalThis.window;
  globalThis.window = {
    __BT3_MARKET_ARENA__: { automationError: 'errore EXIT già superato' },
    marketArena: {
      bridge: {
        keyboardEvents: true,
        setButton: (player, button, pressed) => {
          if (player === 1 && button === 'cross' && !pressed) events.push({ type: 'button', value: 'cross' });
        },
        setMode: () => {},
      },
      match: { running: false, start: () => {}, restart: () => {} },
    },
  };
  const count = (type, value) => events.filter((event) => event.type === type && event.value === value).length;
  const page = {
    waitForTimeout: async (ms) => { waits.push(ms); },
    keyboard: {
      down: async () => {},
      up: async (key) => { events.push({ type: 'key', value: key }); },
    },
    evaluate: async (fn, arg) => fn(arg),
    screenshot: async () => {
      const p1 = Math.max(0, count('key', 'k') - 1); // La prima conferma P1 viene persa.
      const p2 = count('button', 'cross');
      const png = rosterFrame();
      let state = 'roster';
      if (p1 === 1 && p2 === 0) { addCustomSelect(png, 0); state = 'custom:p1'; }
      if (p1 === 1 && p2 === 1) { addCustomSelect(png, 0); addCustomSelect(png, 1); state = 'custom:both'; }
      if (p1 === 1 && p2 === 2) { addCustomSelect(png, 0); addSelectColor(png, 1); state = 'color:p2'; }
      if (p1 === 1 && p2 >= 3) { addCustomSelect(png, 0); state = 'custom:p1'; }
      if (p1 === 2 && p2 >= 3) {
        const map = new PNG({ width: 960, height: 540 });
        paint(map, 0, 0, 960, 540, [55, 130, 65]);
        paint(map, 300, 180, 660, 340, [180, 100, 35]);
        states.push(state = 'map');
        return PNG.sync.write(map);
      }
      if (p1 >= 3) {
        paint(png, 120, 35, 840, 105, [55, 130, 65]);
        paint(png, 120, 440, 840, 520, [55, 130, 65]);
        paint(png, 170, 18, 410, 45, [50, 220, 70]);
        paint(png, 550, 18, 790, 45, [50, 220, 70]);
        state = 'combat';
      }
      states.push(state);
      return PNG.sync.write(png);
    },
  };
  try {
    await runRosterSequence(page, { random: () => 0 });
    assert.equal(globalThis.window.__BT3_MARKET_ARENA__.automationError, null);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
  for (const state of ['roster', 'custom:p1', 'custom:both', 'color:p2', 'map', 'combat']) {
    assert.ok(states.includes(state), `stato non verificato: ${state}; visti: ${states.join(', ')}`);
  }
  assert.equal(waits.some((ms) => ms > 2_500), false, `attese fisse residue: ${waits.join(', ')}`);
});

test('cielo blu e costumi viola a partita in corso non sono il Character Select', async () => {
  const { hasCharacterSelectionFrame } = await import('../menuDriver.mjs');
  const png = new PNG({ width: 960, height: 540 });
  const paint = (x0, y0, x1, y1, [red, green, blue]) => {
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
      const offset = (y * png.width + x) * 4;
      png.data[offset] = red; png.data[offset + 1] = green; png.data[offset + 2] = blue; png.data[offset + 3] = 255;
    }
  };
  paint(0, 0, 960, 540, [120, 90, 70]);
  paint(120, 35, 840, 105, [20, 70, 190]);
  paint(120, 440, 840, 520, [170, 25, 100]);
  assert.equal(hasCharacterSelectionFrame(png), true, 'senza HUD di combattimento resta il roster');
  paint(164, 30, 412, 50, [40, 210, 55]);
  paint(548, 30, 796, 50, [40, 210, 55]);
  paint(460, 20, 500, 45, [240, 240, 240]);
  assert.equal(hasCharacterSelectionFrame(png), false, 'barre HP e timer significano combattimento');
});
