// Tiene la diretta collegata mentre il gioco si riapre. Un solo FFmpeg "principale" codifica
// e resta connesso alla destinazione; legge MPEG-TS da stdin, un formato che si può
// concatenare. A turno gli arrivano due sorgenti sostituibili: la sessione di gioco
// (WebM della sola scheda, convertito in TS) oppure la schermata d'attesa (un'immagine
// nostra). Nessuna delle due legge lo schermo. Gli URL RTMP restano negli argomenti del
// principale e non vengono mai stampati.
import { spawn } from 'node:child_process';

const TS_PACKET = 188;
const AUDIO_TS = ['-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2'];
// Ogni sorgente parte da questo istante sulla linea del tempo della diretta: così il
// principale vede orari sempre crescenti, senza salti fra una sorgente e l'altra.
const TIMELINE = (offsetSec) => ['-output_ts_offset', offsetSec.toFixed(3)];
const MPEGTS_PIPE = ['-f', 'mpegts', '-mpegts_flags', '+resend_headers', '-muxdelay', '0', '-muxpreload', '0', 'pipe:1'];

export function buildSessionArgs({ offsetSec = 0, copyVideo = true } = {}) {
  return [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'webm', '-i', 'pipe:0',
    '-map', '0:v:0', '-map', '0:a:0?',
    // H.264 passa così com'è: la codifica vera resta una sola, nel principale.
    '-c:v', ...(copyVideo ? ['copy'] : ['libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p']),
    ...AUDIO_TS,
    ...TIMELINE(offsetSec),
    ...MPEGTS_PIPE,
  ];
}

export function buildFillerArgs({ image, offsetSec = 0 } = {}) {
  if (!image) throw new Error('Serve un\'immagine per la schermata d\'attesa.');
  return [
    '-hide_banner', '-loglevel', 'error',
    '-re', '-loop', '1', '-framerate', '30', '-i', image,
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-vf', 'scale=1920:-2,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x05070d,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-g', '30', '-pix_fmt', 'yuv420p',
    ...AUDIO_TS,
    ...TIMELINE(offsetSec),
    ...MPEGTS_PIPE,
  ];
}

/** Passa al principale soltanto pacchetti TS interi: una sorgente fermata a metà non lo sporca. */
export function createPacketAligner() {
  let carry = Buffer.alloc(0);
  return (chunk) => {
    const data = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    const usable = data.length - (data.length % TS_PACKET);
    carry = data.subarray(usable);
    return data.subarray(0, usable);
  };
}

export class ContinuousOutput {
  constructor({ ffmpegPath, masterArgs, fillerImage, spawnImpl = spawn, now = Date.now, log = console.error, flushMs = 3_000, filterLog = (text) => text, onMasterStart = () => {} }) {
    this.ffmpegPath = ffmpegPath;
    this.masterArgs = masterArgs;
    this.fillerImage = fillerImage;
    this.spawn = spawnImpl;
    this.now = now;
    this.log = log;
    this.flushMs = flushMs;
    this.filterLog = filterLog;
    this.onMasterStart = onMasterStart;
    this.master = null;
    this.startedAt = 0;
    this.filler = null;
    this.session = null;
    this.activeSource = null;
    this.done = null;
  }

  get connected() {
    return Boolean(this.master) && this.master.exitCode === null;
  }

  offsetSec() {
    return (this.now() - this.startedAt) / 1000;
  }

  start() {
    if (this.connected) return this.done;
    this.startedAt = this.now();
    // stderr passa dal filtro: un errore di FFmpeg può ripetere l'URL con la stream key.
    const master = this.spawn(this.ffmpegPath, this.masterArgs, { stdio: ['pipe', 'inherit', 'pipe'] });
    this.master = master;
    master.stderr?.on('data', (chunk) => process.stderr.write(this.filterLog(chunk)));
    this.onMasterStart(master.pid);
    // Se FFmpeg si chiude, una scrittura in corso non deve far cadere Node.
    master.stdin.on('error', () => {});
    this.done = new Promise((resolve) => master.on('exit', (code) => {
      this.stopFiller();
      resolve(code ?? 1);
    }));
    return this.done;
  }

  /** Copia una sorgente nel principale finché resta quella attiva. */
  forward(source, { onFirstData = () => {} } = {}) {
    const align = createPacketAligner();
    let started = false;
    source.stdout.on('data', (chunk) => {
      if (!started) { started = true; onFirstData(); }
      if (this.activeSource !== source) return;
      const packets = align(chunk);
      if (!packets.length || !this.master?.stdin.writable) return;
      if (!this.master.stdin.write(packets)) {
        source.stdout.pause();
        this.master.stdin.once('drain', () => source.stdout.resume());
      }
    });
    source.stdout.on('error', () => {});
  }

  startFiller() {
    if (this.filler || !this.connected) return;
    const filler = this.spawn(this.ffmpegPath, buildFillerArgs({ image: this.fillerImage, offsetSec: this.offsetSec() }), { stdio: ['ignore', 'pipe', 'inherit'] });
    this.filler = filler;
    filler.on('error', (error) => this.log(`[BT3 stream] schermata d'attesa non avviata: ${error.message}`));
    filler.on('exit', () => { if (this.filler === filler) this.filler = null; });
    this.activeSource = filler;
    this.forward(filler);
  }

  stopFiller() {
    const filler = this.filler;
    this.filler = null;
    filler?.kill();
  }

  /** Apre la sessione di gioco: la schermata d'attesa resta in onda fino al suo primo dato. */
  openSession({ copyVideo = true } = {}) {
    const session = this.spawn(this.ffmpegPath, buildSessionArgs({ offsetSec: this.offsetSec(), copyVideo }), { stdio: ['pipe', 'pipe', 'inherit'] });
    this.session = session;
    session.stdin.on('error', () => {});
    const exited = new Promise((resolve) => session.on('exit', resolve));
    this.forward(session, {
      onFirstData: () => {
        if (this.session !== session) return;
        this.activeSource = session;
        this.stopFiller();
      },
    });
    return {
      get writable() { return session.stdin.writable; },
      write: (chunk) => session.stdin.write(chunk),
      once: (event, handler) => session.stdin.once(event, handler),
      /** Svuota la sessione e, se la diretta è ancora collegata, manda in onda l'attesa. */
      close: async ({ standby = true } = {}) => {
        session.stdin.end();
        const timer = setTimeout(() => session.kill(), this.flushMs);
        await exited;
        clearTimeout(timer);
        if (this.session === session) this.session = null;
        if (standby) this.startFiller();
        if (this.activeSource === session) this.activeSource = null;
      },
      // L'hard stop serve solo se il principale è già caduto.
      kill: () => session.kill(),
    };
  }

  /** Chiude davvero la diretta. Il principale finisce di codificare ciò che ha ricevuto. */
  async stop() {
    this.stopFiller();
    if (!this.connected) return this.done;
    this.master.stdin.end();
    const master = this.master;
    const timer = setTimeout(() => master.kill(), this.flushMs);
    const code = await this.done;
    clearTimeout(timer);
    return code;
  }
}
