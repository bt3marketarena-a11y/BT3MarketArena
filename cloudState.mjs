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
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Errore di validazione: il messaggio è pensato per l'admin e può tornare al client. */
export class StateValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StateValidationError';
  }
}

const reject = (message) => { throw new StateValidationError(message); };

// Lo stato è pubblico e finisce nel browser di ogni spettatore: solo endpoint cifrati,
// senza credenziali nell'URL e con lunghezza limitata.
function checkRpcUrl(value, protocol, label) {
  if (value.length > 512 || /[\s\u0000-\u001f]/.test(value)) reject(`${label} non valido.`);
  let url;
  try { url = new URL(value); } catch { reject(`${label} non valido.`); }
  if (url.protocol !== protocol) reject(`${label} deve usare ${protocol}//`);
  if (url.username || url.password) reject(`${label}: niente credenziali nell'URL.`);
}

export function validatePublicState(state) {
  if (!SOURCES.has(state.source)) reject('Sorgente mercato non supportata.');
  if (state.source !== 'simulation' && !MINT.test(state.ca)) reject('Inserisci una mint Solana valida (32–44 caratteri Base58).');
  if (state.source === 'simulation' && state.ca !== '' && !MINT.test(state.ca)) reject('CA non valido: lascialo vuoto o usa una mint Solana.');
  if (!Number.isFinite(state.whaleThreshold) || state.whaleThreshold < 1 || state.whaleThreshold > 1e12) reject('Whale threshold non valido.');
  if (!Number.isFinite(state.roundDurationSec) || state.roundDurationSec < 0 || state.roundDurationSec > 3600) reject('Durata round non valida.');
  checkRpcUrl(state.wsUrl, 'wss:', 'WebSocket RPC');
  checkRpcUrl(state.httpUrl, 'https:', 'HTTP RPC');
  for (const key of ['phaseOffset', 'hp1Offset', 'hp2Offset']) {
    if (state[key] !== '' && (!/^\d{1,10}$/.test(state[key]) || !Number.isSafeInteger(Number(state[key])))) reject(`Offset ${key} non valido.`);
  }
  return state;
}

export function normalizePublicStatePatch(current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) reject('Il corpo deve essere un oggetto JSON.');
  const unknown = Object.keys(patch).filter((key) => !ALLOWED_FIELDS.has(key));
  if (unknown.length) reject(`Campi non consentiti: ${unknown.slice(0, 5).join(', ').slice(0, 120)}`);
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
