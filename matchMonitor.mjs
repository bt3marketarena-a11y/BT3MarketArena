import { PNG } from 'pngjs';
import { CombatEndDetector, KnockoutDetector, hasActiveCombatFrame, readCombatHealth, runRematchSequence } from './menuDriver.mjs';

export async function monitorPostMatch(page, {
  capture,
  isClosed = () => page.isClosed?.() ?? false,
} = {}) {
  if (!capture) throw new Error('monitorPostMatch richiede una funzione di cattura.');
  let lastState = '';
  let inputsSuspended = false;
  const endDetector = new CombatEndDetector({ delayMs: 12_000 });
  const koDetector = new KnockoutDetector({ delayMs: 1_500 });
  while (!isClosed()) {
    try {
      const state = await page.evaluate(() => ({
        phase: window.marketArena?.match?.phase ?? 'idle',
        round: window.marketArena?.match?.round ?? 0,
        durationMs: window.marketArena?.match?.roundDurationMs ?? null,
      }));
      const phase = state.phase;
      const signature = `${phase}/${state.round}`;
      if (signature !== lastState) {
        console.log(`[BT3 phase] ${new Date().toISOString()} round=${state.round} phase=${phase} durationMs=${state.durationMs}`);
        lastState = signature;
        endDetector.reset();
        koDetector.reset();
      }
      if (phase === 'fighting') {
        const png = PNG.sync.read(await capture(page));
        const activeCombat = hasActiveCombatFrame(png);
        const visualEnd = endDetector.observe(activeCombat);
        if (activeCombat) {
          if (inputsSuspended) {
            await page.evaluate(() => {
              window.marketArena.bridge.setMode(0, 'neutral');
              window.marketArena.bridge.setMode(1, 'neutral');
            });
            inputsSuspended = false;
          }
          if (koDetector.observe(readCombatHealth(png))) {
            console.log('[BT3 round] HP vuote rilevate sullo schermo reale: stop prima di Rematch');
            await page.evaluate(() => window.marketArena.match.notifyKO(null, 'visual-hp-zero'));
          }
        } else {
          koDetector.reset();
          if (!inputsSuspended && endDetector.missingSince !== null && Date.now() - endDetector.missingSince >= 2_000) {
            console.log('[BT3 round] timer assente: pad sospesi durante la sequenza di vittoria');
            await page.evaluate(() => {
              window.marketArena.bridge.setMode(0, 'idle');
              window.marketArena.bridge.setMode(1, 'idle');
            });
            inputsSuspended = true;
          }
          if (visualEnd) {
            console.log('[BT3 round] timer originale assente per 12 s: fine match rilevata');
            await page.evaluate(() => window.marketArena.match.notifyKO(null, 'visual-result'));
          }
        }
      } else {
        endDetector.reset();
        koDetector.reset();
      }
      if (phase !== 'postmatch') {
        await page.waitForTimeout(1_000);
        continue;
      }
      const plan = await runRematchSequence(page);
      console.log(`[BT3 round] nuovo match con roster e stage random: ${JSON.stringify(plan)}`);
    } catch (error) {
      if (isClosed()) break;
      console.error(`[BT3 round] ${error.message}`);
      await page.waitForTimeout(3_000);
    }
  }
}
