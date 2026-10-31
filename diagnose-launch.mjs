import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createInjectionBundle } from './launcher.mjs';

const out = fileURLToPath(new URL('./artifacts/diagnosis/', import.meta.url));
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--window-size=1920,1080'] });
try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await context.addInitScript({ content: await createInjectionBundle() });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
  await page.goto('https://dragonballbt3.online/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  const play = page.locator('button').filter({ hasText: /^\s*(Jugar|Play|Gioca)\s*$/i }).first();
  if (await play.isVisible({ timeout: 4_000 })) await play.click();
  await page.waitForFunction(() => window.frames.length > 0 && Array.from(window.frames).some((frame) => frame.location.pathname.includes('runtime.html')), null, { timeout: 20_000 });
  const runtimeUrl = await page.evaluate(() => {
    const url = new URL(document.querySelector('iframe#game-frame').src, location.href);
    url.searchParams.set('embedded', '0');
    url.searchParams.set('hud', '0');
    return url.href;
  });
  console.log('RUNTIME', runtimeUrl);
  await page.goto(runtimeUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
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
    console.log(name);
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
  await snap('02-new-game');
  await tap('k');
  await page.waitForTimeout(2_500);
  await snap('03-save-prompt');
  await tap('k');
  await page.waitForTimeout(5_000);
  await snap('04-without-save');
  await tap('ArrowLeft');
  await page.waitForTimeout(1_200);
  await snap('05-yes-selected');
  await tap('k', 400);
  await page.waitForTimeout(5_000);
  await snap('06-main-menu');
  for (let index = 0; index < 3; index += 1) {
    await tap('ArrowDown');
    await page.waitForTimeout(350);
  }
  await snap('07-duel-selected');
} finally {
  await browser.close();
}
