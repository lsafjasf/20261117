import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '../..');
const mime = {
  '.html': 'text/html', '.js': 'text/javascript',
  '.css': 'text/css', '.wav': 'audio/wav',
};
const server = createServer(async (req, res) => {
  const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  try {
    const data = await readFile(join(root, path));
    res.writeHead(200, { 'content-type': mime[extname(path)] || 'text/plain' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
await page.click('#btnPlay');
await page.waitForTimeout(1200);
await page.click('#btnVerify');
await page.waitForSelector('#verifyResults table', { timeout: 60000 });
await page.click('#btnExport');
await page.waitForSelector('#downloadLink:not(.hidden)');
await page.waitForTimeout(300);
await page.screenshot({ path: join(root, 'test/screenshot.png'), fullPage: true });
console.log('screenshot saved, errors:', errors.length);
await browser.close();
server.close();
