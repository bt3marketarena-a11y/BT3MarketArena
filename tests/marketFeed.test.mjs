import test from 'node:test';
import assert from 'node:assert/strict';
import { RollingPressure, classifyTrade, normalizePumpTrade } from '../marketFeed.js';

test('RollingPressure calcola dominance e scarta eventi scaduti', () => {
  const now = 100_000;
  const pressure = new RollingPressure(10_000);
  pressure.add({ side: 'BUY', amountUsd: 100, timestamp: now - 1_000 });
  pressure.add({ side: 'SELL', amountUsd: 50, timestamp: now - 500 });
  pressure.add({ side: 'BUY', amountUsd: 900, timestamp: now - 20_000 });
  const snapshot = pressure.snapshot(now);
  assert.equal(snapshot.buyUsd, 100);
  assert.equal(snapshot.sellUsd, 50);
  assert.equal(snapshot.totalUsd, 150);
  assert.ok(Math.abs(snapshot.buyPct - 66.6667) < 0.01);
  assert.equal(snapshot.tradeCount, 2);
});

test('RollingPressure senza trade restituisce dominance neutra', () => {
  const snapshot = new RollingPressure().snapshot(123);
  assert.equal(snapshot.buyPct, 50);
  assert.equal(snapshot.sellPct, 50);
  assert.equal(snapshot.tradeCount, 0);
});

test('classifyTrade riconosce le whale tramite soglia configurabile', () => {
  assert.equal(classifyTrade(9_999, 10_000), 'normal');
  assert.equal(classifyTrade(10_000, 10_000), 'whale');
});

test('normalizePumpTrade converte lamports e direzione in evento comune', () => {
  const event = normalizePumpTrade({
    signature: 'abc',
    txType: 'buy',
    sol_amount: 2_000_000_000,
    marketCapSol: 500,
    timestamp: 1234,
  }, 200);
  assert.equal(event.side, 'BUY');
  assert.equal(event.amountUsd, 400);
  assert.equal(event.marketCap, 100_000);
  assert.equal(event.id, 'abc');
  assert.equal(event.source, 'pumpportal');
});
