import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('il Dockerfile contiene Chromium, Xvfb, PulseAudio e FFmpeg', async () => {
  const dockerfile = await read('Dockerfile');
  assert.match(dockerfile, /FROM node:/);
  assert.match(dockerfile, /playwright install --with-deps chromium/);
  assert.match(dockerfile, /xvfb/);
  assert.match(dockerfile, /pulseaudio/);
  assert.match(dockerfile, /ffmpeg/);
  assert.match(dockerfile, /EXPOSE 3000/);
});

test('lo streamer avvia display, server e launcher calibrato prima di FFmpeg', async () => {
  const script = await read('cloud-stream.sh');
  assert.match(script, /Xvfb :99 -screen 0 1920x1080x24/);
  assert.match(script, /node scripts\/arenaServer\.mjs/);
  assert.match(script, /BT3_CLOUD_SYNC=1/);
  assert.match(script, /BT3_TARGET_URL=.*inject=0/);
  assert.match(script, /node launcher\.mjs/);
  assert.match(script, /x11grab/);
  assert.match(script, /-framerate 60/);
  assert.match(script, /-f pulse/);
  assert.match(script, /STREAM_RTMP_URL/);
  assert.match(script, /trap cleanup/);
  assert.doesNotMatch(script, /echo .*STREAM_RTMP_URL|set -x/);
});

test('una seconda destinazione RTMP opzionale usa tee con una sola codifica', async () => {
  const script = await read('cloud-stream.sh');
  assert.match(script, /STREAM_RTMP_URL_SECONDARY:-/);
  assert.match(script, /-f tee/);
  assert.match(script, /onfail=ignore/);
  assert.match(script, /"\$\{STREAM_FORMAT\[@\]\}" "\$STREAM_OUTPUT"/);
  assert.doesNotMatch(script, /-f flv "\$STREAM_RTMP_URL"/);
  assert.doesNotMatch(script, /echo .*(STREAM_OUTPUT|STREAM_RTMP_URL_SECONDARY)/);
});

test('il launcher attiva il client cloud solo quando richiesto dal container', async () => {
  const launcher = await read('launcher.mjs');
  assert.match(launcher, /BT3_CLOUD_SYNC === '1'/);
  assert.match(launcher, /BT3_CLOUD_BASE_URL/);
});
