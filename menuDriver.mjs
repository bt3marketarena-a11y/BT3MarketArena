import { PNG } from 'pngjs';

const wait = (page, ms) => page.waitForTimeout(ms);

export function hasColorfulGameFrame(png) {
  let samples = 0;
  let colored = 0;
  // Esclude feed, dominance e ticker: i loro colori non devono fingere un frame 3D.
  const minX = Math.floor(png.width * 0.34);
  const maxX = Math.ceil(png.width * 0.66);
  const minY = Math.floor(png.height * 0.10);
  const maxY = Math.ceil(png.height * 0.65);
  for (let y = minY; y < maxY; y += 32) {
    for (let x = minX; x < maxX; x += 32) {
      const offset = (y * png.width + x) * 4;
      const red = png.data[offset];
      const green = png.data[offset + 1];
      const blue = png.data[offset + 2];
      const high = Math.max(red, green, blue);
      const low = Math.min(red, green, blue);
      samples += 1;
      if (high > 60 && high - low > 45) colored += 1;
    }
  }
  return samples > 0 && colored / samples > 0.12;
}

async function waitForColorfulFrame(page, timeoutMs = 120_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const png = PNG.sync.read(await page.screenshot());
    if (hasColorfulGameFrame(png)) {
      console.log(`[BT3 menu] frame a colori rilevato dopo ${Math.round((Date.now() - startedAt) / 1000)} s di attesa visiva`);
      return;
    }
    await wait(page, 1_000);
  }
  throw new Error(`Il runtime non ha mostrato un frame a colori entro ${Math.round(timeoutMs / 1000)} secondi.`);
}

export function hasCombatHudFrame(png) {
  const greenSamples = (minX, maxX) => {
    let count = 0;
    for (let y = Math.floor(png.height * 0.02); y < Math.ceil(png.height * 0.12); y += 4) {
      for (let x = Math.floor(png.width * minX); x < Math.ceil(png.width * maxX); x += 8) {
        const offset = (y * png.width + x) * 4;
        const red = png.data[offset];
        const green = png.data[offset + 1];
        const blue = png.data[offset + 2];
        if (green > 70 && green > red * 1.2 && green > blue * 1.2) count += 1;
      }
    }
    return count;
  };
  return greenSamples(0.17, 0.43) > 8 && greenSamples(0.57, 0.83) > 8;
}

/** Il timer resta visibile con HP gialle/rosse e durante la pausa. */
export function hasActiveCombatFrame(png) {
  let timerPixels = 0;
  // Nel frame RGBA 960x540 del runtime il timer occupa circa y=55–70.
  for (let y = Math.floor(png.height * 0.095); y < Math.ceil(png.height * 0.135); y += 3) {
    for (let x = Math.floor(png.width * 0.475); x < Math.ceil(png.width * 0.525); x += 4) {
      const offset = (y * png.width + x) * 4;
      const red = png.data[offset];
      const green = png.data[offset + 1];
      const blue = png.data[offset + 2];
      if (Math.min(red, green, blue) > 145 && Math.max(red, green, blue) - Math.min(red, green, blue) < 65) timerPixels += 1;
    }
  }
  return timerPixels > 10;
}

export class CombatEndDetector {
  constructor({ delayMs = 12_000 } = {}) {
    this.delayMs = delayMs;
    this.missingSince = null;
    this.fired = false;
  }

  reset() {
    this.missingSince = null;
    this.fired = false;
  }

  observe(activeCombat, now = Date.now()) {
    if (activeCombat) {
      this.reset();
      return false;
    }
    if (this.fired) return false;
    this.missingSince ??= now;
    if (now - this.missingSince < this.delayMs) return false;
    this.fired = true;
    return true;
  }
}

export function readCombatHealth(png) {
  const hasHealth = (minX, maxX) => {
    let count = 0;
    // Limita la lettura alle HP reali (circa y=55–66 a 540p): le aure più
    // in alto non devono trasformare una barra vuota in una HP presente.
    for (let y = Math.floor(png.height * 0.095); y < Math.ceil(png.height * 0.13); y += 4) {
      for (let x = Math.floor(png.width * minX); x < Math.ceil(png.width * maxX); x += 8) {
        const offset = (y * png.width + x) * 4;
        const red = png.data[offset];
        const green = png.data[offset + 1];
        const blue = png.data[offset + 2];
        const high = Math.max(red, green);
        const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
        if (high > 85 && blue < high * 0.75 && red + green > blue * 2.2 && spread > 40) count += 1;
      }
    }
    return count > 8;
  };
  return { p1: hasHealth(0.17, 0.43), p2: hasHealth(0.57, 0.83) };
}

export class KnockoutDetector {
  constructor({ delayMs = 1_500 } = {}) {
    this.delayMs = delayMs;
    this.emptySince = null;
    this.fired = false;
  }

  reset() {
    this.emptySince = null;
    this.fired = false;
  }

  observe(health, now = Date.now()) {
    const knockedOut = (health.p1 && !health.p2) || (!health.p1 && health.p2);
    if (!knockedOut) {
      this.reset();
      return false;
    }
    if (this.fired) return false;
    this.emptySince ??= now;
    if (now - this.emptySince < this.delayMs) return false;
    this.fired = true;
    return true;
  }
}

async function waitForCombatStart(page, timeoutMs = 90_000) {
  const { tap, padTap } = createMenuControls(page, () => {});
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const png = PNG.sync.read(await page.screenshot());
    if (hasCombatHudFrame(png)) {
      console.log('[BT3 menu] barre HP rilevate: combattimento realmente avviato');
      return;
    }
    await tap('k', 300);
    await padTap('cross', 300);
    await tap('Enter', 300);
    await page.evaluate(async () => {
      const bridge = window.marketArena.bridge;
      bridge.setButton(0, 'start', true);
      await new Promise((resolve) => setTimeout(resolve, 300));
      bridge.setButton(0, 'start', false);
    });
    await wait(page, 2_500);
  }
  throw new Error('Le barre HP non sono comparse: introduzione non superata entro 90 secondi.');
}

function createMenuControls(page, onProgress) {
  const tap = async (key, holdMs = 220) => {
    await page.keyboard.down(key);
    await wait(page, holdMs);
    await page.keyboard.up(key);
  };
  const moveNative = async (key, count) => {
    for (let index = 0; index < count; index += 1) {
      await tap(key, 250);
      await wait(page, 250);
    }
  };
  const padTap = async (button, holdMs = 300) => {
    await page.evaluate(async ({ button: name, holdMs: duration }) => {
      const bridge = window.marketArena.bridge;
      bridge.setButton(1, name, true);
      await new Promise((resolve) => setTimeout(resolve, duration));
      bridge.setButton(1, name, false);
    }, { button, holdMs });
    await wait(page, 300);
  };
  const progress = (stage) => {
    onProgress(stage);
    console.log(`[BT3 menu] ${stage}`);
  };
  return { tap, moveNative, padTap, progress };
}

/** Seleziona davvero roster, costumi e mappa dal Character Select corrente. */
export async function runRosterSequence(page, { random = Math.random, onProgress = () => {} } = {}) {
  const randomInt = (min, max) => min + Math.floor(random() * (max - min + 1));
  const plan = {
    p1: { right: randomInt(2, 8), down: randomInt(1, 3) },
    p2: { right: randomInt(2, 8), down: randomInt(1, 2) },
    stage: { right: randomInt(1, 6), down: randomInt(0, 2) },
  };
  const { tap, moveNative, padTap, progress } = createMenuControls(page, onProgress);

  progress(`P1 random: destra ${plan.p1.right}, giù ${plan.p1.down}`);
  await moveNative('ArrowRight', plan.p1.right);
  await moveNative('ArrowDown', plan.p1.down);
  await tap('k', 400);
  await wait(page, 2_000);

  progress(`P2 random: destra ${plan.p2.right}, giù ${plan.p2.down}`);
  for (let index = 0; index < plan.p2.right; index += 1) await padTap('right');
  for (let index = 0; index < plan.p2.down; index += 1) await padTap('down');
  await padTap('cross', 400);
  await wait(page, 3_000);
  await padTap('cross', 400); // Custom Select → Normal
  await wait(page, 4_000);
  await padTap('cross', 400); // Select Color → 1
  await wait(page, 2_000);

  progress('conferma Normal e colore di P1');
  await tap('k', 400);
  await wait(page, 2_000);
  await tap('k', 400); // Custom Select → Normal
  await wait(page, 3_000);
  await tap('k', 400); // Select Color → 1
  await wait(page, 4_000);

  progress(`stage random: destra ${plan.stage.right}, giù ${plan.stage.down}`);
  await moveNative('ArrowRight', plan.stage.right);
  await moveNative('ArrowDown', plan.stage.down);
  await tap('k', 400);

  progress('download della mappa, shader e introduzione 3D');
  await wait(page, 5_000);
  await waitForColorfulFrame(page, 300_000);
  await wait(page, 25_000);
  await waitForCombatStart(page);
  await page.evaluate(() => {
    const match = window.marketArena.match;
    if (match.running) match.restart();
    else match.start();
    window.marketArena.bridge.setMode(0, 'neutral');
    window.marketArena.bridge.setMode(1, 'neutral');
  });
  await wait(page, 5_000);
  progress('combattimento 3D avviato; controllare la cattura video');
  return plan;
}

/** Dopo KO/timeout evita Rematch: seconda voce = Character Select. */
export async function runRematchSequence(page, options = {}) {
  const { tap, progress } = createMenuControls(page, options.onProgress ?? (() => {}));
  await page.evaluate(() => {
    window.marketArena.bridge.setMode(0, 'idle');
    window.marketArena.bridge.setMode(1, 'idle');
    document.querySelector('canvas')?.focus();
  });
  await wait(page, 1_000);
  progress('post-match: Character Select, non Rematch');
  await tap('ArrowDown', 400);
  await wait(page, 1_200);
  await tap('k', 400);
  await wait(page, 8_000);
  return runRosterSequence(page, options);
}

/** Guida il primo ingresso nel vero menu PS2 fino al Character Select. */
export async function runMenuSequence(page, options = {}) {
  const { tap, moveNative, progress } = createMenuControls(page, options.onProgress ?? (() => {}));
  await page.evaluate(() => {
    window.marketArena?.match?.stop();
    window.marketArena?.bridge?.setMode(0, 'idle');
    window.marketArena?.bridge?.setMode(1, 'idle');
    document.querySelector('canvas')?.focus();
  });

  await waitForColorfulFrame(page);
  progress('titolo e avvio senza salvataggio');
  await tap('Enter', 250);
  await wait(page, 2_500);
  await tap('Enter', 250);
  await wait(page, 3_000);
  await tap('k');
  await wait(page, 2_500);
  await tap('k');
  await wait(page, 5_000);
  await tap('ArrowLeft');
  await wait(page, 1_200);
  await tap('k', 400);
  await wait(page, 5_000);

  progress('Duel → 1P vs 2P → Single Battle');
  await moveNative('ArrowDown', 3);
  await tap('k');
  await wait(page, 5_000);
  await tap('ArrowDown', 400);
  await wait(page, 1_200);
  await tap('k', 400);
  await wait(page, 3_000);
  await tap('k', 400);
  await wait(page, 8_000);
  return runRosterSequence(page, options);
}
