import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { buildWhipArgs, redactStreamUrls } from '../scripts/stream-canvas-pipe.mjs';
import { ContinuousOutput } from '../scripts/streamOutput.mjs';
import { startWhipProxy, stripIpv6Candidates } from '../scripts/whipProxy.mjs';

test('la risposta SDP perde solo i candidati IPv6', () => {
  const sdp = [
    'v=0',
    'a=candidate:1 1 udp 2130706431 143.223.92.178 50001 typ host',
    'a=candidate:2 1 udp 2130706431 2603:c026:c106:9a00:0:6d8f:b3b9:f923 50001 typ host',
    'a=candidate:3 1 tcp 1671430143 2603:c026::1 7881 typ host tcptype passive',
    'a=ice-ufrag:abc',
  ].join('\r\n');
  const clean = stripIpv6Candidates(sdp);
  assert.match(clean, /143\.223\.92\.178/);
  assert.doesNotMatch(clean, /2603:/);
  assert.match(clean, /a=ice-ufrag:abc/);
});

test('l intermediario WHIP inoltra offerta e chiave e riscrive la risorsa', async (t) => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), method: options.method, auth: options.headers.authorization });
    if (options.method === 'POST') {
      return new Response('v=0\r\na=candidate:9 1 udp 1 2603::1 5 typ host\r\na=candidate:8 1 udp 1 10.0.0.1 5 typ host\r\n', {
        status: 201, headers: { 'content-type': 'application/sdp', location: '/w/resource-1' },
      });
    }
    return new Response('', { status: 200 });
  };
  const proxy = await startWhipProxy({ target: 'https://whip.example/w', fetchImpl });
  t.after(() => proxy.close());
  assert.match(proxy.url, /^http:\/\/127\.0\.0\.1:\d+\/whip$/);
  const answer = await fetch(proxy.url, { method: 'POST', headers: { authorization: 'Bearer k', 'content-type': 'application/sdp' }, body: 'offer' });
  assert.equal(answer.status, 201);
  const text = await answer.text();
  assert.doesNotMatch(text, /2603::1/);
  assert.match(text, /10\.0\.0\.1/);
  assert.match(answer.headers.get('location'), /^http:\/\/127\.0\.0\.1:\d+\/resource$/);
  await fetch(answer.headers.get('location'), { method: 'DELETE' });
  assert.deepEqual(calls.map(({ url, method }) => `${method} ${url}`), ['POST https://whip.example/w', 'DELETE https://whip.example/w/resource-1']);
  assert.equal(calls[0].auth, 'Bearer k');
});

test('l uscita WHIP è 720p30 senza B-frame, Opus e buffer UDP ampio', () => {
  const args = buildWhipArgs({ url: 'http://127.0.0.1:5000/whip', token: 'segreto', encoder: 'h264_nvenc' }).join(' ');
  assert.match(args, /-f mpegts -i pipe:0/);
  assert.match(args, /scale=1280:720.*fps=30/);
  assert.match(args, /-bf 0/);
  assert.match(args, /-c:a libopus/);
  assert.match(args, /-ts_buffer_size 8388608 -authorization segreto -f whip http:\/\/127\.0\.0\.1:5000\/whip$/);
  assert.throws(() => buildWhipArgs({ url: 'http://evil.example/whip' }), /https/);
  assert.equal(redactStreamUrls('errore https://pump-prod.whip.livekit.cloud/w chiave segreto', ['segreto']), 'errore [destinazione nascosta] chiave [nascosto]');
  assert.equal(redactStreamUrls('caricato https://bt-3-market-arena.vercel.app/runtime.html'), 'caricato https://bt-3-market-arena.vercel.app/runtime.html');
});

function fakeProcess() {
  const child = new EventEmitter();
  child.exitCode = null;
  child.written = [];
  child.stdin = Object.assign(new EventEmitter(), {
    writable: true,
    writableLength: 0,
    write(chunk) { child.written.push(chunk); return true; },
    end() { this.writable = false; },
  });
  child.stdout = new EventEmitter();
  child.stdout.pause = () => {};
  child.stdout.resume = () => {};
  child.stderr = new EventEmitter();
  child.kill = () => { child.exitCode = 1; child.emit('exit', 1); };
  return child;
}

test('la seconda destinazione riceve gli stessi pacchetti e, se cade, il principale continua', () => {
  const spawned = [];
  const logs = [];
  const output = new ContinuousOutput({
    ffmpegPath: 'ffmpeg', masterArgs: ['master'], mirrorArgs: ['mirror'], mirrorRetryMs: 60_000, fillerImage: 'x.png',
    spawnImpl: (_path, args) => { const child = fakeProcess(); child.args = args; spawned.push(child); return child; },
    log: (line) => logs.push(line),
  });
  output.start();
  const [master, mirror] = spawned;
  assert.deepEqual([master.args, mirror.args], [['master'], ['mirror']]);
  const session = output.openSession();
  const sessionProcess = spawned.at(-1);
  sessionProcess.stdout.emit('data', Buffer.alloc(188 * 2, 0x47));
  assert.equal(master.written.length, 1);
  assert.equal(mirror.written.length, 1);
  mirror.kill();
  assert.equal(output.connected, true, 'il principale resta collegato');
  assert.match(logs.join('\n'), /seconda destinazione chiusa/);
  sessionProcess.stdout.emit('data', Buffer.alloc(188, 0x47));
  assert.equal(master.written.length, 2);
  clearTimeout(output.mirrorTimer);
  void session;
});
