import test from 'node:test';
import assert from 'node:assert/strict';
import { MarketFeed, RollingPressure, classifyTrade, normalizePumpTrade } from '../marketFeed.js';

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

test('un cambio CA rapido ignora la risposta lenta del feed precedente', async (t) => {
  const { MarketFeed } = await import('../marketFeed.js');
  const firstCa = 'So11111111111111111111111111111111111111112';
  const secondCa = '11111111111111111111111111111112';
  let releaseFirst;
  const pair = (price) => ({ pairs: [{ chainId: 'solana', priceUsd: String(price), marketCap: price * 100, txns: { m5: { buys: 0, sells: 0 } } }] });
  const markets = [];
  const feed = new MarketFeed({
    fetchImpl: async (url) => {
      if (url.includes(firstCa)) {
        return new Promise((resolve) => { releaseFirst = () => resolve(new Response(JSON.stringify(pair(1)), { status: 200 })); });
      }
      return new Response(JSON.stringify(pair(2)), { status: 200 });
    },
    onMarket: (market) => markets.push(market.price),
  });
  t.after(() => feed.stop());
  const first = feed.connect('dexscreener', firstCa, { pollMs: 60_000 });
  await Promise.resolve();
  await feed.connect('dexscreener', secondCa, { pollMs: 60_000 });
  releaseFirst();
  await first;
  assert.equal(feed.contractAddress, secondCa);
  assert.equal(feed.latestPrice, 2);
  assert.deepEqual(markets, [2]);
  feed.stop();
});

test('MarketFeed invoca fetch con globalThis come richiesto dal browser', async () => {
  const feed = new MarketFeed({
    fetchImpl: function (url) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve({ ok: true, json: async () => ({ pairs: [{ chainId: 'solana', url }] }) });
    },
  });
  const pair = await feed.fetchDexPair('So11111111111111111111111111111111111111112');
  assert.equal(pair.chainId, 'solana');
});

test('DexScreener emette solo gli scambi nuovi con importo medio, non il volume di 5 minuti', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const snapshots = [
    { pairAddress: 'P1', txns: { m5: { buys: 100, sells: 100 } }, volume: { m5: 200_000 }, priceUsd: '94', marketCap: 1e9 },
    { pairAddress: 'P1', txns: { m5: { buys: 103, sells: 101 } }, volume: { m5: 204_000 }, priceUsd: '94', marketCap: 1e9 },
    { pairAddress: 'P2', txns: { m5: { buys: 5, sells: 900 } }, volume: { m5: 905_000 }, priceUsd: '94', marketCap: 1e9 },
  ];
  let call = 0;
  const trades = [];
  const feed = new MarketFeed({
    onTrade: (trade) => trades.push(trade),
    fetchImpl: async () => ({ ok: true, json: async () => ({ pairs: [{ chainId: 'solana', liquidity: { usd: 1 }, ...snapshots[Math.min(call++, snapshots.length - 1)] }] }) }),
  });
  await feed.connect('dexscreener', 'So11111111111111111111111111111111111111112', { pollMs: 2_000 });
  t.mock.timers.tick(2_000);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const buy = trades.find((trade) => trade.side === 'BUY');
  const sell = trades.find((trade) => trade.side === 'SELL');
  assert.equal(buy.count, 3);
  assert.equal(sell.count, 1);
  assert.equal(buy.amountUsd, 3_000, 'media 1.000 $ per scambio × 3 nuovi');
  assert.equal(sell.amountUsd, 1_000);
  t.mock.timers.tick(2_000);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(trades.length, 2, 'cambio di coppia: nessun delta falso da 899 vendite');
  feed.stop();
});

test('normalizePumpTrade legge il formato attuale di PumpPortal (solAmount in SOL)', () => {
  const event = normalizePumpTrade({ signature: 'x', txType: 'sell', solAmount: 1.5, marketCapSol: 300 }, 100);
  assert.equal(event.side, 'SELL');
  assert.equal(event.amountUsd, 150);
  assert.equal(event.marketCap, 30_000);
});

test('PumpPortal: market cap da DexScreener anche senza trade ed errori del server visibili', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const statuses = [];
  const markets = [];
  const sockets = [];
  class FakeSocket {
    constructor(url) { this.url = url; this.listeners = {}; this.sent = []; sockets.push(this); }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    send(message) { this.sent.push(message); }
    close() {}
    emit(type, event) { (this.listeners[type] ?? []).forEach((fn) => fn(event)); }
  }
  let cap = 1_000_000;
  const feed = new MarketFeed({
    WebSocketImpl: FakeSocket,
    onStatus: (status) => statuses.push(status),
    onMarket: (market) => markets.push(market.marketCap),
    fetchImpl: async () => ({ ok: true, json: async () => ({ pairs: [{ chainId: 'solana', priceUsd: '0.001', marketCap: cap, liquidity: { usd: 1 } }] }) }),
  });
  await feed.connect('pumpportal', 'FUvoZUa1FJa5bRRn4VYovJEMypYrWzpX4CdUK4DHpump', { solUsdPrice: 100, marketPollMs: 15_000 });
  assert.ok(markets.includes(1_000_000), 'market cap iniziale senza trade');
  cap = 2_000_000;
  t.mock.timers.tick(15_000);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(markets.includes(2_000_000), 'market cap aggiornato senza trade');
  sockets[0].emit('open');
  sockets[0].emit('message', { data: JSON.stringify({ message: 'API key required' }) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(statuses.some((status) => status.state === 'degraded' && /API key required/.test(status.detail)));
  feed.stop();
});

function fakeSocketClass() {
  const sockets = [];
  class FakeSocket {
    constructor(url) { this.url = url; this.listeners = {}; this.sent = []; sockets.push(this); }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    send(message) { this.sent.push(message); }
    close() {}
    emit(type, event) { (this.listeners[type] ?? []).forEach((fn) => fn(event)); }
  }
  return { FakeSocket, sockets };
}

const PUMP_CA = 'FUvoZUa1FJa5bRRn4VYovJEMypYrWzpX4CdUK4DHpump';
const flush = async () => { for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const dexResponse = () => ({ ok: true, json: async () => ({ pairs: [{ chainId: 'solana', priceUsd: '150', marketCap: 1_000_000, liquidity: { usd: 1 } }] }) });

test('PumpPortal: se il prezzo SOL non arriva al lancio il feed riprova da solo', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { FakeSocket, sockets } = fakeSocketClass();
  const statuses = [];
  let online = false;
  const feed = new MarketFeed({
    WebSocketImpl: FakeSocket,
    onStatus: (status) => statuses.push(status),
    fetchImpl: async () => { if (!online) throw new TypeError('fetch failed'); return dexResponse(); },
  });
  t.after(() => feed.stop());
  // Il CA appena salvato non deve restare senza feed per un errore di rete di un attimo.
  await feed.connect('pumpportal', PUMP_CA);
  assert.equal(feed.contractAddress, PUMP_CA);
  assert.ok(statuses.some((status) => status.state === 'degraded'), 'errore visibile');
  assert.equal(sockets.length, 0);
  online = true;
  t.mock.timers.tick(1_000);
  await flush();
  assert.equal(sockets.length, 1, 'dopo il ritorno della rete il WebSocket viene aperto');
});

test('PumpPortal: una riconnessione fallita viene ritentata, non abbandonata', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { FakeSocket, sockets } = fakeSocketClass();
  let online = true;
  const feed = new MarketFeed({
    WebSocketImpl: FakeSocket,
    fetchImpl: async () => { if (!online) throw new TypeError('fetch failed'); return dexResponse(); },
  });
  t.after(() => feed.stop());
  await feed.connect('pumpportal', PUMP_CA);
  assert.equal(sockets.length, 1);
  online = false;
  sockets[0].emit('close');
  t.mock.timers.tick(1_000);
  await flush();
  online = true;
  t.mock.timers.tick(2_000);
  await flush();
  assert.equal(sockets.length, 2, 'il secondo tentativo riapre il WebSocket');
});

test('PumpPortal: le riconnessioni non accumulano timer del market cap', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { FakeSocket, sockets } = fakeSocketClass();
  let calls = 0;
  const feed = new MarketFeed({
    WebSocketImpl: FakeSocket,
    fetchImpl: async () => { calls += 1; return dexResponse(); },
  });
  t.after(() => feed.stop());
  await feed.connect('pumpportal', PUMP_CA, { solUsdPrice: 100, marketPollMs: 15_000 });
  for (let drop = 0; drop < 3; drop += 1) {
    sockets.at(-1).emit('close');
    t.mock.timers.tick(14_000);
    await flush();
    sockets.at(-1).emit('open');
  }
  calls = 0;
  t.mock.timers.tick(15_000);
  await flush();
  assert.equal(calls, 1, 'un solo aggiornamento ogni 15 s dopo tre riconnessioni');
  feed.stop();
  calls = 0;
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(calls, 0, 'stop ferma tutti i timer');
});

test('dopo stop nessun messaggio del vecchio WebSocket raggiunge HUD o combattimento', async (t) => {
  const { FakeSocket, sockets } = fakeSocketClass();
  const trades = [];
  const feed = new MarketFeed({ WebSocketImpl: FakeSocket, onTrade: (trade) => trades.push(trade), fetchImpl: async () => dexResponse() });
  t.after(() => feed.stop());
  await feed.connect('pumpportal', PUMP_CA, { solUsdPrice: 100, marketPollMs: 60_000 });
  const old = sockets[0];
  old.emit('open');
  feed.stop();
  old.emit('message', { data: JSON.stringify({ txType: 'buy', solAmount: 1, signature: 'x' }) });
  await flush();
  assert.deepEqual(trades, []);
});

test('un evento PumpPortal senza importo o con tipo ignoto non produce trade falsi', async (t) => {
  const { FakeSocket, sockets } = fakeSocketClass();
  const trades = [];
  const statuses = [];
  const feed = new MarketFeed({ WebSocketImpl: FakeSocket, onTrade: (trade) => trades.push(trade), onStatus: (status) => statuses.push(status), fetchImpl: async () => dexResponse() });
  t.after(() => feed.stop());
  await feed.connect('pumpportal', PUMP_CA, { solUsdPrice: 100, marketPollMs: 60_000 });
  sockets[0].emit('open');
  sockets[0].emit('message', { data: JSON.stringify({ txType: 'buy' }) });
  sockets[0].emit('message', { data: JSON.stringify({ txType: 'create', solAmount: 1 }) });
  sockets[0].emit('message', { data: 'non json' });
  await flush();
  assert.deepEqual(trades, []);
  assert.ok(statuses.some((status) => status.state === 'degraded'), 'il dato sporco è segnalato');
  sockets[0].emit('message', { data: JSON.stringify({ txType: 'sell', solAmount: 2, signature: 'ok' }) });
  await flush();
  assert.equal(trades.length, 1);
  assert.equal(trades[0].side, 'SELL');
  assert.equal(trades[0].amountUsd, 200);
});

test('Solana: lo scambio viene letto dal saldo del firmatario, senza prezzo nessun trade inventato', () => {
  const feed = new MarketFeed({});
  const transaction = {
    blockTime: 1_800_000_000,
    transaction: { message: { accountKeys: [{ pubkey: 'buyer', signer: true }] } },
    meta: {
      preTokenBalances: [{ mint: PUMP_CA, owner: 'buyer', uiTokenAmount: { uiAmountString: '10' } }],
      postTokenBalances: [{ mint: PUMP_CA, owner: 'buyer', uiTokenAmount: { uiAmountString: '35' } }],
    },
  };
  assert.equal(feed.normalizeSolanaTransaction(transaction, PUMP_CA, 'sig'), null, 'senza prezzo nessun importo');
  feed.latestPrice = 2;
  const event = feed.normalizeSolanaTransaction(transaction, PUMP_CA, 'sig');
  assert.equal(event.side, 'BUY');
  assert.equal(event.amountUsd, 50);
  assert.equal(event.timestamp, 1_800_000_000_000);
  const other = structuredClone(transaction);
  other.meta.postTokenBalances = [{ mint: 'altro', owner: 'buyer', uiTokenAmount: { uiAmountString: '99' } }];
  other.meta.preTokenBalances = [];
  assert.equal(feed.normalizeSolanaTransaction(other, PUMP_CA, 'sig'), null, 'token diverso ignorato');
});
