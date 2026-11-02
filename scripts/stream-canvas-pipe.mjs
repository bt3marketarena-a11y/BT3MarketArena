// Streamer con GPU locale che non cattura mai lo schermo: video e audio escono dalla
// sola scheda di gioco (getDisplayMedia con preferCurrentTab, verificata come
// displaySurface "browser"), passano da MediaRecorder a Node e arrivano a FFmpeg via
// stdin. Desktop, altre finestre e altri monitor non sono raggiungibili da questa
// pipeline. Gli URL RTMP contengono la stream key: non vengono mai stampati.
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BACKGROUND_FLAGS, findChromeExecutable } from '../launcher.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_GAME_URL = 'https://bt-3-market-arena.vercel.app/runtime.html?hud=0&embedded=0&lang=it&env=BT3_SCALE%3D1%2CBT3_INTERP%3D0';

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
    // Unico ingresso: il WebM prodotto da MediaRecorder dentro la pagina.
    '-f', 'webm', '-i', 'pipe:0',
    '-map', '0:v:0', '-map', '0:a:0?',
    ...(durationSec > 0 ? ['-t', String(durationSec)] : []),
    '-vf', 'scale=1920:1080:flags=bicubic,fps=60',
    // Quick Sync sposta la codifica sulla GPU Intel: con libx264 la CPU condivisa rallentava il gioco.
    ...(encoder === 'h264_qsv'
      ? ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-look_ahead', '0', '-pix_fmt', 'nv12']
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p']),
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
  const probe = spawnSync(ffmpegPath, ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=60', '-t', '0.2', '-c:v', 'h264_qsv', '-f', 'null', '-'], { stdio: 'ignore' });
  return probe.status === 0 ? 'h264_qsv' : 'libx264';
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

export async function runSession(env = process.env) {
  const durationSec = Number(env.STREAM_DURATION_SEC) || 0;
  const ffmpegPath = findFfmpeg(env);
  const encoder = pickEncoder(ffmpegPath, env.STREAM_VIDEO_ENCODER);
  const ffmpegArgs = buildFfmpegArgs({
    primary: env.STREAM_RTMP_URL,
    secondary: env.STREAM_RTMP_URL_SECONDARY,
    durationSec,
    videoBitrate: env.STREAM_VIDEO_BITRATE || '6000k',
    encoder,
  });
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
      ...(headless ? ['--force-device-scale-factor=1', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] : []),
    ],
  });
  let ffmpeg = null;
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

    console.log(`[BT3 stream] encoder video: ${encoder}`);
    ffmpeg = spawn(ffmpegPath, ffmpegArgs, { cwd: ROOT, stdio: ['pipe', 'inherit', 'inherit'] });
    const ffmpegDone = new Promise((resolve) => ffmpeg.on('exit', (code) => resolve(code ?? 1)));
    // A fine registrazione FFmpeg chiude stdin mentre la pagina può ancora inviare chunk.
    ffmpeg.stdin.on('error', () => {});
    let bytes = 0;
    await page.exposeBinding('__bt3StreamChunk', async (_source, base64) => {
      if (!ffmpeg.stdin.writable) return;
      const chunk = Buffer.from(base64, 'base64');
      bytes += chunk.length;
      if (!ffmpeg.stdin.write(chunk)) await new Promise((resolve) => ffmpeg.stdin.once('drain', resolve));
    });
    let ended = null;
    await page.exposeBinding('__bt3StreamEnded', (_source, reason) => { ended = reason; ffmpeg.stdin.end(); });
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
    const watchdog = setInterval(async () => {
      const state = await readDiagnostics(page).catch(() => null);
      if (state?.automationError && state.menuSequence !== 'completed' && ffmpeg.exitCode === null) {
        console.error(`[BT3 stream] menu bloccati prima del combattimento: riavvio della sessione. ${String(state.automationError).split('\n')[0]}`);
        ended = 'menu bloccati';
        ffmpeg.stdin.end();
        setTimeout(() => ffmpeg.kill(), 5_000);
      }
    }, Number(env.STREAM_WATCHDOG_MS) || 10_000);
    const code = await ffmpegDone.finally(() => clearInterval(watchdog));
    const diagnostics = await readDiagnostics(page).catch(() => null);
    console.log(`[BT3 stream] FFmpeg terminato (${code}), ${bytes} byte dalla scheda${ended ? `, ${ended}` : ''}: ${JSON.stringify(diagnostics)}`);
    return { code, recorder, diagnostics, bytes };
  } finally {
    ffmpeg?.stdin.destroy();
    await browser.close().catch(() => {});
  }
}

async function main() {
  let stopping = false;
  process.on('SIGINT', () => { stopping = true; process.exit(0); });
  process.on('SIGTERM', () => { stopping = true; process.exit(0); });
  const once = Number(process.env.STREAM_DURATION_SEC) > 0;
  while (!stopping) {
    try {
      const { code } = await runSession();
      if (once) { process.exitCode = code; return; }
      console.error('[BT3 stream] Sessione terminata: riavvio tra 10 secondi.');
    } catch (error) {
      console.error(`[BT3 stream] ${error.message}`);
      if (once) { process.exitCode = 1; return; }
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void main();
}
