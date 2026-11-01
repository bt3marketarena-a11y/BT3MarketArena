import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildFfmpegArgs, findFfmpeg, parseRegion } from '../scripts/stream-win.mjs';

const PRIMARY = 'rtmp://a.rtmp.youtube.com/live2/primary-key';
const SECONDARY = 'rtmps://va.pscp.tv:443/x/secondary-key';

test('lo streamer Windows codifica 1080p60 H.264/AAC verso una sola destinazione', () => {
  const args = buildFfmpegArgs({ primary: PRIMARY });
  const joined = args.join(' ');
  assert.match(joined, /-f gdigrab -framerate 60 -draw_mouse 0 -i desktop/);
  assert.match(joined, /scale=1920:1080/);
  assert.match(joined, /-c:v libx264 .*-b:v 6000k -maxrate 6000k -bufsize 12000k -g 120/);
  assert.match(joined, /-c:a aac -b:a 160k/);
  assert.deepEqual(args.slice(-3), ['-f', 'flv', PRIMARY]);
});

test('con la seconda destinazione usa tee con onfail=ignore e una sola codifica', () => {
  const args = buildFfmpegArgs({ primary: PRIMARY, secondary: SECONDARY });
  assert.deepEqual(args.slice(-5), ['-flags', '+global_header', '-f', 'tee', `[f=flv:onfail=ignore]${PRIMARY}|[f=flv:onfail=ignore]${SECONDARY}`]);
  assert.equal(args.filter((arg) => arg === 'libx264').length, 1);
});

test('senza dispositivo audio usa una traccia muta e mai il microfono', () => {
  const silent = buildFfmpegArgs({ primary: PRIMARY }).join(' ');
  assert.match(silent, /-f lavfi -i anullsrc/);
  assert.doesNotMatch(silent, /dshow/);
  const loopback = buildFfmpegArgs({ primary: PRIMARY, audioDevice: 'CABLE Output (VB-Audio Virtual Cable)' });
  assert.ok(loopback.includes('audio=CABLE Output (VB-Audio Virtual Cable)'));
});

test('senza STREAM_RTMP_URL lo streamer non parte', () => {
  assert.throws(() => buildFfmpegArgs({}), /STREAM_RTMP_URL/);
});

test('FFMPEG_PATH ha la precedenza sulla ricerca winget', () => {
  assert.equal(findFfmpeg({ FFMPEG_PATH: 'C:\\tools\\ffmpeg.exe' }), 'C:\\tools\\ffmpeg.exe');
});

test('lo script non stampa mai gli URL RTMP', async () => {
  const source = await readFile(new URL('../scripts/stream-win.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /console\.(log|error)\([^)]*(STREAM_RTMP_URL|primary|secondary|ffmpegArgs)/);
});

test('la cattura del desktop resta sul monitor principale indicato', () => {
  assert.deepEqual(parseRegion('0,0,1920x1080'), { x: 0, y: 0, width: 1920, height: 1080 });
  assert.equal(parseRegion('desktop'), null);
  const joined = buildFfmpegArgs({ primary: PRIMARY, region: { x: 0, y: 0, width: 1920, height: 1080 } }).join(' ');
  assert.match(joined, /-offset_x 0 -offset_y 0 -video_size 1920x1080 -i desktop/);
});
