import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { ContinuousOutput, buildFillerArgs, buildSessionArgs, createPacketAligner } from '../scripts/streamOutput.mjs';
import { SessionWatchdog, buildFfmpegArgs, redactStreamUrls } from '../scripts/stream-canvas-pipe.mjs';

const SCREEN_INPUTS = /gdigrab|ddagrab|x11grab|dshow|avfoundation|desktop/;
const PACKET = 188;

function fakeProcess() {
  const child = new EventEmitter();
  child.exitCode = null;
  child.pid = 1;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.received = [];
  child.stdin.on('data', (chunk) => child.received.push(chunk));
  child.killed = false;
  child.exit = (code = 0) => { child.exitCode = code; child.emit('exit', code); };
  child.kill = () => { child.killed = true; child.exit(0); };
  return child;
}

function setup() {
  const children = [];
  let clock = 1_000_000;
  const spawnImpl = (_path, args) => {
    const child = fakeProcess();
    child.args = args;
    child.role = args.includes('rtmp://kick/secret') ? 'master' : args.includes('anullsrc=r=44100:cl=stereo') ? 'filler' : 'session';
    if (child.role === 'session') child.stdin.on('finish', () => setImmediate(() => child.exit(0)));
    children.push(child);
    return child;
  };
  const output = new ContinuousOutput({
    ffmpegPath: 'ffmpeg', masterArgs: ['-i', 'pipe:0', 'rtmp://kick/secret'], fillerImage: 'cover.png', spawnImpl, now: () => clock,
  });
  return { output, children, advance: (ms) => { clock += ms; }, roles: (role) => children.filter((child) => child.role === role) };
}

const packets = (count, value) => Buffer.alloc(PACKET * count, value);
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('la diretta resta collegata mentre la sessione di gioco viene sostituita', async () => {
  const { output, roles, advance } = setup();
  output.start();
  const first = output.openSession();
  roles('session')[0].stdout.write(packets(2, 1));
  await tick();
  advance(60_000);
  await first.close();
  assert.equal(roles('master').length, 1);
  assert.equal(output.connected, true, 'il principale non viene mai chiuso dal riavvio');
  assert.equal(roles('filler').length, 1, 'parte la schermata di attesa');
  roles('filler')[0].stdout.write(packets(2, 2));
  await tick();

  advance(30_000);
  const second = output.openSession();
  assert.equal(roles('filler')[0].killed, false, 'l attesa resta in onda finché il gioco non invia dati');
  roles('session')[1].stdout.write(packets(2, 3));
  await tick();
  assert.equal(roles('filler')[0].killed, true);
  roles('filler')[0].stdout.write(packets(1, 9));
  await tick();
  const sent = Buffer.concat(roles('master')[0].received);
  assert.deepEqual([...new Set(sent)], [1, 2, 3], 'in ordine: gioco, attesa, gioco; nulla dopo lo stop');
  assert.equal(roles('master').length, 1, 'mai una seconda connessione');
  await second.close({ standby: false });
});

test('ogni sorgente continua la linea del tempo, così il principale non vede salti', async () => {
  const { output, roles, advance } = setup();
  output.start();
  advance(90_500);
  const session = output.openSession();
  const offset = (child) => Number(child.args[child.args.indexOf('-output_ts_offset') + 1]);
  assert.equal(offset(roles('session')[0]), 90.5);
  roles('session')[0].stdout.write(packets(1, 1));
  await tick();
  advance(10_000);
  await session.close();
  assert.equal(offset(roles('filler')[0]), 100.5);
});

test('senza standby, come a fine prova, non parte la schermata di attesa', async () => {
  const { output, roles } = setup();
  output.start();
  await output.openSession().close({ standby: false });
  assert.equal(roles('filler').length, 0);
});

test('se il principale cade la schermata si ferma e una nuova sessione si ricollega', async () => {
  const { output, roles } = setup();
  const done = output.start();
  await output.openSession().close();
  roles('master')[0].exit(1);
  assert.equal(await done, 1);
  assert.equal(output.connected, false);
  assert.equal(roles('filler')[0].killed, true);
  output.start();
  assert.equal(roles('master').length, 2);
  assert.equal(output.connected, true);
});

test('una sorgente fermata a metà pacchetto non sporca il flusso del principale', () => {
  const align = createPacketAligner();
  assert.equal(align(Buffer.alloc(100, 1)).length, 0);
  assert.equal(align(Buffer.alloc(100, 1)).length, PACKET, 'il pacchetto completo passa');
  assert.equal(align(Buffer.alloc(PACKET * 2, 2)).length, PACKET * 2, 'il resto resta fino al prossimo dato');
});

test('nessuna sorgente legge lo schermo: solo la scheda via stdin o la nostra immagine', () => {
  const session = buildSessionArgs({ offsetSec: 1 }).join(' ');
  assert.match(session, /-f webm -i pipe:0/);
  assert.equal(session.match(/ -i /g).length, 1);
  const filler = buildFillerArgs({ image: 'cover.png', offsetSec: 1 }).join(' ');
  assert.match(filler, /-i cover\.png/);
  assert.match(filler, /-f lavfi -i anullsrc/);
  const master = buildFfmpegArgs({ primary: 'rtmp://kick/secret' }).join(' ');
  for (const args of [session, filler, master]) assert.doesNotMatch(args, SCREEN_INPUTS);
  for (const args of [session, filler]) assert.doesNotMatch(args, /rtmp/, 'la destinazione resta solo nel principale');
});

test('gli URL con la stream key spariscono da log ed errori', () => {
  assert.equal(redactStreamUrls('errore su rtmps://ingest.example:443/app/sk_segreta: I/O'), 'errore su [destinazione nascosta] I/O');
  assert.equal(redactStreamUrls('RTMP://x/y'), '[destinazione nascosta]');
  assert.equal(redactStreamUrls('nessun url'), 'nessun url');
});

test('il filtro si applica anche a ciò che FFmpeg scrive su stderr', async () => {
  const child = fakeProcess();
  const written = [];
  const original = process.stderr.write;
  process.stderr.write = (text) => { written.push(String(text)); return true; };
  try {
    const output = new ContinuousOutput({ ffmpegPath: 'f', masterArgs: [], fillerImage: 'c', spawnImpl: () => child, filterLog: redactStreamUrls });
    output.start();
    child.stderr.write('Error opening rtmps://host/app/sk_segreta\n');
    await tick();
  } finally {
    process.stderr.write = original;
  }
  assert.equal(written.join('').includes('sk_segreta'), false);
});

function watchdog(options) {
  let at = 0;
  const dog = new SessionWatchdog({ now: () => at, ...options });
  return { dog, advance: (ms) => { at += ms; } };
}
const fighting = { phase: 'fighting', round: 1, menuSequence: 'completed' };

test('la pagina che non risponde più riapre la sessione', () => {
  const { dog, advance } = watchdog();
  let bytes = 0;
  assert.equal(dog.check(fighting, bytes += 1), null);
  advance(30_000);
  assert.equal(dog.check(null, bytes += 1), null, 'un controllo perso non basta');
  advance(20_000);
  assert.match(dog.check(null, bytes += 1), /pagina senza risposta/);
});

test('senza nuovi dati dalla scheda la sessione viene riaperta anche se la pagina risponde', () => {
  const { dog, advance } = watchdog();
  assert.equal(dog.check(fighting, 100), null);
  advance(46_000);
  assert.match(dog.check(fighting, 100), /nessun dato dalla scheda/);
});

test('i menu iniziali fermi senza errore non restano bloccati per sempre', () => {
  const { dog, advance } = watchdog();
  const boot = { phase: 'idle', round: 0, menuSequence: null };
  let bytes = 0;
  assert.equal(dog.check(boot, bytes += 1), null);
  for (let minute = 0; minute < 9; minute += 1) { advance(60_000); assert.equal(dog.check(boot, bytes += 1), null); }
  advance(61_000);
  assert.match(dog.check(boot, bytes += 1), /menu iniziali non completati/);
});

test('i limiti esistenti restano: 3 minuti fuori dal combattimento, 10 in combattimento', () => {
  const stuck = watchdog();
  let bytes = 0;
  const post = { phase: 'postmatch', round: 2, menuSequence: 'completed' };
  stuck.dog.check(post, bytes += 1);
  for (let i = 0; i < 18; i += 1) { stuck.advance(10_000); assert.equal(stuck.dog.check(post, bytes += 1), null); }
  stuck.advance(1_000);
  assert.match(stuck.dog.check(post, bytes += 1), /postmatch\/2 da oltre 3 minuti/);

  const long = watchdog();
  long.dog.check(fighting, bytes += 1);
  for (let i = 0; i < 60; i += 1) { long.advance(10_000); assert.equal(long.dog.check(fighting, bytes += 1), null); }
  long.advance(1_000);
  assert.match(long.dog.check(fighting, bytes += 1), /fighting\/1 da oltre 10 minuti/);
});

test('un errore dei menu prima del combattimento riapre subito, un cambio di round azzera il conteggio', () => {
  const { dog } = watchdog();
  assert.match(dog.check({ phase: 'idle', round: 0, menuSequence: null, automationError: 'Errore X\nstack' }, 1), /menu bloccati prima del combattimento \(Errore X\)/);
  const clean = watchdog();
  clean.dog.check(fighting, 1);
  clean.advance(590_000);
  clean.dog.check({ ...fighting, round: 2 }, 2);
  clean.advance(590_000);
  assert.equal(clean.dog.check({ ...fighting, round: 2 }, 3), null);
});
