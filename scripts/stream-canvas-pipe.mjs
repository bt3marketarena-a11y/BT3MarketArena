// Streamer con GPU locale che non cattura mai lo schermo: video e audio escono dalla
// sola scheda di gioco (getDisplayMedia con preferCurrentTab, verificata come
// displaySurface "browser"), passano da MediaRecorder a Node e arrivano a FFmpeg via
// stdin. Desktop, altre finestre e altri monitor non sono raggiungibili da questa
// pipeline. Gli URL RTMP contengono la stream key: non vengono mai stampati.
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { appendFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BACKGROUND_FLAGS, findChromeExecutable } from '../launcher.mjs';
import { ContinuousOutput } from './streamOutput.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_GAME_URL = 'https://bt-3-market-arena.vercel.app/runtime.html?hud=0&embedded=0&lang=it&env=BT3_SCALE%3D1%2CBT3_INTERP%3D0';
const STANDBY_IMAGE = path.join(ROOT, 'templates', 'assets', 'cover.png');

/** Toglie qualsiasi URL di destinazione: contiene la stream key. */
export function redactStreamUrls(text) {
  return String(text).replace(/rtmps?:\/\/\S+/gi, '[destinazione nascosta]');
}

// Copia su file i messaggi della console: senza, a diretta chiusa non resta nessuna prova
// di ciò che è successo. artifacts/ è ignorata da git e il testo passa dal filtro.
function logToFile(file) {
  if (!file) return;
  mkdirSync(path.dirname(file), { recursive: true });
  for (const method of ['log', 'error']) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      const line = redactStreamUrls(args.join(' '));
      original(line);
      try { appendFileSync(file, `${new Date().toISOString()} ${line}\n`); } catch {}
    };
  }
}

/**
 * Decide se la sessione va riaperta. Copre anche i casi in cui la pagina non risponde più:
 * senza stato non si può sapere se il gioco è vivo, e senza nuovi dati dalla scheda la
 * diretta è ferma anche se la pagina sembra a posto.
 */
export class SessionWatchdog {
  constructor({ stallMs = 10 * 60_000, menuStallMs = 3 * 60_000, bootMs = 10 * 60_000, deadPageMs = 45_000, noDataMs = 45_000, now = Date.now } = {}) {
    Object.assign(this, { stallMs, menuStallMs, bootMs, deadPageMs, noDataMs, now });
    const start = now();
    this.startedAt = start;
    this.signature = '';
    this.lastChangeAt = start;
    this.lastStateAt = start;
    this.lastBytes = 0;
    this.lastDataAt = start;
  }

  check(state, bytes) {
    const at = this.now();
    if (bytes !== this.lastBytes) { this.lastBytes = bytes; this.lastDataAt = at; }
    if (at - this.lastDataAt > this.noDataMs) return `nessun dato dalla scheda da oltre ${Math.round(this.noDataMs / 1000)} secondi`;
    if (!state) {
      return at - this.lastStateAt > this.deadPageMs ? `pagina senza risposta da oltre ${Math.round(this.deadPageMs / 1000)} secondi` : null;
    }
    this.lastStateAt = at;
    if (state.automationError && state.menuSequence !== 'completed') {
      return `menu bloccati prima del combattimento (${String(state.automationError).split('\n')[0]})`;
    }
    const signature = `${state.phase}/${state.round}`;
    if (signature !== this.signature) { this.signature = signature; this.lastChangeAt = at; return null; }
    if (state.menuSequence !== 'completed') {
      return at - this.startedAt > this.bootMs ? `menu iniziali non completati in ${Math.round(this.bootMs / 60_000)} minuti` : null;
    }
    const limit = state.phase === 'fighting' ? this.stallMs : this.menuStallMs;
    return at - this.lastChangeAt > limit ? `partita ferma su ${signature} da oltre ${Math.round(limit / 60_000)} minuti` : null;
  }
}

export function chromiumArgs({ windowPosition = '-2400,0' } = {}) {
  return [
    '--autoplay-policy=no-user-gesture-required',
    // Accetta soltanto la cattura della scheda corrente: nessun selettore di schermo o finestra.
    '--auto-accept-this-tab-capture',
    '--no-first-run', '--no-default-browser-check',
    `--window-position=${windowPosition}`, '--window-size=1920,1080',
    ...BACKGROUND_FLAGS,
  ];
}

export function buildFfmpegArgs({ primary, secondary = '', durationSec = 0, videoBitrate = '6000k', encoder = 'libx264' } = {}) {
  if (!primary) throw new Error('Configura STREAM_RTMP_URL con la destinazione RTMP e la stream key.');
  const kbps = Number.parseInt(videoBitrate, 10);
  const fileFormat = (target) => (/\.mp4$/i.test(target) ? 'mp4' : 'flv');
  const output = secondary
    ? ['-flags', '+global_header', '-f', 'tee', `[f=${fileFormat(primary)}:onfail=ignore]${primary}|[f=${fileFormat(secondary)}:onfail=ignore]${secondary}`]
    : [...(fileFormat(primary) === 'mp4' ? ['-movflags', '+faststart'] : []), '-f', fileFormat(primary), primary];
  return [
    '-hide_banner', '-loglevel', 'warning', '-y',
    // Unico ingresso: MPEG-TS da stdin, cioè la sola scheda oppure la schermata d'attesa
    // (vedi streamOutput.mjs). Con NVENC anche la decodifica resta sulla GPU NVIDIA.
    ...(encoder === 'h264_nvenc' ? ['-hwaccel', 'cuda'] : []),
    '-fflags', '+genpts+discardcorrupt', '-f', 'mpegts', '-i', 'pipe:0',
    '-map', '0:v:0', '-map', '0:a:0?',
    ...(durationSec > 0 ? ['-t', String(durationSec)] : []),
    '-vf', 'scale=1920:1080:flags=bicubic,fps=60',
    // Il cambio di sorgente può lasciare un attimo senza audio: si riempie di silenzio.
    '-af', 'aresample=async=1000',
    // NVENC usa la GPU dedicata e lascia libera la Intel che disegna il desktop; Quick Sync
    // resta il ripiego senza NVIDIA. Con libx264 la CPU condivisa rallentava il gioco.
    ...({
      h264_nvenc: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'll', '-rc', 'cbr', '-pix_fmt', 'yuv420p'],
      h264_qsv: ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-look_ahead', '0', '-pix_fmt', 'nv12'],
    }[encoder] ?? ['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p']),
    '-b:v', videoBitrate, '-maxrate', videoBitrate, '-bufsize', `${kbps * 2}k`,
    '-g', '120', '-keyint_min', '120', '-sc_threshold', '0',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2',
    ...output,
  ];
}

export function findFfmpeg(env = process.env) {
  if (env.FFMPEG_PATH) return env.FFMPEG_PATH;
  const packages = path.join(env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Packages');
  if (existsSync(packages)) {
    for (const entry of readdirSync(packages).filter((name) => name.startsWith('Gyan.FFmpeg'))) {
      for (const build of readdirSync(path.join(packages, entry))) {
        const candidate = path.join(packages, entry, build, 'bin', 'ffmpeg.exe');
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return 'ffmpeg';
}

export function pickEncoder(ffmpegPath, requested = '') {
  if (requested) return requested;
  for (const encoder of ['h264_nvenc', 'h264_qsv']) {
    const probe = spawnSync(ffmpegPath, ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=60', '-t', '0.2', '-c:v', encoder, '-f', 'null', '-'], { stdio: 'ignore' });
    if (probe.status === 0) return encoder;
  }
  return 'libx264';
}

// Prima del motore: tutto ciò che il gioco invia a AudioContext.destination viene duplicato
// in un MediaStreamAudioDestinationNode. In headless non esiste un'uscita audio, quindi la
// scheda catturata è muta: questa è la sorgente audio della diretta.
export const AUDIO_TAP_SCRIPT = `(() => {
  if (window.__BT3_AUDIO_TAPS__) return;
  const taps = new Map();
  window.__BT3_AUDIO_TAPS__ = taps;
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (target, ...rest) {
    const result = connect.call(this, target, ...rest);
    try {
      if (target && this.context && target === this.context.destination) {
        let tap = taps.get(this.context);
        if (!tap) { tap = this.context.createMediaStreamDestination(); taps.set(this.context, tap); }
        connect.call(this, tap, ...rest);
      }
    } catch {}
    return result;
  };
})();`;

// Eseguito nella pagina con gesto utente (CDP). Rifiuta qualsiasi superficie che non
// sia la scheda stessa e consegna i chunk WebM in ordine tramite __bt3StreamChunk.
export const IN_PAGE_RECORDER = `(async () => {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 60, max: 60 }, width: { ideal: 1920 }, height: { ideal: 1080 }, displaySurface: 'browser' },
    audio: { suppressLocalAudioPlayback: true },
    preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude', systemAudio: 'exclude', monitorTypeSurfaces: 'exclude',
  });
  const video = stream.getVideoTracks()[0];
  const settings = video.getSettings();
  if (settings.displaySurface !== 'browser') {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error('Superficie catturata non consentita: ' + settings.displaySurface);
  }
  const contexts = [...(window.__BT3_AUDIO_TAPS__ ?? new Map()).entries()];
  const running = contexts.filter(([context]) => context.state === 'running');
  const tap = (running.at(-1) ?? contexts.at(-1))?.[1];
  const audioTracks = tap ? tap.stream.getAudioTracks() : stream.getAudioTracks();
  if (tap) stream.getAudioTracks().forEach((track) => track.stop());
  const recorded = new MediaStream([video, ...audioTracks]);
  const mimeType = ['video/webm;codecs=h264,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type));
  const recorder = new MediaRecorder(recorded, { mimeType, videoBitsPerSecond: 16000000, audioBitsPerSecond: 192000 });
  let queue = Promise.resolve();
  const toBase64 = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    // Il MIME contiene virgole (codecs=h264,opus): i dati iniziano dopo "base64,".
    reader.onload = () => { const url = String(reader.result); resolve(url.slice(url.indexOf('base64,') + 7)); };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  recorder.ondataavailable = (event) => {
    if (!event.data.size) return;
    queue = queue.then(async () => window.__bt3StreamChunk(await toBase64(event.data)));
  };
  video.addEventListener('ended', () => window.__bt3StreamEnded('track ended'));
  recorder.start(200);
  window.__BT3_STREAM__ = { recorder, stream };
  return { mimeType, displaySurface: settings.displaySurface, width: settings.width, height: settings.height, frameRate: settings.frameRate,
    audioSource: tap ? 'webaudio-tap' : 'tab', audioTracks: audioTracks.length, audioContexts: contexts.map(([context]) => context.state) };
})()`;

async function startTabRecorder(page) {
  const cdp = await page.context().newCDPSession(page);
  const result = await cdp.send('Runtime.evaluate', { expression: IN_PAGE_RECORDER, awaitPromise: true, userGesture: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

async function readDiagnostics(page) {
  return page.evaluate(() => ({
    menuSequence: window.__BT3_MARKET_ARENA__?.menuSequence ?? null,
    automationError: window.__BT3_MARKET_ARENA__?.automationError ?? null,
    phase: window.marketArena?.match?.phase ?? null,
    round: window.marketArena?.match?.round ?? null,
    visibility: document.visibilityState,
    renderer: (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const info = gl?.getExtension('WEBGL_debug_renderer_info');
      return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null;
    })(),
    labSpeed: document.getElementById('lab-speed')?.textContent ?? null,
    presentFps: document.getElementById('hud')?.textContent ?? null,
  }));
}

export function createOutput(env = process.env) {
  const ffmpegPath = findFfmpeg(env);
  const encoder = pickEncoder(ffmpegPath, env.STREAM_VIDEO_ENCODER);
  const output = new ContinuousOutput({
    ffmpegPath,
    fillerImage: STANDBY_IMAGE,
    masterArgs: buildFfmpegArgs({
      primary: env.STREAM_RTMP_URL,
      secondary: env.STREAM_RTMP_URL_SECONDARY,
      durationSec: Number(env.STREAM_DURATION_SEC) || 0,
      videoBitrate: env.STREAM_VIDEO_BITRATE || '6000k',
      encoder,
    }),
    filterLog: redactStreamUrls,
    onMasterStart: (pid) => lowerPriority(pid, env),
  });
  console.log(`[BT3 stream] encoder video: ${encoder}`);
  return output;
}

export async function runSession(env = process.env, output = createOutput(env)) {
  const durationSec = Number(env.STREAM_DURATION_SEC) || 0;
  const executablePath = findChromeExecutable();
  // Headless: nessuna finestra sul desktop e superficie esattamente 1920x1080. Una finestra
  // reale viene ridotta da Windows all'area dello schermo (con scaling 125% ~1920x795 CSS)
  // e la cattura della scheda ne perderebbe la parte bassa con l'HUD.
  const headless = env.STREAM_HEADLESS !== '0';
  const browser = await chromium.launch({
    headless,
    ...(executablePath ? { executablePath } : {}),
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      ...chromiumArgs({ windowPosition: env.STREAM_WINDOW_POSITION || '-2400,0' }),
      ...(headless ? ['--force-device-scale-factor=1', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist',
        // Sui portatili ibridi il gioco va sulla GPU dedicata: la Intel integrata disegna il
        // desktop e, condivisa con lo streamer, rendeva lento tutto il PC.
        '--force_high_performance_gpu'] : []),
    ],
  });
  let session = null;
  try {
    // viewport null: la pagina usa la superficie reale, la stessa che riceve la cattura.
    const page = await browser.newPage(headless ? { viewport: null } : { viewport: { width: 1920, height: 1080 } });
    if (headless) {
      // --window-size include i bordi della finestra virtuale: si corregge della differenza misurata.
      const cdp = await page.context().newCDPSession(page);
      const { windowId, bounds } = await cdp.send('Browser.getWindowForTarget');
      const [width, height] = await page.evaluate(() => [innerWidth, innerHeight]);
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: bounds.width + 1920 - width, height: bounds.height + 1080 - height } });
    }
    page.on('console', (message) => {
      if (message.text().startsWith('[BT3')) console.log(`[browser] ${message.text()}`);
    });
    await page.addInitScript({ content: AUDIO_TAP_SCRIPT });
    await page.goto(env.BT3_GAME_URL || DEFAULT_GAME_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForFunction(() => window.__BT3_MARKET_ARENA__?.status === 'running', null, { timeout: 60_000 });
    if (env.STREAM_WAIT_FOR_FIGHTING === '1') {
      await page.waitForFunction(() => window.__BT3_MARKET_ARENA__?.menuSequence === 'completed' || window.__BT3_MARKET_ARENA__?.automationError,
        null, { timeout: Number(env.STREAM_START_TIMEOUT_MS) || 600_000 });
      const ready = await readDiagnostics(page);
      if (ready.automationError) throw new Error(ready.automationError);
      console.log(`[BT3 stream] combattimento raggiunto: ${JSON.stringify(ready)}`);
    }

    // Il principale resta collegato fra una sessione e l'altra: se è già vivo, qui in onda
    // c'è la schermata d'attesa e lascia il posto al gioco col primo dato della scheda.
    const outputDone = output.start();
    const copyVideo = await page.evaluate(() => MediaRecorder.isTypeSupported('video/webm;codecs=h264,opus'));
    session = output.openSession({ copyVideo });
    let bytes = 0;
    await page.exposeBinding('__bt3StreamChunk', async (_source, base64) => {
      if (!session.writable) return;
      const chunk = Buffer.from(base64, 'base64');
      bytes += chunk.length;
      if (!session.write(chunk)) await new Promise((resolve) => session.once('drain', resolve));
    });
    let ended = null;
    let endSession;
    const sessionEnded = new Promise((resolve) => { endSession = resolve; });
    const finish = (reason) => {
      if (ended) return;
      ended = reason;
      endSession();
    };
    await page.exposeBinding('__bt3StreamEnded', (_source, reason) => finish(reason));
    page.on('crash', () => finish('pagina del gioco terminata'));
    // In headless l'audio della scheda è muto: la registrazione parte quando il gioco ha
    // creato il suo AudioContext, così la sorgente è il tap WebAudio e non il silenzio.
    await page.waitForFunction(() => window.__BT3_AUDIO_TAPS__?.size > 0, null, { timeout: Number(env.STREAM_AUDIO_WAIT_MS) || 90_000 })
      .catch(() => console.error('[BT3 stream] AudioContext del gioco non ancora creato: audio della scheda come ripiego.'));
    const recorder = await startTabRecorder(page);
    console.log(`[BT3 stream] cattura della sola scheda: ${JSON.stringify(recorder)}`);
    if (env.STREAM_DEBUG_SCREENSHOT) {
      await page.waitForTimeout(1_500);
      await page.screenshot({ path: env.STREAM_DEBUG_SCREENSHOT });
    }

    // L'automazione nella pagina non riprova un errore dei menu prima del primo match:
    // la diretta resterebbe ferma su un menu. La sessione si chiude e il ciclo esterno
    // riapre il gioco da capo (la stream key resta nell'ambiente del processo).
    // Rete di sicurezza 24/7: un match dura al massimo ~5 minuti, quindi la stessa fase e
    // lo stesso round per oltre STREAM_STALL_MS indicano un blocco (menu non riconosciuto,
    // popup inatteso): si riapre il gioco invece di restare fermi in diretta.
    const watchdog = new SessionWatchdog({
      stallMs: Number(env.STREAM_STALL_MS) || undefined,
      // Fuori dal combattimento (menu, KO, post-partita) 3 minuti fermi sono già un blocco certo.
      menuStallMs: Number(env.STREAM_MENU_STALL_MS) || undefined,
    });
    const watchdogTimer = setInterval(async () => {
      const reason = watchdog.check(await readDiagnostics(page).catch(() => null), bytes);
      if (reason && !ended) {
        console.error(`[BT3 stream] ${reason}: riavvio della sessione.`);
        finish(reason);
      }
    }, Number(env.STREAM_WATCHDOG_MS) || 10_000);
    const code = await Promise.race([outputDone, sessionEnded.then(() => 0)]).finally(() => clearInterval(watchdogTimer));
    const diagnostics = await readDiagnostics(page).catch(() => null);
    console.log(`[BT3 stream] sessione chiusa (${code}), ${bytes} byte dalla scheda, diretta ${output.connected ? 'ancora collegata' : 'scollegata'}${ended ? `, ${ended}` : ''}: ${JSON.stringify(diagnostics)}`);
    return { code, recorder, diagnostics, bytes };
  } finally {
    // Prima la schermata d'attesa, poi la chiusura del browser: niente buchi in onda.
    await session?.close({ standby: durationSec === 0 });
    await browser.close().catch(() => {});
  }
}

// Priorità "sotto il normale": chi usa il PC durante la diretta ha sempre la precedenza.
// I processi figli (Chromium) la ereditano dal processo Node. STREAM_PRIORITY=normal la disattiva.
function lowerPriority(pid = 0, env = process.env) {
  if (env.STREAM_PRIORITY === 'normal') return;
  try { os.setPriority(pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
}

async function main() {
  lowerPriority();
  logToFile(process.env.STREAM_LOG_FILE ?? path.join(ROOT, 'artifacts', 'stream-live.log'));
  let stopping = false;
  process.on('SIGINT', () => { stopping = true; process.exit(0); });
  process.on('SIGTERM', () => { stopping = true; process.exit(0); });
  const once = Number(process.env.STREAM_DURATION_SEC) > 0;
  let output = null;
  while (!stopping) {
    try {
      output ??= createOutput();
      const { code } = await runSession(process.env, output);
      if (once) { await output.stop(); process.exitCode = code; return; }
      console.error(`[BT3 stream] Sessione terminata: riapro il gioco${output.connected ? ', la diretta resta collegata' : ' tra 10 secondi'}.`);
    } catch (error) {
      console.error(`[BT3 stream] ${redactStreamUrls(error.message)}`);
      if (once) { await output?.stop(); process.exitCode = 1; return; }
    }
    // Con la schermata d'attesa in onda conviene riaprire subito.
    await new Promise((resolve) => setTimeout(resolve, output?.connected ? 2_000 : 10_000));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void main();
}
