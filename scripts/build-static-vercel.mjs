import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInjectionBundle } from '../injectionBundle.mjs';

const RUNTIME_URL = 'https://dragonballbt3.online/runtime.html?hud=0&embedded=0&lang=it&env=BT3_SCALE%3D1%2CBT3_INTERP%3D0';

function escapeAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function injectExternalBundle(html, { bundleSha256, commit }) {
  const injection = `<meta name="bt3-build" content="${escapeAttribute(commit)}"><script src="/bt3-arena-bundle.js?v=${bundleSha256}"></script>`;
  if (/<head(?:\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${injection}`);
  }
  return `${injection}${html}`;
}

export async function buildStaticVercel({
  fetchImpl = globalThis.fetch,
  outputDir = fileURLToPath(new URL('../public/', import.meta.url)),
  fallbackFile = fileURLToPath(new URL('../templates/runtime.fallback.html', import.meta.url)),
  commit = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT ?? 'local',
  builtAt = new Date().toISOString(),
} = {}) {
  let html;
  let source = 'upstream';
  try {
    const response = await fetchImpl(RUNTIME_URL, { signal: AbortSignal.timeout(45_000) });
    if (!response.ok) throw new Error(`Runtime upstream HTTP ${response.status}`);
    html = await response.text();
    if (!/<head(?:\s[^>]*)?>/i.test(html) || !/<canvas\b/i.test(html)) throw new Error('HTML runtime upstream non valido.');
  } catch (error) {
    html = await readFile(fallbackFile, 'utf8');
    source = 'fallback';
    console.warn(`[BT3 static] Upstream non disponibile (${error.message}); uso il fallback locale.`);
  }

  const bundle = await createInjectionBundle({ web: true, cloudSync: { enabled: true } });
  const bundleSha256 = createHash('sha256').update(bundle).digest('hex');
  const manifest = { commit: String(commit), bundleSha256, builtAt };
  const injected = injectExternalBundle(html, manifest);
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(outputDir, 'index.html'), injected),
    writeFile(path.join(outputDir, 'runtime.html'), injected),
    writeFile(path.join(outputDir, 'bt3-arena-bundle.js'), bundle),
    writeFile(path.join(outputDir, 'build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`),
    copyFile(new URL('../admin.html', import.meta.url), path.join(outputDir, 'admin.html')),
  ]);
  return { source, outputDir, manifest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await buildStaticVercel();
  console.log(`[BT3 static] Build completata da ${result.source}: ${result.outputDir} bundle=${result.manifest.bundleSha256}`);
}
