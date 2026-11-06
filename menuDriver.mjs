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
  // Geometria 4:3 con bande nere: pannello più stretto, quattro voci; sei voci sono i risultati.
  const items = readMenuLayout(png)?.items;
  if (items === 6) return false;
  return (darkRatio > 0.45 && brightText > 24) || items === 4;
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

function rosterRowDarkRatio(png, player, center, halfHeight = 10) {
  const [minX, maxX] = player === 0 ? [0.16, 0.43] : [0.57, 0.84];
  const scaledCenter = center * png.height / 540;
  const scaledRadius = halfHeight * png.height / 540;
  let samples = 0;
  let dark = 0;
  for (let y = Math.floor(scaledCenter - scaledRadius); y <= Math.ceil(scaledCenter + scaledRadius); y += 3) {
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
  // Un pannello reale copre tutta l'area; tre frammenti sul personaggio non bastano.
  return rosterRowDarkRatio(png, player, 245, 90) > 0.5
    && rosterPanelRow(png, player, 309)
    && [181, 224, 267].filter((center) => rosterPanelRow(png, player, center)).length >= 2;
}

export function hasSelectColorFrame(png, player) {
  // Il titolo Select Color ha fondo chiaro; soltanto la riga numerica è scura.
  return rosterTextCount(png, player, 181) > 50
    && rosterPanelRow(png, player, 225)
    && !rosterPanelRow(png, player, 309);
}

function hasMapHeaderFrame(png) {
  let title = 0;
  // Il titolo Map Select occupa il lato sinistro; la freccia arancione
  // centrale del Character Select non deve essere considerata un titolo.
  for (let y = Math.floor(png.height * 0.055); y < Math.ceil(png.height * 0.18); y += 2) {
    for (let x = Math.floor(png.width * 0.12); x < Math.ceil(png.width * 0.43); x += 2) {
      const offset = (y * png.width + x) * 4;
      const red = png.data[offset];
      const green = png.data[offset + 1];
      const blue = png.data[offset + 2];
      if (red > 155 && green > 35 && green < 190 && blue < 105 && red > green * 1.08 && red > blue * 1.65) title += 1;
    }
  }
  return title > 800;
}

export function hasCharacterSelectionFrame(png) {
  // Cielo blu e costumi viola imitano le due fasce del roster: barre HP e timer insieme
  // esistono solo in combattimento, dove i tasti del roster finirebbero nella partita.
  if (hasCombatHudFrame(png) && hasActiveCombatFrame(png)) return false;
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
  // Nei viewport compatti la seconda riga può sparire: i nomi dei due
  // lottatori restano un segnale specifico del Character Select.
  const nameplate = [0, 1].some((player) => rosterPanelRow(png, player, 309));
  return blue > 30 && (magenta > 10 || nameplate) && !hasMapHeaderFrame(png)
    && ![0, 1].some((player) => hasCustomSelectFrame(png, player) || hasSelectColorFrame(png, player));
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
      // Il testo non selezionato del menu reale è grigio-azzurro, non bianco puro.
      const neutral = Math.min(red, green, blue) > 90 && Math.max(red, green, blue) - Math.min(red, green, blue) < 105;
      const yellow = red > 140 && green > 100 && blue < 120 && red > blue * 1.6 && green > blue * 1.3;
      if (neutral || yellow) count += 1;
    }
  }
  return count;
}

function isMenuText(red, green, blue) {
  const neutral = Math.min(red, green, blue) > 90 && Math.max(red, green, blue) - Math.min(red, green, blue) < 105;
  return neutral || isMenuYellow(red, green, blue);
}

function isMenuYellow(red, green, blue) {
  return red > 140 && green > 100 && blue < 120 && red > blue * 1.6 && green > blue * 1.3;
}

/**
 * Il runtime attuale disegna il gioco in 4:3 con bande nere laterali: il pannello del
 * menu occupa allora il 26-74% della larghezza e le voci sono più distanziate delle
 * posizioni fisse tarate in origine. Qui l'area di gioco viene misurata e le voci
 * vengono contate come righe di testo a passo regolare dentro il pannello scuro.
 */
export function readMenuLayout(png) {
  const pixel = (x, y) => {
    const offset = (y * png.width + x) * 4;
    return [png.data[offset], png.data[offset + 1], png.data[offset + 2]];
  };
  const litColumn = (x) => {
    let lit = 0;
    for (let y = Math.floor(png.height * 0.3); y < png.height * 0.7; y += 6) if (Math.max(...pixel(x, y)) > 18) lit += 1;
    return lit > 3;
  };
  let left = 0;
  while (left < png.width / 2 && !litColumn(left)) left += 1;
  let right = png.width - 1;
  while (right > png.width / 2 && !litColumn(right)) right -= 1;
  const gameWidth = right - left + 1;
  if (gameWidth < png.width * 0.5) return null;
  const gameX = (fraction) => Math.round(left + fraction * gameWidth);
  const panelEdge = (minX, maxX) => {
    let samples = 0;
    let dark = 0;
    for (let y = Math.floor(png.height * 0.4); y < png.height * 0.6; y += 3) {
      for (let x = gameX(minX); x < gameX(maxX); x += 3) {
        const [red, green, blue] = pixel(x, y);
        if (Math.max(red, green, blue) < 105 && blue >= red) dark += 1;
        samples += 1;
      }
    }
    return samples ? dark / samples : 0;
  };
  if (panelEdge(0.2, 0.28) <= 0.35 || panelEdge(0.72, 0.8) <= 0.35) return null;
  const scale = png.height / 540;
  const lines = [];
  let current = null;
  for (let y = Math.floor(png.height * 0.12); y < png.height * 0.88; y += 1) {
    let text = 0;
    let yellow = 0;
    for (let x = gameX(0.3); x < gameX(0.7); x += 2) {
      const [red, green, blue] = pixel(x, y);
      if (isMenuText(red, green, blue)) text += 1;
      if (isMenuYellow(red, green, blue)) yellow += 1;
    }
    if (text >= 8 * scale) {
      if (!current) { current = { top: y, bottom: y, yellow: 0 }; lines.push(current); }
      current.bottom = y;
      current.yellow += yellow;
    } else {
      current = null;
    }
  }
  // Le voci sono alte ~12-15 px su 540: bordi sottili e titolo grande restano fuori.
  const items = lines
    .filter((line) => line.bottom - line.top >= 8 * scale && line.bottom - line.top <= 22 * scale)
    .map((line) => ({ center: (line.top + line.bottom) / 2, yellow: line.yellow }));
  // La sequenza più lunga a passo regolare è il menu; il resto è scenario o HUD.
  let best = [];
  for (let start = 0; start < items.length; start += 1) {
    const run = [items[start]];
    for (let index = start + 1; index < items.length; index += 1) {
      const gap = items[index].center - run.at(-1).center;
      if (gap >= 25 * scale && gap <= 42 * scale) run.push(items[index]);
      else break;
    }
    if (run.length > best.length) best = run;
  }
  if (best.length < 2) return null;
  const yellowCounts = best.map((item) => item.yellow);
  const selected = yellowCounts.indexOf(Math.max(...yellowCounts));
  return { items: best.length, selected: yellowCounts[selected] > 20 * scale ? selected : null };
}

export function hasResultsMenuFrame(png) {
  if (hasActiveCombatFrame(png)) return false;
  const { darkRatio, brightText } = pausePanelStats(png);
  // Il menu finale ha sei voci, incluso Replay Data nelle ultime due righe.
  // Il normale menu pausa si ferma a quattro e non deve chiudere il round.
  const left = darkPanelRatio(png, 0.18, 0.28);
  const right = darkPanelRatio(png, 0.72, 0.82);
  const replayRows = brightRowTextCount(png, 342) > 20 && brightRowTextCount(png, 371) > 20;
  if (darkRatio > 0.2 && brightText > 24 && left > 0.35 && right > 0.35 && replayRows) return true;
  return readMenuLayout(png)?.items === 6;
}

export function hasExitPromptFrame(png) {
  const { darkRatio, brightText } = pausePanelStats(png);
  const center = darkPanelRatio(png, 0.3, 0.7, 0.34, 0.65);
  // Il personaggio alle spalle può scurire i lati: Yes/No evidenziati e il
  // pannello centrale identificano EXIT senza dipendere dallo sfondo. Il giallo si cerca
  // solo dove stanno Yes e No: i palazzi gialli di alcuni stage facevano scattare un falso
  // KO a partita in corso (round doppio, o blocco su "Pannello EXIT non leggibile").
  const yesNoSelection = yellowTextCount(png, 280, 0.44, 0.56) > 20 || yellowTextCount(png, 311, 0.44, 0.56) > 20;
  return !hasResultsMenuFrame(png) && darkRatio > 0.2 && brightText > 24 && center > 0.4 && yesNoSelection;
}

function yellowTextCount(png, center, minX = 0.2, maxX = 0.8) {
  const scaledCenter = center * png.height / 540;
  let yellow = 0;
  for (let y = Math.floor(scaledCenter - 9 * png.height / 540); y <= Math.ceil(scaledCenter + 9 * png.height / 540); y += 2) {
    for (let x = Math.floor(png.width * minX); x < Math.ceil(png.width * maxX); x += 3) {
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
  // Dopo il KO (unico contesto di questa lettura) il timer può restare visibile dietro
  // il pannello: le sei voci a passo regolare bastano, senza il filtro del combattimento.
  const layout = readMenuLayout(png);
  if (layout?.items === 6) return layout.selected;
  if (!hasResultsMenuFrame(png)) return null;
  const counts = [225, 252, 284, 311, 342, 371].map((center) => yellowTextCount(png, center));
  const selected = counts.indexOf(Math.max(...counts));
  return counts[selected] > 20 ? selected : null;
}

export function readExitPromptSelection(png) {
  if (!hasExitPromptFrame(png)) return null;
  // Yes/No sono centrati: le armature gialle ai lati non devono cambiare il vincitore.
  const counts = [280, 311].map((center) => yellowTextCount(png, center, 0.44, 0.56));
  const selected = counts.indexOf(Math.max(...counts));
  return counts[selected] > 20 ? selected : null;
}

async function confirmExitPromptSelection(page, menuPlayer, target) {
  const { tap, padTap } = createMenuControls(page, () => {});
  const read = async () => readExitPromptSelection(PNG.sync.read(await page.screenshot()));
  const label = target === 0 ? 'Yes' : 'No';
  let selected = await read();
  if (selected === null) throw new Error('Pannello EXIT non leggibile: nessuna conferma inviata.');
  // Come nel menu risultati, il proprietario di EXIT può non coincidere con il
  // vincitore stimato dalle HP. L'altro pad riceve input soltanto mentre EXIT
  // resta visibile con la voce richiesta verificata.
  for (const player of [menuPlayer, menuPlayer === 0 ? 1 : 0]) {
    for (let attempt = 0; selected !== target && attempt < 2; attempt += 1) {
      const up = selected > target;
      if (player === 0) await tap(up ? 'ArrowUp' : 'ArrowDown', 120);
      else await padTap(up ? 'up' : 'down', 120);
      await wait(page, 350);
      selected = await read();
      if (selected === null) throw new Error('Pannello EXIT scomparso durante lo spostamento; conferma bloccata.');
    }
    if (selected !== target) continue;
    if (player === 0) await tap('k', 400);
    else await padTap('cross', 400);
    await wait(page, 1_000);
    // Due frame consecutivi con EXIT ancora aperto: la conferma non è stata recepita.
    let open = true;
    for (let check = 0; check < 2 && open; check += 1) {
      selected = await read();
      if (selected === null) open = false;
      else if (selected !== target) throw new Error(`Voce EXIT cambiata dopo la conferma ${label}; nessun altro input.`);
      else if (check === 0) await wait(page, 250);
    }
    if (!open) return player;
  }
  throw new Error(`EXIT non chiuso su ${label} da nessun pad; conferma bloccata.`);
}

export async function waitForResultsMenu(page, { timeoutMs = 60_000, pollMs = 500, menuPlayer = 1 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const png = PNG.sync.read(await page.screenshot());
    if (hasCharacterSelectionFrame(png)) return 'roster';
    if (hasConfirmedMapSelectionFrame(png)) return 'map';
    if (hasExitPromptFrame(png)) {
      console.log('[BT3 menu] EXIT? residuo: confermo No e torno al menu dei risultati');
      menuPlayer = await confirmExitPromptSelection(page, menuPlayer, 1);
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

  progress('conferma Normal ed eventuale colore di P2');
  const p2NormalFrame = await confirmRosterState(
    page,
    () => padTap('cross', 400),
    (png) => hasSelectColorFrame(png, 1)
      || (hasCustomSelectFrame(png, 0) && !hasCustomSelectFrame(png, 1) && !hasSelectColorFrame(png, 1)),
    'Normal P2',
  );
  if (hasSelectColorFrame(p2NormalFrame, 1)) {
    await confirmRosterState(page, () => padTap('cross', 400), (png) => hasCustomSelectFrame(png, 0) && !hasCustomSelectFrame(png, 1) && !hasSelectColorFrame(png, 1), 'P2 pronto');
  }

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

  return confirmMapAndCombat(page, plan, { moveNative, tap, progress });
}

async function confirmMapAndCombat(page, plan, { moveNative, tap, progress }) {
  progress(`stage random: destra ${plan.stage.right}, giù ${plan.stage.down}`);
  await moveNative('ArrowRight', plan.stage.right);
  await moveNative('ArrowDown', plan.stage.down);
  // L'estremo destro è l'icona BGM: una posizione a sinistra conferma sempre uno stage.
  await moveNative('ArrowLeft', 1);
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
    if (window.__BT3_MARKET_ARENA__) window.__BT3_MARKET_ARENA__.automationError = null;
  });
  progress('combattimento 3D avviato; controllare la cattura video');
  return plan;
}

function hasConfirmedMapSelectionFrame(png) {
  return hasMapHeaderFrame(png) && hasMapSelectionFrame(png);
}

/** Riprende da una mappa già aperta dopo un errore nella selezione precedente. */
export async function runMapSelectionSequence(page, { random = Math.random, onProgress = () => {} } = {}) {
  const randomInt = (min, max) => min + Math.floor(random() * (max - min + 1));
  const plan = { stage: { right: randomInt(1, 6), down: randomInt(0, 2) } };
  const controls = createMenuControls(page, onProgress);
  await waitForRosterState(page, hasConfirmedMapSelectionFrame, 'Map Select', 30_000);
  return confirmMapAndCombat(page, plan, controls);
}

/** Dopo KO/timeout naviga dalla voce realmente evidenziata a Character Select. */
export async function runRematchSequence(page, options = {}) {
  const { tap, padTap, progress } = createMenuControls(page, options.onProgress ?? (() => {}));
  let menuPlayer = options.menuPlayer === 0 ? 0 : 1;
  const rosterSequence = options.rosterSequence ?? runRosterSequence;
  const mapSequence = options.mapSequence ?? runMapSelectionSequence;
  await page.evaluate(() => {
    window.marketArena.bridge.setMode(0, 'idle');
    window.marketArena.bridge.setMode(1, 'idle');
    document.querySelector('canvas')?.focus();
  });
  const recoveryFrame = PNG.sync.read(await page.screenshot());
  if (hasCharacterSelectionFrame(recoveryFrame)) {
    progress('Character Select già visibile: ripresa diretta del roster, senza cercare i risultati');
    return rosterSequence(page, options);
  }
  if (hasConfirmedMapSelectionFrame(recoveryFrame)) {
    progress('Map Select già visibile: ripresa diretta della mappa, senza cercare i risultati');
    return mapSequence(page, options);
  }
  progress('attesa visiva del menu dei risultati; nessuna conferma anticipata');
  let selected = await waitForResultsMenu(page, { menuPlayer });
  if (selected === 'roster') {
    progress('Character Select apparso durante il retry: ripresa immediata del roster');
    return rosterSequence(page, options);
  }
  if (selected === 'map') {
    progress('Map Select apparsa durante il retry: ripresa immediata della mappa');
    return mapSequence(page, options);
  }
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
        // La voce evidenziata lampeggia: un fotogramma illeggibile non è un menu scomparso.
        // Si rilegge per ~1 s; se il menu non torna, questo pad conta come "nessun movimento".
        let frame = null;
        selected = null;
        for (let read = 0; read < 4 && selected === null; read += 1) {
          if (read > 0) await wait(page, 250);
          frame = PNG.sync.read(await page.screenshot());
          selected = readResultsMenuSelection(frame);
        }
        if (selected === null) {
          if (hasCharacterSelectionFrame(frame)) {
            progress('Character Select apparso durante lo spostamento: ripresa del roster');
            return rosterSequence(page, options);
          }
          progress(`menu risultati illeggibile dopo l'input di P${candidate + 1}: considero nessun movimento`);
          selected = previous;
          continue;
        }
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
  // Se la voce era già quella giusta nessun movimento ha rivelato il proprietario del menu:
  // una conferma ignorata si riprova con l'altro giocatore, mai su un menu non verificato.
  const confirmWith = (player) => confirmRosterState(
    page,
    () => player === 0 ? tap('k', 400) : padTap('cross', 400),
    (png) => hasExitPromptFrame(png) || hasCharacterSelectionFrame(png),
    'Character Select / EXIT',
  );
  let confirmationFrame;
  try {
    confirmationFrame = await confirmWith(menuPlayer);
  } catch (error) {
    const other = menuPlayer === 0 ? 1 : 0;
    if (readResultsMenuSelection(PNG.sync.read(await page.screenshot())) !== 1) throw error;
    progress(`conferma non recepita da P${menuPlayer + 1}: riprovo con P${other + 1}`);
    confirmationFrame = await confirmWith(other);
    menuPlayer = other;
  }
  if (hasExitPromptFrame(confirmationFrame)) {
    // Character Select chiede EXIT? con default No: qui Yes è la conferma corretta.
    progress('conferma EXIT? → Yes per entrare davvero nel Character Select');
    await confirmExitPromptSelection(page, menuPlayer, 0);
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
