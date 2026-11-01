# BT3 Market Arena — mobile, CA e rilascio 24/7

## Obiettivo

Rendere la pagina pubblica leggibile e utilizzabile da telefono, eliminare gli hint tastiera dall’esperienza spettatore, verificare che Vercel serva la build appena pubblicata e completare il flusso di inserimento del Contract Address dopo il lancio. Il progetto deve restare pronto per una diretta continua su YouTube e X tramite il container esistente.

Non vengono riscritti il motore, il bridge gamepad, i detector HP/KO o i timing dei menu già calibrati.

## Approccio

Si estende l’architettura attuale invece di introdurre un secondo frontend. Un intervento soltanto estetico non risolverebbe lo stato condiviso su Vercel; una riscrittura separata rischierebbe di duplicare `menuDriver` e `matchMonitor`. La patch resta quindi concentrata su HUD, controllo CA, distribuzione della build e supervisione dello streamer.

## HUD mobile-first e admin

Il canvas reale resta a schermo intero con rapporto d’aspetto preservato. L’HUD usa `clamp()`, unità relative al viewport e `env(safe-area-inset-*)`: il testo non può più ridursi ai valori di pochi pixel prodotti dalle attuali regole in soli `vw`.

Su schermi stretti l’HUD mostra una barra inferiore compatta con market cap, round e dominanza BUY/SELL. Il Live Impact Feed resta chiuso all’avvio e si apre come pannello a tendina ancorato in basso, con altezza massima limitata e scorrimento interno. Le HP originali del gioco restano libere in alto.

Le scritte `F2 // ADMIN` e il badge F2 vengono rimossi dal markup visibile. F2 continua a funzionare come scorciatoia desktop non pubblicizzata. Un pulsante admin con icona, etichetta accessibile e area touch minima di 44×44 CSS pixel apre lo stesso pannello; `/admin` resta disponibile come pagina indipendente. Il pannello usa un dialogo/bottom sheet touch-friendly, con CA e sorgente in primo piano e parametri RPC/memoria/test in una sezione avanzata chiusa.

Nessun comando testuale o simulazione di pulsanti di gioco viene aggiunto alla vista spettatore.

## Flusso Contract Address e dati reali

L’amministratore inserisce `ADMIN_KEY`, sorgente e mint Solana. Il client e il server validano il Base58 a 32–44 caratteri; la password resta soltanto nell’header della richiesta e non entra in storage, markup o log.

La mutazione segue questo ordine:

1. il server valida e salva una nuova revisione;
2. il client amministratore applica la risposta;
3. gli altri client ricevono la revisione via SSE dove supportato e tramite polling periodico di coerenza;
4. il vecchio feed viene fermato prima dell’attivazione del nuovo;
5. un numero di generazione invalida le risposte asincrone di connessioni precedenti, così due cambi CA ravvicinati non possono riattivare il feed vecchio;
6. il gioco, i gamepad e i menu non vengono ricaricati.

Prima di un CA valido la modalità resta `simulation`, con dati esplicitamente pre-lancio. Con `pumpportal` o `solana`, ogni trade reale BUY alimenta P1 e ogni SELL alimenta P2; con `dexscreener` gli eventi restano marcati come aggregati. Gli attacchi restano bloccati durante KO, risultati e menu. Market cap e prezzo aggiornano l’HUD senza presentare valori simulati come reali.

## Stato condiviso su Vercel

`api/state.mjs` usa un adattatore di storage. Quando sono configurate le credenziali REST di Redis/Upstash tramite Vercel Marketplace, lo stato e la revisione risiedono nello storage esterno e sono condivisi fra istanze. Il polling ogni due secondi garantisce la convergenza anche quando una Function diversa non riceve l’evento SSE.

Senza storage esterno resta disponibile la memoria locale per sviluppo e test, ma la risposta espone una modalità `memory` e la documentazione non promette persistenza o sincronizzazione globale. Il server Node esistente continua a usare `STATE_FILE` su volume e SSE immediato.

Gli errori di autenticazione, validazione, storage o connessione al feed vengono mostrati nell’admin senza chiudere il runtime. Un errore di rete non ripristina automaticamente dati simulati spacciandoli per live.

## Build Vercel verificabile

La build genera un manifest statico contenente commit, hash SHA-256 del bundle e timestamp. Lo script iniettato in `index.html` e `runtime.html` usa `/bt3-arena-bundle.js?v=<hash>`; il bundle resta immutabile, mentre HTML e manifest richiedono riconvalida. Il manifest è servito localmente e non viene inoltrato all’upstream.

Il runtime espone discretamente la stessa identità di build per diagnostica. La verifica post-deploy confronta commit del ramo, manifest pubblico e hash del bundle scaricato: HTTP 200 da solo non è considerato prova di aggiornamento.

## Recovery dei menu osservato

La prova pubblica ha mostrato una sessione `postmatch` ferma su `EXIT?` con `No` selezionato e l’errore “Menu dei risultati non visibile”. La patch aggiunge un recovery limitato e basato su frame riconosciuti: chiude il popup residuo su No, attende il menu risultati e riprende il percorso Character Select. Non vengono inviate conferme alla cieca né modificati i timing di roster, mappa o combattimento.

## Streaming 24/7

Vercel resta il frontend pubblico. Chromium, Xvfb, PulseAudio e FFmpeg restano nel container a lunga esecuzione. Lo script accetta una destinazione primaria e una secondaria opzionale per YouTube e X/provider RTMP, codificando una sola volta e duplicando l’output; la disconnessione attiva il retry controllato.

Nessuna diretta viene avviata durante i test senza URL e chiavi forniti dall’operatore. Le chiavi non vengono scritte nel repository o stampate nei log.

## Verifica e criteri di accettazione

- Test unitari per assenza degli hint, struttura responsive, area touch admin, manifest/hash, polling e hot-swap CA con risposte fuori ordine.
- Test API per autenticazione, validazione e adattatore Redis con fetch simulata; nessuna credenziale reale nei test.
- Regressioni esistenti su KO, EXIT, roster e mappa devono restare verdi, con un caso dedicato al popup EXIT residuo.
- Build e controlli sintattici completi, inclusa la sintassi di `cloud-stream.sh`.
- Prova browser desktop e mobile 390×844: nessun overflow orizzontale, testo HUD leggibile, feed chiuso/aperto e admin raggiungibile da tocco.
- Push automatico su `main`, attesa del deploy e confronto fra commit, manifest e hash pubblico.
- Nessuna affermazione di streaming attivo o persistenza globale senza rispettivamente chiavi RTMP e storage esterno configurati.
