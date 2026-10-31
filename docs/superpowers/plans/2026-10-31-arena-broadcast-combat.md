# BT3 Broadcast Combat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere il feed inglese e collassabile, eliminare i falsi KO, migliorare la coreografia e aggiungere flag/diagnostica visiva senza cambiare i timing dei menu.

**Architecture:** Il template e `BroadcastUI` gestiscono il pannello; `BT3InputBridge` possiede le macro; `matchMonitor` decide KO e rematch solo da evidenza visiva; `Orchestrator` espone i booleani e lo stato di validazione.

**Tech Stack:** JavaScript ES modules, Node `node:test`, esbuild, Vercel static CDN, browser WebGL2.

## Global Constraints

- Mantenere invariati i delay di `runMenuSequence()`, `runRosterSequence()` e `runRematchSequence()`.
- Non introdurre iframe, canvas simulati, OCR o dipendenze nuove.
- Il round predefinito termina soltanto su KO; un timeout positivo resta opzionale.
- Verifica visiva obbligatoria sul vero gioco prima di dichiarare il flusso riuscito.

---

### Task 1: Feed inglese e richiudibile

**Files:**
- Modify: `index.html`, `styles.css`, `broadcastUI.js`
- Test: `tests/broadcastUI.test.mjs`

**Interfaces:**
- Produces: `describeTrade(trade): string`, `BroadcastUI.setFeedOpen(open: boolean)`.

- [ ] **Step 1: Scrivere test falliti**

```js
test('il feed descrive le azioni soltanto in inglese', () => {
  assert.equal(describeTrade({ side: 'BUY', kind: 'normal' }), "P1 breaks P2's counter!");
  assert.equal(describeTrade({ side: 'SELL', kind: 'whale' }), 'P2 → ULTIMATE FINAL on P1!');
});
```

Aggiungere asserzioni sul markup per `id="feed-toggle"`, `aria-expanded="false"` e sull'assenza delle vecchie frasi italiane.

- [ ] **Step 2: Verificare il fallimento**

Run: `node --test tests/broadcastUI.test.mjs`
Expected: FAIL perché `describeTrade` e il toggle non esistono.

- [ ] **Step 3: Implementare**

```js
export function describeTrade(trade) {
  const attacker = trade.side === 'BUY' ? 'P1' : 'P2';
  const defender = trade.side === 'BUY' ? 'P2' : 'P1';
  return trade.kind === 'whale'
    ? `${attacker} → ULTIMATE FINAL on ${defender}!`
    : `${attacker} breaks ${defender}'s counter!`;
}
```

Nel costruttore collegare il pulsante a `setFeedOpen`; il metodo aggiorna `aria-expanded`, classe `is-open` e `hidden` della lista. Il CSS rende cliccabile soltanto il pulsante e nasconde la lista da chiusa.

- [ ] **Step 4: Verificare**

Run: `node --test tests/broadcastUI.test.mjs && npm run build`
Expected: PASS e bundle generato.

- [ ] **Step 5: Commit**

```bash
git add index.html styles.css broadcastUI.js tests/broadcastUI.test.mjs
git commit -m "Add collapsible English impact feed"
```

### Task 2: KO reale e rematch

**Files:**
- Modify: `matchMonitor.mjs`, `matchAutomator.js`, `orchestrator.js`, `cloudState.mjs`, `index.html`
- Test: `tests/combatFrame.test.mjs`, `tests/matchAutomator.test.mjs`, `tests/directInjection.test.mjs`

**Interfaces:**
- Consumes: `readCombatHealth(png)`, `KnockoutDetector.observe(health)`.
- Produces: `roundDurationMs = 0` come default; nessun evento `visual-result` da timer assente.

- [ ] **Step 1: Scrivere la regressione**

```js
test('il timer assente non causa un KO', () => {
  const detector = new CombatEndDetector({ delayMs: 0 });
  assert.equal(detector.observe(false), true); // il detector misura solo l'assenza
  assert.doesNotMatch(monitorSource, /notifyKO\(null, 'visual-result'\)/);
});
```

Aggiungere il test che `new MatchAutomator().roundDurationMs === 0` e che, con timeout zero, non venga creato alcun timer di round.

- [ ] **Step 2: Verificare il fallimento**

Run: `node --test tests/combatFrame.test.mjs tests/matchAutomator.test.mjs tests/directInjection.test.mjs`
Expected: FAIL sul default e sul ramo `visual-result` ancora presente.

- [ ] **Step 3: Implementare**

Valutare `readCombatHealth(png)` durante tutta la fase `fighting`, non soltanto quando il timer è visibile. Eliminare la chiamata `notifyKO(null, 'visual-result')`; conservare la sospensione input nei menu e riprendere `neutral` quando il timer ritorna. Impostare il default del timeout a zero e aggiornare il campo admin con `min="0"`.

- [ ] **Step 4: Verificare**

Run: `npm test`
Expected: tutti i test PASS; nessun reset per sola assenza del timer.

- [ ] **Step 5: Commit**

```bash
git add matchMonitor.mjs matchAutomator.js orchestrator.js cloudState.mjs index.html tests
git commit -m "Require visual KO before character reset"
```

### Task 3: Coreografia cinematografica e flag

**Files:**
- Modify: `bt3InputBridge.js`, `orchestrator.js`, `webBootstrap.js`, `index.html`, `styles.css`
- Test: `tests/bt3InputBridge.test.mjs`, `tests/orchestratorCloud.test.mjs`

**Interfaces:**
- Produces: `MACROS.teleportCounter`, `MACROS.cinematicLoop`, `bridge.setCinematicCombat(boolean)`, `app.setFeature(name, boolean)`, `app.getVisualValidation()`.

- [ ] **Step 1: Scrivere test falliti**

```js
assert.ok(MACROS.teleportCounter.some(frame => frame.press.includes('cross')));
assert.ok(MACROS.cinematicLoop.some(frame => frame.press.includes('triangle')));
assert.throws(() => app.setFeature('unknown', true), /Flag sconosciuto/);
```

Verificare che il modo neutro scelga `cinematicLoop`, che il flag false ripristini `zCounterLoop` e che nessuna modalità idle lasci pulsanti premuti.

- [ ] **Step 2: Verificare il fallimento**

Run: `node --test tests/bt3InputBridge.test.mjs tests/orchestratorCloud.test.mjs`
Expected: FAIL per macro e API assenti.

- [ ] **Step 3: Implementare**

Creare la sequenza composita da guardia/counter, rush, teleport, sidestep e Blast 2. Aggiungere i quattro booleani e il metodo:

```js
setFeature(name, enabled) {
  if (!Object.hasOwn(this.features, name)) throw new Error(`Flag sconosciuto: ${name}`);
  if (typeof enabled !== 'boolean') throw new TypeError(`Il flag ${name} richiede un booleano.`);
  this.features[name] = enabled;
  if (name === 'cinematicCombat') this.bridge.setCinematicCombat(enabled);
  return { ...this.features };
}
```

`webBootstrap` rispetta `autoMenu`; `matchMonitor` rispetta `autoRematch` e `visualKO`. Le checkbox F2 chiamano lo stesso metodo.

- [ ] **Step 4: Verificare**

Run: `npm test && npm run check && npm run build`
Expected: PASS senza errori di bundling.

- [ ] **Step 5: Commit**

```bash
git add bt3InputBridge.js orchestrator.js webBootstrap.js index.html styles.css tests
git commit -m "Add cinematic combat and runtime feature flags"
```

### Task 4: Validazione visiva e pubblicazione

**Files:**
- Modify: `README.md`, `HANDOFF.md`
- Test: output browser in `artifacts/`

**Interfaces:**
- Consumes: `window.marketArena.getVisualValidation()` e `window.__BT3_MARKET_ARENA__.validation`.

- [ ] **Step 1: Documentare**

Aggiungere esempi `marketArena.setFeature('visualKO', true)` e `marketArena.getVisualValidation()`, il comportamento del feed e la regola KO-only.

- [ ] **Step 2: Pubblicare**

Run: `git add README.md HANDOFF.md && git commit -m "Document arena controls and visual validation" && git push origin main`
Expected: branch `main` aggiornato e deployment Vercel `success`.

- [ ] **Step 3: Verificare il gioco reale**

Aprire `https://bt-3-market-arena.vercel.app/`, confermare Wasm 200 e SSE 200, catturare il feed chiuso e aperto. Verificare che il menu `Rushing Technique` non produca `postmatch`; attendere un HP vuoto e catturare Character Select e il round successivo.

- [ ] **Step 4: Controllo finale**

Run: `git status --short --branch`
Expected: nessuna modifica non committata. Riportare soltanto gli stati effettivamente osservati negli screenshot.
