// ui-shots.mjs — captures UI screenshots (default / extreme / error) into artifacts/.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:8123';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await page.screenshot({ path: 'artifacts/default-ui.png' });

// Extreme parameters via the UI, then screenshot.
await page.locator('#azimuth').fill('64');
await page.locator('#elevation').fill('9');
await page.locator('#softness').fill('0.9');
await page.locator('#strength').fill('0.82');
await page.locator('#length').fill('1.8');
await page.locator('#zoom').fill('1.06');
await page.locator('#panX').fill('36');
await page.locator('#panY').fill('14');
await page.waitForTimeout(400);
await page.screenshot({ path: 'artifacts/extreme-ui.png' });

// Error state: invalid input keeps the last good frame + shows reasons.
await page.locator('#azimuthNum').fill('110');
await page.locator('#elevationNum').fill('0');
await page.locator('#zoomNum').fill('5');
await page.waitForTimeout(300);
await page.screenshot({ path: 'artifacts/error-ui.png' });

await browser.close();
console.log('ui shots saved');
