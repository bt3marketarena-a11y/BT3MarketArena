import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { CombatEndDetector, KnockoutDetector, hasActiveCombatFrame, hasCombatHudFrame, readCombatHealth } from '../menuDriver.mjs';

function frame() {
  const png = new PNG({ width: 1920, height: 1080 });
  // Frame landscape senza letterbox: il contenuto inizia dal primo pixel.
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = 10;
    png.data[index + 1] = 15;
    png.data[index + 2] = 25;
    png.data[index + 3] = 255;
  }
  return png;
}

function greenBars(png, rightToo = true) {
  const bars = rightToo ? [[330, 800], [1120, 1590]] : [[330, 800]];
  for (const [x0, x1] of bars) {
    for (let y = 35; y < 55; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const offset = (y * png.width + x) * 4;
        png.data[offset] = 40;
        png.data[offset + 1] = 210;
        png.data[offset + 2] = 55;
      }
    }
  }
}

test('il combattimento richiede entrambe le barre HP verdi in alto', () => {
  const png = frame();
  greenBars(png);
  assert.equal(hasCombatHudFrame(png), true);
});

test('l’introduzione o una sola barra non avvia il timer di combattimento', () => {
  const intro = frame();
  assert.equal(hasCombatHudFrame(intro), false);
  const oneBar = frame();
  greenBars(oneBar, false);
  assert.equal(hasCombatHudFrame(oneBar), false);
});

test('il timer centrale mantiene attivo il match anche con HP consumate', () => {
  const png = frame();
  for (let y = 35; y < 70; y += 1) {
    for (let x = 925; x < 990; x += 1) {
      const offset = (y * png.width + x) * 4;
      png.data[offset] = 240;
      png.data[offset + 1] = 240;
      png.data[offset + 2] = 240;
    }
  }
  assert.equal(hasActiveCombatFrame(png), true);
  assert.equal(hasActiveCombatFrame(frame()), false);
});

test('la fine match richiede assenza persistente del timer e si resetta sulla pausa', () => {
  const detector = new CombatEndDetector({ delayMs: 12_000 });
  assert.equal(detector.observe(true, 0), false);
  assert.equal(detector.observe(false, 1_000), false);
  assert.equal(detector.observe(false, 5_000), false);
  assert.equal(detector.observe(true, 6_000), false);
  assert.equal(detector.observe(false, 7_000), false);
  assert.equal(detector.observe(false, 18_999), false);
  assert.equal(detector.observe(false, 19_000), true);
  assert.equal(detector.observe(false, 20_000), false);
});

test('legge HP verdi, gialle e rosse senza confondere una barra vuota', () => {
  const png = frame();
  greenBars(png);
  assert.deepEqual(readCombatHealth(png), { p1: true, p2: true });
  const oneBar = frame();
  greenBars(oneBar, false);
  assert.deepEqual(readCombatHealth(oneBar), { p1: true, p2: false });
  for (const [red, green, blue] of [[220, 190, 30], [210, 45, 30]]) {
    for (let y = 35; y < 55; y += 1) {
      for (let x = 1120; x < 1250; x += 1) {
        const offset = (y * oneBar.width + x) * 4;
        oneBar.data[offset] = red;
        oneBar.data[offset + 1] = green;
        oneBar.data[offset + 2] = blue;
      }
    }
    assert.equal(readCombatHealth(oneBar).p2, true);
  }
});

test('gli effetti sopra le HP non sostituiscono le barre nel frame 960x540', () => {
  const png = new PNG({ width: 960, height: 540 });
  png.data.fill(0);
  for (let index = 3; index < png.data.length; index += 4) png.data[index] = 255;
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
  // Una aura nel campionamento legacy non deve fingere una HP presente.
  paint(164, 412, 20, 40, [40, 210, 55]);
  // Coordinate misurate sul frame reale del runtime pubblico.
  paint(164, 412, 55, 67, [40, 210, 55]);
  paint(548, 796, 55, 67, [40, 210, 55]);
  assert.deepEqual(readCombatHealth(png), { p1: true, p2: true });
});

test('il KO richiede una HP vuota persistente e non scatta con entrambe piene', () => {
  const detector = new KnockoutDetector({ delayMs: 1_500 });
  assert.equal(detector.observe({ p1: true, p2: true }, 0), false);
  assert.equal(detector.observe({ p1: false, p2: true }, 1_000), false);
  assert.equal(detector.observe({ p1: true, p2: true }, 1_200), false);
  assert.equal(detector.observe({ p1: false, p2: true }, 2_000), false);
  assert.equal(detector.observe({ p1: false, p2: true }, 3_500), true);
  assert.equal(detector.observe({ p1: false, p2: true }, 4_000), false);
});
