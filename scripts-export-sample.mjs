import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => { throw e; });
await page.goto('http://localhost:8742/');
await page.waitForFunction(() => window.__app != null);

// 应用溶解转场后导出，覆盖转场合成路径。
await page.selectOption('#transitionType', 'dissolve');
await page.click('#applyTransitionBtn');

const sample = await page.evaluate(async () => {
  const out = await __app.exporter.exportVideo({ realTime: true });
  const buf = new Uint8Array(await out.blob.arrayBuffer());
  return {
    webm: Array.from(buf),
    black: out.blackFrames,
    bytes: out.bytes,
    durationMs: out.durationMs,
    project: __app.serialize(),
  };
});

await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/sample-timeline.webm', Buffer.from(sample.webm));
await writeFile('artifacts/sample-project.json', sample.project);
console.log(JSON.stringify({
  webmBytes: sample.bytes,
  durationMs: sample.durationMs,
  blackFrames: sample.black,
}, null, 2));
await browser.close();
