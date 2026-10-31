import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('il template broadcast non contiene canvas simulati o iframe', async () => {
  const html = await read('index.html');
  assert.doesNotMatch(html, /arena-simulator|bt3-engine/i);
  assert.doesNotMatch(html, /<canvas|<iframe/i);
  assert.match(html, /id="broadcast"/);
});

test('il launcher usa Chromium app fullscreen kiosk senza viewport ridotto', async () => {
  const launcher = await read('launcher.mjs');
  assert.match(launcher, /addInitScript/);
  assert.match(launcher, /https:\/\/dragonballbt3\.online\//);
  assert.match(launcher, /--app=\$\{TARGET_URL\}/);
  assert.match(launcher, /--start-fullscreen/);
  assert.match(launcher, /--kiosk/);
  assert.match(launcher, /launchPersistentContext/);
  assert.match(launcher, /context\.pages\(\)/);
  assert.doesNotMatch(launcher, /browser\.newContext/);
  assert.match(launcher, /viewport:\s*null/);
  assert.doesNotMatch(launcher, /deviceScaleFactor:/);
  assert.match(launcher, /1920/);
  assert.match(launcher, /1080/);
});

test('il canvas riempie il viewport e lo HUD lascia libere le barre HP originali', async () => {
  const css = await read('styles.css');
  assert.match(css, /canvas\s*\{[^}]*width:\s*100vw\s*!important/);
  assert.match(css, /canvas\s*\{[^}]*height:\s*100vh\s*!important/);
  assert.match(css, /canvas\s*\{[^}]*object-fit:\s*contain\s*!important/);
  assert.match(css, /\.topbar\s*\{[^}]*bottom:/);
  assert.doesNotMatch(css, /\.topbar\s*\{[^}]*top:0/);
  assert.match(css, /\.ticker\s*\{[^}]*bottom:\s*20px/);
});

test('il monitor condiviso instrada il post-match verso Character Select', async () => {
  const monitor = await read('matchMonitor.mjs');
  const driver = await read('menuDriver.mjs');
  assert.match(monitor, /runRematchSequence/);
  assert.match(monitor, /phase\s*!==\s*'postmatch'/);
  assert.match(driver, /post-match: Character Select, non Rematch/);
  assert.match(driver, /await tap\('ArrowDown', 400\)/);
  assert.match(driver, /return runRosterSequence\(page, options\)/);
});

test('il monitor rileva la fine match e il launcher conserva la cattura Windows', async () => {
  const monitor = await read('matchMonitor.mjs');
  const launcher = await read('launcher.mjs');
  assert.match(monitor, /CombatEndDetector/);
  assert.match(monitor, /hasActiveCombatFrame/);
  assert.match(monitor, /notifyKO\(null, 'visual-result'\)/);
  assert.match(monitor, /endDetector\.reset\(\)/);
  assert.match(monitor, /KnockoutDetector/);
  assert.match(monitor, /readCombatHealth/);
  assert.match(launcher, /captureGameFrame/);
  assert.match(monitor, /notifyKO\(null, 'visual-hp-zero'\)/);
});

test('Start attraversa la schermata VS su tastiera e gamepad P1', async () => {
  const driver = await read('menuDriver.mjs');
  assert.match(driver, /await tap\('Enter', 300\)/);
  assert.match(driver, /setButton\(0, 'start', true\)/);
  assert.match(driver, /setButton\(0, 'start', false\)/);
  assert.match(driver, /const \{ tap, padTap \} = createMenuControls/);
  assert.match(driver, /await tap\('k', 300\)/);
  assert.match(driver, /await padTap\('cross', 300\)/);
  assert.match(driver, /hasCombatHudFrame/);
});

test('il bootstrap installa il bridge prima del montaggio DOM', async () => {
  const bootstrap = await read('pageBootstrap.js');
  assert.ok(bootstrap.indexOf('new BT3InputBridge') < bootstrap.indexOf('mountOverlay'));
  assert.match(bootstrap, /const GLOBAL_KEY = '__BT3_MARKET_ARENA__'/);
  assert.match(bootstrap, /window\[GLOBAL_KEY\]/);
});
