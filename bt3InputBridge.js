export const BUTTONS = Object.freeze({
  cross: 0, circle: 1, square: 2, triangle: 3,
  l1: 4, guard: 5, l2: 6, r2: 7,
  select: 8, start: 9, l3: 10, r3: 11,
  up: 12, down: 13, left: 14, right: 15,
});

export const KEYBOARD_MAP = Object.freeze([
  {
    up: ['w', 'KeyW'], down: ['s', 'KeyS'], left: ['a', 'KeyA'], right: ['d', 'KeyD'],
    square: ['j', 'KeyJ'], cross: ['k', 'KeyK'], circle: ['l', 'KeyL'], triangle: ['i', 'KeyI'],
    l1: ['u', 'KeyU'], guard: ['o', 'KeyO'], l2: ['7', 'Digit7'], r2: ['9', 'Digit9'],
    start: ['Enter', 'Enter'], select: ['Backspace', 'Backspace'],
  },
  {
    up: ['ArrowUp', 'ArrowUp'], down: ['ArrowDown', 'ArrowDown'], left: ['ArrowLeft', 'ArrowLeft'], right: ['ArrowRight', 'ArrowRight'],
    square: ['1', 'Numpad1'], cross: ['2', 'Numpad2'], circle: ['3', 'Numpad3'], triangle: ['4', 'Numpad4'],
    l1: ['5', 'Numpad5'], guard: ['6', 'Numpad6'], l2: ['7', 'Numpad7'], r2: ['9', 'Numpad9'],
    start: ['0', 'Numpad0'], select: ['.', 'NumpadDecimal'],
  },
]);

const f = (press = [], axes = null) => ({ press, axes });
const idleFrames = (count) => Array.from({ length: count }, () => f());

export const MACROS = Object.freeze({
  zCounterLoop: [
    f(['guard', 'left']), f(['guard', 'left']), f(), f(['cross']), f(), f(['square']), f(),
    f(['guard', 'right']), f(['guard', 'right']), f(), f(['cross']), f(), idleFrames(2),
  ].flat(),
  rushCombo: [
    f(['square']), f(['square']), f(), f(['square']), f(), f(['triangle']), f(),
    f(['cross']), f(), f(['square', 'triangle']), f(['square', 'triangle']), f(),
  ],
  blast2: [
    f(['l2']), f(['l2']), f(['l2', 'triangle']), f(['l2', 'triangle']), f(['l2', 'triangle']),
    f(), f(['cross']), f(), idleFrames(8),
  ].flat(),
  ultimateFinal: [
    f(['l2']), f(['l2']), f(['l2', 'up', 'circle']), f(['l2', 'up', 'circle']),
    f(['l2', 'up', 'circle']), f(), idleFrames(36),
  ].flat(),
  sidestep: [f(['guard', 'down']), f(['guard', 'down']), f(), f(['cross']), f()],
});

function createPad(index) {
  return {
    id: `BT3 Virtual ${index === 0 ? 'Buyer' : 'Seller'} (Standard Mapping)`,
    index,
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
    vibrationActuator: null,
  };
}

export function announceGamepads(targetWindow, pads) {
  for (const gamepad of pads) {
    let event;
    try {
      const EventClass = targetWindow.GamepadEvent ?? globalThis.GamepadEvent;
      if (!EventClass) throw new Error('GamepadEvent non disponibile');
      event = new EventClass('gamepadconnected', { gamepad });
    } catch {
      const EventClass = targetWindow.Event ?? globalThis.Event;
      event = new EventClass('gamepadconnected');
      Object.defineProperty(event, 'gamepad', { configurable: true, enumerable: true, value: gamepad });
    }
    targetWindow.dispatchEvent(event);
  }
}

export class BT3InputBridge {
  constructor({ window: targetWindow = globalThis.window, autoStart = true, keyboardEvents = true, fps = 60, lockOnIntervalFrames = 300 } = {}) {
    if (!targetWindow) throw new Error('BT3InputBridge richiede una window di destinazione.');
    this.window = targetWindow;
    this.fps = fps;
    this.frameMs = 1000 / fps;
    this.keyboardEvents = keyboardEvents;
    this.lockOnIntervalFrames = Math.max(2, lockOnIntervalFrames);
    this.lockOnCountdown = [0, 0];
    this.pads = [createPad(0), createPad(1)];
    this.runtime = [null, null];
    this.modes = ['idle', 'idle'];
    this.installed = false;
    this.running = false;
    this.lastTime = 0;
    this.accumulator = 0;
    this.rafId = null;
    this.originalDescriptor = null;
    this.hadOwnGetGamepads = false;
    this.originalGetGamepads = null;
    if (autoStart) this.start();
  }

  install() {
    if (this.installed) return this;
    const nav = this.window.navigator;
    this.hadOwnGetGamepads = Object.prototype.hasOwnProperty.call(nav, 'getGamepads');
    this.originalDescriptor = Object.getOwnPropertyDescriptor(nav, 'getGamepads');
    this.originalGetGamepads = nav.getGamepads;
    Object.defineProperty(nav, 'getGamepads', {
      configurable: true,
      writable: true,
      value: () => this.pads,
    });
    this.installed = true;
    announceGamepads(this.window, this.pads);
    return this;
  }

  getPad(index) {
    if (index !== 0 && index !== 1) throw new RangeError('Pad index deve essere 0 o 1.');
    return this.pads[index];
  }

  setButton(index, name, pressed) {
    const buttonIndex = BUTTONS[name];
    if (buttonIndex === undefined) throw new Error(`Pulsante sconosciuto: ${name}`);
    const pad = this.getPad(index);
    const button = pad.buttons[buttonIndex];
    const next = Boolean(pressed);
    if (button.pressed === next) return;
    button.pressed = next;
    button.touched = next;
    button.value = next ? 1 : 0;
    pad.timestamp = this.window.performance?.now?.() ?? Date.now();
    if (this.keyboardEvents) this.dispatchKey(index, name, next);
  }

  setAxis(index, axis, value) {
    const pad = this.getPad(index);
    if (axis < 0 || axis > 3) throw new RangeError('Axis index deve essere tra 0 e 3.');
    pad.axes[axis] = Math.max(-1, Math.min(1, Number(value) || 0));
    pad.timestamp = this.window.performance?.now?.() ?? Date.now();
  }

  releaseAll(index) {
    for (const name of Object.keys(BUTTONS)) this.setButton(index, name, false);
    this.pads[index].axes.fill(0);
  }

  dispatchKey(index, name, pressed) {
    const mapping = KEYBOARD_MAP[index]?.[name];
    if (!mapping) return;
    const [key, code] = mapping;
    const EventClass = this.window.KeyboardEvent ?? globalThis.KeyboardEvent;
    if (!EventClass) return;
    const canvas = this.window.document?.querySelector?.('canvas');
    const targets = [this.window, canvas].filter((target, position, list) => target?.dispatchEvent && list.indexOf(target) === position);
    for (const target of targets) {
      target.dispatchEvent(new EventClass(pressed ? 'keydown' : 'keyup', {
        key, code, bubbles: false, cancelable: true, composed: true,
      }));
    }
  }

  playMacro(index, name, { loop = false, frames = null } = {}) {
    const sequence = frames ?? MACROS[name];
    if (!sequence?.length) return Promise.reject(new Error(`Macro sconosciuta o vuota: ${name}`));
    if (this.runtime[index]?.resolve) this.runtime[index].resolve({ cancelled: true });
    this.releaseAll(index);
    return new Promise((resolve) => {
      this.runtime[index] = { name, frames: sequence, cursor: 0, loop, resolve };
    });
  }

  setMode(index, mode, { macro = null } = {}) {
    const allowed = ['idle', 'neutral', 'attack', 'vulnerable'];
    if (!allowed.includes(mode)) throw new Error(`Modalità input sconosciuta: ${mode}`);
    this.modes[index] = mode;
    this.lockOnCountdown[index] = 0;
    if (this.runtime[index]?.resolve) this.runtime[index].resolve({ cancelled: true });
    this.runtime[index] = null;
    this.releaseAll(index);
    if (mode === 'neutral') return this.playMacro(index, 'zCounterLoop', { loop: true });
    if (mode === 'attack') return this.playMacro(index, macro ?? 'rushCombo', { loop: macro !== 'ultimateFinal' });
    return Promise.resolve({ cancelled: false });
  }

  stepFrame() {
    for (let index = 0; index < 2; index += 1) {
      const current = this.runtime[index];
      this.releaseAll(index);
      if (current) {
        const frame = current.frames[current.cursor];
        for (const name of frame.press) this.setButton(index, name, true);
        if (frame.axes) frame.axes.forEach((value, axis) => this.setAxis(index, axis, value));
        current.cursor += 1;
        if (current.cursor >= current.frames.length) {
          if (current.loop) {
            current.cursor = 0;
          } else {
            this.runtime[index] = null;
            current.resolve({ cancelled: false });
          }
        }
      }
      if (this.modes[index] !== 'idle') {
        if (this.lockOnCountdown[index] <= 0) {
          this.setButton(index, 'l1', true);
          this.lockOnCountdown[index] = this.lockOnIntervalFrames - 1;
        } else {
          this.lockOnCountdown[index] -= 1;
        }
      }
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = this.window.performance?.now?.() ?? Date.now();
    const tick = (now) => {
      if (!this.running) return;
      this.accumulator += Math.min(250, now - this.lastTime);
      this.lastTime = now;
      let steps = 0;
      while (this.accumulator >= this.frameMs && steps < 6) {
        this.stepFrame();
        this.accumulator -= this.frameMs;
        steps += 1;
      }
      this.rafId = this.window.requestAnimationFrame(tick);
    };
    this.rafId = this.window.requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    if (this.rafId !== null) this.window.cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.pads.forEach((_, index) => this.releaseAll(index));
  }

  autoMenuRandomSelect(index, { steps = 0, stageSteps = 0, direction = 'down' } = {}) {
    const frames = [f(['start']), f(), f(), f(['cross']), f(), f()];
    for (let i = 0; i < steps; i += 1) frames.push(f([direction]), f(), f());
    frames.push(f(['cross']), f(), f(), f(), f(['cross']), f(), f());
    for (let i = 0; i < stageSteps; i += 1) frames.push(f(['right']), f(), f());
    frames.push(f(['cross']), f(), f(), f(['start']), f(), f());
    return this.playMacro(index, 'autoMenuRandomSelect', { frames });
  }

  enterDuelMode(index = 0) {
    const frames = [
      f(['start']), f(['start']), f(), ...idleFrames(12),
      f(['cross']), f(['cross']), f(), ...idleFrames(10),
      f(['down']), f(), f(), f(['cross']), f(['cross']), f(), ...idleFrames(8),
      f(['cross']), f(['cross']), f(), ...idleFrames(8),
    ];
    return this.playMacro(index, 'enterDuelMode', { frames }).then((result) => {
      if (!result.cancelled) {
        this.setMode(0, 'neutral');
        this.setMode(1, 'neutral');
      }
      return result;
    });
  }

  zCounterLoop(index) { return this.setMode(index, 'neutral'); }
  rushCombo(index) { return this.setMode(index, 'attack', { macro: 'rushCombo' }); }
  blast2(index) { return this.setMode(index, 'attack', { macro: 'blast2' }); }
  ultimateFinal(index) { return this.playMacro(index, 'ultimateFinal'); }

  destroy() {
    this.stop();
    if (!this.installed) return;
    const nav = this.window.navigator;
    if (this.hadOwnGetGamepads && this.originalDescriptor) {
      Object.defineProperty(nav, 'getGamepads', this.originalDescriptor);
    } else {
      delete nav.getGamepads;
    }
    this.installed = false;
  }
}
