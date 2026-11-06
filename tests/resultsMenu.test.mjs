import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import {
  hasCharacterSelectionFrame,
  hasExitPromptFrame,
  hasPauseMenuFrame,
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

test('con Character Select già visibile il recovery riprende dal roster senza cercare i risultati', async () => {
  const events = [];
  let captures = 0;
  let rosterCalls = 0;
  const { page, restore } = fakePage(async () => {
    captures += 1;
    if (captures > 3) throw new Error('il driver sta ancora cercando il menu risultati');
    const png = new PNG({ width: 960, height: 540 });
    paint(png, 0, 0, 960, 540, [55, 130, 65]);
    paint(png, 120, 35, 840, 105, [20, 70, 190]);
    paint(png, 120, 440, 840, 520, [170, 25, 100]);
    return PNG.sync.write(png);
  }, events);
  try {
    const result = await runRematchSequence(page, {
      rosterSequence: async () => { rosterCalls += 1; return { recovered: true }; },
    });
    assert.deepEqual(result, { recovered: true });
    assert.equal(rosterCalls, 1);
    assert.equal(events.length, 0);
  } finally {
    restore();
  }
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

test('EXIT residuo di P1 con P2 stimato: Cross non chiude, il driver verifica e conferma No con K', async () => {
  const events = [];
  const { page, restore } = fakePage(async () => {
    const closed = events.some((event) => event.type === 'key' && event.args[0] === 'k' && !event.args[1]);
    return PNG.sync.write(closed ? resultsFrame(1) : exitFrame(1));
  }, events);
  try {
    const selected = await waitForResultsMenu(page, { menuPlayer: 1, timeoutMs: 5_000, pollMs: 0 });
    assert.equal(selected, 1);
    assert.deepEqual(events.map((event) => [event.type, ...event.args.slice(0, 3)]), [
      ['button', 1, 'cross', true], ['button', 1, 'cross', false],
      ['key', 'k', true], ['key', 'k', false],
    ]);
  } finally {
    restore();
  }
});

test('EXIT residuo su Yes viene portato su No e verificato prima della conferma', async () => {
  const events = [];
  const { page, restore } = fakePage(async () => {
    const released = (name) => events.some((event) => event.type === 'button' && event.args[1] === name && !event.args[2]);
    if (released('cross')) return PNG.sync.write(resultsFrame(1));
    return PNG.sync.write(exitFrame(released('down') ? 1 : 0));
  }, events);
  try {
    const selected = await waitForResultsMenu(page, { menuPlayer: 1, timeoutMs: 5_000, pollMs: 0 });
    assert.equal(selected, 1);
    assert.deepEqual(events.filter((event) => event.type === 'button').map((event) => event.args), [
      [1, 'down', true], [1, 'down', false],
      [1, 'cross', true], [1, 'cross', false],
    ]);
  } finally {
    restore();
  }
});

test('se nessun pad chiude EXIT il driver si ferma dopo una sola conferma per pad', async () => {
  const events = [];
  const { page, restore } = fakePage(async () => PNG.sync.write(exitFrame(1)), events);
  try {
    await assert.rejects(
      waitForResultsMenu(page, { menuPlayer: 1, timeoutMs: 5_000, pollMs: 0 }),
      /EXIT non chiuso/,
    );
    assert.deepEqual(events.map((event) => [event.type, ...event.args.slice(0, 3)]), [
      ['button', 1, 'cross', true], ['button', 1, 'cross', false],
      ['key', 'k', true], ['key', 'k', false],
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
      paint(png, 120, 35, 840, 105, [20, 70, 190]);
      paint(png, 120, 440, 840, 520, [170, 25, 100]);
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

test('EXIT resta leggibile quando il personaggio scurisce il lato destro', () => {
  const png = exitFrame(1);
  paint(png, 700, 175, 790, 365, [12, 35, 55]);
  assert.equal(readExitPromptSelection(png), 1);
});

test('il pannello EXIT distingue Yes da No', () => {
  assert.equal(readExitPromptSelection(exitFrame(0)), 0);
  assert.equal(readExitPromptSelection(exitFrame(1)), 1);
  assert.equal(readExitPromptSelection(resultsFrame(1)), null);
});

test('i colori del personaggio ai lati non cambiano la selezione EXIT da No a Yes', () => {
  const png = exitFrame(1);
  paint(png, 210, 270, 420, 282, [230, 220, 40]);
  paint(png, 540, 270, 750, 282, [230, 220, 40]);
  assert.equal(readExitPromptSelection(png), 1);
});

test('ripete Character Select se la prima conferma resta nei risultati', async () => {
  const events = [];
  const { page, restore } = fakePage(async () => {
    const confirmations = events.filter((event) => event.type === 'button' && event.args[1] === 'cross' && !event.args[2]).length;
    const movedToYes = events.some((event) => event.type === 'button' && event.args[1] === 'up' && !event.args[2]);
    if (confirmations < 2) return PNG.sync.write(resultsFrame(1));
    if (confirmations >= 3) {
      const png = new PNG({ width: 960, height: 540 });
      paint(png, 0, 0, 960, 540, [35, 130, 55]);
      paint(png, 120, 35, 840, 105, [20, 70, 190]);
      paint(png, 120, 440, 840, 520, [170, 25, 100]);
      return PNG.sync.write(png);
    }
    return PNG.sync.write(exitFrame(movedToYes ? 0 : 1));
  }, events);
  try {
    await runRematchSequence(page, {
      menuPlayer: 1,
      rosterSequence: async () => ({ verified: true }),
    });
    const buttons = events.filter((event) => event.type === 'button').map((event) => event.args);
    assert.deepEqual(buttons, [
      [1, 'cross', true], [1, 'cross', false],
      [1, 'cross', true], [1, 'cross', false],
      [1, 'up', true], [1, 'up', false],
      [1, 'cross', true], [1, 'cross', false],
    ]);
  } finally {
    restore();
  }
});

test('dopo Character Select il driver sceglie Yes su EXIT prima del roster', async () => {
  const events = [];
  const waits = [];
  const { page, restore } = fakePage(async () => {
    const confirmations = events.filter((event) => event.type === 'button' && event.args[1] === 'cross' && !event.args[2]).length;
    const movedToYes = events.some((event) => event.type === 'button' && event.args[1] === 'up' && !event.args[2]);
    if (confirmations >= 2) {
      const png = new PNG({ width: 960, height: 540 });
      paint(png, 0, 0, 960, 540, [35, 130, 55]);
      paint(png, 120, 35, 840, 105, [20, 70, 190]);
      paint(png, 120, 440, 840, 520, [170, 25, 100]);
      return PNG.sync.write(png);
    }
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
      paint(png, 120, 35, 840, 105, [20, 70, 190]);
      paint(png, 120, 440, 840, 520, [170, 25, 100]);
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

function pillarboxMenuFrame(items, selected = 0) {
  // Geometria reale attuale: gioco 4:3 con bande nere, pannello 26-74% e voci a passo ~34 px.
  const png = new PNG({ width: 960, height: 540 });
  paint(png, 0, 0, 960, 540, [0, 0, 0]);
  paint(png, 120, 0, 840, 540, [60, 140, 70]);
  paint(png, 250, 125, 710, 410, [14, 34, 70]);
  paint(png, 390, 152, 570, 182, [240, 150, 40]);
  const first = items === 6 ? 218 : 236;
  for (let index = 0; index < items; index += 1) {
    const center = first + index * 34;
    paint(png, 330, center - 6, 630, center + 7, index === selected ? [235, 215, 40] : [200, 205, 215]);
  }
  return png;
}

test('il menu risultati viene riconosciuto anche nella geometria 4:3 con bande nere', () => {
  const results = pillarboxMenuFrame(6, 1);
  assert.equal(hasResultsMenuFrame(results), true);
  assert.equal(readResultsMenuSelection(results), 1);
  assert.equal(hasPauseMenuFrame(results), false);
  const pause = pillarboxMenuFrame(4, 0);
  assert.equal(hasResultsMenuFrame(pause), false);
  assert.equal(hasPauseMenuFrame(pause), true);
});

test('con Character Select già evidenziato una conferma ignorata da P2 viene riprovata con P1', async () => {
  const events = [];
  const { page, restore } = fakePage(async () => {
    const confirmedByP1 = events.some((event) => event.type === 'key' && event.args[0] === 'k' && !event.args[1]);
    if (confirmedByP1) {
      const png = new PNG({ width: 960, height: 540 });
      paint(png, 0, 0, 960, 540, [35, 130, 55]);
      paint(png, 120, 35, 840, 105, [20, 70, 190]);
      paint(png, 120, 440, 840, 520, [170, 25, 100]);
      return PNG.sync.write(png);
    }
    return PNG.sync.write(resultsFrame(1));
  }, events);
  try {
    const result = await runRematchSequence(page, { menuPlayer: 1, rosterSequence: async () => ({ verified: true }) });
    assert.deepEqual(result, { verified: true });
    const crosses = events.filter((event) => event.type === 'button' && event.args[1] === 'cross' && event.args[2]).length;
    const kPresses = events.filter((event) => event.type === 'key' && event.args[0] === 'k' && event.args[1]).length;
    assert.equal(crosses, 3, 'tre tentativi con il pad di P2');
    assert.equal(kPresses, 1, 'poi una conferma di P1, recepita');
  } finally {
    restore();
  }
});

test('un fotogramma illeggibile durante lo spostamento non è un menu scomparso', async () => {
  const events = [];
  let unreadable = 2;
  const blank = () => {
    const png = new PNG({ width: 960, height: 540 });
    paint(png, 0, 0, 960, 540, [35, 130, 55]);
    return png;
  };
  const roster = () => {
    const png = blank();
    paint(png, 120, 35, 840, 105, [20, 70, 190]);
    paint(png, 120, 440, 840, 520, [170, 25, 100]);
    return png;
  };
  const { page, restore } = fakePage(async () => {
    const released = (name) => events.some((event) => event.type === 'button' && event.args[1] === name && !event.args[2]);
    if (released('cross')) return PNG.sync.write(roster());
    if (!released('down')) return PNG.sync.write(resultsFrame(0));
    // La voce lampeggia: subito dopo il tasto due letture non trovano nessuna riga gialla.
    if (unreadable > 0) { unreadable -= 1; return PNG.sync.write(blank()); }
    return PNG.sync.write(resultsFrame(1));
  }, events);
  try {
    const plan = await runRematchSequence(page, { menuPlayer: 1, rosterSequence: async () => ({ verified: true }) });
    assert.deepEqual(plan, { verified: true });
    const buttons = events.filter((event) => event.type === 'button' && event.args[2]).map((event) => event.args[1]);
    assert.deepEqual(buttons, ['down', 'cross'], 'un solo movimento e una sola conferma, nessun errore');
  } finally {
    restore();
  }
});

test('se il menu non torna leggibile il driver si ferma senza confermare alla cieca', async () => {
  const events = [];
  const { page, restore } = fakePage(async () => {
    const pressed = events.some((event) => event.type === 'button' || event.type === 'key');
    if (!pressed) return PNG.sync.write(resultsFrame(0));
    const png = new PNG({ width: 960, height: 540 });
    paint(png, 0, 0, 960, 540, [35, 130, 55]);
    return PNG.sync.write(png);
  }, events);
  try {
    await assert.rejects(runRematchSequence(page, { menuPlayer: 1, rosterSequence: async () => ({}) }), /Nessun movimento del menu dalla voce 1; conferma bloccata/);
    assert.equal(events.some((event) => event.type === 'button' && event.args[1] === 'cross'), false);
    assert.equal(events.some((event) => event.type === 'key' && event.args[0] === 'k'), false);
  } finally {
    restore();
  }
});

function yellowBuildingsFrame() {
  // Stage reale con palazzi gialli e terreno scuro: combattimento in corso, nessun pannello.
  const png = new PNG({ width: 960, height: 540 });
  paint(png, 0, 0, 960, 540, [30, 40, 60]);
  paint(png, 200, 120, 330, 400, [190, 160, 60]);
  paint(png, 640, 120, 750, 400, [190, 160, 60]);
  paint(png, 400, 240, 420, 260, [230, 230, 230]);
  return png;
}

test('i palazzi gialli dello stage non vengono scambiati per il pannello EXIT', () => {
  const frame = yellowBuildingsFrame();
  assert.equal(hasExitPromptFrame(frame), false);
  assert.equal(readExitPromptSelection(frame), null);
});

test('se EXIT è riconosciuto la voce è sempre leggibile: niente ciclo di errori', () => {
  for (const selected of [0, 1]) {
    const frame = exitFrame(selected);
    assert.equal(hasExitPromptFrame(frame), true);
    assert.equal(readExitPromptSelection(frame), selected);
  }
});

test('un pannello su sfondo azzurro con costumi viola non è il Character Select', () => {
  // Sfondo reale: cielo in alto e braccia viola in basso imitano le due fasce del roster.
  const decorate = (png) => {
    paint(png, 120, 35, 840, 105, [20, 70, 190]);
    paint(png, 120, 440, 840, 520, [170, 25, 100]);
    return png;
  };
  const exit = decorate(exitFrame(1));
  assert.equal(hasExitPromptFrame(exit), true);
  assert.equal(hasCharacterSelectionFrame(exit), false);
  const results = decorate(resultsFrame(0));
  assert.equal(hasResultsMenuFrame(results), true);
  assert.equal(hasCharacterSelectionFrame(results), false);
});
