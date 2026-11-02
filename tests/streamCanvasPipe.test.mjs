import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AUDIO_TAP_SCRIPT, IN_PAGE_RECORDER, buildFfmpegArgs, chromiumArgs, findFfmpeg } from '../scripts/stream-canvas-pipe.mjs';

const PRIMARY = 'rtmp://a.rtmp.youtube.com/live2/primary-key';
const SECONDARY = 'rtmps://va.pscp.tv:443/x/secondary-key';

test('FFmpeg riceve soltanto lo stream della scheda da stdin, mai lo schermo', () => {
  const joined = buildFfmpegArgs({ primary: PRIMARY }).join(' ');
  assert.match(joined, /-f webm -i pipe:0/);
  assert.equal(joined.match(/ -i /g).length, 1, 'un solo ingresso');
  assert.doesNotMatch(joined, /gdigrab|x11grab|dshow|ddagrab|desktop|lavfi/);
});

test('uscita 1080p60 H.264/AAC verso una o due destinazioni con tee', () => {
  const single = buildFfmpegArgs({ primary: PRIMARY });
  assert.match(single.join(' '), /fps=60.*-c:v libx264 .*-g 120 .*-c:a aac/);
  assert.deepEqual(single.slice(-3), ['-f', 'flv', PRIMARY]);
  const dual = buildFfmpegArgs({ primary: PRIMARY, secondary: SECONDARY });
  assert.deepEqual(dual.slice(-5), ['-flags', '+global_header', '-f', 'tee', `[f=flv:onfail=ignore]${PRIMARY}|[f=flv:onfail=ignore]${SECONDARY}`]);
  assert.deepEqual(buildFfmpegArgs({ primary: 'artifacts/test.mp4' }).slice(-3), ['-f', 'mp4', 'artifacts/test.mp4']);
  assert.throws(() => buildFfmpegArgs({}), /STREAM_RTMP_URL/);
});

test('Chromium resta attivo in secondo piano e accetta solo la scheda corrente', () => {
  const args = chromiumArgs();
  for (const flag of ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--auto-accept-this-tab-capture']) {
    assert.ok(args.includes(flag), flag);
  }
});

test('il registratore nella pagina rifiuta qualsiasi superficie diversa dalla scheda', () => {
  assert.match(IN_PAGE_RECORDER, /preferCurrentTab: true/);
  assert.match(IN_PAGE_RECORDER, /monitorTypeSurfaces: 'exclude'/);
  assert.match(IN_PAGE_RECORDER, /systemAudio: 'exclude'/);
  assert.match(IN_PAGE_RECORDER, /settings\.displaySurface !== 'browser'/);
});

test('FFMPEG_PATH ha la precedenza e gli URL RTMP non vengono stampati', async () => {
  assert.equal(findFfmpeg({ FFMPEG_PATH: 'C:\\tools\\ffmpeg.exe' }), 'C:\\tools\\ffmpeg.exe');
  const source = await readFile(new URL('../scripts/stream-canvas-pipe.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /console\.(log|error)\([^)]*(STREAM_RTMP_URL|ffmpegArgs|primary|secondary)/);
  assert.doesNotMatch(source, /gdigrab|CopyFromScreen|screenCapture/);
});

test('i chunk WebM vengono estratti dopo "base64," anche con virgole nel MIME', () => {
  assert.match(IN_PAGE_RECORDER, /url\.indexOf\('base64,'\) \+ 7/);
  assert.doesNotMatch(IN_PAGE_RECORDER, /split\(','\)/);
});

test('lo streamer usa headless con GPU e superficie reale per default', async () => {
  const source = await readFile(new URL('../scripts/stream-canvas-pipe.mjs', import.meta.url), 'utf8');
  assert.match(source, /const headless = env\.STREAM_HEADLESS !== '0'/);
  assert.match(source, /'--enable-gpu', '--use-angle=d3d11'/);
  assert.match(source, /Browser\.setWindowBounds/);
  assert.match(source, /headless \? \{ viewport: null \}/);
});

test('in headless l audio arriva da WebAudio e la codifica può usare Quick Sync', () => {
  assert.match(AUDIO_TAP_SCRIPT, /createMediaStreamDestination/);
  assert.match(AUDIO_TAP_SCRIPT, /target === this\.context\.destination/);
  assert.match(IN_PAGE_RECORDER, /audioSource: tap \? 'webaudio-tap' : 'tab'/);
  const qsv = buildFfmpegArgs({ primary: PRIMARY, encoder: 'h264_qsv' }).join(' ');
  assert.match(qsv, /-c:v h264_qsv .*-pix_fmt nv12/);
  assert.doesNotMatch(qsv, /libx264/);
});

test('su portatili ibridi gioco e codifica usano la GPU NVIDIA con priorità bassa', async () => {
  const nvenc = buildFfmpegArgs({ primary: PRIMARY, encoder: 'h264_nvenc' }).join(' ');
  assert.match(nvenc, /-hwaccel cuda -f webm -i pipe:0/);
  assert.match(nvenc, /-c:v h264_nvenc .*-rc cbr/);
  assert.doesNotMatch(buildFfmpegArgs({ primary: PRIMARY, encoder: 'h264_qsv' }).join(' '), /hwaccel/);
  const source = await readFile(new URL('../scripts/stream-canvas-pipe.mjs', import.meta.url), 'utf8');
  assert.match(source, /'--force_high_performance_gpu'/);
  assert.match(source, /for \(const encoder of \['h264_nvenc', 'h264_qsv'\]\)/);
  assert.match(source, /PRIORITY_BELOW_NORMAL/);
  assert.match(source, /lowerPriority\(ffmpeg\.pid, env\)/);
});

test('se i menu si bloccano prima del combattimento la sessione viene riaperta', async () => {
  const source = await readFile(new URL('../scripts/stream-canvas-pipe.mjs', import.meta.url), 'utf8');
  assert.match(source, /state\?\.automationError && state\.menuSequence !== 'completed'/);
  assert.match(source, /ffmpeg\.stdin\.end\(\);\s+setTimeout\(\(\) => ffmpeg\.kill\(\), 5_000\)/);
  assert.match(source, /console\.error\('\[BT3 stream\] Sessione terminata: riavvio tra 10 secondi\.'\)/);
});

test('la registrazione aspetta l AudioContext del gioco prima di partire', async () => {
  const source = await readFile(new URL('../scripts/stream-canvas-pipe.mjs', import.meta.url), 'utf8');
  const wait = source.indexOf('window.__BT3_AUDIO_TAPS__?.size > 0');
  assert.ok(wait > 0 && wait < source.indexOf('const recorder = await startTabRecorder(page);'));
});

test('una partita ferma nella stessa fase per oltre 10 minuti riapre la sessione', async () => {
  const source = await readFile(new URL('../scripts/stream-canvas-pipe.mjs', import.meta.url), 'utf8');
  assert.match(source, /const stallMs = Number\(env\.STREAM_STALL_MS\) \|\| 10 \* 60_000/);
  assert.match(source, /state\?\.menuSequence === 'completed' && Date\.now\(\) - lastChangeAt > stallMs/);
  assert.match(source, /round: window\.marketArena\?\.match\?\.round \?\? null/);
});
