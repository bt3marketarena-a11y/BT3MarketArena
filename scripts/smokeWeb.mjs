import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createArenaServer } from './arenaServer.mjs';
import { findChromeExecutable } from '../launcher.mjs';

const full = process.argv.includes('--full');
// BT3_SMOKE_BASE_URL verifica un deploy pubblico (es. Vercel) invece del proxy locale.
const remoteBase = process.env.BT3_SMOKE_BASE_URL?.replace(/\/$/, '') ?? '';
const server = remoteBase ? null : createArenaServer({ adminKey: 'smoke-only-not-retained', stateFile: null });
let browser;
try {
  if (server) await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = remoteBase || `http://127.0.0.1:${server.address().port}`;
  const executablePath = findChromeExecutable();
  browser = await chromium.launch({
    headless: process.env.BT3_SMOKE_HEADFUL !== '1',
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  if (process.env.BT3_SMOKE_SINGLE_CHANNEL === '1') {
    await page.addInitScript(() => {
      const NativeKeyboardEvent = window.KeyboardEvent;
      window.KeyboardEvent = class extends NativeKeyboardEvent {
        constructor(type, init) { super(type, { ...init, bubbles: true }); }
      };
      const originalDispatch = window.dispatchEvent;
      window.dispatchEvent = function dispatchOnce(event) {
        if (event instanceof NativeKeyboardEvent && !event.isTrusted) return true;
        return originalDispatch.call(this, event);
      };
    });
  }
  const errors = [];
  const network = [];
  let waitError = null;
  page.on('requestfailed', (request) => network.push(`FAILED ${request.failure()?.errorText} ${request.url().slice(0, 160)}`));
  page.on('response', (response) => {
    if (response.status() >= 400) network.push(`HTTP ${response.status()} ${response.url().slice(0, 160)}`);
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.text().startsWith('[BT3')) console.log(`[browser] ${message.text()}`);
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(`${base}/runtime.html?hud=0&embedded=0&lang=it&env=BT3_SCALE%3D1%2CBT3_INTERP%3D0`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForFunction(() => window.__BT3_MARKET_ARENA__?.status === 'running', null, { timeout: 60_000 });
  await page.waitForFunction(() => document.querySelector('canvas') && window.__BT3_FRAME_CAPTURE__, null, { timeout: 60_000 });
  if (full) {
    await page.waitForFunction(() => window.__BT3_MARKET_ARENA__?.menuSequence === 'completed' || window.__BT3_MARKET_ARENA__?.automationError, null, { timeout: Number(process.env.BT3_SMOKE_TIMEOUT) || 240_000 }).catch((error) => { waitError = error; });
  } else {
    await page.waitForTimeout(12_000);
  }
  const diagnostics = await page.evaluate(() => ({
    status: window.__BT3_MARKET_ARENA__?.status,
    injectionError: window.__BT3_MARKET_ARENA__?.error,
    automationError: window.__BT3_MARKET_ARENA__?.automationError,
    menuSequence: window.__BT3_MARKET_ARENA__?.menuSequence,
    phase: window.marketArena?.match?.phase,
    build: window.__BT3_MARKET_ARENA__?.build,
    cloud: { revision: window.marketArena?.appliedCloudRevision, source: window.marketArena?.config?.source, ca: window.marketArena?.config?.ca },
    webgl2: Boolean(document.createElement('canvas').getContext('webgl2')),
    hud: Boolean(document.getElementById('broadcast')),
    canvases: document.querySelectorAll('canvas').length,
    pads: [...navigator.getGamepads()].map((pad) => pad && ({ index: pad.index, buttons: pad.buttons.length, axes: pad.axes.length })),
    frame: (() => {
      const frame = window.__BT3_FRAME_CAPTURE__?.read();
      return frame ? { width: frame.width, height: frame.height, bytes: frame.data.length } : null;
    })(),
  }));
  const dataUrl = await page.evaluate(() => {
    const frame = window.__BT3_FRAME_CAPTURE__.read();
    const canvas = document.createElement('canvas');
    canvas.width = frame.width;
    canvas.height = frame.height;
    canvas.getContext('2d').putImageData(new ImageData(frame.data, frame.width, frame.height), 0, 0);
    return canvas.toDataURL('image/png');
  });
  await mkdir(path.join(process.cwd(), 'artifacts'), { recursive: true });
  const name = `${remoteBase ? 'prod' : 'cloud'}-web-${full ? 'combat' : 'smoke'}`;
  await writeFile(path.join(process.cwd(), 'artifacts', `${name}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
  // La pagina intera include l'HUD sopra il canvas, assente nei soli pixel WebGL.
  await page.screenshot({ path: path.join(process.cwd(), 'artifacts', `${name}-page.png`) });
  console.log(JSON.stringify({ diagnostics, errors: errors.slice(0, 20), network: network.slice(0, 30) }, null, 2));
  if (diagnostics.automationError) throw new Error(diagnostics.automationError);
  if (diagnostics.pads.length !== 2 || diagnostics.pads.some((pad) => !pad || pad.buttons !== 16 || pad.axes !== 4)) throw new Error('Gamepad web non conformi.');
  if (!diagnostics.hud || !diagnostics.frame) throw new Error('HUD o cattura RGBA non disponibili.');
  if (waitError) throw waitError;
  if (full && diagnostics.menuSequence !== 'completed') throw new Error('Automazione web non completata.');
} finally {
  await browser?.close();
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
