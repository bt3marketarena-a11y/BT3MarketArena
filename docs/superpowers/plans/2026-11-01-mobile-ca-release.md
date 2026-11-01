# Mobile CA and Streaming Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pubblicare una release BT3 mobile-first, con admin CA touch-friendly, stato condiviso verificabile, build Vercel anti-obsolescenza e streaming RTMP primario/secondario.

**Architecture:** Mantenere il bundle e l’automazione attuali, separando le nuove responsabilità in un adattatore Redis per `api/state.mjs` e nel manifest generato dalla build. HUD, cloud client e orchestrator restano moduli browser esistenti; il container continua a possedere Chromium e FFmpeg.

**Tech Stack:** Node.js 20+, browser MAIN world, CSS, Node test runner, Vercel static CDN/Functions, Upstash Redis SDK, Playwright, Xvfb e FFmpeg.

## Global Constraints

- Non riscrivere motore, gamepad, detector HP/KO o timing dei menu calibrati.
- Prima di un CA valido mostrare sempre `PRE-LAUNCH SIMULATOR`; non presentare dati simulati come reali.
- `ADMIN_KEY`, token Redis e URL RTMP non devono entrare in markup, localStorage, log o repository.
- Vercel ospita il frontend e l’API state; lo streamer 24/7 resta nel container.
- Nessuna diretta reale senza chiavi fornite; nessuna promessa di stato globale senza Redis.
- Ogni push usa `origin main` e l’account GitHub già autorizzato `bt3marketarena-a11y`.

---

### Task 1: HUD spectator responsive e admin touch

**Files:**
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `broadcastUI.js`
- Modify: `admin.html`
- Test: `tests/broadcastUI.test.mjs`

**Interfaces:**
- Produces: `#admin-open` con `aria-label="Open market admin"`; `#admin-fallback` con chiusura esplicita; markup privo di hint F2.
- Preserves: `BroadcastUI.bindAdmin(callbacks, config)` e F2 come scorciatoia non visibile.

- [ ] **Step 1: Scrivere test falliti su markup e CSS**

Aggiungere a `tests/broadcastUI.test.mjs`:

```js
test('la vista spectator non mostra comandi tastiera e offre admin touch', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /F2 \/\/ ADMIN|<span>F2<\/span>/);
  assert.match(html, /id="admin-open"[^>]*aria-label="Open market admin"/);
  assert.match(html, /id="admin-close"/);
  assert.match(css, /clamp\(/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(css, /@media\s*\(max-width:\s*600px\)/);
  assert.match(css, /#admin-open\{[^}]*min-width:44px[^}]*min-height:44px/);
});
```

- [ ] **Step 2: Verificare il fallimento**

Run: `node --test tests/broadcastUI.test.mjs`
Expected: FAIL perché `#admin-open`, `#admin-close` e le regole mobile non esistono.

- [ ] **Step 3: Implementare markup, stili e binding minimi**

In `index.html` eliminare `.ticker-help` e il badge F2; aggiungere fuori dalla ticker:

```html
<button id="admin-open" class="admin-open" type="button" aria-label="Open market admin" title="Market admin">⚙</button>
```

Nel dialogo aggiungere un pulsante `type="button" id="admin-close" aria-label="Close admin"`. Racchiudere RPC, memory bridge, flag e test in `<details class="admin-advanced"><summary>Advanced settings</summary>…</details>`. Usare inglese per le azioni del feed e testi spectator.

In `broadcastUI.js` collegare il pulsante in `bindAdmin`:

```js
const open = document.getElementById('admin-open');
if (!this.adminOpenBound && open) {
  open.addEventListener('click', () => this.openAdmin(this.adminCallbacks));
  this.adminOpenBound = true;
}
```

In `openAdmin`, dopo `showModal()`, associare `#admin-close` a `this.elements.fallback.close()`. Su viewport stretto usare sempre il dialogo in-page, non il popup:

```js
const popup = this.window?.innerWidth <= 600 || window.innerWidth <= 600
  ? null
  : window.open('', 'BT3MarketArenaAdmin', 'width=560,height=900,resizable=yes,scrollbars=yes');
```

Per testabilità usare soltanto `window.innerWidth` nel browser, senza introdurre una dipendenza obbligatoria nel costruttore.

In `styles.css` aggiungere regole finali con font minimo `clamp(11px,…)`, `.admin-open{pointer-events:auto;min-width:44px;min-height:44px}`, bottom sheet e `@media(max-width:600px)`; rispettare `padding-bottom:max(20px,env(safe-area-inset-bottom))`. In `admin.html` applicare input/button con `min-height:44px`, `font-size:16px` su mobile e lo stesso `<details>` avanzato.

- [ ] **Step 4: Eseguire test e verifica responsive**

Run: `node --test tests/broadcastUI.test.mjs && npm run check`
Expected: PASS. In browser a 390×844 verificare nessun overflow, toggle feed ≥44 px e admin apribile tramite `#admin-open`.

- [ ] **Step 5: Commit**

```bash
git add index.html styles.css broadcastUI.js admin.html tests/broadcastUI.test.mjs
git commit -m "Add mobile spectator HUD and touch admin"
```

### Task 2: Build Vercel con hash e manifest

**Files:**
- Modify: `scripts/build-static-vercel.mjs`
- Modify: `vercel.json`
- Modify: `pageBootstrap.js`
- Test: `tests/staticVercel.test.mjs`
- Test: `tests/vercel.test.mjs`

**Interfaces:**
- Produces: `public/build-manifest.json` con `{commit,bundleSha256,builtAt}` e script `/bt3-arena-bundle.js?v=<bundleSha256>`.
- Produces: `window.__BT3_MARKET_ARENA__.build` letto da `<meta name="bt3-build">`.

- [ ] **Step 1: Scrivere test falliti**

In `tests/staticVercel.test.mjs` calcolare l’hash del bundle e richiedere:

```js
const manifest = JSON.parse(await readFile(path.join(directory, 'public', 'build-manifest.json'), 'utf8'));
assert.match(manifest.bundleSha256, /^[a-f0-9]{64}$/);
assert.ok(index.includes(`/bt3-arena-bundle.js?v=${manifest.bundleSha256}`));
assert.ok(index.includes(`<meta name="bt3-build" content="${manifest.commit}">`));
assert.equal(new URL(`https://arena.local/bt3-arena-bundle.js?v=${manifest.bundleSha256}`).searchParams.get('v'), manifest.bundleSha256);
```

Passare `commit: 'test-commit'` e `builtAt: '2026-11-01T00:00:00.000Z'` alla build per rendere il test deterministico.

- [ ] **Step 2: Verificare il fallimento**

Run: `node --test tests/staticVercel.test.mjs`
Expected: FAIL per manifest assente e URL senza hash.

- [ ] **Step 3: Implementare manifest e caching**

Usare `createHash('sha256').update(bundle).digest('hex')`; il commit viene da `process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT ?? 'local'`. Iniettare meta e script prima degli altri script. Scrivere il manifest con il timestamp reale o quello passato dal test. Aggiungere in `pageBootstrap.js`:

```js
build: document.querySelector('meta[name="bt3-build"]')?.content ?? 'development',
```

In `vercel.json` escludere `build-manifest.json` dal rewrite esterno e aggiungere headers `Cache-Control: public, max-age=0, must-revalidate` per HTML/manifest e `Cache-Control: public, max-age=31536000, immutable` per il bundle.

- [ ] **Step 4: Verificare build e routing**

Run: `node --test tests/staticVercel.test.mjs tests/vercel.test.mjs && npm run build`
Expected: PASS; il manifest locale coincide con l’hash di `public/bt3-arena-bundle.js`.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-static-vercel.mjs vercel.json pageBootstrap.js tests/staticVercel.test.mjs tests/vercel.test.mjs
git commit -m "Version Vercel bundle and publish build manifest"
```

### Task 3: Stato CA Redis e polling coerente

**Files:**
- Create: `redisCloudState.mjs`
- Modify: `cloudState.mjs`
- Modify: `api/state.mjs`
- Modify: `cloudClient.js`
- Modify: `orchestrator.js`
- Modify: `package.json` e `package-lock.json` tramite `npm install @upstash/redis`
- Test: `tests/cloudState.test.mjs`
- Test: `tests/cloudClient.test.mjs`
- Test: `tests/vercel.test.mjs`

**Interfaces:**
- Produces: `createRedisStateStore({url,token,fetchImpl})` con `mode='redis'`, `get()` e `update(patch)`.
- Produces: risposte API con `storage: 'redis'|'memory'`.
- Produces: `CloudConfigClient.subscribe(onState,onError,{pollMs=2000})` con SSE + polling non sovrapposto.

- [ ] **Step 1: Scrivere test falliti**

Per Redis usare fetch simulata o un client finto iniettato e verificare caricamento del default, salvataggio CA e revisione. Per il polling usare un scheduler finto:

```js
test('il polling recupera revisioni pubblicate da un’altra istanza', async () => {
  let tick;
  const client = new CloudConfigClient({
    fetchImpl: async () => ({ ok: true, json: async () => ({ ...PUBLIC_STATE, revision: 4 }) }),
    EventSourceImpl: null,
    setIntervalImpl: (fn) => { tick = fn; return 1; },
    clearIntervalImpl: () => {},
  });
  const states = [];
  const close = client.subscribe((state) => states.push(state));
  await tick();
  close();
  assert.equal(states[0].revision, 4);
});
```

- [ ] **Step 2: Verificare il fallimento**

Run: `node --test tests/cloudState.test.mjs tests/cloudClient.test.mjs`
Expected: FAIL perché l’adattatore e il polling non esistono.

- [ ] **Step 3: Implementare store e polling**

Esportare da `cloudState.mjs` `normalizePublicStatePatch(current,patch)` e impostare `this.mode = stateFile ? 'file' : 'memory'`. `redisCloudState.mjs` usa `new Redis({url,token,fetch:fetchImpl})`, chiave `bt3:market-arena:state:v1`, valori JSON automaticamente deserializzati e `normalizePublicStatePatch`. Ogni update salva `{...next,revision:current.revision+1,updatedAt:new Date().toISOString()}`.

In `api/state.mjs` scegliere Redis soltanto se sono presenti entrambe `KV_REST_API_URL` e `KV_REST_API_TOKEN`, altrimenti memoria; aggiungere `storage: store.mode` a JSON e SSE. In `orchestrator.js` escludere `storage` dalla configurazione prima del merge.

In `cloudClient.js` accettare scheduler nel costruttore, mantenere SSE se disponibile e avviare sempre polling con guardia `polling` e `closed`; gli errori vanno a `onError`, la chiusura ferma timer ed EventSource.

- [ ] **Step 4: Eseguire test API senza credenziali reali**

Run: `npm install @upstash/redis && node --test tests/cloudState.test.mjs tests/cloudClient.test.mjs tests/vercel.test.mjs tests/server.test.mjs`
Expected: PASS; senza variabili Redis `storage` è `memory` e nessun file viene scritto su Vercel.

- [ ] **Step 5: Commit**

```bash
git add redisCloudState.mjs cloudState.mjs api/state.mjs cloudClient.js orchestrator.js package.json package-lock.json tests/cloudState.test.mjs tests/cloudClient.test.mjs tests/vercel.test.mjs
git commit -m "Share CA revisions through Redis and polling"
```

### Task 4: Hot-swap CA senza connessioni obsolete

**Files:**
- Modify: `marketFeed.js`
- Modify: `orchestrator.js`
- Test: `tests/marketFeed.test.mjs`
- Test: `tests/orchestratorCloud.test.mjs`

**Interfaces:**
- Produces: `MarketFeed.connectionGeneration`, incrementato da `stop()` e verificato dopo ogni avvio asincrono.
- Preserves: BUY→P1, SELL→P2 e blocco input fuori da `fighting`.

- [ ] **Step 1: Scrivere test falliti**

Simulare due `connect()` in cui il primo fetch si risolve dopo il secondo e asserire che il socket finale appartenga al secondo CA. Nell’orchestrator applicare revisioni 5 e 4 in sequenza e richiedere che la 4 non sovrascriva la 5:

```js
assert.equal(fake.config.ca, NEW_CA);
assert.equal(fake.appliedCloudRevision, 5);
```

- [ ] **Step 2: Verificare il fallimento**

Run: `node --test tests/marketFeed.test.mjs tests/orchestratorCloud.test.mjs`
Expected: FAIL per apertura del feed vecchio o revisione regressiva.

- [ ] **Step 3: Implementare generation guard e revisioni monotone**

In `MarketFeed.stop()` incrementare `this.connectionGeneration`. In `connect()` catturare la generazione dopo `stop()` e passarla ai connettori; dopo ogni `await`, se non coincide con quella corrente, uscire senza aprire socket o timer. In `openSocket` accettare la generazione e non installare un socket se obsoleta. In `applyCloudState` ignorare `revision <= appliedCloudRevision`, aggiornando la revisione soltanto dopo una connessione riuscita oppure conservando lo stato degraded senza permettere regressioni.

- [ ] **Step 4: Verificare hot-swap e regressione completa**

Run: `node --test tests/marketFeed.test.mjs tests/orchestratorCloud.test.mjs && npm test`
Expected: PASS, inclusi blocco trade durante KO e nessun ADMIN_KEY persistente.

- [ ] **Step 5: Commit**

```bash
git add marketFeed.js orchestrator.js tests/marketFeed.test.mjs tests/orchestratorCloud.test.mjs
git commit -m "Prevent stale feed connections during CA hot swap"
```

### Task 5: Recovery EXIT residuo e doppia destinazione RTMP

**Files:**
- Modify: `matchMonitor.mjs`
- Modify: `cloud-stream.sh`
- Modify: `README.md`
- Modify: `HANDOFF.md`
- Test: `tests/matchMonitor.test.mjs`
- Test: `tests/cloudPackaging.test.mjs`

**Interfaces:**
- Consumes: `hasExitPromptFrame`, `readExitPromptSelection`, `runRematchSequence`.
- Produces: `STREAM_RTMP_URL_SECONDARY` opzionale; output FFmpeg `tee` soltanto quando presente.

- [ ] **Step 1: Scrivere test falliti**

Aggiungere un caso `postmatch` con frame EXIT/No che verifica un solo percorso visivo di chiusura prima di `runRematchSequence`; nessuna conferma è ammessa su frame non riconosciuto. Per la shell leggere `cloud-stream.sh` e richiedere `STREAM_RTMP_URL_SECONDARY` e `-f tee`, senza stampare gli URL.

- [ ] **Step 2: Verificare il fallimento**

Run: `node --test tests/matchMonitor.test.mjs tests/cloudPackaging.test.mjs`
Expected: FAIL per recovery o seconda destinazione assente.

- [ ] **Step 3: Implementare recovery e output tee**

Nel ramo `postmatch`, prima di `runRematchSequence`, riconoscere EXIT; se la selezione è No, premere la conferma del proprietario del menu e attendere un nuovo frame. Se è Yes, usare ArrowDown e verificare No prima della conferma. Limitare il recovery a un tentativo per frame riconosciuto e lasciare il resto al ciclo esistente.

In `cloud-stream.sh` costruire l’output senza loggare le chiavi:

```bash
if [[ -n "${STREAM_RTMP_URL_SECONDARY:-}" ]]; then
  STREAM_OUTPUT="[f=flv]${STREAM_RTMP_URL}|[f=flv]${STREAM_RTMP_URL_SECONDARY}"
  STREAM_FORMAT=( -f tee )
else
  STREAM_OUTPUT="$STREAM_RTMP_URL"
  STREAM_FORMAT=( -f flv )
fi
```

Usare `"${STREAM_FORMAT[@]}" "$STREAM_OUTPUT"` al posto di `-f flv "$STREAM_RTMP_URL"`.

Documentare mobile/admin, Redis, manifest, verifica hash, limiti Vercel e le due destinazioni RTMP in README/HANDOFF senza cambiare la tabella dei timing.

- [ ] **Step 4: Verificare tutta la release**

Run: `npm test && npm run check && npm run build && git diff --check && bash -n cloud-stream.sh`
Expected: tutti i test PASS, build completata e nessun errore whitespace/shell.

- [ ] **Step 5: Commit, push e controllo pubblico**

```bash
git add matchMonitor.mjs cloud-stream.sh README.md HANDOFF.md tests/matchMonitor.test.mjs tests/cloudPackaging.test.mjs
git commit -m "Harden postmatch recovery and dual RTMP streaming"
git push origin main
```

Attendere il deploy, quindi richiedere `/`, `/build-manifest.json`, `/api/state` e il bundle versionato. Confrontare il commit manifest con `git rev-parse HEAD` e ricalcolare SHA-256 del bundle pubblico. Verificare desktop e 390×844 con screenshot; non dichiarare Redis o dirette attive se le relative variabili non risultano configurate.
