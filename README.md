# BT3 // Market Arena — Direct Injection

Launcher Playwright che esegue il **vero motore WebAssembly/WebGL2 di `dragonballbt3.online`** e inietta controller virtuali, HUD crypto e controlli di mercato direttamente nel MAIN world del documento di gioco.

Non vengono creati canvas sostitutivi, iframe locali o scene 2D. Il video catturato da OBS è il canvas reale del gioco remoto.

> Il progetto non scarica né ridistribuisce ROM, Wasm o asset del gioco. La disponibilità del servizio remoto e i diritti d'uso restano responsabilità dell'operatore.

## Avvio immediato

Requisiti: Node.js 20 o successivo su Windows, macOS o Linux.

```bash
npm install
npx playwright install chromium
npm start
```

`npm start` apre automaticamente una finestra Chromium pulita in modalità app/kiosk a **1920×1080**, con `--app`, `--start-fullscreen` e `viewport: null`: niente barra URL o spazio sottratto al canvas. Il launcher usa `launchPersistentContext()` e pilota la pagina app originale, senza crearne una seconda con le barre del browser. Se è già installato Chrome/Edge, prova a usarlo; altrimenti utilizza il Chromium di Playwright. Per forzare un eseguibile:

```bash
CHROME_PATH=/percorso/chrome npm start
```

## Modalità disponibili

| Modalità | Comando | Uso |
|---|---|---|
| Launcher locale | `npm start` | Chromium kiosk sul PC, automazione Playwright calibrata |
| Web app pubblica | `npm run start:web` | Reverse proxy same-origin, automazione nel browser dei visitatori, CA globale via SSE |
| Anteprima web locale | `npm run dev` | Come la web app; accetta anche `-- --host 0.0.0.0 --port 7100` |
| Cloud streamer | `npm run start:stream` o Docker | Xvfb + launcher calibrato + FFmpeg RTMP, senza OBS |

Le due modalità online condividono `menuDriver.mjs`, `matchMonitor.mjs`, i detector HP/fine match e tutti i timing del launcher. Non esiste una seconda sequenza semplificata per il web.

## 1. Web app pubblica con reverse proxy

Avvio locale:

```bash
ADMIN_KEY='sostituisci-con-una-password-lunga' npm run start:web
```

Apri `http://localhost:3000/` per il gioco e `http://localhost:3000/admin` per il Control Room remoto. In produzione usa sempre HTTPS. `npm run dev` è un alias adatto all'anteprima e accetta gli argomenti `--host` e `--port`.

`scripts/arenaServer.mjs` proxya `runtime.html`, JavaScript, Wasm, dati e richieste Range verso `https://dragonballbt3.online`. Il visitatore non esegue Playwright: il bundle viene iniettato come primo script nell'`<head>`, prima di Emscripten. HTML, asset e API condividono la stessa origine, eliminando iframe e CORS fra gioco e HUD.

Il bootstrap web installa:

- i due gamepad virtuali e il doppio canale di combattimento già esistenti;
- HUD responsive e pannello admin (pulsante touch, F2 su desktop);
- un adapter browser per lo stesso `menuDriver.mjs`;
- eventi menu singoli con bubbling naturale dal canvas a `window`, equivalenti agli input Playwright;
- hook `requestAnimationFrame` e `preserveDrawingBuffer` per leggere RGBA/HP dal vero canvas WebGL2;
- lo stesso monitor HP/KO e cambio personaggi usato dal launcher: il timer assente sospende soltanto gli input, senza dichiarare la fine del match.

Per il rendering 3D è necessario un browser con WebGL2 accelerato. Il percorso completo è stato verificato in Chromium headful; Chromium headless può mostrare un canvas nero durante il caricamento 3D e non è una prova valida del rendering per gli spettatori.

### Stato CA condiviso e admin

- `GET /api/state`: configurazione pubblica corrente, revisione e timestamp.
- `PATCH /api/state` o `PUT /api/state`: mutazione protetta da `Authorization: Bearer ADMIN_KEY` oppure `x-admin-key`.
- `GET /api/events`: SSE con stato iniziale, aggiornamenti immediati e heartbeat ogni 25 secondi.
- `GET /admin`: pannello remoto con hot-swap CA.
- `GET /healthz`: healthcheck del servizio.

Il pannello admin della web app usa lo stesso endpoint: prima salva lo stato sul server, poi riconnette il feed dal risultato. Tutti gli altri browser ricevono la nuova revisione via SSE e, in ogni caso, tramite un polling di coerenza ogni **2 s** su `GET /api/state`; riconnettono il proprio `MarketFeed` senza ricaricare il gioco. Le revisioni sono monotone: una risposta più vecchia non sovrascrive un CA più recente. Il feed precedente viene fermato prima del nuovo e un numero di generazione (`MarketFeed.connectionGeneration`) scarta socket, timer e fetch di connessioni superate, così due cambi CA ravvicinati non riattivano il vecchio token. Ogni risposta dell'API riporta `storage`: `redis`, `file` o `memory`. `ADMIN_KEY` non viene inclusa nello stato, nel markup, nei log, nel `localStorage` o nel payload JSON; resta soltanto nell'header della richiesta. Se la variabile non è configurata, ogni mutazione è rifiutata.

### Deploy su Vercel

La build `npm run build` scarica il runtime reale, compila il bundle web e genera `public/index.html`, `public/runtime.html`, `public/bt3-arena-bundle.js` e `public/admin.html`. Se upstream è offline usa `templates/runtime.fallback.html`. La home e il runtime sono quindi serviti dal CDN statico e non invocano alcuna Function.

`vercel.json` pubblica `public/`, mantiene `/api/state` nella Function isolata `api/state.mjs`, instrada esplicitamente `/api/events` sulla stessa Function con `?events=1` e `/admin` su `admin.html`. Tutti gli asset del motore non locali vengono inoltrati dai rewrite esterni del CDN a `https://dragonballbt3.online/`; non devono ricadere su `index.html`, altrimenti JavaScript, CSS e Wasm riceverebbero HTML e il gioco resterebbe bloccato sul caricamento. Il server proxy locale risiede in `scripts/arenaServer.mjs`: non deve esistere un entrypoint `server.*` nella radice o in `src/`, perché Vercel lo rileverebbe automaticamente come Function Node per tutte le rotte. La proprietà `framework: null` forza il preset statico anche se il progetto era stato importato come **Serverless Node**. Configura `ADMIN_KEY`; non impostare `STATE_FILE`.

**Stato CA condiviso:** collega un database Redis/Upstash dal Vercel Marketplace. `api/state.mjs` usa `redisCloudState.mjs` (chiave `bt3:market-arena:state:v1`) quando trova `KV_REST_API_URL` + `KV_REST_API_TOKEN` oppure `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`, anche con il prefisso personalizzato scelto nel Marketplace (es. `STORAGE_KV_REST_API_URL` + `STORAGE_KV_REST_API_TOKEN`), e risponde con `storage: "redis"`. Le variabili valgono solo per i deploy successivi: dopo averle aggiunte serve un nuovo deploy di Production. Senza queste variabili resta in memoria (`storage: "memory"`): lo stato può essere perso o non coincidere fra istanze. Il polling da 2 s fa convergere i client anche quando l'evento SSE arriva a una Function diversa. Vercel ospita soltanto la web app, non il container Chromium/FFmpeg 24/7.

**Build verificabile:** la build scrive `public/build-manifest.json` con `{ commit, bundleSha256, builtAt }` (commit da `VERCEL_GIT_COMMIT_SHA`, poi `GIT_COMMIT`, altrimenti `local`). HTML e runtime caricano `/bt3-arena-bundle.js?v=<bundleSha256>` e contengono `<meta name="bt3-build">`, esposto anche come `window.__BT3_MARKET_ARENA__.build`. HTML e manifest richiedono riconvalida (`max-age=0, must-revalidate`), il bundle è `immutable`. Dopo ogni deploy confronta `git rev-parse HEAD` con `/build-manifest.json` e ricalcola lo SHA-256 del bundle scaricato: un HTTP 200 da solo non prova che la build pubblicata sia aggiornata.

```bash
curl -s https://bt-3-market-arena.vercel.app/build-manifest.json
curl -s "https://bt-3-market-arena.vercel.app/bt3-arena-bundle.js?v=<bundleSha256>" | sha256sum
```

### Deploy su Render

Crea un **Web Service** Node con:

```text
Build Command: npm ci
Start Command: npm run start:web
Health Check Path: /healthz
```

Variabili:

```text
ADMIN_KEY=<password-lunga-e-casuale>
STATE_FILE=/var/data/cloud-state.json
UPSTREAM_ORIGIN=https://dragonballbt3.online
```

Render assegna `PORT` automaticamente. Monta un disco persistente su `/var/data`; senza disco, il CA resta condiviso fra i client connessi ma torna al valore iniziale dopo restart/redeploy. Il filesystem locale effimero non è una persistenza affidabile.

### Deploy su Railway

Crea un servizio dal repository con gli stessi comandi build/start, oppure lascia a Railway il rilevamento Node e imposta `npm run start:web` come start command. Configura `ADMIN_KEY`, `UPSTREAM_ORIGIN` e `STATE_FILE=/data/cloud-state.json`, quindi monta un **Volume** su `/data`. Espone il servizio tramite il dominio HTTPS Railway; il server ascolta sulla `PORT` fornita dalla piattaforma.

## 2. Cloud streamer 24/7 senza OBS

Il `Dockerfile` contiene Node.js, Chromium/Playwright, Xvfb, PulseAudio e FFmpeg. `cloud-stream.sh` esegue:

1. PulseAudio e `Xvfb :99 -screen 0 1920x1080x24`.
2. `scripts/arenaServer.mjs` per `/admin`, `/api/state`, `/api/events` e `/healthz`.
3. Il normale `launcher.mjs` in modalità headed/kiosk, con `BT3_CLOUD_SYNC=1`.
4. FFmpeg con `x11grab` a 60 fps, audio PulseAudio, H.264/AAC e destinazione `STREAM_RTMP_URL`.

Senza `CLOUD_STATE_ORIGIN` il CA della live è quello del `STATE_FILE` locale al container, indipendente dal sito pubblico. Con `-e CLOUD_STATE_ORIGIN=https://bt-3-market-arena.vercel.app` il server del container inoltra `GET/PATCH /api/state` al deploy Vercel (Redis) e risponde 204 su `/api/events`: il launcher resta sul polling da 2 s e un CA salvato da `/admin` su Vercel raggiunge anche YouTube/X. Nel container il launcher usa il proxy locale con `inject=0`, riservato a questo flusso: evita che il bootstrap web e quello Playwright eseguano due automazioni contemporanee. I timing e la cattura del launcher non cambiano. FFmpeg riprova dopo 5 secondi in caso di disconnessione; se server o launcher terminano, il container esce e il restart policy della piattaforma riavvia l'intero stack.

Build ed esecuzione:

```bash
docker build -t bt3-market-arena .
docker run -d --name bt3-market-arena --restart unless-stopped \
  -p 3000:3000 \
  -e ADMIN_KEY='sostituisci-con-una-password-lunga' \
  -e STREAM_RTMP_URL='rtmp://PROVIDER/PATH/STREAM_KEY' \
  -e CLOUD_STATE_ORIGIN='https://bt-3-market-arena.vercel.app' \
  -e STATE_FILE=/app/artifacts/cloud-state.json \
  -v bt3-market-state:/app/artifacts \
  bt3-market-arena
```

`STREAM_RTMP_URL` deve contenere l'endpoint e la stream key di YouTube Live o del provider RTMP usato per X. Per trasmettere su due piattaforme insieme aggiungi `-e STREAM_RTMP_URL_SECONDARY='rtmp://…'`: FFmpeg codifica una sola volta e il muxer `tee` duplica l'output; con `onfail=ignore` la caduta di una destinazione non interrompe l'altra. Se FFmpeg termina del tutto, il retry dopo 5 secondi riapre entrambe. Non stampare gli URL nei log e non inserirli nel repository. Il bitrate video predefinito è 6000 kbit/s, GOP 120 frame, audio AAC 160 kbit/s; adattalo alle restrizioni del provider prima della diretta.

Su Render/Railway scegli il deploy **Dockerfile**, espone la porta HTTP e configura lo stesso volume persistente. Il servizio deve avere CPU/RAM sufficienti per Chromium WebGL2 e codifica 1080p60. Account cloud, quota e chiavi RTMP non sono inclusi nel progetto.

### Streamer con GPU locale, senza cattura dello schermo

`scripts/stream-canvas-pipe.mjs` non legge mai lo schermo, le finestre o i monitor del PC. Apre la pagina pubblica (`BT3_GAME_URL`, predefinita `https://bt-3-market-arena.vercel.app/runtime.html?...`) in Chromium **headless** con GPU (ANGLE Direct3D11, `--enable-gpu`): nessuna finestra compare sul desktop e la superficie della pagina è esattamente 1920×1080. Una finestra reale verrebbe ridotta da Windows all'area dello schermo (con scaling 125% circa 1920×795 CSS) e la cattura della scheda perderebbe la parte bassa con l'HUD. `STREAM_HEADLESS=0` usa invece una finestra fuori schermo (`STREAM_WINDOW_POSITION`, predefinita `-2400,0`) per diagnosi. La pagina usa la stessa automazione nella pagina di `smokeWeb.mjs` e lo stato CA da Redis. Dentro la pagina `getDisplayMedia({ preferCurrentTab: true })`, accettato in automatico da `--auto-accept-this-tab-capture`, cattura soltanto la scheda: canvas WebGL2, HUD e audio della pagina. Lo script interrompe tutto se la superficie non è `displaySurface: "browser"`. `MediaRecorder` invia il WebM a Node, che lo scrive su `stdin` di FFmpeg: H.264 1080p60 6000 kbit/s (GOP 120) + AAC 160 kbit/s verso `STREAM_RTMP_URL`, più `STREAM_RTMP_URL_SECONDARY` con `tee`/`onfail=ignore`. L'audio non viene riprodotto sulle casse del PC (`suppressLocalAudioPlayback`). Se la sessione termina, riparte dopo 10 s.

`--disable-background-timer-throttling`, `--disable-renderer-backgrounding` e `--disable-backgrounding-occluded-windows`, presenti anche nel launcher, mantengono attivo `requestAnimationFrame` quando la finestra è coperta o non in primo piano. Senza questi flag Chromium considera la pagina nascosta, il gioco si ferma e i tasti dei menu vanno persi: era il blocco al Character Select. In headless non esiste una finestra da ridurre o coprire: il PC resta libero.

```powershell
$env:STREAM_RTMP_URL = Read-Host -MaskInput "YouTube URL+key"; $env:STREAM_RTMP_URL_SECONDARY = Read-Host -MaskInput "X URL+key"; node scripts/stream-canvas-pipe.mjs
```

Prova locale su file: `STREAM_RTMP_URL=artifacts/test.mp4 STREAM_DURATION_SEC=15 STREAM_WAIT_FOR_FIGHTING=1 node scripts/stream-canvas-pipe.mjs`. FFmpeg si installa con `winget install --id Gyan.FFmpeg -e`; lo script lo trova da solo oppure tramite `FFMPEG_PATH`.

## Variabili d'ambiente

| Variabile | Obbligatoria | Descrizione |
|---|---|---|
| `PORT` | Fornita dal cloud | Porta HTTP; default locale 3000 |
| `ADMIN_KEY` | Sì per mutazioni | Password del Control Room; mai salvata nei client |
| `STATE_FILE` | Consigliata | Percorso JSON su volume persistente; default `artifacts/cloud-state.json` |
| `UPSTREAM_ORIGIN` | No | Default `https://dragonballbt3.online` |
| `STREAM_RTMP_URL` | Solo streamer | Destinazione RTMP completa, inclusa stream key |
| `STREAM_RTMP_URL_SECONDARY` | No | Seconda destinazione RTMP (es. X), duplicata con `tee` |
| `CLOUD_STATE_ORIGIN` | Consigliata per lo streamer | Origine del deploy pubblico (es. `https://bt-3-market-arena.vercel.app`): `/api/state` viene inoltrato lì lato server, così la live segue il CA salvato su Redis |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Consigliate su Vercel | Redis/Upstash per lo stato CA condiviso (alias `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`) |
| `BT3_CLOUD_SYNC` | Gestita dallo script | `1` nel container per collegare il launcher allo stato condiviso |
| `BT3_CLOUD_BASE_URL` | Opzionale | Override origine API; normalmente vuota perché same-origin |
| `BT3_TARGET_URL` | Gestita dallo script | Override URL runtime; nel container usa proxy locale + `inject=0` |

## Sequenza eseguita dal launcher

1. Compila in memoria `pageBootstrap.js` e tutti i moduli con esbuild in formato IIFE.
2. Registra il bundle con `context.addInitScript()` prima della navigazione.
3. Apre direttamente `https://dragonballbt3.online/runtime.html` con `embedded=0` e `hud=0`, senza landing o navigazioni intermedie.
4. Mantiene il runtime same-origin come unica pagina principale.
5. Installa i gamepad prima degli script Emscripten e monta HUD/admin sopra il canvas WebGL2.
6. Attende 30 secondi di boot e, con `menuDriver.mjs`, un frame realmente a colori: niente input durante le schermate legali nere o le dissolvenze bianche.
7. Usa pressioni native mantenute per superare il titolo, scegliere **New Game**, rispondere **No** alla creazione del save e **Yes** a “Start a new game without saving?”.
8. Entra in **Duel → 1P vs 2P → Single Battle**.
9. Randomizza P1 con frecce + `K`, P2 con il secondo gamepad virtuale. Verifica visivamente Character Select, Custom Select, Normal e Select Color prima di ogni avanzamento. Il detector del roster accetta anche i viewport compatti con pochi campioni magenta e, se la fascia magenta è assente, usa i nomi dei lottatori come secondo segnale; il titolo Map Select viene cercato soltanto in alto a sinistra, senza confondere la freccia arancione centrale del roster. Dopo Normal di P2 accetta sia Select Color sia il personaggio già pronto quando il colore non è richiesto, mentre dopo Normal di P1 accetta sia Select Color sia l'eventuale passaggio diretto a Map Select.
10. Randomizza la mappa, poi preme sempre **ArrowLeft** una volta prima di **K**: l’estremo destro è l’icona BGM e confermarla aprirebbe la musica invece dello stage. Attende quindi il download degli asset e la comparsa del frame 3D a colori, supera l'intro con Start e attiva i due pad soltanto dopo aver rilevato entrambe le barre HP.
11. Legge soltanto i pixel della pagina tramite Playwright, mai lo schermo del sistema operativo; i flag di background mantengono il rendering attivo anche con la finestra coperta. Con una barra HP presente e l'altra completamente priva di pixel HP per **1,5 s**, sospende i pad e marca un possibile KO, ma non cambia round finché non compare il menu finale a sei voci con il timer non più visibile. Durante la sospensione `inputLocked` impedisce anche agli eventi BUY/SELL/whale di riattivare i pad e confermare accidentalmente Fight Again. Anche una barra quasi esaurita con pochi campioni colorati resta considerata presente, evitando KO anticipati. Se riconosce **1P/2P Pause**, sospende i pad e preme Start per riprendere: l'oscuramento delle HP in pausa non è un KO. Se il timer sparisce fuori dalla pausa, sospende gli input dopo **2 s** senza dichiarare il risultato; alla ricomparsa riprende il combattimento. Il detector distingue il pannello largo dei risultati dal pannello stretto **EXIT?**: EXIT usa il pannello centrale e legge la selezione gialla Yes/No soltanto nella fascia centrale del testo, così oscuramenti o armature gialle ai lati non possono scambiare No per Yes; un EXIT residuo di provenienza incerta viene chiuso su **No** per tornare ai risultati. Se il pannello resta aperto per due frame dopo la conferma, il proprietario non era il pad stimato dalle HP: il driver riverifica la voce e prova una sola volta l'altro giocatore (K per P1, Cross per P2), quindi si ferma con un errore esplicito invece di attendere 60 s. Nel menu legge la voce evidenziata, raggiunge **Character Select** con impulsi direzionali brevi e verifica visivamente la riga prima di premere **K** (1P) oppure **Cross** (2P); non assume che Fight Again sia sempre selezionato. Dopo la conferma, se il gioco presenta **EXIT?**, seleziona e verifica **Yes** per entrare davvero nel roster. Infine riesegue dal punto 9 personaggi e mappa. Se un retry trova Character Select oppure Map Select già aperti oppure apparsi durante l'attesa dei risultati, riprende direttamente da quello stato senza attendere il timeout; per Map Select è richiesto anche il titolo in alto a sinistra, così una transizione vuota non viene confermata per errore. Se il nuovo match mostra già entrambe le HP verdi e il timer ma la fase è rimasta `postmatch`, il monitor sincronizza subito `match.restart()` e riattiva i pad senza rieseguire i menu; gli errori di automazione sono esposti in `automationError`. Il timeout software è disattivato per default (`roundDurationSec = 0`); un valore positivo lo abilita come opzione.

Questo passaggio attraverso il runtime reale evita sia il blocco cross-origin sia l'annidamento nel frame della landing: hook, HUD, input e Wasm condividono lo stesso `window`.

### Timing calibrati

- Attesa iniziale fissa: **30 s**, seguita da attesa visiva massima **120 s**.
- Pressioni normali: **220–250 ms**; conferme critiche e D-pad Versus: **400 ms**.
- Dopo “Yes” senza salvataggio: **5 s**; prima della conferma sono presenti **1,2 s** di assestamento dopo `ArrowLeft`.
- Apertura Duello: **5 s**; scelta 1P vs 2P: **1,2 s**; sottomenu Single Battle: **3 s**; ingresso roster: **8 s**.
- Nel roster ogni stato richiede **2 frame consecutivi**, con polling ogni **150 ms**. Ogni conferma può essere ripetuta al massimo **3 volte**, attendendo lo stato successivo per **2,5 s** dopo ciascun tentativo; non esistono più attese fisse da 2–4 s fra Custom Select, Normal e colore. Durante il D-pad P2 gli eventi tastiera del gamepad sono sospesi per non muovere anche P1.
- Dopo la mappa restano soltanto **1 s** di assestamento, l'attesa visiva del 3D fino a **300 s** e il recupero condizionato dalle barre HP (massimo **90 s**). Sono state rimosse le attese fisse di **25 s** per l'introduzione e **5 s** prima della cattura.
- Post-match: polling visivo ogni **500 ms**. Le direzioni durano **120 ms** con **350 ms** di pausa, così non attivano l'auto-repeat; la voce Yes/No viene verificata prima di una conferma da **400 ms**, seguita da **1 s** di attesa. Un **EXIT?** residuo viene chiuso su **No**. Dopo l'ultimo spostamento nei risultati attende **800 ms** e verifica Character Select; la conferma da **400 ms** richiede due frame di Character Select oppure EXIT e può essere ripetuta fino a **3 volte**, con **2,5 s** di attesa per tentativo. Se compare **EXIT?**, seleziona e verifica **Yes**, quindi il roster attende direttamente il proprio frame senza gli **8 s** fissi precedenti.

Il download remoto può richiedere 490 file e circa 50 MB: il completamento è governato dal frame 3D, non da un timer presunto. Il rilevatore analizza soltanto il rettangolo centrale (34–66% della larghezza, 10–65% dell'altezza), escludendo i colori dell'HUD che causerebbero falsi positivi durante il download. Le tempistiche possono cambiare con gli aggiornamenti del sito; la cattura visiva resta il controllo decisivo.

## Input iniettati

### Pre-load Gamepad Hook

`BT3InputBridge.install()` sostituisce `navigator.getGamepads()` prima del caricamento del motore e restituisce:

- **Pad 0 — BUYER/P1**, mapping `standard`, 16 bottoni, 4 assi.
- **Pad 1 — SELLER/P2**, mapping `standard`, 16 bottoni, 4 assi.

Per ciascun pad viene emesso `gamepadconnected` tramite `GamepadEvent`; se il costruttore non accetta l'oggetto virtuale, il bridge crea un evento compatibile con proprietà `gamepad`.

### Doppio canale tastiera

Ogni transizione di pulsante genera `keydown`/`keyup` separatamente su `window` e sul primo `canvas`, senza bubbling. Per i menu il driver usa inoltre gli input nativi mantenuti di Playwright: le frecce sono il D-pad effettivo del motore, mentre WASD non sostituisce il D-pad nei dialoghi.

Gli eventi sintetici hanno `isTrusted=false`; il gamepad polling resta il canale principale per P2 e per il combattimento.

### Macro di combattimento

Scheduler a 60 fps con `zCounterLoop`, `rushCombo`, `blast2`, `ultimateFinal`, `sidestep` e `teleportCounter`. La coreografia predefinita `cinematicLoop` alterna counter, rush, teletrasporto, schivata laterale e Blast 2. Durante il combattimento entrambi i pad ricevono un impulso **L1 ogni 300 frame (circa 5 s)** per riattivare il lock-on; in `idle` il pulsante viene rilasciato. La vecchia macro `enterDuelMode()` non viene più invocata: i menu appartengono esclusivamente a `menuDriver.mjs`.

BUY attiva l'attacco di P1 e rende vulnerabile P2; SELL inverte i ruoli. Una whale avvia `L2 + Su + Circle`. Al termine dell'override i pad tornano alla coreografia neutra. `setCinematicCombat(false)` disattiva a caldo la coreografia senza reinstallare i controller.

## HUD e Admin

Il canvas reale è forzato a `100vw × 100vh` con `object-fit: contain`. L'HUD è un `div` fixed con `z-index: 999999` e `pointer-events: none`; brand, round, market cap, dominance, feed e ticker occupano la fascia inferiore/laterale (`bottom: 20px` per il ticker), lasciando libere le barre HP e il timer originali in alto. Include:

- Buy/Sell Dominance su finestra rolling di 15 secondi.
- Market cap e prezzo.
- Live Impact Feed interamente in inglese, chiuso per default e apribile a tendina tramite il suo toggle; soltanto il pulsante intercetta il mouse.
- Contract Address e sorgente feed.
- Round, fase e banner K.O.
- HP soltanto quando il Wasm Memory Bridge è configurato; non vengono mostrati valori simulati.

La vista spettatore non mostra comandi tastiera. Il pulsante admin con icona (`#admin-open`, area touch 44×44 px) apre il Control Room; su desktop **F2** resta una scorciatoia non pubblicizzata e apre il popup separato, fuori dalla cattura OBS. Su schermi fino a 600 px il pannello si apre come dialogo/bottom sheet nella pagina, con CA e sorgente in primo piano e RPC, memoria, flag e test in **Advanced settings**. L'HUD usa `clamp()` e `env(safe-area-inset-*)`: su telefono resta una barra inferiore compatta e il Live Impact Feed si apre a tendina con scorrimento interno. `/admin` resta disponibile come pagina indipendente. Consente hot-swap del CA, selezione feed, whale threshold, RPC, offset memoria e test BUY/SELL/WHALE. Il timeout del round è opzionale: `0` significa soltanto KO. Quattro checkbox attivano/disattivano a caldo `autoMenu`, `autoRematch`, `cinematicCombat` e `visualKO`. Il cambio feed non ricarica il runtime o il bridge.

Gli stessi flag e lo stato delle validazioni visive sono disponibili dalla console:

```js
marketArena.setFeature('cinematicCombat', false);
marketArena.setFeature('visualKO', true);
marketArena.getVisualValidation();
```

I flag accettano soltanto valori booleani. `getVisualValidation()` espone fase, round, stato dei flag e ultimo frame acquisito; una fase logica non sostituisce il controllo visivo del canvas.

## Feed di mercato

- **Simulation:** simula soltanto gli eventi di mercato pre-lancio; il video resta sempre il gioco reale.
- **PumpPortal:** `subscribeTokenTrade` via WebSocket, conversione lamport/SOL-USD.
- **DexScreener:** polling ogni 5 secondi; eventi aggregati, non singole transazioni.
- **Solana RPC:** `logsSubscribe` + `getTransaction(jsonParsed)`, con classificazione della variazione token del signer.

Per il 24/7 usa endpoint RPC dedicati: quelli pubblici possono applicare rate limit.

## Wasm Memory Bridge

Nel pannello F2 inserisci offset decimali per fase, HP P1 e HP P2. L'adapter legge direttamente, nell'ordine:

1. `window.wasmMemory`
2. `window.Module.wasmMemory`
3. `window.Module.HEAPU8.buffer`

HP sono `Int16LE`, fase `Uint8`, con scala HUD predefinita 0–1000. Senza offset, gli HP restano nascosti e il cambio round usa il rilevamento visivo del KO; il timer assente sospende soltanto gli input. Gli aggiornamenti del sito possono cambiare la memoria e richiedere una nuova identificazione degli offset.

## OBS

1. Avvia `npm start`.
2. In OBS aggiungi **Window Capture** e seleziona la finestra Chromium del runtime.
3. Imposta la scena a **1920×1080** e cattura soltanto il contenuto della finestra.
4. Non usare Display Capture se vuoi escludere il popup F2.
5. Mantieni Chromium visibile e la scheda attiva: il sito raccomanda esplicitamente questa condizione per il motore.

Il canvas mantiene il rapporto d'aspetto del gioco; eventuali bande laterali appartengono al rendering originale, non a un renderer sostitutivo.

## Struttura

| File | Responsabilità |
|---|---|
| `launcher.mjs` | Chromium kiosk, navigazione runtime, init script e diagnostica |
| `menuDriver.mjs` | Percorso menu, scelte random e attese visive boot/download |
| `pageBootstrap.js` | Installazione pre-load e montaggio HUD nel MAIN world |
| `index.html` | Solo template HUD/admin, senza canvas o iframe |
| `styles.css` | Overlay fixed trasparente sopra il gioco |
| `bt3InputBridge.js` | Gamepad, eventi connessione, doppio canale tastiera e macro |
| `marketFeed.js` | Feed mercato, rolling pressure e hot-swap |
| `matchAutomator.js` | Round, random roster e memory adapter |
| `orchestrator.js` | Collegamento mercato → input reali, stato locale/cloud e gestione runtime |
| `broadcastUI.js` | HUD e Control Room F2 |
| `scripts/arenaServer.mjs` | Reverse proxy, API admin, SSE, healthcheck e avvio web |
| `cloudState.mjs` | Validazione, revisioni e persistenza atomica dello stato globale |
| `cloudClient.js` | Client HTTP/SSE same-origin per F2 e spettatori |
| `injectionBundle.mjs` | Bundle Playwright/web condiviso, alias PNG browser |
| `webBootstrap.js` | Automazione nel MAIN world del visitatore |
| `browserPageAdapter.js` | Interface `page`, input nativi-like, cattura WebGL RGBA |
| `matchMonitor.mjs` | Monitor HP/fine match condiviso fra launcher e web |
| `admin.html` | Control Room remoto `/admin` |
| `Dockerfile` / `cloud-stream.sh` | Container Xvfb/PulseAudio/FFmpeg e supervisione stream |

## Verifica

```bash
npm test
npm run check
npm run test:browser
bash -n cloud-stream.sh
node scripts/smokeWeb.mjs
BT3_SMOKE_HEADFUL=1 node scripts/smokeWeb.mjs --full
```

Su PowerShell la prova completa usa: `$env:BT3_SMOKE_HEADFUL=1; node scripts/smokeWeb.mjs --full`.

Per una validazione senza aprire una finestra visibile:

```bash
BT3_HEADLESS=1 npm run test:browser
```

Su PowerShell: `$env:BT3_HEADLESS=1; npm run test:browser`.

Il test browser esegue l'intero percorso fino al match e verifica runtime attivo, HUD nel DOM, canvas WebGL2, due pad da 16 bottoni/4 assi, bundle `running` e fase `fighting`. Salva `artifacts/dragonballbt3-direct.png` e `artifacts/dragonballbt3-combat.png`, quindi chiude Chromium. La fase logica non sostituisce il controllo visivo: apri la cattura e conferma che mostri i due modelli 3D, non il download o un menu.

Il normale `npm start` lascia invece Chromium aperto e salva `artifacts/dragonballbt3-live.png` dopo la stessa sequenza. Su Windows, `start-live.cmd` consente di avviarlo in una finestra separata registrando `artifacts/live-launcher.log`.

**Verifica visiva della finestra aperta:** gli screenshot Playwright possono catturare un frame WebGL precedente (per esempio il download anche quando il match è già iniziato). Per la verifica headful decisiva cattura il desktop/finestra dal sistema operativo e controlla `artifacts/live-window-current.png`: devono essere visibili i due personaggi 3D e l'HUD di combattimento. Su Windows con Python e Pillow:

```bash
python -c "from PIL import ImageGrab; ImageGrab.grab().save('artifacts/live-window-current.png')"
```

Non usare `artifacts/dragonballbt3-combat.png` come unica certificazione visiva del match.

Lo smoke web rapido verifica proxy reale, bundle, gamepad e RGBA. Quello `--full` completa titolo, Duello, roster, mappa e combattimento, salvando `artifacts/cloud-web-combat.png` direttamente dai pixel del canvas. Usa `BT3_SMOKE_HEADFUL=1`: la variante headless è utile solo al controllo di bootstrap/asset e può non renderizzare il 3D. Lo script chiude sempre browser e server al termine.
