# BT3 Market Arena: broadcast, combattimento e validazione visiva

## Obiettivo

Migliorare la versione web esistente senza sostituire il motore reale e senza cambiare i timing di navigazione già calibrati. Il Live Impact Feed deve essere interamente in inglese e non coprire stabilmente il gioco. I round devono continuare fino al KO reale e poi passare a Character Select. Il combattimento neutro deve alternare azioni riconoscibili invece di ripetere soltanto guardia e contrattacco.

## Approccio

Si usa una state machine visiva conservativa e una coreografia deterministica. Non si aggiungono OCR, servizi esterni o nuovi delay alla navigazione dei menu.

## Broadcast UI

- Le azioni del feed usano inglese: `breaks P2's counter!` e `ULTIMATE FINAL on P2!`; aggregazioni e timestamp usano formato inglese.
- Il feed è un pannello a tendina chiuso al primo avvio. La barra `LIVE IMPACT FEED` contiene un pulsante con stato `aria-expanded`; il contenitore generale resta `pointer-events:none`, mentre il solo pulsante usa `pointer-events:auto`.
- Aperto, il feed mantiene al massimo cinque eventi; chiuso, mostra soltanto la barra e non intercetta il gioco.
- La scelta non modifica market feed, input o stato del round.

## KO e post-match

- La sola assenza del timer non genera più un KO: menu di pausa e schermate come `Rushing Technique` possono nasconderlo mentre il match è ancora attivo.
- Il KO visivo richiede una barra HP presente e l'altra vuota in modo persistente, usando il detector esistente.
- Il timeout manuale resta disponibile soltanto se configurato con un valore positivo; il valore predefinito `0` disattiva il reset temporizzato.
- Al KO: fase `ko`, pad in idle, fase `postmatch`, quindi `runRematchSequence()` sceglie Character Select e riusa `runRosterSequence()` senza alterarne i delay.
- Una generazione di round e una transizione post-match condivisa impediscono doppie sequenze concorrenti.

## Coreografia

- Il modo `neutral` non esegue all'infinito `zCounterLoop`: uno scheduler alterna `rushCombo`, `sidestep`, `teleportCounter`, `blast2` e pause di guardia.
- `teleportCounter` combina guardia/direzione, Cross e un breve rush; non dichiara di leggere la posizione o il fotogramma dell'avversario.
- Gli eventi BUY/SELL mantengono la priorità e assegnano attack/vulnerable. Al termine dell'override torna la coreografia neutra.
- Il lock-on periodico esistente resta attivo in tutte le modalità non idle.

## Flag e diagnostica

`window.marketArena.features` espone booleani `autoMenu`, `autoRematch`, `cinematicCombat`, `visualKO`, tutti attivi per default. `setFeature(name, enabled)` accetta soltanto nomi noti e valori booleani, restituisce lo stato aggiornato e impedisce che la disattivazione lasci input premuti.

`window.marketArena.getVisualValidation()` restituisce un oggetto essenziale con flag, fase, round e ultimo esito visivo. `window.__BT3_MARKET_ARENA__.validation` conserva l'esito dei controlli per console e test. Il pannello F2 mostra i flag come checkbox e lo stato del bridge.

## Test e verifica

- Test unitari per inglese/tendina, macro nuove, scheduler, flag e timeout disattivato.
- Test di regressione: assenza del timer non produce KO; KO persistente produce una sola sequenza.
- Build e suite completa prima del deploy.
- Verifica online con screenshot: feed chiuso/aperto, combattimento reale, KO e Character Select. Nessun risultato visivo viene dichiarato senza screenshot osservato.
