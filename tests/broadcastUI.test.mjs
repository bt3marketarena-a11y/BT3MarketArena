import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('il feed descrive le azioni soltanto in inglese', async () => {
  const ui = await import('../broadcastUI.js');
  assert.equal(typeof ui.describeTrade, 'function');
  assert.equal(ui.describeTrade({ side: 'BUY', kind: 'normal' }), "P1 breaks P2's counter!");
  assert.equal(ui.describeTrade({ side: 'SELL', kind: 'whale' }), 'P2 → ULTIMATE FINAL on P1!');
});

test('il feed ha un toggle chiuso al primo avvio', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="feed-toggle"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /id="trade-list" hidden/);
  assert.doesNotMatch(html, /Ultime transazioni/);
});

test('il toggle apre e chiude la lista senza cambiare il feed', async () => {
  const { BroadcastUI } = await import('../broadcastUI.js');
  const tradeList = { hidden: true };
  const feedToggle = { getAttribute: () => 'false', setAttribute(name, value) { this[name] = value; } };
  const feed = { classList: { toggle(name, open) { this.open = open; } } };
  const fake = { elements: { tradeList, feedToggle }, feed };
  assert.equal(typeof BroadcastUI.prototype.setFeedOpen, 'function');
  BroadcastUI.prototype.setFeedOpen.call(fake, true);
  assert.equal(tradeList.hidden, false);
  assert.equal(feedToggle['aria-expanded'], 'true');
  assert.equal(feed.classList.open, true);
  BroadcastUI.prototype.setFeedOpen.call(fake, false);
  assert.equal(tradeList.hidden, true);
  assert.equal(feedToggle['aria-expanded'], 'false');
});

test('la vista spectator nasconde i comandi tastiera e offre un admin touch', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /F2 \/\/ ADMIN|<span>F2<\/span>/);
  assert.match(html, /id="admin-open"[^>]*aria-label="Open market admin"/);
  assert.match(html, /id="admin-close"/);
});

test('il layout mobile usa font leggibili, safe area e target touch', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /clamp\(/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(css, /@media\s*\(max-width:\s*600px\)/);
  assert.match(css, /\.admin-open\{[^}]*min-width:44px[^}]*min-height:44px/);
});

test('la diagnostica spagnola del runtime originale resta fuori dalla live', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(css, /#lab-speed,#hud\{display:none!important\}/);
  assert.doesNotMatch(html, /id="(hud|lab-speed)"/, 'gli id nascosti appartengono soltanto al runtime originale');
});
