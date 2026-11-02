// Esporta logo (400x400) e copertina X (1500x500) dai template HTML del brand.
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
try {
  for (const [name, width, height] of [['logo', 400, 400], ['cover', 1500, 500]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(path.join(here, `${name}.html`)).href);
    await page.screenshot({ path: path.join(here, `bt3-${name}.png`) });
    await page.close();
  }
} finally {
  await browser.close();
}
