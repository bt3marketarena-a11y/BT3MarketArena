# BT3 Direct Injection Implementation Plan

**Goal:** Run the real dragonballbt3.online WebGL2 engine with pre-load virtual controllers and an injected crypto HUD.

**Architecture:** Playwright context init script, direct top-level runtime navigation and an esbuild IIFE bundle. No local rendering surface.

## Completed tasks

- [x] Remove the previous local renderer and iframe architecture.
- [x] Add 16-button/4-axis pads, connection events and dual keyboard dispatch.
- [x] Build `pageBootstrap.js` and `launcher.mjs` with kiosk 1920×1080.
- [x] Detect and promote `runtime.html`, then validate WebGL2/HUD/gamepads.
- [x] Update README and HANDOFF for direct injection.

## Verification commands

```bash
npm test
npm run check
npm run test:browser
```
