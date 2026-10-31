# HANDOFF — Direct DOM & Gamepad Injection

## Stato corrente

L'architettura usa sempre il motore remoto reale. Non esistono renderer alternativi, canvas sostitutivi, stickman o iframe applicativi. Sono presenti tre entry point: `npm start` per il launcher Playwright persistente, `npm run start:web` per reverse proxy/web app e `cloud-stream.sh` per lo streamer Docker.

`npm run test:browser` esegue la navigazione diagnostica locale e chiude il browser. `menuDriver.mjs` porta il runtime reale attraverso **New Game senza save → Duel → 1P vs 2P → Single Battle → P1/P2 random → Normal/colori → stage random → combattimento**. Lo stesso file è compilato anche nel bundle web: timing, roster e recovery non sono stati duplicati o ricalibrati.

La validazione headful locale ha verificato `runtime.html`, canvas WebGL2, HUD iniettato, due gamepad virtuali conformi e i due personaggi 3D in combattimento. Anche lo smoke tramite reverse proxy ha completato l'intero percorso fino a `fighting`, salvando i pixel reali in `artifacts/cloud-web-combat.png`. Il test headless arriva al bootstrap ma può mostrare nero nel 3D; la verifica completa deve usare `BT3_SMOKE_HEADFUL=1`.

## Catena di iniezione

```text
launcher.mjs
  │ esbuild IIFE in memoria
  │ context.addInitScript(bundle)
  ▼
dragonballbt3.online/runtime.html?embedded=0&hud=0
  │ apertura diretta same-origin come top-level
  │ nessuna landing o navigazione intermedia
  │
  ├─ prima degli script Emscripten:
  │    BT3InputBridge.install()
  │    navigator.getGamepads → [Buyer, Seller]
  │    2 × gamepadconnected
  │
  └─ DOMContentLoaded:
       index.html + styles.css
       Orchestrator + MarketFeed + MatchAutomator
       HUD fixed z-index 999999
```

Il bootstrap ignora i frame figli (`window.top === window`): dopo la promozione del runtime a pagina principale esiste una sola applicazione attiva, nello stesso realm del Wasm.

## Stato globale diagnostico

Nel runtime:

```js
window.__BT3_MARKET_ARENA__ = {
  bridge,
  app,
  status,      // preloaded → running, oppure error
  installedAt,
  error
};

window.marketArena; // Orchestrator
```

Per controlli manuali dalla console Playwright:

```js
navigator.getGamepads().map(p => [p.id, p.buttons.length, p.axes.length]);
window.__BT3_MARKET_ARENA__.status;
document.querySelectorAll('canvas').length;
document.getElementById('broadcast') !== null;
```

## Bundle

`createInjectionBundle()` in `injectionBundle.mjs` legge il contenuto di `<body>` da `index.html` e `styles.css`. In locale compila `pageBootstrap.js`; con `{ web: true }` compila `webBootstrap.js` e alias `pngjs` verso `browserPng.js`, che accetta direttamente frame RGBA. HTML, CSS e `__BT3_CLOUD_SYNC__` vengono serializzati con `define`.

Dopo modifiche a HTML/CSS/moduli non serve una build separata: il bundle viene ricreato a ogni `npm start` e alla prima richiesta HTML del proxy.

## Architettura cloud

```text
Browser spettatore
  │ HTTPS same-origin
  ▼
server.mjs ────────────────► dragonballbt3.online
  │ inject bundle nel primo <head>     runtime.html / JS / Wasm / dati / Range
  ├─ GET/PATCH /api/state ◄── CloudStateStore → STATE_FILE
  ├─ GET /api/events ───────► SSE revisione CA a tutti i client
  ├─ GET /admin ────────────► Control Room remoto protetto da ADMIN_KEY
  └─ GET /healthz

Docker cloud-stream.sh
  ├─ Xvfb :99 1920x1080x24 + PulseAudio
  ├─ server.mjs (admin remoto)
  ├─ launcher.mjs via proxy locale ?inject=0, BT3_CLOUD_SYNC=1
  └─ FFmpeg x11grab 60 fps + PulseAudio → STREAM_RTMP_URL
```

Il proxy non inoltra `ADMIN_KEY` all'upstream. Le risposte HTML eliminano CSP/entity header non più validi ma mantengono COOP/COEP. I body binari restano invariati; i Location upstream vengono riscritti same-origin.

`browserPageAdapter.js` implementa `waitForTimeout`, `keyboard.down/up`, `evaluate`, `screenshot` e `isClosed`. I menu usano un solo KeyboardEvent sul canvas con `bubbles:true`: doppi dispatch separati a window/canvas causavano una deviazione in Dragon World Tour. Il doppio canale del `BT3InputBridge` per il combattimento resta invariato. Per i pixel, il hook pre-load imposta `preserveDrawingBuffer:true` su WebGL/WebGL2 e copia i frame dopo i callback rAF; senza questo hook il canvas diventava nero nella lettura del 3D.

`CloudStateStore` accetta soltanto campi pubblici noti, normalizza numeri/URL/mint, incrementa `revision` e scrive JSON con rename atomico. `CloudConfigClient` invia la password solo come Bearer; `BroadcastUI` elimina `adminKey` dal FormData prima di chiamare l'Orchestrator. In modalità cloud l'Orchestrator non salva la configurazione admin in `localStorage`, applica una revisione una sola volta e chiude SSE in `destroy()`.

`STATE_FILE` deve risiedere su un volume persistente in Render/Railway. Su Vercel, `api/index.mjs` esporta lo stesso `http.Server` con `stateFile:null` e `vercel.json` instrada tutto alla Function: non esiste persistenza o coordinamento CA/SSE fra istanze senza uno storage esterno. Il piano Vercel non esegue lo streamer Chromium/FFmpeg. Lo streamer richiede `STREAM_RTMP_URL`; FFmpeg ritenta ogni 5 secondi, mentre la terminazione di server/launcher arresta il container per consentire il restart esterno. Nessun deploy o stream pubblico è incluso nella verifica locale.

## Input

`BT3InputBridge` possiede entrambi i pad fin dalla init script. Ogni pad ha 16 bottoni e 4 assi. `announceGamepads()` invia due `gamepadconnected` durante `install()`.

`dispatchKey()` invia eventi distinti a `window` e canvas con `bubbles: false`. La vecchia chiamata automatica a `enterDuelMode()` dopo 3,5 secondi è stata rimossa dal flusso: teneva il match attivo durante il boot e interferiva con i menu.

`menuDriver.mjs` possiede l'intero percorso: due Start, New Game senza salvataggio, Duel, 1P vs 2P, Single Battle, roster random P1/P2, Normal, colori e mappa random. Le frecce native sono il D-pad; WASD non lo sostituisce nei dialoghi. Le pressioni durano 220–250 ms, quelle critiche 400 ms.

Il boot attende un frame a colori analizzato con `pngjs`, evitando input su schermate legali o dissolvenze. Dopo Map Select attende il download reale degli asset e un successivo frame 3D; non considera il timer o la sola fase logica una prova del combattimento. Dopo l'introduzione il recupero ripete **K → Cross (P2) → Enter → Start (P1)** finché `hasCombatHudFrame()` non rileva entrambe le barre HP verdi: questo chiude anche Select Color o Map Select rimasti aperti per una conferma non recepita. Soltanto allora avvia il timer del round. I timing completi sono nel README.

Durante `neutral`, `attack` e `vulnerable`, il bridge invia **L1** a ciascun pad ogni 300 frame (circa 5 secondi a 60 fps) per riattivare il lock-on. In `idle` L1 viene rilasciato.

## Mercato e match

Il cambio CA usa `MarketFeed.stop()` e il nuovo connettore; non naviga la pagina e non reinstalla i gamepad. La simulazione pre-lancio produce soltanto dati di mercato.

`MatchAutomator` gestisce soltanto fase, KO/timeout e round. Su Windows `screenCapture.mjs` cattura il desktop reale con `SetProcessDPIAware`, quindi il monitor non dipende dai frame WebGL potenzialmente obsoleti di Playwright e non viene ritagliato dallo scaling al 125%. `monitorPostMatch()` usa `readCombatHealth()` e `KnockoutDetector`: una HP vuota per 1,5 secondi invia `notifyKO(null, 'visual-hp-zero')` prima che i pad possano confermare Rematch. Se invece il timer originale sparisce durante la vittoria, i pad vengono sospesi dopo 2 secondi e la fine match viene confermata dopo 12 secondi con `notifyKO(null, 'visual-result')`; se il timer ricompare, i pad riprendono in neutro. Dopo il KO `runRematchSequence()` preme **ArrowDown → K** per scegliere Character Select e riesegue roster, Normal, colori e mappa prima di `match.restart()`. Con offset Wasm validi il KO resta disponibile anche dalla memoria; `roundDurationSec` predefinito a **300 s** è soltanto il fallback. Non vengono applicati danni fittizi o HP simulati.

Configurazione `localStorage` del runtime, chiave:

```text
bt3-market-arena-direct-v2
```

Il browser viene aperto con un contesto pulito: la persistenza vale per la sessione corrente. `launchPersistentContext()` crea già una directory `artifacts/chromium-profile-*` e pilota la pagina `--app` con `viewport: null`; ogni avvio usa un profilo separato.

## Diagnostica launcher

`collectDiagnostics()` restituisce:

- URL e titolo del runtime.
- Stato/errore dell'iniezione.
- Presenza HUD.
- Numero canvas e canvas WebGL2.
- ID, mapping, bottoni e assi dei pad.
- Fase del match automator.

Errori frequenti:

- **`Executable doesn't exist`:** esegui `npx playwright install chromium` o configura `CHROME_PATH`.
- **Nessun runtime rilevato:** controlla se la landing ha cambiato il pulsante Play o il selettore `iframe#game-frame`.
- **`injectionStatus: error`:** leggi `injectionError`; il bundle viene eseguito ma il bootstrap ha incontrato un errore DOM.
- **Canvas assente:** verifica disponibilità del sito, WebGL2 e caricamento del runtime.
- **Input non recepiti:** controlla focus canvas, mapping aggiornato del sito e sequenza menu; non assumere che gli eventi tastiera sintetici vengano accettati.
- **Memoria nulla:** la build remota potrebbe non esportare `Module.wasmMemory` o `HEAPU8` sul `window` principale.

## Test e rilascio

```bash
npm test
npm run check
npm run test:browser
bash -n cloud-stream.sh
node scripts/smokeWeb.mjs
BT3_SMOKE_HEADFUL=1 node scripts/smokeWeb.mjs --full
```

Per la web app la prova completa deve riportare `menuSequence: "completed"` e `phase: "fighting"`; `artifacts/cloud-web-combat.png` deve mostrare i due modelli 3D e le HP, non una schermata nera. Errori 404/network upstream vanno registrati e valutati separatamente dal risultato del match. Per il container eseguire anche `docker build` quando è disponibile un daemon; `bash -n` valida soltanto la sintassi dello script, non FFmpeg/RTMP.

Prima della diretta verifica visivamente ingresso Duello, selezione P1/P2, macro BUY/SELL, whale, cambio round e popup F2. Il test automatico certifica motore/HUD/pad, non la correttezza degli hit-frame o degli offset della build remota corrente.

Per il match headful, la verifica decisiva è una cattura OS della finestra aperta (`artifacts/live-window-current.png`): gli screenshot Playwright possono conservare un frame WebGL obsoleto. `artifacts/dragonballbt3-combat.png` da solo non certifica che il combattimento sia visibile. Il log `artifacts/live-launcher.log` deve inoltre riportare `menuSequence: "completed"`, `matchPhase: "fighting"` e il messaggio di motore reale attivo.

Chiudi la finestra Chromium per terminare il launcher. I segnali SIGINT/SIGTERM chiudono il browser; la modalità `--validate` chiude sempre il contesto al termine.
