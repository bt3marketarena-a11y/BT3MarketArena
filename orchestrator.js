import { BT3InputBridge } from './bt3InputBridge.js';
import { MarketFeed } from './marketFeed.js';
import { MatchAutomator, WasmMemoryBridge } from './matchAutomator.js';
import { BroadcastUI } from './broadcastUI.js';
import { CloudConfigClient } from './cloudClient.js';

const STORAGE_KEY = 'bt3-market-arena-direct-v2';
const DEFAULT_CONFIG = {
  source: 'simulation', ca: '', whaleThreshold: 10_000,
  wsUrl: 'wss://api.mainnet-beta.solana.com', httpUrl: 'https://api.mainnet-beta.solana.com',
  phaseOffset: '', hp1Offset: '', hp2Offset: '', roundDurationSec: 300,
};

export class Orchestrator {
  constructor({ bridge = null, targetWindow = window, cloudSync = { enabled: false } } = {}) {
    this.window = targetWindow;
    this.config = this.loadConfig();
    this.cloud = cloudSync?.enabled ? new CloudConfigClient({ baseUrl: cloudSync.baseUrl ?? '' }) : null;
    this.cloudUnsubscribe = null;
    this.appliedCloudRevision = -1;
    this.ui = new BroadcastUI();
    this.bridge = bridge ?? new BT3InputBridge({ window: targetWindow }).install();
    this.engineStatus = 'MAIN-world pre-load attivo: 2 gamepad, GamepadEvent e doppio canale KeyboardEvent sul motore reale.';
    this.overrideTimer = null;
    this.memoryTimer = null;
    this.memoryBridge = null;
    this.lastMemoryHp = null;
    this.market = new MarketFeed({
      whaleThresholdUsd: Number(this.config.whaleThreshold),
      onTrade: (trade, snapshot) => this.handleTrade(trade, snapshot),
      onStatus: (status) => this.ui.setStatus(status),
      onMarket: (market) => this.ui.updateMarket(market),
    });
    this.match = new MatchAutomator({
      inputBridge: this.bridge,
      roundDurationMs: Number(this.config.roundDurationSec) * 1000,
      onPhase: (phase, round) => this.handlePhase(phase, round),
      onReset: () => this.resetMatch(),
      onTimeout: () => this.ui.setStatus({ state: 'timeout', detail: 'Cambio round di sicurezza sul motore reale', mode: this.market.mode, contractAddress: this.market.contractAddress }),
    });
    this.pressureTimer = null;
  }

  loadConfig() {
    try { return { ...DEFAULT_CONFIG, ...JSON.parse(this.window.localStorage.getItem(STORAGE_KEY) ?? '{}') }; }
    catch { return { ...DEFAULT_CONFIG }; }
  }

  saveConfig() {
    this.window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
  }

  async start() {
    this.ui.bindAdmin({
      onApply: (config, action, adminKey) => this.applyConfig(config, action, adminKey),
      getEngineStatus: () => this.engineStatus,
    }, this.config);
    this.bridge.setMode(0, 'idle');
    this.bridge.setMode(1, 'idle');
    this.pressureTimer = this.window.setInterval(() => this.ui.updatePressure(this.market.getSnapshot()), 200);
    if (this.cloud) {
      await this.startCloud();
      return;
    }
    if (this.config.source !== 'simulation' && this.config.ca) {
      await this.connectFeed(this.config).catch((error) => {
        this.ui.setStatus({ state: 'degraded', detail: error.message, mode: this.config.source, contractAddress: this.config.ca });
      });
    } else {
      await this.market.startSimulation();
    }
  }

  async startCloud() {
    let receivedState = false;
    const apply = async (state) => {
      receivedState = true;
      await this.applyCloudState(state).catch((error) => this.ui.setStatus({ state: 'degraded', detail: error.message, mode: state.source, contractAddress: state.ca }));
    };
    this.cloudUnsubscribe = this.cloud.subscribe((state) => { void apply(state); });
    try {
      await apply(await this.cloud.load());
    } catch (error) {
      this.ui.setStatus({ state: 'degraded', detail: error.message, mode: 'cloud', contractAddress: '' });
    }
    if (!receivedState) await this.market.startSimulation();
  }

  async applyCloudState(state) {
    const revision = Number(state.revision) || 0;
    if (revision === this.appliedCloudRevision) return;
    this.appliedCloudRevision = revision;
    const { revision: ignoredRevision, updatedAt: ignoredUpdatedAt, ...config } = state;
    this.config = { ...this.config, ...config };
    this.ui.currentConfig = { ...this.ui.currentConfig, ...this.config };
    this.match.roundDurationMs = Math.max(10, Number(this.config.roundDurationSec) || 300) * 1000;
    this.market.whaleThresholdUsd = Math.max(1, Number(this.config.whaleThreshold) || 10_000);
    if (this.config.source === 'simulation') {
      await this.market.startSimulation();
      this.ui.setContract('SIMULATION_MODE', 'simulation');
    } else {
      await this.connectFeed(this.config);
    }
  }

  async waitForGameAndEnter() {
    const canvas = await this.waitForCanvas(60_000);
    if (!canvas) {
      this.engineStatus = 'Canvas WebGL non rilevato entro 60 secondi; bridge comunque installato.';
      return;
    }
    canvas.setAttribute('tabindex', '0');
    canvas.focus({ preventScroll: true });
    this.window.setTimeout(() => this.bridge.enterDuelMode(0), 3_500);
  }

  waitForCanvas(timeoutMs) {
    return new Promise((resolve) => {
      const existing = this.window.document.querySelector('canvas');
      if (existing) { resolve(existing); return; }
      const observer = new MutationObserver(() => {
        const canvas = this.window.document.querySelector('canvas');
        if (canvas) { observer.disconnect(); clearTimeout(timer); resolve(canvas); }
      });
      observer.observe(this.window.document.documentElement, { childList: true, subtree: true });
      const timer = this.window.setTimeout(() => { observer.disconnect(); resolve(null); }, timeoutMs);
    });
  }

  async connectFeed(config) {
    this.market.whaleThresholdUsd = Math.max(1, Number(config.whaleThreshold) || 10_000);
    await this.market.connect(config.source, config.ca, { wsUrl: config.wsUrl, httpUrl: config.httpUrl });
    this.ui.setContract(config.ca, config.source);
  }

  async applyConfig(incoming, action, adminKey = '') {
    const { adminKey: ignoredAdminKey, revision: ignoredRevision, updatedAt: ignoredUpdatedAt, ...publicIncoming } = incoming;
    if (this.cloud && !action.startsWith('test-')) {
      const next = { ...this.config, ...publicIncoming };
      if (action === 'simulation') next.source = 'simulation';
      const state = await this.cloud.update(next, adminKey);
      await this.applyCloudState(state);
      return;
    }
    this.config = { ...this.config, ...publicIncoming };
    this.saveConfig();
    this.ui.currentConfig = { ...this.ui.currentConfig, ...this.config };
    if (action === 'simulation') {
      this.config.source = 'simulation';
      this.saveConfig();
      await this.market.startSimulation();
      this.ui.setContract('SIMULATION_MODE', 'simulation');
      return;
    }
    if (action === 'feed') {
      if (this.config.source === 'simulation') await this.market.startSimulation();
      else await this.connectFeed(this.config);
      return;
    }
    if (action === 'memory') {
      this.configureMemoryBridge();
      this.match.roundDurationMs = Math.max(10, Number(this.config.roundDurationSec) || 300) * 1000;
      return;
    }
    if (action.startsWith('test-')) {
      const side = action === 'test-sell' ? 'SELL' : 'BUY';
      const amountUsd = action === 'test-whale' ? Math.max(25_000, Number(this.config.whaleThreshold) * 2) : 450;
      this.market.emitTrade({ id: `manual-${Date.now()}`, side, amountUsd, timestamp: Date.now(), source: 'manual-test', marketCap: this.market.latestMarketCap, price: this.market.latestPrice, aggregate: false });
    }
  }

  handleTrade(trade, snapshot) {
    this.ui.addTrade(trade);
    this.ui.updatePressure(snapshot);
    if (this.match.phase !== 'fighting') return;
    const attacker = trade.side === 'BUY' ? 0 : 1;
    const defender = 1 - attacker;
    const macro = trade.kind === 'whale' ? 'ultimateFinal' : trade.amountUsd >= 1_500 ? 'blast2' : 'rushCombo';
    this.bridge.setMode(attacker, 'attack', { macro });
    this.bridge.setMode(defender, 'vulnerable');
    clearTimeout(this.overrideTimer);
    this.overrideTimer = this.window.setTimeout(() => {
      if (this.match.phase !== 'fighting') return;
      this.bridge.setMode(0, 'neutral');
      this.bridge.setMode(1, 'neutral');
    }, trade.kind === 'whale' ? 4_800 : macro === 'blast2' ? 2_200 : 1_100);
  }

  handlePhase(phase, round) {
    this.ui.setPhase(phase, round);
    if (phase === 'ko' || phase === 'menu') {
      clearTimeout(this.overrideTimer);
      this.bridge.setMode(0, 'idle');
      this.bridge.setMode(1, 'idle');
    }
  }

  resetMatch() {
    this.lastMemoryHp = null;
    this.bridge.setMode(0, 'neutral');
    this.bridge.setMode(1, 'neutral');
  }

  configureMemoryBridge() {
    clearInterval(this.memoryTimer);
    const offsets = { phase: this.parseOffset(this.config.phaseOffset), hp1: this.parseOffset(this.config.hp1Offset), hp2: this.parseOffset(this.config.hp2Offset) };
    if (!Object.values(offsets).every(Number.isInteger)) {
      this.memoryBridge = null;
      this.engineStatus = 'Direct injection attiva. KO automatico tramite timer; configura gli offset per leggere gli HP reali.';
      return;
    }
    this.memoryBridge = new WasmMemoryBridge({
      offsets,
      getMemory: () => this.window.wasmMemory ?? this.window.Module?.wasmMemory ?? (this.window.Module?.HEAPU8 ? { buffer: this.window.Module.HEAPU8.buffer } : null),
    });
    this.memoryTimer = this.window.setInterval(() => this.pollMemory(), 150);
    this.engineStatus = 'Direct injection e Wasm Memory Bridge attivi nel documento reale.';
  }

  parseOffset(value) {
    if (value === '' || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : null;
  }

  pollMemory() {
    if (!this.memoryBridge || this.match.phase !== 'fighting') return;
    try {
      const state = this.memoryBridge.read();
      if (!state) return;
      const hp = [state.hp1, state.hp2];
      if (this.lastMemoryHp) {
        if (hp[0] <= 0 && this.lastMemoryHp[0] > 0) this.match.notifyKO(0);
        else if (hp[1] <= 0 && this.lastMemoryHp[1] > 0) this.match.notifyKO(1);
      }
      this.lastMemoryHp = hp;
      this.ui.updateHealth(hp.map((value) => Math.max(0, Math.min(100, value / 10))));
    } catch {
      this.engineStatus = 'Memory Bridge: memoria Wasm non esportata dalla pagina; verificare Module.wasmMemory/HEAPU8.';
    }
  }

  destroy() {
    this.cloudUnsubscribe?.();
    this.cloudUnsubscribe = null;
    clearInterval(this.pressureTimer);
    clearInterval(this.memoryTimer);
    clearTimeout(this.overrideTimer);
    this.market.stop();
    this.match.stop();
    this.bridge.destroy();
  }
}
