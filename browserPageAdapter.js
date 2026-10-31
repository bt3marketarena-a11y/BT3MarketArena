const MENU_KEYS = Object.freeze({
  Enter: ['Enter', 'Enter', 13],
  ArrowDown: ['ArrowDown', 'ArrowDown', 40],
  ArrowLeft: ['ArrowLeft', 'ArrowLeft', 37],
  ArrowRight: ['ArrowRight', 'ArrowRight', 39],
  ArrowUp: ['ArrowUp', 'ArrowUp', 38],
});

function keyDescriptor(key) {
  if (MENU_KEYS[key]) return MENU_KEYS[key];
  if (typeof key === 'string' && /^[a-z]$/i.test(key)) {
    const lower = key.toLowerCase();
    return [lower, `Key${lower.toUpperCase()}`, lower.toUpperCase().charCodeAt(0)];
  }
  throw new Error(`Tasto menu non supportato dall'adapter browser: ${key}`);
}

export function dispatchMenuKey(targetWindow, key, pressed) {
  const [normalizedKey, code, keyCode] = keyDescriptor(key);
  const EventClass = targetWindow.KeyboardEvent;
  if (!EventClass) throw new Error('KeyboardEvent non disponibile nel browser.');
  const canvas = targetWindow.document.querySelector('canvas');
  const target = canvas ?? targetWindow;
  // Come Playwright: un solo evento che raggiunge window per bubbling naturale.
  target.dispatchEvent(new EventClass(pressed ? 'keydown' : 'keyup', {
    key: normalizedKey,
    code,
    keyCode,
    which: keyCode,
    bubbles: true,
    cancelable: true,
    composed: true,
  }));
}

export function installPreserveDrawingBuffer(targetWindow) {
  const prototype = targetWindow.HTMLCanvasElement?.prototype;
  if (!prototype || prototype.__BT3_PRESERVE_BUFFER__) return;
  const originalGetContext = prototype.getContext;
  prototype.getContext = function getContextWithPreservedBuffer(type, attributes) {
    if (['webgl', 'webgl2', 'experimental-webgl'].includes(type)) {
      return originalGetContext.call(this, type, { ...attributes, preserveDrawingBuffer: true });
    }
    return originalGetContext.call(this, type, attributes);
  };
  Object.defineProperty(prototype, '__BT3_PRESERVE_BUFFER__', { value: true });
}

function largestGameCanvas(targetWindow) {
  return [...targetWindow.document.querySelectorAll('canvas')]
    .filter((canvas) => canvas.width > 0 && canvas.height > 0 && !canvas.dataset?.bt3CaptureSurface)
    .sort((a, b) => b.width * b.height - a.width * a.height)[0] ?? null;
}

export function captureCanvasFrame(targetWindow, sourceCanvas, {
  width = 960,
  height = 540,
  surface = null,
} = {}) {
  const canvas = sourceCanvas ?? largestGameCanvas(targetWindow);
  if (!canvas) throw new Error('Canvas WebGL non ancora disponibile per la cattura browser.');
  const captureSurface = surface ?? targetWindow.document.createElement('canvas');
  captureSurface.dataset && (captureSurface.dataset.bt3CaptureSurface = '1');
  captureSurface.width = width;
  captureSurface.height = height;
  const context = captureSurface.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D offscreen non disponibile.');
  context.drawImage(canvas, 0, 0, width, height);
  return { data: context.getImageData(0, 0, width, height).data, width, height };
}

/**
 * Emscripten normalmente usa preserveDrawingBuffer:false. La copia viene quindi
 * eseguita alla fine dello stesso callback rAF che ha renderizzato il frame.
 */
export function installCanvasFrameCapture(targetWindow, {
  width = 960,
  height = 540,
  intervalMs = 50,
  now = () => targetWindow.performance.now(),
} = {}) {
  if (targetWindow.__BT3_FRAME_CAPTURE__) return targetWindow.__BT3_FRAME_CAPTURE__;
  const surface = targetWindow.document.createElement('canvas');
  if (surface.dataset) surface.dataset.bt3CaptureSurface = '1';
  const originalRequestAnimationFrame = targetWindow.requestAnimationFrame.bind(targetWindow);
  let lastFrame = null;
  let capturedAt = -Infinity;

  const captureNow = () => {
    lastFrame = captureCanvasFrame(targetWindow, null, { width, height, surface });
    capturedAt = now();
    return lastFrame;
  };
  targetWindow.requestAnimationFrame = (callback) => originalRequestAnimationFrame(function bt3CaptureAnimationFrame(time) {
    const result = callback.call(this, time);
    if (now() - capturedAt >= intervalMs && largestGameCanvas(targetWindow)) {
      try { captureNow(); } catch (error) {
        targetWindow.console?.warn?.(`[BT3 capture] ${error.message}`);
      }
    }
    return result;
  });

  const api = {
    captureNow,
    read() { return lastFrame ?? captureNow(); },
    restore() { targetWindow.requestAnimationFrame = originalRequestAnimationFrame; },
  };
  targetWindow.__BT3_FRAME_CAPTURE__ = api;
  return api;
}

export function createBrowserPageAdapter({ window: targetWindow = window } = {}) {
  installPreserveDrawingBuffer(targetWindow);
  const frames = installCanvasFrameCapture(targetWindow);
  return {
    waitForTimeout: (ms) => new Promise((resolve) => targetWindow.setTimeout(resolve, ms)),
    keyboard: {
      down: (key) => dispatchMenuKey(targetWindow, key, true),
      up: (key) => dispatchMenuKey(targetWindow, key, false),
    },
    evaluate: (fn, arg) => fn(arg),
    screenshot: async () => frames.read(),
    isClosed: () => false,
  };
}
