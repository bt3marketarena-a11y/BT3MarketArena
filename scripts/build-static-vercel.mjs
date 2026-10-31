import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInjectionBundle } from '../injectionBundle.mjs';

const RUNTIME_URL = 'https://dragonballbt3.online/runtime.html?hud=0&embedded=0&lang=it&env=BT3_SCALE%3D1%2CBT3_INTERP%3D0';
const BUNDLE_TAG = '<script src="/bt3-arena-bundle.js"></script>';

function injectExternalBundle(html) {
  if (/<head(?:\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${BUNDLE_TAG}`);
  }
  return `${BUNDLE_TAG}${html}`;
}

export async function buildStaticVercel({
  fetchImpl = globalThis.fetch,
  outputDir = fileURLToPath(new URL('../public/', import.meta.url)),
  fallbackFile = fileURLToPath(new URL('../templates/runtime.fallback.html', import.meta.url)),
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
  const injected = injectExternalBundle(html);
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(outputDir, 'index.html'), injected),
    writeFile(path.join(outputDir, 'runtime.html'), injected),
    writeFile(path.join(outputDir, 'bt3-arena-bundle.js'), bundle),
    copyFile(new URL('../admin.html', import.meta.url), path.join(outputDir, 'admin.html')),
  ]);
  return { source, outputDir };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await buildStaticVercel();
  console.log(`[BT3 static] Build completata da ${result.source}: ${result.outputDir}`);
}
