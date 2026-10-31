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
