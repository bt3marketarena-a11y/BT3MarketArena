import { PNG } from 'pngjs';
import { CombatEndDetector, KnockoutDetector, hasActiveCombatFrame, hasCombatHudFrame, hasPauseMenuFrame, readCombatHealth, runRematchSequence } from './menuDriver.mjs';

export async function monitorPostMatch(page, {
  capture,
  isClosed = () => page.isClosed?.() ?? false,
} = {}) {
  if (!capture) throw new Error('monitorPostMatch richiede una funzione di cattura.');
  let lastState = '';
  let lastHealth = null;
  let inputsSuspended = false;
  const endDetector = new CombatEndDetector({ delayMs: 12_000 });
  const koDetector = new KnockoutDetector({ delayMs: 1_500 });
  while (!isClosed()) {
    try {
      const state = await page.evaluate(() => ({
        phase: window.marketArena?.match?.phase ?? 'idle',
        round: window.marketArena?.match?.round ?? 0,
        durationMs: window.marketArena?.match?.roundDurationMs ?? null,
        features: { ...window.marketArena?.features },
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
        const pauseMenu = hasPauseMenuFrame(png);
        const activeCombat = hasActiveCombatFrame(png);
        const health = readCombatHealth(png);
        if (!pauseMenu) lastHealth = health;
        await page.evaluate(({ activeCombat: timerVisible, health: hp, pauseMenuVisible, phase: currentPhase, round }) => {
          window.__BT3_MARKET_ARENA__.validation = {
            checkedAt: new Date().toISOString(), phase: currentPhase, round,
            combatTimerVisible: timerVisible, health: hp, pauseMenuVisible,
          };
        }, { activeCombat, health, pauseMenuVisible: pauseMenu, phase, round: state.round });
        if (pauseMenu) {
          // Il menu di pausa oscura le HP: non è un KO. Start riprende il round
          // senza selezionare Skill List, Character Select o Main Menu.
          endDetector.reset();
          koDetector.reset();
          if (!inputsSuspended) {
            await page.evaluate(() => {
              window.marketArena.bridge.setMode(0, 'idle');
              window.marketArena.bridge.setMode(1, 'idle');
            });
            inputsSuspended = true;
          }
          console.log('[BT3 round] pausa rilevata: ripresa con Start, nessun KO');
          await page.keyboard.down('Enter');
          await page.waitForTimeout(220);
          await page.keyboard.up('Enter');
          await page.waitForTimeout(1_000);
          continue;
        }
        endDetector.observe(activeCombat);
        if (state.features.visualKO && koDetector.observe(health)) {
          console.log('[BT3 round] HP vuote rilevate sullo schermo reale: stop prima di Character Select');
          await page.evaluate(() => window.marketArena.match.notifyKO(null, 'visual-hp-zero'));
        }
        if (activeCombat) {
          if (inputsSuspended) {
            await page.evaluate(() => {
              window.marketArena.bridge.setMode(0, 'neutral');
              window.marketArena.bridge.setMode(1, 'neutral');
            });
            inputsSuspended = false;
          }
        } else if (!inputsSuspended && endDetector.missingSince !== null && Date.now() - endDetector.missingSince >= 2_000) {
          console.log('[BT3 round] timer assente: pad sospesi, ma nessun KO senza una HP vuota');
          await page.evaluate(() => {
            window.marketArena.bridge.setMode(0, 'idle');
            window.marketArena.bridge.setMode(1, 'idle');
          });
          inputsSuspended = true;
        }
      } else {
        endDetector.reset();
        koDetector.reset();
      }
      if (phase !== 'postmatch' || !state.features.autoRematch) {
        await page.waitForTimeout(1_000);
        continue;
      }
      // Recovery: il driver può aver caricato il nuovo round senza aggiornare
      // la fase dopo un'attesa scaduta. Non rieseguire mai i menu sopra il match.
      const png = PNG.sync.read(await capture(page));
      if (hasCombatHudFrame(png) && hasActiveCombatFrame(png) && !hasPauseMenuFrame(png)) {
        console.log('[BT3 round] nuove HP e timer già visibili: sincronizzo HUD e pad');
        await page.evaluate(() => {
          window.marketArena.match.restart();
          window.marketArena.bridge.setMode(0, 'neutral');
          window.marketArena.bridge.setMode(1, 'neutral');
          window.__BT3_MARKET_ARENA__.automationError = null;
        });
        lastHealth = { p1: true, p2: true };
        inputsSuspended = false;
        await page.waitForTimeout(1_000);
        continue;
      }
      // Il menu dei risultati appartiene al vincitore: 1P usa tastiera, 2P gamepad.
      const menuPlayer = lastHealth?.p1 && !lastHealth?.p2 ? 0 : 1;
      const plan = await runRematchSequence(page, { menuPlayer });
      console.log(`[BT3 round] nuovo match con roster e stage random: ${JSON.stringify(plan)}`);
    } catch (error) {
      if (isClosed()) break;
      console.error(`[BT3 round] ${error.message}`);
      await page.evaluate((message) => {
        window.__BT3_MARKET_ARENA__.automationError = message;
      }, String(error?.stack ?? error));
      await page.waitForTimeout(3_000);
    }
  }
}
