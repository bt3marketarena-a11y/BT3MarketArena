# BT3 Market Arena — Direct Injection Design

## Architettura approvata

Playwright apre `dragonballbt3.online`, attiva Play e promuove il runtime same-origin a pagina principale. Un bundle IIFE registrato con `context.addInitScript()` installa due gamepad prima degli script Emscripten e monta l'HUD nel DOM reale.

## Componenti

- `launcher.mjs`: Chromium kiosk 1920×1080, navigazione e diagnostica.
- `pageBootstrap.js`: pre-load bridge e bootstrap HUD.
- `bt3InputBridge.js`: due pad standard da 16 bottoni/4 assi, GamepadEvent, KeyboardEvent su window/canvas e macro 60 fps.
- `orchestrator.js`: mercato → macro, hot-swap feed e memory adapter.
- `index.html`/`styles.css`: solo overlay fixed, senza renderer o frame applicativi.

## Verifica

Test unitari, syntax check e navigazione Playwright sul runtime reale con controllo WebGL2, HUD e gamepad.
