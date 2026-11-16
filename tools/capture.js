// Renders the default and an extreme parameter set to PNG artifacts.
import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(root, 'artifacts');

const EXTREME = {
  seed: 2147483647,
  layerCount: 6,
  buildingDensity: 1,
  windowLitRatio: 1,
  lightBeams: true,
  sunsetHue: 360,
  sunSize: 1,
  parallaxStrength: 2,
  zoom: 2.5,
  masterVolume: 1,
};

const MINIMAL = {
  seed: 0,
  layerCount: 2,
  buildingDensity: 0,
  windowLitRatio: 0,
  lightBeams: false,
  sunsetHue: 0,
  sunSize: 0,
  parallaxStrength: 0,
  zoom: 0.5,
  masterVolume: 0,
};

async function dataUrlToBuffer(page, dataUrl) {
  return page.evaluate((url) => {
    const bin = atob(url.split(',')[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return Array.from(bytes);
  }, dataUrl);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:4783/', { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__paperStreet?.frameToken > 0);

async function shoot(name, patch, view) {
  await page.evaluate(({ patch, view }) => {
    const app = globalThis.__paperStreet;
    if (patch) app.applyParams(patch);
    if (view) app.setView(view.viewX, view.viewY);
  }, { patch, view });
  const { dataUrl, snapshot, pngBytes } = await page.evaluate(async () => {
    const app = globalThis.__paperStreet;
    const dataUrl = app.capturePNG(false);
    return { dataUrl, snapshot: app.snapshot() };
  }).then(async (res) => ({ ...res, pngBytes: await dataUrlToBuffer(page, res.dataUrl) }));
  const buf = Buffer.from(pngBytes);
  await writeFile(join(outDir, name), buf);
  return { name, size: buf.length, stats: snapshot.stats, params: snapshot.params };
}

await mkdir(outDir, { recursive: true });
const results = [];
results.push(await shoot('paper-street-default.png', null, { viewX: 0, viewY: 0 }));
results.push(await shoot('paper-street-extreme.png', EXTREME, { viewX: 0.85, viewY: -0.4 }));
results.push(await shoot('paper-street-minimal.png', MINIMAL, { viewX: -0.85, viewY: 0.4 }));

// Error-state demo: invalid params must keep the previous good frame
// and surface a reason banner instead of a white screen.
await page.evaluate(() => {
  const app = globalThis.__paperStreet;
  app.applyParams({ layerCount: 99, zoom: 'not-a-number' });
});
await page.screenshot({ path: join(outDir, 'paper-street-error-state.png'), fullPage: false });
const errorInfo = await page.evaluate(() => ({
  message: globalThis.__paperStreet.errorMessage,
  frameToken: globalThis.__paperStreet.frameToken,
}));
results.push({ name: 'paper-street-error-state.png', ...errorInfo });

await writeFile(join(outDir, 'capture-report.json'), JSON.stringify(results, null, 2));
await browser.close();
for (const r of results) {
  if (r.stats) {
    console.log(`${r.name}: ${r.size} bytes, layers=${r.stats.layers} buildings=${r.stats.buildings}`);
  } else {
    console.log(`${r.name}: ${r.message || 'error-state screenshot'}`);
  }
}
