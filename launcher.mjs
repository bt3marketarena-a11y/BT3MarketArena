import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runMenuSequence } from './menuDriver.mjs';
import { captureGameFrame } from './screenCapture.mjs';
import { createInjectionBundle } from './injectionBundle.mjs';
import { monitorPostMatch as monitorSharedPostMatch } from './matchMonitor.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const TARGET_URL = process.env.BT3_TARGET_URL ?? 'https://dragonballbt3.online/runtime.html?hud=0&embedded=0&lang=it&env=BT3_SCALE%3D1%2CBT3_INTERP%3D0';

export { createInjectionBundle };

export async function monitorPostMatch(page) {
  const monitorPath = path.join(ROOT, 'artifacts', 'live-monitor.png');
  return monitorSharedPostMatch(page, { capture: (targetPage) => captureGameFrame(targetPage, monitorPath) });
}

export function findChromeExecutable() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const candidates = [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function clickSitePlayButton(page) {
  const play = page.locator('button').filter({ hasText: /^\s*(Jugar|Play|Gioca)\s*$/i }).first();
  try {
    if (await play.isVisible({ timeout: 4_000 })) {
      await play.click();
      console.log('[BT3] Pulsante Play/Jugar attivato.');
    }
  } catch (error) {
    console.log(`[BT3] Play automatico non disponibile: ${error.message}`);
  }
}

async function collectDiagnostics(page) {
  return page.evaluate(() => {
    const canvases = [...document.querySelectorAll('canvas')];
    const pads = navigator.getGamepads();
    return {
      url: location.href,
      title: document.title,
      injectionStatus: window.__BT3_MARKET_ARENA__?.status ?? 'missing',
      injectionError: window.__BT3_MARKET_ARENA__?.error ?? null,
      hudMounted: Boolean(document.getElementById('broadcast')),
      canvasCount: canvases.length,
      webgl2CanvasCount: canvases.filter((canvas) => {
        try { return Boolean(canvas.getContext('webgl2')); } catch { return false; }
      }).length,
      pads: [...pads].map((pad) => pad ? { id: pad.id, index: pad.index, mapping: pad.mapping, buttons: pad.buttons.length, axes: pad.axes.length } : null),
      matchPhase: window.marketArena?.match?.phase ?? null,
    };
  });
}

export async function launchArena({ headless = process.env.BT3_HEADLESS === '1', validate = false } = {}) {
  const bundle = await createInjectionBundle({
    cloudSync: {
      enabled: process.env.BT3_CLOUD_SYNC === '1',
      baseUrl: process.env.BT3_CLOUD_BASE_URL ?? '',
    },
  });
  const executablePath = findChromeExecutable();
  await mkdir(path.join(ROOT, 'artifacts'), { recursive: true });
  const profileDir = path.join(ROOT, 'artifacts', `chromium-profile-${Date.now()}`);
  const context = await chromium.launchPersistentContext(profileDir, {
    headless,
    ...(executablePath ? { executablePath } : {}),
    ignoreDefaultArgs: ['--enable-automation'],
    viewport: null,
    colorScheme: 'dark',
    args: [
      `--app=${TARGET_URL}`, '--start-fullscreen', '--kiosk',
      '--window-position=0,0', '--window-size=1920,1080',
      '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required',
      '--disable-features=Translate,MediaRouter', '--hide-crash-restore-bubble',
    ],
  });
  const browser = context.browser();
  try {
    // Riutilizza la finestra --app: newPage() creerebbe una normale finestra con URL bar.
    const page = context.pages()[0] ?? await context.newPage();
    page.on('pageerror', (error) => console.error(`[BT3 pageerror] ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(`[BT3 console] ${message.text()}`);
    });
    await context.addInitScript({ content: bundle });
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForFunction(() => window.__BT3_MARKET_ARENA__?.app !== null, null, { timeout: 30_000 });
    console.log(`[BT3] Runtime same-origin aperto direttamente: ${TARGET_URL}`);
    await page.waitForTimeout(30_000);
    const menuPlan = await runMenuSequence(page);
    void monitorPostMatch(page);
    const diagnostics = { ...await collectDiagnostics(page), menuSequence: 'completed', menuPlan };
    console.log(`[BT3] ${JSON.stringify(diagnostics, null, 2)}`);
    await mkdir(path.join(ROOT, 'artifacts'), { recursive: true });
    if (validate) {
      if (diagnostics.injectionStatus !== 'running') throw new Error(`Iniezione non attiva: ${diagnostics.injectionError ?? diagnostics.injectionStatus}`);
      if (!diagnostics.hudMounted) throw new Error('HUD non montato nel DOM reale.');
      if (diagnostics.canvasCount < 1) throw new Error('Nessun canvas del motore rilevato.');
      if (diagnostics.pads.length !== 2 || diagnostics.pads.some((pad) => !pad || pad.buttons !== 16 || pad.axes !== 4)) throw new Error('Gamepad virtuali non conformi.');
      if (diagnostics.matchPhase !== 'fighting') throw new Error(`Match non attivo dopo il driver dei menu: ${diagnostics.matchPhase}`);
      await page.screenshot({ path: path.join(ROOT, 'artifacts', 'dragonballbt3-direct.png'), fullPage: false });
      await page.screenshot({ path: path.join(ROOT, 'artifacts', 'dragonballbt3-combat.png'), fullPage: false });
    } else {
      await page.screenshot({ path: path.join(ROOT, 'artifacts', 'dragonballbt3-live.png'), fullPage: false });
    }
    return { browser, context, page, diagnostics };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const validate = process.argv.includes('--validate');
  let browser;
  const shutdown = async () => { if (browser) await browser.close(); };
  process.on('SIGINT', async () => { await shutdown(); process.exit(0); });
  process.on('SIGTERM', async () => { await shutdown(); process.exit(0); });
  try {
    console.log(`[BT3] Avvio Chromium 1920x1080 su ${TARGET_URL}`);
    const session = await launchArena({ validate });
    browser = session.browser;
    if (validate) {
      await browser.close();
      console.log('[BT3] Validazione completata; Chromium chiuso.');
    } else {
      console.log('[BT3] Motore reale attivo. Premi F2 per il Control Room; chiudi Chromium per terminare.');
      await new Promise((resolve) => browser.on('disconnected', resolve));
    }
  } catch (error) {
    await shutdown();
    console.error(`[BT3] ${error.stack ?? error}`);
    if (!findChromeExecutable()) console.error('[BT3] Se Chromium non è installato, esegui: npx playwright install chromium');
    process.exitCode = 1;
  }
}
