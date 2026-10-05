// Renders PWA PNG icons from the SVG favicon using headless Chromium.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const svg = readFileSync('public/favicon.svg', 'utf8');
const browser = await chromium.launch();
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0;background:#121318">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: `public/icon-${size}.png` });
  await page.close();
}
await browser.close();
