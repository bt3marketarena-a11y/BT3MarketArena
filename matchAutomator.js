export function createRosterPlan(random = Math.random, rosterSize = 161, stageCount = 16) {
  const pick = (size) => Math.min(size - 1, Math.floor(random() * size));
  const p1 = pick(rosterSize);
  const p2 = pick(rosterSize);
  return {
    p1,
    p2,
    stage: pick(stageCount),
    p1Steps: p1,
    p2Steps: p2,
    stageSteps: pick(stageCount),
  };
}

export class WasmMemoryBridge {
  constructor({ getMemory, offsets = {} }) {
    this.getMemory = getMemory;
    this.offsets = offsets;
  }

  read() {
    const { phase, hp1, hp2 } = this.offsets;
    if (![phase, hp1, hp2].every(Number.isInteger)) return null;
    const memory = this.getMemory?.();
    if (!memory?.buffer) return null;
    const view = new DataView(memory.buffer);
    if (Math.max(phase, hp1, hp2) + 2 > view.byteLength) return null;
    return {
      phase: view.getUint8(phase),
      hp1: view.getInt16(hp1, true),
      hp2: view.getInt16(hp2, true),
    };
  }
}

export class MatchAutomator {
  constructor({
    inputBridge = null,
    onReset = () => {}, onPhase = () => {}, onRandomize = () => {}, onKO = () => {}, onTimeout = () => {},
    random = Math.random,
    koDelayMs = 3_000,
    menuDelayMs = 1_200,
    roundDurationMs = 300_000,
    autoStart = false,
  } = {}) {
    this.inputBridge = inputBridge;
    this.onReset = onReset;
    this.onPhase = onPhase;
    this.onRandomize = onRandomize;
    this.onKO = onKO;
    this.onTimeout = onTimeout;
    this.random = random;
    this.koDelayMs = koDelayMs;
    this.menuDelayMs = menuDelayMs;
    this.roundDurationMs = roundDurationMs;
    this.phase = 'idle';
    this.running = false;
    this.generation = 0;
    this.timers = new Set();
    this.round = 0;
    this.lastPlan = null;
    if (autoStart) this.start();
  }

  setPhase(phase) {
    this.phase = phase;
    this.onPhase(phase, this.round);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.generation += 1;
    this.round = 1;
    this.setPhase('fighting');
    this.armRoundTimeout();
  }

  stop() {
    this.running = false;
    this.generation += 1;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.setPhase('idle');
  }

  delay(callback, ms) {
    const generation = this.generation;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.running && generation === this.generation) callback();
    }, ms);
    this.timers.add(timer);
  }

  armRoundTimeout() {
    if (this.roundDurationMs <= 0) return;
    this.delay(() => {
      this.onTimeout(this.round);
      this.notifyKO(null, 'timeout');
    }, this.roundDurationMs);
  }

  notifyKO(loser, reason = 'ko') {
    if (!this.running || this.phase !== 'fighting') return false;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.setPhase('ko');
    this.onKO({ loser, reason, round: this.round });
    this.delay(() => this.beginMenu(), this.koDelayMs);
    return true;
  }

  beginMenu() {
    if (!this.running || this.phase !== 'ko') return;
    // Il driver Playwright deve scegliere Character Select: confermare qui
    // attiverebbe Rematch e conserverebbe i due personaggi precedenti.
    this.setPhase('postmatch');
  }

  restart() {
    if (!this.running) return;
    this.onReset(this.lastPlan);
    this.round += 1;
    this.setPhase('fighting');
    this.armRoundTimeout();
  }
}
