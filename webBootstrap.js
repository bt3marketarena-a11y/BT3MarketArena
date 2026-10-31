import './pageBootstrap.js';
import { createBrowserPageAdapter } from './browserPageAdapter.js';
import { runMenuSequence } from './menuDriver.mjs';
import { monitorPostMatch } from './matchMonitor.mjs';

const adapter = createBrowserPageAdapter({ window });

async function waitForMarketArena(timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (!window.marketArena || window.__BT3_MARKET_ARENA__?.status !== 'running') {
    if (window.__BT3_MARKET_ARENA__?.status === 'error') {
      throw new Error(window.__BT3_MARKET_ARENA__.error ?? 'Bootstrap Market Arena non riuscito.');
    }
    if (Date.now() - startedAt >= timeoutMs) throw new Error('Market Arena non pronto entro 60 secondi.');
    await adapter.waitForTimeout(250);
  }
  return window.marketArena;
}

async function startWebAutomation() {
  try {
    await waitForMarketArena();
    await adapter.waitForTimeout(30_000);
    const menuPlan = await runMenuSequence(adapter);
    window.__BT3_MARKET_ARENA__.menuPlan = menuPlan;
    window.__BT3_MARKET_ARENA__.menuSequence = 'completed';
    void monitorPostMatch(adapter, { capture: () => adapter.screenshot() });
  } catch (error) {
    window.__BT3_MARKET_ARENA__.automationError = String(error?.stack ?? error);
    console.error(`[BT3 web automation] ${error?.stack ?? error}`);
  }
}

void startWebAutomation();
