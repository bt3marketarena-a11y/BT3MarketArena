// Esporta l'immagine del post di lancio (1600x900) da launch.html.
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.join(here, 'launch.html')).href);
  await page.screenshot({ path: path.join(here, 'bt3-launch.png') });
} finally {
  await browser.close();
}
