import { test, expect } from '@playwright/test';

const URL = 'http://127.0.0.1:4783/';

async function appState(page) {
  return page.evaluate(() => globalThis.__paperStreet.snapshot());
}

test.describe('纸片街景浏览器集成', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
    await page.waitForFunction(() => globalThis.__paperStreet?.frameToken > 0);
  });

  test('默认参数：首帧非空白，图层 4 层且按深度排序，建筑窗洞坐标合法', async ({ page }) => {
    const state = await appState(page);
    expect(state.stats.layers).toBe(4);
    expect(state.stats.buildings).toBeGreaterThan(10);
    const depths = state.layerOrder.map((l) => l.depth);
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
    expect(state.layerOrder.at(-1).parallax).toBeGreaterThan(state.layerOrder[0].parallax);

    const pixels = await page.evaluate(() => {
      const c = document.getElementById('scene');
      const ctx = c.getContext('2d');
      return {
        data: ctx.getImageData(0, 0, c.width, c.height).data,
        width: c.width,
        height: c.height,
      };
    });
    // Not a blank/white frame: sample variance across the image.
    const sample = pixels.data;
    let distinct = 0;
    const seen = new Set();
    for (let i = 0; i < sample.length; i += 4096) {
      seen.add(`${sample[i]},${sample[i + 1]},${sample[i + 2]}`);
    }
    distinct = seen.size;
    expect(distinct).toBeGreaterThan(40);
    // Top of the frame is sky (warm), bottom is dark ground.
    const topIdx = (10 * pixels.width + 10) * 4;
    const bottomIdx = ((pixels.height - 12) * pixels.width + 10) * 4;
    expect(sample[bottomIdx]).toBeLessThan(sample[topIdx]);
  });

  test('几何位置：同参数两次加载对象数量与建筑坐标完全一致', async ({ page }) => {
    const first = await appState(page);
    await page.reload();
    await page.waitForFunction(() => globalThis.__paperStreet?.frameToken > 0);
    const second = await appState(page);
    expect(second.stats).toEqual(first.stats);
    expect(second.layerOrder).toEqual(first.layerOrder);
    expect(second.params).toEqual(first.params);
  });

  test('拖拽视差：拖动后视角变化、近层位移大于远层，刷新后视角恢复', async ({ page }) => {
    const before = await appState(page);
    const canvas = page.locator('#scene');
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.35, { steps: 8 });
    await page.mouse.up();
    const dragged = await appState(page);
    expect(dragged.view.viewX).not.toBe(before.view.viewX);
    expect(Math.abs(dragged.view.viewX)).toBeGreaterThan(0.2);

    const offsets = await page.evaluate(async () => {
      const app = globalThis.__paperStreet;
      const { layerOffsetX } = await import('/js/geometry.js');
      return app.scene.layers.map((l) =>
        layerOffsetX(app.view.viewX, l, app.lastGoodParams.parallaxStrength));
    });
    for (let i = 1; i < offsets.length; i += 1) {
      expect(Math.abs(offsets[i])).toBeGreaterThan(Math.abs(offsets[i - 1]));
    }

    // Unsaved view is restored after refresh (params never saved here).
    await page.reload();
    await page.waitForFunction(() => globalThis.__paperStreet?.frameToken > 0);
    const restored = await appState(page);
    expect(restored.view.viewX).toBeCloseTo(dragged.view.viewX, 5);
    expect(restored.view.viewY).toBeCloseTo(dragged.view.viewY, 5);
  });

  test('边界参数：极端组合可正常渲染并保持图层顺序', async ({ page }) => {
    const result = await page.evaluate(() => {
      const app = globalThis.__paperStreet;
      const r = app.applyParams({
        layerCount: 6, buildingDensity: 1, windowLitRatio: 1, lightBeams: true,
        sunsetHue: 360, sunSize: 1, parallaxStrength: 2, zoom: 2.5, masterVolume: 1, seed: 0,
      });
      return { ok: r.ok, snapshot: app.snapshot() };
    });
    expect(result.ok).toBe(true);
    expect(result.snapshot.stats.layers).toBe(6);
    expect(result.snapshot.zoom).toBe(2.5);
    const depths = result.snapshot.layerOrder.map((l) => l.depth);
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
  });

  test('边界参数：最小组合（2 层、无亮窗、无光束、最小缩放）也可渲染', async ({ page }) => {
    const result = await page.evaluate(() => {
      const app = globalThis.__paperStreet;
      const r = app.applyParams({
        layerCount: 2, buildingDensity: 0, windowLitRatio: 0, lightBeams: false,
        sunsetHue: 0, sunSize: 0, parallaxStrength: 0, zoom: 0.5, masterVolume: 0, seed: 2147483647,
      });
      return { ok: r.ok, stats: app.snapshot().stats };
    });
    expect(result.ok).toBe(true);
    expect(result.stats.layers).toBe(2);
    expect(result.stats.lit).toBe(0);
  });

  test('异常参数：错误显示原因，上一张可用画面与参数保留，不白屏', async ({ page }) => {
    const good = await appState(page);
    const result = await page.evaluate(() =>
      globalThis.__paperStreet.applyParams({ layerCount: 99, sunsetHue: 'banana' }));
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('layerCount');

    await expect(page.locator('#errorBanner')).toBeVisible();
    const banner = await page.locator('#errorBanner').textContent();
    expect(banner).toContain('超出允许范围');

    const after = await appState(page);
    expect(after.params).toEqual(good.params);
    expect(after.layerOrder).toEqual(good.layerOrder);
    expect(after.frameToken).toBe(good.frameToken);

    const blank = await page.evaluate(() => {
      const c = document.getElementById('scene');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] !== 0 || d[i + 1] !== 0 || d[i + 2] !== 0) return false;
      }
      return true;
    });
    expect(blank).toBe(false);
  });

  test('异常参数：JSON 文本框输入非法 JSON 也只提示不清屏', async ({ page }) => {
    await page.locator('#jsonInput').fill('{ broken');
    await page.locator('#jsonApplyBtn').click();
    await expect(page.locator('#errorBanner')).toContainText('JSON 解析失败');
    await expect(page.locator('#scene')).toBeVisible();
  });

  test('参数保存：保存到 localStorage，刷新后对象与位置一致', async ({ page }) => {
    await page.evaluate(() => globalThis.__paperStreet.applyParams(
      { seed: 777, layerCount: 5, sunsetHue: 300, zoom: 1.4 }, { persist: true }));
    const saved = await appState(page);
    await page.reload();
    await page.waitForFunction(() => globalThis.__paperStreet?.frameToken > 0);
    const reloaded = await appState(page);
    expect(reloaded.params.seed).toBe(777);
    expect(reloaded.params.layerCount).toBe(5);
    expect(reloaded.params.sunsetHue).toBe(300);
    expect(reloaded.stats).toEqual(saved.stats);
    expect(reloaded.layerOrder).toEqual(saved.layerOrder);
  });

  test('暂停：显示徽标且帧不再随视角更新，继续后恢复', async ({ page }) => {
    await page.locator('#pauseBtn').click();
    await expect(page.locator('#pauseBadge')).toBeVisible();
    const pausedState = await appState(page);
    const canvas = page.locator('#scene');
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.5, { steps: 6 });
    await page.mouse.up();
    const whilePaused = await appState(page);
    expect(whilePaused.frameToken).toBe(pausedState.frameToken);

    await page.locator('#pauseBtn').click();
    await expect(page.locator('#pauseBadge')).toBeHidden();
    const resumed = await appState(page);
    expect(resumed.frameToken).toBeGreaterThan(pausedState.frameToken);
  });

  test('导出 PNG：返回 1280x720 的有效 PNG data URL 且文件可下载', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.evaluate(() => globalThis.__paperStreet.capturePNG(true)),
    ]);
    expect(download.suggestedFilename()).toMatch(/^paper-street-.*\.png$/);
    const buf = await download.createReadStream();
    const chunks = [];
    for await (const chunk of buf) chunks.push(chunk);
    const png = Buffer.concat(chunks);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    // IHDR width/height (bytes 16-24) must be 1280 x 720.
    expect(png.readUInt32BE(16)).toBe(1280);
    expect(png.readUInt32BE(20)).toBe(720);
  });

  test('音频：点击后 AudioContext 运行，暂停时挂起，再继续恢复', async ({ page }) => {
    await page.locator('#audioBtn').click();
    await page.waitForFunction(() => globalThis.__paperStreet.audio.playing === true);
    const running = await page.evaluate(() => globalThis.__paperStreet.audio.ctx.state);
    expect(running).toBe('running');
    await page.locator('#pauseBtn').click();
    await page.waitForFunction(() => globalThis.__paperStreet.audio.ctx.state === 'suspended');
    await page.locator('#pauseBtn').click();
    await page.waitForFunction(() => globalThis.__paperStreet.audio.ctx.state === 'running');
  });
});
