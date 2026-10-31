import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

export async function createInjectionBundle({ web = false, cloudSync = { enabled: false } } = {}) {
  const [html, css] = await Promise.all([
    readFile(path.join(ROOT, 'index.html'), 'utf8'),
    readFile(path.join(ROOT, 'styles.css'), 'utf8'),
  ]);
  const body = html.match(/<body>([\s\S]*?)<\/body>/)?.[1];
  if (!body) throw new Error('Template overlay: elemento <body> non trovato.');

  const result = await build({
    absWorkingDir: ROOT,
    entryPoints: [web ? 'webBootstrap.js' : 'pageBootstrap.js'],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    minify: true,
    define: {
      __BT3_OVERLAY_HTML__: JSON.stringify(body),
      __BT3_OVERLAY_CSS__: JSON.stringify(css),
      __BT3_CLOUD_SYNC__: JSON.stringify(cloudSync),
    },
    plugins: web ? [{
      name: 'browser-rgba-png',
      setup(buildContext) {
        buildContext.onResolve({ filter: /^pngjs$/ }, () => ({ path: path.join(ROOT, 'browserPng.js') }));
      },
    }] : [],
  });
  return result.outputFiles[0].text;
}
