export class RollingPressure {
  constructor(windowMs = 15_000) {
    this.windowMs = windowMs;
    this.events = [];
  }

  add(event) {
    if (!['BUY', 'SELL'].includes(event.side)) throw new Error('Trade side deve essere BUY o SELL.');
    if (!Number.isFinite(event.amountUsd) || event.amountUsd < 0) throw new Error('amountUsd non valido.');
    this.events.push({ side: event.side, amountUsd: event.amountUsd, timestamp: event.timestamp ?? Date.now() });
  }

  clear() { this.events = []; }

  snapshot(now = Date.now()) {
    const cutoff = now - this.windowMs;
    this.events = this.events.filter((event) => event.timestamp >= cutoff && event.timestamp <= now + 1000);
    let buyUsd = 0;
    let sellUsd = 0;
    for (const event of this.events) {
      if (event.side === 'BUY') buyUsd += event.amountUsd;
      else sellUsd += event.amountUsd;
    }
    const totalUsd = buyUsd + sellUsd;
    return {
      buyUsd,
      sellUsd,
      totalUsd,
      buyPct: totalUsd ? (buyUsd / totalUsd) * 100 : 50,
      sellPct: totalUsd ? (sellUsd / totalUsd) * 100 : 50,
      tradeCount: this.events.length,
      windowMs: this.windowMs,
    };
  }
}

export function classifyTrade(amountUsd, whaleThresholdUsd = 10_000) {
  return amountUsd >= whaleThresholdUsd ? 'whale' : 'normal';
}

export function normalizePumpTrade(raw, solUsdPrice) {
  // PumpPortal invia solAmount già in SOL; il vecchio formato usava sol_amount in lamport.
  const sol = raw.solAmount !== undefined ? Number(raw.solAmount) : Number(raw.sol_amount) / 1_000_000_000;
  const side = String(raw.txType).toUpperCase();
  if (!['BUY', 'SELL'].includes(side) || !Number.isFinite(sol)) throw new Error('Evento PumpPortal non valido.');
  return {
    id: raw.signature ?? `${raw.timestamp ?? Date.now()}-${side}`,
    side,
    amountUsd: sol * solUsdPrice,
    amountSol: sol,
    marketCap: Number(raw.marketCapSol) * solUsdPrice || null,
    price: null,
    timestamp: Number(raw.timestamp) || Date.now(),
    txSignature: raw.signature ?? null,
    source: 'pumpportal',
    aggregate: false,
  };
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export class MarketFeed {
  constructor({
    onTrade = () => {}, onStatus = () => {}, onMarket = () => {},
    pressureWindowMs = 15_000, whaleThresholdUsd = 10_000,
    fetchImpl = globalThis.fetch, WebSocketImpl = globalThis.WebSocket,
    random = Math.random,
  } = {}) {
    this.onTrade = onTrade;
    this.onStatus = onStatus;
    this.onMarket = onMarket;
    this.pressure = new RollingPressure(pressureWindowMs);
    this.whaleThresholdUsd = whaleThresholdUsd;
    // fetch nativo richiede window come this: invocato come metodo lancia "Illegal invocation".
    this.fetch = (...args) => fetchImpl.apply(globalThis, args);
    this.WebSocket = WebSocketImpl;
    this.random = random;
    this.mode = 'idle';
    this.contractAddress = '';
    this.latestPrice = null;
    this.latestMarketCap = null;
    this.supply = null;
    this.socket = null;
    this.timer = null;
    this.abortController = null;
    this.running = false;
    this.reconnectAttempt = 0;
    this.reconnectConfig = null;
    this.previousDexCounts = null;
    this.connectionGeneration = 0;
  }

  isCurrentConnection(generation) {
    return this.running && generation === this.connectionGeneration;
  }

  status(state, detail = '') {
    this.onStatus({ mode: this.mode, state, detail, contractAddress: this.contractAddress });
  }

  emitTrade(event) {
    const normalized = {
      ...event,
      amountUsd: Math.max(0, safeNumber(event.amountUsd)),
      timestamp: event.timestamp ?? Date.now(),
      kind: classifyTrade(event.amountUsd, this.whaleThresholdUsd),
    };
    if (normalized.price) this.latestPrice = normalized.price;
    if (normalized.marketCap) this.latestMarketCap = normalized.marketCap;
    this.pressure.add(normalized);
    this.onTrade(normalized, this.getSnapshot());
  }

  emitMarket() {
    this.onMarket({ price: this.latestPrice, marketCap: this.latestMarketCap, mode: this.mode });
  }

  getSnapshot() {
    return { ...this.pressure.snapshot(), price: this.latestPrice, marketCap: this.latestMarketCap, mode: this.mode };
  }

  async startSimulation({ price = 0.001, marketCap = 1_000_000 } = {}) {
    this.stop();
    this.running = true;
    this.mode = 'simulation';
    this.contractAddress = 'SIMULATION_MODE';
    this.latestPrice = price;
    this.latestMarketCap = marketCap;
    this.supply = marketCap / price;
    this.pressure.clear();
    this.status('live', 'Generatore pre-lancio attivo');
    this.emitMarket();
    const tick = () => {
      if (!this.running || this.mode !== 'simulation') return;
      const side = this.random() > 0.48 ? 'BUY' : 'SELL';
      const isWhale = this.random() < 0.035;
      const base = Math.exp(Math.log(12) + this.random() * Math.log(180));
      const amountUsd = isWhale ? 10_000 + this.random() * 45_000 : base;
      const impact = (side === 'BUY' ? 1 : -1) * Math.min(0.035, amountUsd / Math.max(this.latestMarketCap, 1) * 0.22);
      this.latestPrice = Math.max(0.000000001, this.latestPrice * (1 + impact + (this.random() - 0.5) * 0.001));
      this.latestMarketCap = this.latestPrice * this.supply;
      this.emitTrade({
        id: `sim-${Date.now()}-${Math.floor(this.random() * 1e6)}`,
        side, amountUsd, price: this.latestPrice, marketCap: this.latestMarketCap,
        timestamp: Date.now(), txSignature: null, source: 'simulation', aggregate: false,
      });
      this.emitMarket();
      this.timer = setTimeout(tick, 260 + this.random() * 1_250);
    };
    this.timer = setTimeout(tick, 180);
  }

  async connect(source, contractAddress, options = {}) {
    const ca = String(contractAddress ?? '').trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ca)) throw new Error('Inserisci una mint Solana valida (32–44 caratteri Base58).');
    this.stop();
    const generation = this.connectionGeneration;
    this.running = true;
    this.mode = source;
    this.contractAddress = ca;
    this.previousDexCounts = null;
    this.pressure.clear();
    this.reconnectConfig = { source, ca, options };
    this.status('connecting', `Connessione a ${source}`);
    if (source === 'pumpportal') return this.connectPumpPortal(ca, options, generation);
    if (source === 'dexscreener') return this.connectDexScreener(ca, options, generation);
    if (source === 'solana') return this.connectSolana(ca, options, generation);
    throw new Error(`Sorgente non supportata: ${source}`);
  }

  async connectPumpPortal(ca, { solUsdPrice = null, marketPollMs = 15_000 } = {}, generation = this.connectionGeneration) {
    let rate = solUsdPrice;
    try {
      rate ??= await this.fetchSolUsdPrice();
    } catch (error) {
      // Senza prezzo SOL il feed non parte: un errore di rete di un attimo, magari proprio
      // al salvataggio del CA, non deve lasciarlo fermo fino al prossimo cambio.
      if (this.isCurrentConnection(generation)) {
        this.status('degraded', error.message);
        this.scheduleReconnect(generation);
      }
      return;
    }
    if (!this.isCurrentConnection(generation)) return;
    // I trade portano il market cap solo quando avvengono: prezzo e market cap arrivano
    // anche da DexScreener, così l'HUD resta aggiornato pure nei momenti senza scambi.
    const refreshMarket = async () => {
      try {
        const pair = await this.fetchDexPair(ca);
        if (!this.isCurrentConnection(generation)) return;
        this.latestPrice = safeNumber(pair.priceUsd, this.latestPrice);
        this.latestMarketCap = safeNumber(pair.marketCap ?? pair.fdv, this.latestMarketCap);
        this.emitMarket();
      } catch {}
    };
    await refreshMarket();
    // Timer separato: this.timer è usato dalla riconnessione del WebSocket.
    if (this.isCurrentConnection(generation)) {
      // A ogni riconnessione questa funzione riparte: il timer precedente va sostituito.
      clearInterval(this.marketTimer);
      this.marketTimer = setInterval(refreshMarket, Math.max(5_000, marketPollMs));
    }
    const url = 'wss://pumpportal.fun/api/data';
    this.openSocket(url, {
      onOpen: (socket) => socket.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: [ca] })),
      onMessage: (data) => {
        if (!this.isCurrentConnection(generation)) return;
        // Risposte del server senza trade (es. chiave API richiesta): visibili come stato, non ignorate.
        if (!data.txType && data.message) { this.status('degraded', `PumpPortal: ${data.message}`); return; }
        if (!data.txType || !(data.solAmount ?? data.sol_amount)) return;
        const event = normalizePumpTrade(data, rate);
        if (event.marketCap && this.supply) event.price = event.marketCap / this.supply;
        this.emitTrade(event);
        this.emitMarket();
      },
    }, generation);
  }

  async connectDexScreener(ca, { pollMs = 5_000 } = {}, generation = this.connectionGeneration) {
    const poll = async () => {
      if (!this.isCurrentConnection(generation) || this.mode !== 'dexscreener') return;
      try {
        const pair = await this.fetchDexPair(ca);
        if (!this.isCurrentConnection(generation)) return;
        const counts = { pair: pair.pairAddress ?? null, buys: safeNumber(pair.txns?.m5?.buys), sells: safeNumber(pair.txns?.m5?.sells) };
        this.latestPrice = safeNumber(pair.priceUsd, this.latestPrice);
        this.latestMarketCap = safeNumber(pair.marketCap ?? pair.fdv, this.latestMarketCap);
        // Se cambia la coppia più liquida i conteggi non sono confrontabili: si riparte.
        if (this.previousDexCounts && this.previousDexCounts.pair !== counts.pair) this.previousDexCounts = null;
        if (this.previousDexCounts) {
          const deltas = {
            BUY: Math.max(0, counts.buys - this.previousDexCounts.buys),
            SELL: Math.max(0, counts.sells - this.previousDexCounts.sells),
          };
          // Il volume m5 copre 5 minuti: l'importo dei soli scambi nuovi è la media per
          // scambio della finestra moltiplicata per i nuovi scambi, non l'intero volume.
          const windowTrades = counts.buys + counts.sells;
          const averageTradeUsd = windowTrades ? safeNumber(pair.volume?.m5) / windowTrades : 0;
          for (const side of ['BUY', 'SELL']) {
            if (!deltas[side]) continue;
            this.emitTrade({
              id: `dex-${ca}-${Date.now()}-${side}`,
              side,
              amountUsd: averageTradeUsd * deltas[side],
              price: this.latestPrice,
              marketCap: this.latestMarketCap,
              timestamp: Date.now(),
              txSignature: null,
              source: 'dexscreener-aggregate',
              aggregate: true,
              count: deltas[side],
            });
          }
        }
        this.previousDexCounts = counts;
        this.status('live', 'Polling DexScreener: eventi aggregati su 5 minuti');
        this.emitMarket();
      } catch (error) {
        if (this.isCurrentConnection(generation) && error.name !== 'AbortError') this.status('degraded', error.message);
      }
    };
    await poll();
    if (this.isCurrentConnection(generation)) this.timer = setInterval(poll, Math.max(2_000, pollMs));
  }

  async connectSolana(ca, {
    wsUrl = 'wss://api.mainnet-beta.solana.com',
    httpUrl = 'https://api.mainnet-beta.solana.com',
  } = {}, generation = this.connectionGeneration) {
    try {
      const pair = await this.fetchDexPair(ca);
      if (!this.isCurrentConnection(generation)) return;
      this.latestPrice = safeNumber(pair.priceUsd, null);
      this.latestMarketCap = safeNumber(pair.marketCap ?? pair.fdv, null);
      this.emitMarket();
    } catch {
      if (this.isCurrentConnection(generation)) this.status('degraded', 'Prezzo iniziale non disponibile; il feed RPC continua.');
    }
    if (!this.isCurrentConnection(generation)) return;
    let requestId = 1;
    this.openSocket(wsUrl, {
      onOpen: (socket) => socket.send(JSON.stringify({
        jsonrpc: '2.0', id: requestId++, method: 'logsSubscribe',
        params: [{ mentions: [ca] }, { commitment: 'confirmed' }],
      })),
      onMessage: async (data) => {
        if (!this.isCurrentConnection(generation)) return;
        const signature = data.params?.result?.value?.signature;
        if (!signature || data.params?.result?.value?.err) return;
        try {
          const transaction = await this.fetchSolanaTransaction(httpUrl, signature);
          if (!this.isCurrentConnection(generation)) return;
          const event = this.normalizeSolanaTransaction(transaction, ca, signature);
          if (event) {
            this.emitTrade(event);
            this.emitMarket();
          }
        } catch (error) {
          if (this.isCurrentConnection(generation)) this.status('degraded', `Transazione ${signature.slice(0, 8)}: ${error.message}`);
        }
      },
    }, generation);
  }

  normalizeSolanaTransaction(transaction, ca, signature) {
    const meta = transaction?.meta;
    const keys = transaction?.transaction?.message?.accountKeys ?? [];
    const signer = keys.find((key) => key.signer)?.pubkey ?? (typeof keys[0] === 'string' ? keys[0] : null);
    if (!meta || !signer || !this.latestPrice) return null;
    const ownerRows = (rows) => rows.filter((row) => row.mint === ca && (row.owner === signer || (!row.owner && keys[row.accountIndex]?.pubkey === signer)));
    const pre = ownerRows(meta.preTokenBalances ?? []).reduce((sum, row) => sum + safeNumber(row.uiTokenAmount.uiAmountString ?? row.uiTokenAmount.uiAmount), 0);
    const post = ownerRows(meta.postTokenBalances ?? []).reduce((sum, row) => sum + safeNumber(row.uiTokenAmount.uiAmountString ?? row.uiTokenAmount.uiAmount), 0);
    const delta = post - pre;
    if (!Number.isFinite(delta) || delta === 0) return null;
    return {
      id: signature,
      side: delta > 0 ? 'BUY' : 'SELL',
      amountUsd: Math.abs(delta) * this.latestPrice,
      tokenAmount: Math.abs(delta),
      price: this.latestPrice,
      marketCap: this.latestMarketCap,
      timestamp: (transaction.blockTime ?? 0) * 1000 || Date.now(),
      txSignature: signature,
      source: 'solana',
      aggregate: false,
    };
  }

  openSocket(url, { onOpen, onMessage }, generation = this.connectionGeneration) {
    if (!this.isCurrentConnection(generation)) return;
    if (!this.WebSocket) throw new Error('WebSocket non disponibile in questo browser.');
    const socket = new this.WebSocket(url);
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (!this.isCurrentConnection(generation) || this.socket !== socket) return;
      this.reconnectAttempt = 0;
      this.status('live', `WebSocket connesso: ${url}`);
      onOpen(socket);
    });
    socket.addEventListener('message', (event) => {
      if (!this.isCurrentConnection(generation) || this.socket !== socket) return;
      Promise.resolve().then(() => onMessage(JSON.parse(event.data))).catch((error) => {
        if (this.isCurrentConnection(generation)) this.status('degraded', error.message);
      });
    });
    socket.addEventListener('error', () => {
      if (this.isCurrentConnection(generation) && this.socket === socket) this.status('degraded', 'Errore WebSocket; riconnessione automatica.');
    });
    socket.addEventListener('close', () => {
      if (!this.isCurrentConnection(generation) || this.socket !== socket) return;
      this.scheduleReconnect(generation);
    });
  }

  scheduleReconnect(generation = this.connectionGeneration) {
    if (!this.reconnectConfig || !this.isCurrentConnection(generation)) return;
    const delay = Math.min(30_000, 1_000 * 2 ** this.reconnectAttempt++);
    this.status('reconnecting', `Nuovo tentativo tra ${Math.round(delay / 1000)} s`);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!this.reconnectConfig || !this.isCurrentConnection(generation)) return;
      const { source, ca, options } = this.reconnectConfig;
      this.status('connecting', 'Riconnessione feed');
      const reportError = (error) => {
        if (this.isCurrentConnection(generation)) this.status('degraded', error.message);
      };
      if (source === 'pumpportal') this.connectPumpPortal(ca, options, generation).catch(reportError);
      else if (source === 'solana') this.connectSolana(ca, options, generation).catch(reportError);
      else if (source === 'dexscreener') this.connectDexScreener(ca, options, generation).catch(reportError);
    }, delay);
  }

  async fetchDexPair(ca) {
    const response = await this.fetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(ca)}`, {
      signal: this.abortController?.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`DexScreener HTTP ${response.status}`);
    const data = await response.json();
    const pair = data.pairs?.filter((item) => item.chainId === 'solana').sort((a, b) => safeNumber(b.liquidity?.usd) - safeNumber(a.liquidity?.usd))[0] ?? data.pairs?.[0];
    if (!pair) throw new Error('Nessuna coppia DexScreener trovata per questa mint.');
    return pair;
  }

  async fetchSolUsdPrice() {
    const wrappedSol = 'So11111111111111111111111111111111111111112';
    const pair = await this.fetchDexPair(wrappedSol);
    const price = safeNumber(pair.priceUsd, null);
    if (!price) throw new Error('Impossibile ottenere il prezzo SOL/USD.');
    return price;
  }

  async fetchSolanaTransaction(httpUrl, signature) {
    const response = await this.fetch(httpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }] }),
    });
    if (!response.ok) throw new Error(`Solana RPC HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.error) throw new Error(payload.error.message);
    return payload.result;
  }

  stop() {
    this.connectionGeneration += 1;
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.marketTimer) {
      clearInterval(this.marketTimer);
      this.marketTimer = null;
    }
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      socket.close();
    }
    this.abortController?.abort();
    this.abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
    this.reconnectConfig = null;
    this.previousDexCounts = null;
    this.mode = 'idle';
  }
}
