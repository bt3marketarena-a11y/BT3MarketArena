import { BT3InputBridge } from './bt3InputBridge.js';
import { Orchestrator } from './orchestrator.js';

const GLOBAL_KEY = '__BT3_MARKET_ARENA__';

if (window.top === window && !window[GLOBAL_KEY]) {
  const bridge = new BT3InputBridge({ window }).install();
  window[GLOBAL_KEY] = {
    bridge,
    app: null,
    status: 'preloaded',
    installedAt: performance.now(),
    error: null,
  };

  async function mountOverlay() {
    if (!document.body || document.getElementById('bt3-market-arena-injected')) return;
    try {
      const style = document.createElement('style');
      style.id = 'bt3-market-arena-style';
      style.textContent = __BT3_OVERLAY_CSS__;
      document.head.appendChild(style);

      const container = document.createElement('div');
      container.id = 'bt3-market-arena-injected';
      container.innerHTML = __BT3_OVERLAY_HTML__;
      document.body.appendChild(container);

      const app = new Orchestrator({ bridge, targetWindow: window, cloudSync: __BT3_CLOUD_SYNC__ });
      window[GLOBAL_KEY].app = app;
      window.marketArena = app;
      await app.start();
      window[GLOBAL_KEY].status = 'running';
    } catch (error) {
      window[GLOBAL_KEY].status = 'error';
      window[GLOBAL_KEY].error = String(error?.stack ?? error);
      console.error('[BT3 Market Arena] Bootstrap error:', error);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountOverlay, { once: true });
  } else {
    void mountOverlay();
  }
}
