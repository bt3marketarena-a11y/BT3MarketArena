import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { buildStaticVercel } from '../scripts/build-static-vercel.mjs';

async function workspace(t) {
  const directory = await mkdtemp(path.join(process.cwd(), 'artifacts', 'static-vercel-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('la build Vercel genera home e runtime statici con bundle precompilato', async (t) => {
  const directory = await workspace(t);
  const source = '<!doctype html><html><head><meta charset="utf-8"><script src="/engine.js"></script></head><body><canvas id="canvas"></canvas></body></html>';
  await buildStaticVercel({
    fetchImpl: async () => new Response(source, { status: 200 }),
    outputDir: path.join(directory, 'public'),
    fallbackFile: path.join(directory, 'missing-fallback.html'),
  });
  const index = await readFile(path.join(directory, 'public', 'index.html'), 'utf8');
  const runtime = await readFile(path.join(directory, 'public', 'runtime.html'), 'utf8');
  const bundle = await readFile(path.join(directory, 'public', 'bt3-arena-bundle.js'), 'utf8');
  const admin = await readFile(path.join(directory, 'public', 'admin.html'), 'utf8');
  assert.ok(runtime.indexOf('<script src="/bt3-arena-bundle.js?v=') < runtime.indexOf('<script src="/engine.js">'));
  // La home è la pagina della diretta condivisa: niente motore né bundle, solo il player Kick.
  assert.match(index, /<iframe src="https:\/\/player\.kick\.com\/bt3marketarena\?autoplay=true&amp;muted=true"/);
  assert.match(index, /<meta name="twitter:card" content="summary_large_image">/);
  for (const tag of ['property="og:image"', 'name="twitter:image"']) assert.ok(index.includes(`${tag} content="https://bt-3-market-arena.vercel.app/og-preview.png"`), tag);
  assert.ok((await readFile(path.join(directory, 'public', 'og-preview.png'))).length > 10_000);
  assert.doesNotMatch(index, /bt3-arena-bundle|engine\.js|<canvas/);
  for (const tag of ['og:title', 'og:description', 'twitter:card']) assert.match(index, new RegExp(`(property|name)="${tag}"`));
  assert.match(index, /fetch\('\/api\/state'/);
  assert.match(index, /https:\/\/x\.com\/BT3MarketArena/);
  assert.match(index, /href="\/admin"/);
  assert.ok(bundle.length > 1000);
  assert.match(admin, /Market Arena/);
});

test('la build Vercel usa il fallback HTML locale se upstream è offline', async (t) => {
  const directory = await workspace(t);
  const fallbackFile = path.join(directory, 'runtime-fallback.html');
  const fallback = '<!doctype html><html><head></head><body><canvas id="canvas"></canvas></body></html>';
  await writeFile(fallbackFile, fallback);
  const result = await buildStaticVercel({
    fetchImpl: async () => { throw new Error('offline'); },
    outputDir: path.join(directory, 'public'),
    fallbackFile,
  });
  const runtime = await readFile(path.join(directory, 'public', 'runtime.html'), 'utf8');
  assert.equal(result.source, 'fallback');
  assert.match(runtime, /<canvas id="canvas">/);
  assert.match(runtime, /<script src="\/bt3-arena-bundle\.js\?v=[a-f0-9]{64}"><\/script>/);
});

test('la build Vercel versiona il bundle e pubblica un manifest verificabile', async (t) => {
  const directory = await workspace(t);
  const source = '<!doctype html><html><head><script src="/engine.js"></script></head><body><canvas></canvas></body></html>';
  await buildStaticVercel({
    fetchImpl: async () => new Response(source, { status: 200 }),
    outputDir: path.join(directory, 'public'),
    fallbackFile: path.join(directory, 'missing-fallback.html'),
    commit: 'test-commit',
    builtAt: '2026-11-01T00:00:00.000Z',
  });
  const index = await readFile(path.join(directory, 'public', 'runtime.html'), 'utf8');
  const bundle = await readFile(path.join(directory, 'public', 'bt3-arena-bundle.js'), 'utf8');
  const manifest = JSON.parse(await readFile(path.join(directory, 'public', 'build-manifest.json'), 'utf8'));
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256').update(bundle).digest('hex');
  assert.deepEqual(manifest, { commit: 'test-commit', bundleSha256: hash, builtAt: '2026-11-01T00:00:00.000Z' });
  assert.ok(index.includes(`/bt3-arena-bundle.js?v=${hash}`));
  assert.ok(index.includes('<meta name="bt3-build" content="test-commit">'));
  assert.ok(index.indexOf(`/bt3-arena-bundle.js?v=${hash}`) < index.indexOf('/engine.js'));
});
