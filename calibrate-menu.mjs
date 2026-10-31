import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createInjectionBundle } from './launcher.mjs';

const out = fileURLToPath(new URL('./artifacts/calibration/', import.meta.url));
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--window-size=1920,1080'] });
try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await context.addInitScript({ content: await createInjectionBundle() });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
  await page.goto('https://dragonballbt3.online/runtime.html?hud=0&embedded=0&lang=it&env=BT3_SCALE%3D1%2CBT3_INTERP%3D0', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForSelector('canvas', { timeout: 60_000 });
  await page.waitForTimeout(18_000);
  await page.evaluate(() => {
    window.marketArena?.match?.stop();
    window.marketArena?.market?.stop();
    window.marketArena?.bridge?.setMode(0, 'idle');
    window.marketArena?.bridge?.setMode(1, 'idle');
    document.querySelector('canvas')?.focus();
  });
  const snap = async (name) => {
    await page.screenshot({ path: `${out}${name}.png` });
    console.log(name, await page.evaluate(() => ({ pads: navigator.getGamepads().map((p) => p.buttons.map((b) => b.pressed)), canvas: [document.querySelector('canvas')?.width, document.querySelector('canvas')?.height] })));
  };
  const tap = async (key, holdMs = 220) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(holdMs);
    await page.keyboard.up(key);
  };
  await snap('00-loaded');
  await tap('Enter', 250);
  await page.waitForTimeout(2_500);
  await snap('01-title');
  await tap('Enter', 250);
  await page.waitForTimeout(3_000);
  await snap('02-main-menu');
  await tap('k');
  await page.waitForTimeout(2_500);
  await snap('03-save-prompt');
  await tap('k');
  await page.waitForTimeout(5_000);
  await snap('05-without-save');
  await tap('ArrowLeft');
  await page.waitForTimeout(1_200);
  await snap('06-without-save-selected');
  await tap('k', 400);
  await page.waitForTimeout(5_000);
  await snap('07-main-menu');
  for (let index = 0; index < 3; index += 1) {
    await tap('ArrowDown');
    await page.waitForTimeout(350);
  }
  await snap('08-duel-selected');
  await tap('k');
  await page.waitForTimeout(5_000);
  await snap('09-duel-menu');
  await tap('ArrowDown', 400);
  await page.waitForTimeout(1_200);
  await snap('10-1p-vs-2p-selected');
  await tap('k', 400);
  await page.waitForTimeout(3_000);
  await snap('11-battle-type');
  await tap('k', 400);
  await page.waitForTimeout(8_000);
  await snap('12-character-select');
  for (const [key, count] of [['ArrowRight', 5], ['ArrowDown', 2]]) {
    for (let index = 0; index < count; index += 1) {
      await tap(key, 250);
      await page.waitForTimeout(250);
    }
  }
  await tap('k', 400);
  await page.waitForTimeout(2_000);
  await snap('13-p1-selected');
  const padTap = async (button, holdMs = 300) => {
    await page.evaluate(async ({ button, holdMs }) => {
      const bridge = window.marketArena.bridge;
      bridge.setButton(1, button, true);
      await new Promise((resolve) => setTimeout(resolve, holdMs));
      bridge.setButton(1, button, false);
    }, { button, holdMs });
    await page.waitForTimeout(300);
  };
  for (let index = 0; index < 4; index += 1) await padTap('right');
  await padTap('down');
  await snap('14-p2-moved');
  await padTap('cross', 400);
  await page.waitForTimeout(3_000);
  await snap('15-p2-custom-select');
  await padTap('cross', 400);
  await page.waitForTimeout(4_000);
  await snap('16-p2-color-select');
  await padTap('cross', 400);
  await page.waitForTimeout(2_000);
  await snap('17-p2-confirmed');
  await tap('k', 400);
  await page.waitForTimeout(2_000);
  await snap('18-p1-custom-select');
  await tap('k', 400);
  await page.waitForTimeout(3_000);
  await snap('19-p1-color-select');
  await tap('k', 400);
  await page.waitForTimeout(4_000);
  await snap('20-map-select');
  for (const [key, count] of [['ArrowRight', 3], ['ArrowDown', 2]]) {
    for (let index = 0; index < count; index += 1) {
      await tap(key, 250);
      await page.waitForTimeout(250);
    }
  }
  await tap('k', 400);
  await page.waitForTimeout(15_000);
  await snap('21-battle-loading');
  await page.waitForTimeout(10_000);
  await snap('22-arena-intro');
  await page.waitForTimeout(15_000);
  await tap('Enter', 300);
  await page.evaluate(() => {
    window.marketArena.bridge.setMode(0, 'neutral');
    window.marketArena.bridge.setMode(1, 'neutral');
  });
  await page.waitForTimeout(5_000);
  await snap('23-combat');
  await page.waitForTimeout(5_000);
  await snap('24-combat-active');
} finally {
  await browser.close();
}
