// Streamer 24/7 nativo per Windows, equivalente a cloud-stream.sh senza Docker:
// server locale (stato CA dal deploy pubblico) + launcher kiosk + FFmpeg gdigrab.
// Gli URL RTMP contengono la stream key: non vengono mai stampati.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// gdigrab "desktop" copre tutti i monitor: con più schermi finirebbero in onda anche
// finestre private. La cattura resta sul monitor principale, dove si apre il kiosk.
export function parseRegion(value) {
  const match = /^(-?\d+),(-?\d+),(\d+)x(\d+)$/.exec(String(value ?? '').trim());
  return match ? { x: Number(match[1]), y: Number(match[2]), width: Number(match[3]), height: Number(match[4]) } : null;
}

export function primaryScreenRegion() {
  const script = 'Add-Type \'using System;using System.Runtime.InteropServices;public class P{[DllImport("user32.dll")]public static extern bool SetProcessDpiAwarenessContext(IntPtr v);[DllImport("user32.dll")]public static extern int GetSystemMetrics(int i);}\';'
    + '[P]::SetProcessDpiAwarenessContext([IntPtr](-4))|Out-Null;"0,0,{0}x{1}" -f [P]::GetSystemMetrics(0),[P]::GetSystemMetrics(1)';
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
  return parseRegion(result.stdout) ?? { x: 0, y: 0, width: 1920, height: 1080 };
}

export function buildFfmpegArgs({
  primary,
  secondary = '',
  audioDevice = '',
  capture = 'desktop',
  region = null,
  videoBitrate = '6000k',
  durationSec = 0,
} = {}) {
  if (!primary) throw new Error('Configura STREAM_RTMP_URL con la destinazione RTMP e la stream key.');
  const kbps = Number.parseInt(videoBitrate, 10);
  const audioInput = audioDevice
    ? ['-f', 'dshow', '-i', `audio=${audioDevice}`]
    // Nessun loopback di sistema configurato: traccia muta, mai il microfono per default.
    : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100'];
  const output = secondary
    // Una sola codifica; onfail=ignore evita che la caduta di un provider fermi l'altro.
    ? ['-flags', '+global_header', '-f', 'tee', `[f=flv:onfail=ignore]${primary}|[f=flv:onfail=ignore]${secondary}`]
    : ['-f', 'flv', primary];
  return [
    '-hide_banner', '-loglevel', 'warning',
    '-f', 'gdigrab', '-framerate', '60', '-draw_mouse', '0',
    ...(region ? ['-offset_x', String(region.x), '-offset_y', String(region.y), '-video_size', `${region.width}x${region.height}`] : []),
    '-i', capture,
    ...audioInput,
    '-map', '0:v', '-map', '1:a',
    ...(durationSec > 0 ? ['-t', String(durationSec)] : []),
    '-vf', 'scale=1920:1080:flags=bicubic,fps=60',
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p',
    '-b:v', videoBitrate, '-maxrate', videoBitrate, '-bufsize', `${kbps * 2}k`,
    '-g', '120', '-keyint_min', '120', '-sc_threshold', '0',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100',
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

async function waitForHealth(url, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('Server locale non raggiungibile su /healthz.');
}

async function main() {
  const env = process.env;
  const port = env.PORT || '3000';
  const ffmpegArgs = buildFfmpegArgs({
    primary: env.STREAM_RTMP_URL,
    secondary: env.STREAM_RTMP_URL_SECONDARY,
    audioDevice: env.STREAM_AUDIO_DEVICE,
    capture: env.STREAM_CAPTURE || 'desktop',
    // title=<finestra> cattura già una sola finestra; desktop va limitato al monitor principale.
    region: (env.STREAM_CAPTURE || 'desktop') === 'desktop' ? parseRegion(env.STREAM_CAPTURE_REGION) ?? primaryScreenRegion() : null,
    videoBitrate: env.STREAM_VIDEO_BITRATE || '6000k',
    durationSec: Number(env.STREAM_DURATION_SEC) || 0,
  });
  const ffmpegPath = findFfmpeg(env);
  const children = new Set();
  let stopping = false;
  const start = (command, args, extraEnv = {}, stdio = 'inherit') => {
    const child = spawn(command, args, { cwd: ROOT, env: { ...env, ...extraEnv }, stdio });
    children.add(child);
    child.on('exit', () => children.delete(child));
    return child;
  };
  const stop = (code = 0) => {
    stopping = true;
    for (const child of children) child.kill();
    process.exitCode = code;
  };
  process.on('SIGINT', () => stop(0));
  process.on('SIGTERM', () => stop(0));

  const server = start(process.execPath, ['scripts/arenaServer.mjs'], {
    PORT: port,
    CLOUD_STATE_ORIGIN: env.CLOUD_STATE_ORIGIN ?? 'https://bt-3-market-arena.vercel.app',
  });
  server.on('exit', () => { if (!stopping) { console.error('[BT3 stream] Il server HTTP si è arrestato.'); stop(1); } });
  await waitForHealth(`http://127.0.0.1:${port}/healthz`);

  // inject=0 evita il secondo bootstrap del proxy: il launcher possiede menu e monitor.
  // Un errore dei menu chiude il launcher: per la 24/7 lo si riapre, FFmpeg continua.
  const runLauncher = () => {
    if (stopping) return;
    const launcher = start(process.execPath, ['launcher.mjs'], {
      BT3_CLOUD_SYNC: '1',
      BT3_CLOUD_BASE_URL: '',
      BT3_TARGET_URL: `http://127.0.0.1:${port}/runtime.html?hud=0&embedded=0&lang=it&env=BT3_SCALE%3D1%2CBT3_INTERP%3D0&inject=0`,
    });
    launcher.on('exit', () => {
      if (stopping) return;
      console.error('[BT3 stream] Il launcher BT3 si è arrestato: riavvio tra 10 secondi.');
      setTimeout(runLauncher, 10_000);
    });
  };
  runLauncher();

  const destinations = env.STREAM_RTMP_URL_SECONDARY ? 2 : 1;
  const runFfmpeg = () => {
    if (stopping) return;
    console.log(`[BT3 stream] FFmpeg 1080p60 verso ${destinations} destinazione/i`);
    const ffmpeg = start(ffmpegPath, ffmpegArgs, {}, ['ignore', 'inherit', 'inherit']);
    ffmpeg.on('exit', (code) => {
      if (stopping) return;
      if (Number(env.STREAM_DURATION_SEC) > 0) { stop(code ?? 0); return; }
      console.error('[BT3 stream] FFmpeg disconnesso: nuovo tentativo tra 5 secondi.');
      setTimeout(runFfmpeg, 5_000);
    });
  };
  // Il launcher apre il kiosk e attende il boot: la cattura parte dopo la finestra.
  setTimeout(runFfmpeg, Number(env.STREAM_START_DELAY_MS) || 15_000);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`[BT3 stream] ${error.message}`);
    process.exit(1);
  });
}
