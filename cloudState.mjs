import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_PUBLIC_STATE = Object.freeze({
  source: 'simulation',
  ca: '',
  whaleThreshold: 10_000,
  wsUrl: 'wss://api.mainnet-beta.solana.com',
  httpUrl: 'https://api.mainnet-beta.solana.com',
  phaseOffset: '',
  hp1Offset: '',
  hp2Offset: '',
  roundDurationSec: 0,
});

const ALLOWED_FIELDS = new Set(Object.keys(DEFAULT_PUBLIC_STATE));
const SOURCES = new Set(['simulation', 'pumpportal', 'dexscreener', 'solana']);

export function validatePublicState(state) {
  if (!SOURCES.has(state.source)) throw new Error('Sorgente mercato non supportata.');
  if (state.source !== 'simulation' && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(state.ca)) {
    throw new Error('Inserisci una mint Solana valida (32–44 caratteri Base58).');
  }
  if (!Number.isFinite(state.whaleThreshold) || state.whaleThreshold < 1) throw new Error('Whale threshold non valido.');
  if (!Number.isFinite(state.roundDurationSec) || state.roundDurationSec < 0) throw new Error('Durata round non valida.');
  if (!/^wss?:\/\//i.test(state.wsUrl)) throw new Error('WebSocket RPC non valido.');
  if (!/^https?:\/\//i.test(state.httpUrl)) throw new Error('HTTP RPC non valido.');
  for (const key of ['phaseOffset', 'hp1Offset', 'hp2Offset']) {
    if (state[key] !== '' && (!Number.isInteger(Number(state[key])) || Number(state[key]) < 0)) throw new Error(`Offset ${key} non valido.`);
  }
  return state;
}

export function normalizePublicStatePatch(current, patch) {
  const unknown = Object.keys(patch).filter((key) => !ALLOWED_FIELDS.has(key));
  if (unknown.length) throw new Error(`Campi non consentiti: ${unknown.join(', ')}`);
  const merged = { ...current, ...patch };
  const next = {
    source: String(merged.source),
    ca: String(merged.ca ?? '').trim(),
    whaleThreshold: Number(merged.whaleThreshold),
    wsUrl: String(merged.wsUrl).trim(),
    httpUrl: String(merged.httpUrl).trim(),
    phaseOffset: merged.phaseOffset === '' ? '' : String(merged.phaseOffset),
    hp1Offset: merged.hp1Offset === '' ? '' : String(merged.hp1Offset),
    hp2Offset: merged.hp2Offset === '' ? '' : String(merged.hp2Offset),
    roundDurationSec: Number(merged.roundDurationSec),
  };
  return validatePublicState(next);
}

export class CloudStateStore {
  constructor({ stateFile = null } = {}) {
    this.stateFile = stateFile;
    this.mode = stateFile ? 'file' : 'memory';
    this.state = { ...DEFAULT_PUBLIC_STATE, revision: 0, updatedAt: null };
    this.queue = Promise.resolve();
    this.ready = this.load();
  }

  async load() {
    if (!this.stateFile) return;
    try {
      const saved = JSON.parse(await readFile(this.stateFile, 'utf8'));
      const { revision = 0, updatedAt = null, ...config } = saved;
      this.state = { ...normalizePublicStatePatch(DEFAULT_PUBLIC_STATE, config), revision, updatedAt };
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Stato cloud non leggibile: ${error.message}`);
    }
  }

  async get() {
    await this.ready;
    return { ...this.state };
  }

  update(patch) {
    this.queue = this.queue.catch(() => {}).then(async () => {
      await this.ready;
      const publicConfig = normalizePublicStatePatch(this.state, patch);
      const next = { ...publicConfig, revision: this.state.revision + 1, updatedAt: new Date().toISOString() };
      if (this.stateFile) {
        await mkdir(path.dirname(this.stateFile), { recursive: true });
        const temporary = `${this.stateFile}.${process.pid}.tmp`;
        await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
        await rename(temporary, this.stateFile);
      }
      this.state = next;
      return { ...next };
    });
    return this.queue;
  }
}
