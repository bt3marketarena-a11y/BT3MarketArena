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

function hasTopLetterbox(png) {
  let samples = 0;
  let visible = 0;
  for (let y = 0; y < Math.ceil(png.height * 0.025); y += 2) {
    for (let x = Math.floor(png.width * 0.34); x < Math.ceil(png.width * 0.66); x += 8) {
      const offset = (y * png.width + x) * 4;
      if (Math.max(png.data[offset], png.data[offset + 1], png.data[offset + 2]) > 20) visible += 1;
      samples += 1;
    }
  }
  return samples > 0 && visible / samples < 0.05;
}

/** Il timer resta visibile con HP gialle/rosse e durante la pausa. */
export function hasActiveCombatFrame(png) {
  let timerPixels = 0;
  // Senza letterbox il timer è in alto; con banda nera è traslato in basso.
  const [minY, maxY] = hasTopLetterbox(png) ? [0.095, 0.135] : [0.025, 0.085];
  for (let y = Math.floor(png.height * minY); y < Math.ceil(png.height * maxY); y += 3) {
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

function pausePanelStats(png) {
  let samples = 0;
  let dark = 0;
  let brightText = 0;
  for (let y = Math.floor(png.height * 0.32); y < Math.ceil(png.height * 0.68); y += 4) {
    for (let x = Math.floor(png.width * 0.18); x < Math.ceil(png.width * 0.82); x += 4) {
      const offset = (y * png.width + x) * 4;
      const red = png.data[offset];
      const green = png.data[offset + 1];
      const blue = png.data[offset + 2];
      const high = Math.max(red, green, blue);
      const low = Math.min(red, green, blue);
      if (high < 105 && blue >= red) dark += 1;
      if (low > 150 && high - low < 65) brightText += 1;
      samples += 1;
    }
  }
  return { darkRatio: samples ? dark / samples : 0, brightText };
}

function darkPanelRatio(png, minX, maxX, minY = 0.4, maxY = 0.6) {
  let samples = 0;
  let dark = 0;
  for (let y = Math.floor(png.height * minY); y < Math.ceil(png.height * maxY); y += 3) {
    for (let x = Math.floor(png.width * minX); x < Math.ceil(png.width * maxX); x += 3) {
      const offset = (y * png.width + x) * 4;
      const red = png.data[offset];
      const green = png.data[offset + 1];
      const blue = png.data[offset + 2];
      if (Math.max(red, green, blue) < 105 && blue >= red) dark += 1;
      samples += 1;
    }
  }
  return samples ? dark / samples : 0;
}

export function hasPauseMenuFrame(png) {
  const { darkRatio, brightText } = pausePanelStats(png);
  // Il menu 1P/2P Pause copre il centro con un pannello blu scuro e voci bianche.
  // La combinazione evita di classificare come pausa un'arena notturna o una nuvola.
  return darkRatio > 0.45 && brightText > 24;
}

function rosterTextCount(png, player, center) {
  const [minX, maxX] = player === 0 ? [0.16, 0.43] : [0.57, 0.84];
  const scaledCenter = center * png.height / 540;
  let count = 0;
  for (let y = Math.floor(scaledCenter - 7 * png.height / 540); y <= Math.ceil(scaledCenter + 7 * png.height / 540); y += 2) {
    for (let x = Math.floor(png.width * minX); x < Math.ceil(png.width * maxX); x += 3) {
      const offset = (y * png.width + x) * 4;
      const high = Math.max(png.data[offset], png.data[offset + 1], png.data[offset + 2]);
      const low = Math.min(png.data[offset], png.data[offset + 1], png.data[offset + 2]);
      if (high > 150 && low > 55) count += 1;
    }
  }
  return count;
}

function rosterRowDarkRatio(png, player, center) {
  const [minX, maxX] = player === 0 ? [0.16, 0.43] : [0.57, 0.84];
  const scaledCenter = center * png.height / 540;
  let samples = 0;
  let dark = 0;
  for (let y = Math.floor(scaledCenter - 10 * png.height / 540); y <= Math.ceil(scaledCenter + 10 * png.height / 540); y += 3) {
    for (let x = Math.floor(png.width * minX); x < Math.ceil(png.width * maxX); x += 4) {
      const offset = (y * png.width + x) * 4;
      const red = png.data[offset];
      const green = png.data[offset + 1];
      const blue = png.data[offset + 2];
      const high = Math.max(red, green, blue);
      const panel = player === 0
        ? blue > red * 1.1 && blue > green * 1.05
        : red > green * 1.25 && blue > green * 1.1;
      if (high < 150 && panel) dark += 1;
      samples += 1;
    }
  }
  return samples ? dark / samples : 0;
}

function rosterPanelRow(png, player, center) {
  return rosterTextCount(png, player, center) > 50 && rosterRowDarkRatio(png, player, center) > 0.2;
}

export function hasCustomSelectFrame(png, player) {
  return rosterPanelRow(png, player, 309)
    && [181, 224, 267].filter((center) => rosterPanelRow(png, player, center)).length >= 2;
}

export function hasSelectColorFrame(png, player) {
  return rosterPanelRow(png, player, 181)
    && rosterPanelRow(png, player, 225)
    && !rosterPanelRow(png, player, 309);
}

export function hasCharacterSelectionFrame(png) {
  let blue = 0;
  let magenta = 0;
  for (let y = Math.floor(png.height * 0.06); y < Math.ceil(png.height * 0.19); y += 4) {
    for (let x = Math.floor(png.width * 0.12); x < Math.ceil(png.width * 0.88); x += 6) {
      const offset = (y * png.width + x) * 4;
      const red = png.data[offset];
      const green = png.data[offset + 1];
      const blueChannel = png.data[offset + 2];
      if (blueChannel > 110 && blueChannel > red * 1.35 && blueChannel > green * 1.15) blue += 1;
    }
  }
  for (let y = Math.floor(png.height * 0.82); y < Math.ceil(png.height * 0.96); y += 4) {
    for (let x = Math.floor(png.width * 0.12); x < Math.ceil(png.width * 0.88); x += 6) {
      const offset = (y * png.width + x) * 4;
      const red = png.data[offset];
      const green = png.data[offset + 1];
      const blueChannel = png.data[offset + 2];
      if (red > 100 && blueChannel > 60 && red > green * 1.5 && blueChannel > green * 1.3) magenta += 1;
    }
  }
  return blue > 30 && magenta > 30 && ![0, 1].some((player) => hasCustomSelectFrame(png, player) || hasSelectColorFrame(png, player));
}

export function hasMapSelectionFrame(png) {
  return hasColorfulGameFrame(png)
    && !hasCharacterSelectionFrame(png)
    && ![0, 1].some((player) => hasCustomSelectFrame(png, player) || hasSelectColorFrame(png, player));
}

function brightRowTextCount(png, center) {
  const scaledCenter = center * png.height / 540;
  let count = 0;
  for (let y = Math.floor(scaledCenter - 6 * png.height / 540); y <= Math.ceil(scaledCenter + 6 * png.height / 540); y += 2) {
    for (let x = Math.floor(png.width * 0.2); x < Math.ceil(png.width * 0.8); x += 3) {
      const offset = (y * png.width + x) * 4;
      const red = png.data[offset];
      const green = png.data[offset + 1];
      const blue = png.data[offset + 2];
      const neutral = Math.min(red, green, blue) > 150 && Math.max(red, green, blue) - Math.min(red, green, blue) < 65;
      const yellow = red > 140 && green > 100 && blue < 120 && red > blue * 1.6 && green > blue * 1.3;
      if (neutral || yellow) count += 1;
    }
  }
  return count;
}

export function hasResultsMenuFrame(png) {
  const { darkRatio, brightText } = pausePanelStats(png);
  // Il menu finale ha sei voci, incluso Replay Data nelle ultime due righe.
  // Il normale menu pausa si ferma a quattro e non deve chiudere il round.
  const left = darkPanelRatio(png, 0.18, 0.28);
  const right = darkPanelRatio(png, 0.72, 0.82);
  const replayRows = brightRowTextCount(png, 342) > 20 && brightRowTextCount(png, 371) > 20;
  return darkRatio > 0.2 && brightText > 24 && left > 0.35 && right > 0.35 && replayRows;
}

export function hasExitPromptFrame(png) {
  const { darkRatio, brightText } = pausePanelStats(png);
  const center = darkPanelRatio(png, 0.3, 0.7, 0.34, 0.65);
  const left = darkPanelRatio(png, 0.18, 0.28);
  const right = darkPanelRatio(png, 0.72, 0.82);
  return darkRatio > 0.2 && brightText > 24 && center > 0.4 && left < 0.15 && right < 0.15;
}

function yellowTextCount(png, center) {
  const scaledCenter = center * png.height / 540;
  let yellow = 0;
  for (let y = Math.floor(scaledCenter - 9 * png.height / 540); y <= Math.ceil(scaledCenter + 9 * png.height / 540); y += 2) {
    for (let x = Math.floor(png.width * 0.2); x < Math.ceil(png.width * 0.8); x += 3) {
      const offset = (y * png.width + x) * 4;
      const red = png.data[offset];
      const green = png.data[offset + 1];
      const blue = png.data[offset + 2];
      if (red > 140 && green > 100 && blue < 120 && red > blue * 1.6 && green > blue * 1.3) yellow += 1;
    }
  }
  return yellow;
}

export function readResultsMenuSelection(png) {
  if (!hasResultsMenuFrame(png)) return null;
  const counts = [225, 252, 284, 311, 342, 371].map((center) => yellowTextCount(png, center));
  const selected = counts.indexOf(Math.max(...counts));
  return counts[selected] > 20 ? selected : null;
}

export function readExitPromptSelection(png) {
  if (!hasExitPromptFrame(png)) return null;
  const counts = [280, 311].map((center) => yellowTextCount(png, center));
  const selected = counts.indexOf(Math.max(...counts));
  return counts[selected] > 20 ? selected : null;
}

async function confirmExitPromptSelection(page, menuPlayer, target) {
  const { tap, padTap } = createMenuControls(page, () => {});
  const selected = readExitPromptSelection(PNG.sync.read(await page.screenshot()));
  if (selected === null) throw new Error('Pannello EXIT non leggibile: nessuna conferma inviata.');
  const delta = selected - target;
  for (let index = 0; index < Math.abs(delta); index += 1) {
    if (menuPlayer === 0) await tap(delta > 0 ? 'ArrowUp' : 'ArrowDown', 120);
    else await padTap(delta > 0 ? 'up' : 'down', 120);
    await wait(page, 350);
  }
  const verified = readExitPromptSelection(PNG.sync.read(await page.screenshot()));
  if (verified !== target) throw new Error(`Voce EXIT ${target === 0 ? 'Yes' : 'No'} non verificata; conferma bloccata.`);
  if (menuPlayer === 0) await tap('k', 400);
  else await padTap('cross', 400);
  await wait(page, 1_000);
}

export async function waitForResultsMenu(page, { timeoutMs = 60_000, pollMs = 500, menuPlayer = 1 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const png = PNG.sync.read(await page.screenshot());
    if (hasExitPromptFrame(png)) {
      console.log('[BT3 menu] EXIT? residuo: confermo No e torno al menu dei risultati');
      await confirmExitPromptSelection(page, menuPlayer, 1);
      continue;
    }
    const selected = readResultsMenuSelection(png);
    if (selected !== null) {
      console.log(`[BT3 menu] menu dei risultati visibile: voce ${selected + 1} evidenziata`);
      return selected;
    }
    await wait(page, pollMs);
  }
  throw new Error('Menu dei risultati non visibile: nessun tasto di conferma inviato alla cieca.');
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
  // Limita la lettura alla fascia HP del layout corrente: le aure altre non
  // devono trasformare una barra vuota in una HP presente.
  const [minY, maxY] = hasTopLetterbox(png) ? [0.095, 0.13] : [0.025, 0.075];
  const hasHealth = (minX, maxX) => {
    let count = 0;
    for (let y = Math.floor(png.height * minY); y < Math.ceil(png.height * maxY); y += 4) {
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
    // Anche una HP quasi esaurita può produrre meno di nove campioni validi:
    // soltanto l'assenza completa di pixel HP può alimentare il detector KO.
    return count > 0;
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

export function createMenuControls(page, onProgress) {
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
      const keyboardEvents = bridge.keyboardEvents;
      bridge.keyboardEvents = false;
      try {
        bridge.setButton(1, name, true);
        await new Promise((resolve) => setTimeout(resolve, duration));
        bridge.setButton(1, name, false);
      } finally {
        bridge.keyboardEvents = keyboardEvents;
      }
    }, { button, holdMs });
    await wait(page, 300);
  };
  const progress = (stage) => {
    onProgress(stage);
    console.log(`[BT3 menu] ${stage}`);
  };
  return { tap, moveNative, padTap, progress };
}

async function waitForRosterState(page, predicate, label, timeoutMs = 20_000) {
  const startedAt = Date.now();
  let stableFrames = 0;
  while (Date.now() - startedAt < timeoutMs) {
    const png = PNG.sync.read(await page.screenshot());
    stableFrames = predicate(png) ? stableFrames + 1 : 0;
    if (stableFrames >= 2) {
      console.log(`[BT3 menu] ${label} verificato in ${Date.now() - startedAt} ms`);
      return png;
    }
    await wait(page, 150);
  }
  throw new Error(`${label} non verificato visivamente entro ${Math.round(timeoutMs / 1000)} secondi.`);
}

async function confirmRosterState(page, action, predicate, label) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await action();
    try {
      return await waitForRosterState(page, predicate, label, 2_500);
    } catch (error) {
      if (attempt === 3) throw error;
      console.log(`[BT3 menu] ${label}: conferma ${attempt} non recepita, nuovo tentativo`);
    }
  }
  throw new Error(`${label}: conferma non verificata.`);
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

  await waitForRosterState(page, hasCharacterSelectionFrame, 'Character Select', 30_000);
  progress(`P1 random: destra ${plan.p1.right}, giù ${plan.p1.down}`);
  await moveNative('ArrowRight', plan.p1.right);
  await moveNative('ArrowDown', plan.p1.down);
  await confirmRosterState(page, () => tap('k', 400), (png) => hasCustomSelectFrame(png, 0), 'Custom Select P1');

  progress(`P2 random: destra ${plan.p2.right}, giù ${plan.p2.down}`);
  for (let index = 0; index < plan.p2.right; index += 1) await padTap('right', 120);
  for (let index = 0; index < plan.p2.down; index += 1) await padTap('down', 120);
  await confirmRosterState(page, () => padTap('cross', 400), (png) => hasCustomSelectFrame(png, 1), 'Custom Select P2');

  progress('conferma Normal e colore di P2');
  await confirmRosterState(page, () => padTap('cross', 400), (png) => hasSelectColorFrame(png, 1), 'Select Color P2');
  await confirmRosterState(page, () => padTap('cross', 400), (png) => hasCustomSelectFrame(png, 0) && !hasCustomSelectFrame(png, 1) && !hasSelectColorFrame(png, 1), 'P2 pronto');

  progress('conferma Normal e colore di P1');
  const p1NormalFrame = await confirmRosterState(
    page,
    () => tap('k', 400),
    (png) => hasSelectColorFrame(png, 0) || hasMapSelectionFrame(png),
    'Normal P1',
  );
  if (!hasMapSelectionFrame(p1NormalFrame)) {
    await confirmRosterState(page, () => tap('k', 400), hasMapSelectionFrame, 'Map Select');
  }

  progress(`stage random: destra ${plan.stage.right}, giù ${plan.stage.down}`);
  await moveNative('ArrowRight', plan.stage.right);
  await moveNative('ArrowDown', plan.stage.down);
  await tap('k', 400);

  progress('download della mappa, shader e introduzione 3D');
  await wait(page, 1_000);
  await waitForColorfulFrame(page, 300_000);
  await waitForCombatStart(page);
  await page.evaluate(() => {
    const match = window.marketArena.match;
    if (match.running) match.restart();
    else match.start();
    window.marketArena.bridge.setMode(0, 'neutral');
    window.marketArena.bridge.setMode(1, 'neutral');
  });
  progress('combattimento 3D avviato; controllare la cattura video');
  return plan;
}

/** Dopo KO/timeout naviga dalla voce realmente evidenziata a Character Select. */
export async function runRematchSequence(page, options = {}) {
  const { tap, padTap, progress } = createMenuControls(page, options.onProgress ?? (() => {}));
  let menuPlayer = options.menuPlayer === 0 ? 0 : 1;
  const rosterSequence = options.rosterSequence ?? runRosterSequence;
  await page.evaluate(() => {
    window.marketArena.bridge.setMode(0, 'idle');
    window.marketArena.bridge.setMode(1, 'idle');
    document.querySelector('canvas')?.focus();
  });
  progress('attesa visiva del menu dei risultati; nessuna conferma anticipata');
  let selected = await waitForResultsMenu(page, { menuPlayer });
  progress(`post-match P${menuPlayer + 1}: dalla voce ${selected + 1} a Character Select`);
  for (let attempt = 0; selected !== 1 && attempt < 12; attempt += 1) {
    const direction = selected > 1 ? 'up' : 'down';
    const key = selected > 1 ? 'ArrowUp' : 'ArrowDown';
    const previous = selected;
    let moved = false;
    // Il titolo 1P/2P Pause non sempre coincide con il vincitore ricostruito
    // dalle HP. Prova l'altro pad soltanto con direzioni, mai con conferme.
    for (const candidate of [menuPlayer, menuPlayer === 0 ? 1 : 0]) {
      for (let retry = 0; retry < 2 && !moved; retry += 1) {
        if (candidate === 0) await tap(key, 120);
        else await padTap(direction, 120);
        await wait(page, 350);
        selected = readResultsMenuSelection(PNG.sync.read(await page.screenshot()));
        if (selected === null) throw new Error('Menu risultati non più leggibile durante lo spostamento.');
        if (selected !== previous) {
          if (candidate !== menuPlayer) progress(`input post-match recepito da P${candidate + 1}; fallback completato`);
          menuPlayer = candidate;
          moved = true;
        }
      }
      if (moved) break;
    }
    if (!moved) throw new Error(`Nessun movimento del menu dalla voce ${previous + 1}; conferma bloccata.`);
  }
  if (selected !== 1) throw new Error('Character Select non raggiunto entro 12 movimenti verificati.');
  if (menuPlayer === 0) await tap('k', 400);
  else await padTap('cross', 400);
  await wait(page, 1_200);
  const confirmationFrame = PNG.sync.read(await page.screenshot());
  if (hasExitPromptFrame(confirmationFrame)) {
    // Character Select chiede EXIT? con default No: qui Yes è la conferma corretta.
    progress('conferma EXIT? → Yes per entrare davvero nel Character Select');
    await confirmExitPromptSelection(page, menuPlayer, 0);
  } else if (hasResultsMenuFrame(confirmationFrame)) {
    throw new Error('Conferma Character Select non recepita: il menu risultati è ancora visibile.');
  }
  return rosterSequence(page, options);
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
