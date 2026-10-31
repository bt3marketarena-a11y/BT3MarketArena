# Cloud-Native BT3 Market Arena Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pubblicare il runtime BT3 tramite reverse proxy same-origin, sincronizzare il Contract Address fra tutti i client e trasmettere il launcher calibrato da un container senza OBS.

**Architecture:** `injectionBundle.mjs` produce due bundle dallo stesso codice sorgente: quello Playwright esistente e un bootstrap web. `server.mjs` proxya gli asset remoti, inietta il bundle nell'HTML e gestisce stato/SSE/admin; il container riusa `launcher.mjs` sotto Xvfb e invia il desktop a FFmpeg. Un adapter implementa la stessa interfaccia `page` consumata da `menuDriver.mjs`, senza cambiare timing o soglie.

**Tech Stack:** Node.js 20+, `node:http`, Fetch API, Server-Sent Events, esbuild, Playwright/Chromium, browser Canvas API, Docker, Xvfb, PulseAudio, FFmpeg.

## Global Constraints

- Non modificare timing, sequenze e rilevatori di `menuDriver.mjs`.
- Mantenere Windows `screenCapture.mjs` e i fallback locali invariati.
- Nessun iframe, arena sostitutiva o renderer stickman.
- Non salvare o esporre `ADMIN_KEY`; mutazioni rifiutate se la chiave non è configurata.
- Non eseguire commit Git, non richiesti dall'utente.
- Non dichiarare verificati deploy/stream esterni senza una prova effettiva.

---

### Task 1: Bundle condiviso e adapter browser

**Files:**
- Create: `injectionBundle.mjs`, `browserPageAdapter.js`, `browserPng.js`, `webBootstrap.js`, `matchMonitor.mjs`
- Modify: `launcher.mjs`, `orchestrator.js`
- Test: `tests/browserAdapter.test.mjs`, `tests/injectionBundle.test.mjs`

**Interfaces:**
- Consumes: `runMenuSequence(page)`, `runRematchSequence(page)`, `createInjectionBundle()` esistente.
- Produces: `createInjectionBundle({ web?: boolean, cloudSync?: object })`, `createBrowserPageAdapter({ window, canvas })`, `monitorPostMatch(page, { capture, isClosed? })`.

- [ ] **Step 1: Scrivere test che falliscono**

```js
test('il bundle web usa il bootstrap browser e alias PNG senza moduli Node', async () => {
  const bundle = await createInjectionBundle({ web: true, cloudSync: { enabled: true } });
  assert.match(bundle, /EventSource|api\/events/);
  assert.doesNotMatch(bundle, /require\("node:|require\("fs"/);
});

test('la cattura browser restituisce RGBA compatibile con i detector', () => {
  const frame = captureCanvasFrame(fakeCanvasWithRedPixels());
  assert.deepEqual([frame.width, frame.height], [960, 540]);
  assert.equal(frame.data[0], 255);
});
```

- [ ] **Step 2: Verificare il fallimento**

Run: `node --test tests/browserAdapter.test.mjs tests/injectionBundle.test.mjs`
Expected: FAIL per moduli `injectionBundle.mjs` e `browserPageAdapter.js` assenti.

- [ ] **Step 3: Implementare adapter, hook rAF e monitor condiviso**

```js
export function createBrowserPageAdapter({ window: targetWindow = window } = {}) {
  const frameCapture = installCanvasFrameCapture(targetWindow);
  return {
    waitForTimeout: (ms) => new Promise((resolve) => targetWindow.setTimeout(resolve, ms)),
    keyboard: {
      down: (key) => dispatchMenuKey(targetWindow, key, true),
      up: (key) => dispatchMenuKey(targetWindow, key, false),
    },
    evaluate: (fn, arg) => fn(arg),
    screenshot: async () => frameCapture.read(),
  };
}
```

Il bootstrap web importa `pageBootstrap.js`, attende `window.marketArena`, attende 30 s, chiama `runMenuSequence(adapter)` e avvia `monitorPostMatch(adapter, { capture: () => adapter.screenshot() })`. Il launcher continua a passare `captureGameFrame`; `matchMonitor.mjs` conserva verbatim detector, 1,5/2/12 s e log.

- [ ] **Step 4: Verificare i test e la non regressione**

Run: `node --test tests/browserAdapter.test.mjs tests/injectionBundle.test.mjs tests/directInjection.test.mjs tests/combatFrame.test.mjs`
Expected: PASS; `menuDriver.mjs` invariato rispetto al baseline.

---

### Task 2: Reverse proxy e iniezione HTML

**Files:**
- Create: `server.mjs`, `cloudState.mjs`
- Modify: `package.json`
- Test: `tests/server.test.mjs`

**Interfaces:**
- Consumes: `createInjectionBundle({ web: true, cloudSync: { enabled: true } })`.
- Produces: `createArenaServer({ upstreamOrigin, adminKey, stateFile, fetchImpl })`, `injectBundle(html, bundle)`, server su `PORT`.

- [ ] **Step 1: Scrivere test con upstream locale mock**

```js
test('il proxy conserva binary, query e Range e inietta prima degli script', async () => {
  const binary = await fetch(`${base}/asset.wasm?x=1`, { headers: { Range: 'bytes=0-3' } });
  assert.deepEqual(Buffer.from(await binary.arrayBuffer()), Buffer.from([0, 97, 115, 109]));
  const html = await (await fetch(`${base}/runtime.html`)).text();
  assert.ok(html.indexOf('__BT3_MARKET_ARENA__') < html.indexOf('<script'));
});
```

- [ ] **Step 2: Verificare il fallimento**

Run: `node --test tests/server.test.mjs`
Expected: FAIL perché `server.mjs` non esiste.

- [ ] **Step 3: Implementare proxy trasparente e route**

`GET /` effettua redirect al runtime con la query BT3 esistente. Gli altri path inoltrano metodo, query, body e Range; la risposta conserva status, tipo e byte. Solo HTML riceve `<script>bundle</script>` come primo figlio di `<head>`; vengono ricalcolati gli header entity e rimossa CSP bloccante. `/healthz` restituisce `{ ok: true }`.

- [ ] **Step 4: Verificare il proxy**

Run: `node --test tests/server.test.mjs`
Expected: PASS per HTML, Wasm, query, Range e errori upstream.

---

### Task 3: Stato CA globale, SSE e Control Room

**Files:**
- Create: `cloudClient.js`, `admin.html`
- Modify: `server.mjs`, `cloudState.mjs`, `orchestrator.js`, `broadcastUI.js`, `index.html`
- Test: `tests/cloudState.test.mjs`, `tests/cloudClient.test.mjs`, `tests/server.test.mjs`

**Interfaces:**
- Consumes: `Orchestrator.applyConfig(incoming, action)` e `BroadcastUI.bindAdmin()`.
- Produces: `CloudStateStore.get()/update()`, `CloudConfigClient.load()/subscribe()/update()`, `cloudSync` opzionale dell'Orchestrator.

- [ ] **Step 1: Scrivere test di autenticazione, persistenza e broadcast**

```js
test('solo la chiave admin aggiorna lo stato e notifica SSE', async () => {
  assert.equal((await fetch(`${base}/api/state`, { method: 'PATCH', body: '{}' })).status, 401);
  const response = await authedPatch({ ca: VALID_CA, source: 'pumpportal' });
  assert.equal(response.status, 200);
  assert.equal((await store.get()).ca, VALID_CA);
  assert.doesNotMatch(JSON.stringify(response.body), new RegExp(adminKey));
});
```

- [ ] **Step 2: Verificare il fallimento**

Run: `node --test tests/cloudState.test.mjs tests/server.test.mjs`
Expected: FAIL per store e route admin assenti.

- [ ] **Step 3: Implementare stato, client e F2 remoto**

`GET /api/state` espone soltanto configurazione pubblica; `PATCH /api/state` accetta Bearer o `x-admin-key` e usa timing-safe comparison; `GET /api/events` invia stato iniziale, heartbeat e update. `/admin` contiene un form con password e fetch autenticato. Il campo `adminKey` in F2 è `type=password`, `autocomplete=off`; `readConfig()` lo separa e nessun valore entra in `localStorage`. In cloud l'Orchestrator applica prima la mutazione remota e poi riconnette il `MarketFeed` dallo stato ricevuto.

- [ ] **Step 4: Verificare sincronizzazione e segretezza**

Run: `node --test tests/cloudState.test.mjs tests/cloudClient.test.mjs tests/server.test.mjs`
Expected: PASS; nessun `ADMIN_KEY` in stato, HTML, log o storage.

---

### Task 4: Streamer container 24/7

**Files:**
- Create: `Dockerfile`, `cloud-stream.sh`, `.dockerignore`
- Modify: `package.json`
- Test: `tests/cloudPackaging.test.mjs`

**Interfaces:**
- Consumes: `server.mjs`, `launcher.mjs`, `BT3_CLOUD_SYNC=1`.
- Produces: container con HTTP admin e stream `STREAM_RTMP_URL`.

- [ ] **Step 1: Scrivere test statici del packaging**

```js
test('lo streamer avvia Xvfb, server, launcher e FFmpeg senza esporre la chiave', async () => {
  const script = await readFile('cloud-stream.sh', 'utf8');
  assert.match(script, /Xvfb :99 -screen 0 1920x1080x24/);
  assert.match(script, /BT3_CLOUD_SYNC=1/);
  assert.match(script, /x11grab/);
  assert.match(script, /-r 60/);
  assert.doesNotMatch(script, /echo .*STREAM_RTMP_URL/);
});
```

- [ ] **Step 2: Verificare il fallimento**

Run: `node --test tests/cloudPackaging.test.mjs`
Expected: FAIL per file container assenti.

- [ ] **Step 3: Implementare immagine e supervisione**

Il Dockerfile installa Chromium e dipendenze Playwright, Xvfb, PulseAudio e FFmpeg; copia il progetto ed esegue `npm ci`. Lo script attiva `pulseaudio`, `Xvfb :99 -screen 0 1920x1080x24`, `node server.mjs`, `DISPLAY=:99 BT3_CLOUD_SYNC=1 node launcher.mjs`, quindi FFmpeg con `x11grab` a 60 fps, H.264/AAC e RTMP. Una `trap` termina tutti i figli; nessun comando stampa `STREAM_RTMP_URL`.

- [ ] **Step 4: Validare sintassi e packaging**

Run: `node --test tests/cloudPackaging.test.mjs && bash -n cloud-stream.sh`
Expected: PASS; build Docker eseguita solo se il daemon è disponibile.

---

### Task 5: Documentazione e verifica integrata

**Files:**
- Modify: `README.md`, `HANDOFF.md`
- Test: tutti i test Node e smoke browser/proxy.

- [ ] **Step 1: Documentare deploy e limiti verificati**

README e HANDOFF devono distinguere web app pubblica e streamer, elencare `PORT`, `UPSTREAM_ORIGIN`, `ADMIN_KEY`, `STATE_FILE`, `STREAM_RTMP_URL`, volume persistente e healthcheck; Render/Railway ricevono comandi build/start esatti. La modalità locale e tutti i timing restano documentati senza alterazioni.

- [ ] **Step 2: Eseguire la suite completa**

Run: `npm test && npm run check && bash -n cloud-stream.sh`
Expected: tutti i test PASS e sintassi valida.

- [ ] **Step 3: Eseguire smoke sul runtime reale**

Avviare il proxy su una porta libera, aprire `/runtime.html?...` con Chromium e verificare bundle `running`, canvas WebGL2, due gamepad, assenza di errori CORS e acquisizione RGBA. Eseguire il percorso menu soltanto se il runtime risponde; separare nei risultati errori upstream da errori del progetto.

- [ ] **Step 4: Controllo finale**

Rileggere stato Git senza modificare la history, confermare che `menuDriver.mjs` non sia cambiato e riportare separatamente test locali superati e verifiche esterne non disponibili (account cloud, Docker daemon, chiave RTMP).
