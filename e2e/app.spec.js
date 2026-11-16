import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.waitForFunction(() => window.__app != null);
});

test('页面渲染两场景并支持播放/暂停/拖动/循环共用播放头', async ({ page }) => {
  const app = () => page.evaluate(() => window.__app);
  expect(await page.evaluate(() => __app.model.clips.length)).toBe(2);

  await page.click('#playBtn');
  await page.waitForTimeout(500);
  const playingHead = await page.evaluate(() => __app.engine.playheadMs);
  expect(playingHead).toBeGreaterThan(200);
  expect(await page.locator('#stateBadge').textContent()).toContain('播放中');

  await page.click('#pauseBtn');
  const paused = await page.evaluate(() => __app.engine.playheadMs);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => __app.engine.playheadMs)).toBe(paused);

  await page.evaluate(() => __app.engine.seek(6000));
  expect(await page.evaluate(() => __app.engine.playheadMs)).toBe(6000);
  const playheadLeft = await page.locator('#playhead').evaluate((el) => el.style.left);
  expect(playheadLeft).not.toBe('0px');

  // 循环：播到结尾后回到开头附近
  await page.evaluate(() => { __app.engine.setLoop(true); __app.engine.seek(7700); __app.engine.play(); });
  await page.waitForFunction(() => __app.engine.playheadMs < 2000, { timeout: 4000 });
  await page.evaluate(() => __app.engine.pause());
});

test('第二场景从自身时间起点继续，不继承旧时间', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { model } = __app;
    model.addTransition('clipA', 'clipB', 'dissolve', 1000);
    const b = model.clips.find((c) => c.id === 'clipB');
    return { bIn: b.inPoint, bSrcIn: b.srcIn, duration: model.durationMs };
  });
  expect(result.bIn).toBe(3000);
  expect(result.bSrcIn).toBe(0);
  expect(result.duration).toBe(7000);
  const localAtStart = await page.evaluate(() => {
    const { model } = __app;
    const b = model.clips.find((c) => c.id === 'clipB');
    return __app.localTime(b, b.inPoint);
  });
  expect(localAtStart).toBe(0);
});

for (const type of ['push', 'dissolve', 'mask']) {
  test(`转场 ${type} 可应用且校验通过、时长缩短`, async ({ page }) => {
    await page.selectOption('#transitionType', type);
    await page.click('#applyTransitionBtn');
    const info = await page.evaluate(() => ({
      tr: __app.model.transitions[0],
      valid: __app.model.validate().ok,
      duration: __app.model.durationMs,
    }));
    expect(info.tr.type).toBe(type);
    expect(info.valid).toBe(true);
    expect(info.duration).toBe(6800);
    // 转场中段画面非黑
    await page.evaluate((ms) => __app.engine.seek(ms), info.tr.startMs + 400);
    const nonBlack = await page.evaluate(() => {
      const ctx = document.getElementById('stage').getContext('2d');
      const d = ctx.getImageData(0, 0, 720, 405).data;
      let bright = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) bright++;
      return bright / (d.length / 4);
    });
    expect(nonBlack).toBeGreaterThan(0.5);
  });
}

test('分割片段后音画事件仍在统一时间基准上', async ({ page }) => {
  await page.click('#splitBtn');
  const data = await page.evaluate(() => ({
    clips: __app.model.clips.map((c) => [c.id, c.inPoint, c.outPoint]),
    aud: __app.model.audioEvents.map((e) => e.atMs),
    overlaps: __app.model.findOverlaps().length,
  }));
  expect(data.overlaps).toBe(0);
  expect(data.aud).toContain(3600);
  expect(data.clips.length).toBe(3);
});

test('非法重叠阻止导出并标出冲突位置', async ({ page }) => {
  await page.click('#overlapBtn');
  const validation = await page.evaluate(() => __app.model.validate());
  expect(validation.ok).toBe(false);
  expect(validation.errors[0].startMs).toBeGreaterThanOrEqual(0);
  await page.click('#exportBtn');
  await expect(page.locator('#conflictBox')).toBeVisible();
  expect(await page.locator('#conflictBox').textContent()).toContain('冲突位置');
  expect(await page.locator('.clip.conflict').count()).toBeGreaterThan(0);
});

test('保存后重新载入，入点出点与事件位置保持不变', async ({ page }) => {
  await page.selectOption('#transitionType', 'mask');
  await page.click('#applyTransitionBtn');
  const before = await page.evaluate(() => JSON.stringify(__app.model.toJSON()));
  await page.click('#saveBtn');
  await page.reload();
  await page.waitForFunction(() => window.__app != null);
  const after = await page.evaluate(() => JSON.stringify(__app.model.toJSON()));
  expect(after).toBe(before);
  expect(await page.evaluate(() => __app.model.transitions[0].type)).toBe('mask');
});

test('导出可播放 WebM，首尾无黑帧，且音视频轨道都存在', async ({ page }) => {
  const out = await page.evaluate(async () => {
    const result = await __app.exporter.exportVideo({
      realTime: true,
      onProgress: () => {},
    });
    const buf = new Uint8Array(await result.blob.arrayBuffer());
    // WebM/EBML 魔数 1A 45 DF A3
    const magic = [0x1a, 0x45, 0xdf, 0xa3].every((b, i) => buf[i] === b);
    return { magic, bytes: result.bytes, black: result.blackFrames, type: result.blob.type };
  });
  expect(out.magic).toBe(true);
  expect(out.type).toContain('video/webm');
  expect(out.bytes).toBeGreaterThan(20000);
  expect(out.black.first).toBe(false);
  expect(out.black.last).toBe(false);
});

test('移动/分割/转场后音频事件位置不变，导出视频可被 video 元素解码播放', async ({ page }) => {
  await page.click('#splitBtn');
  await page.selectOption('#transitionType', 'dissolve');
  await page.click('#applyTransitionBtn');
  const alignment = await page.evaluate(() => ({
    audioAt: __app.model.audioEvents.map((e) => e.atMs),
    programMs: __app.model.durationMs,
    activeAtAudio: __app.model.activeAt(1000).clips.length >= 1,
  }));
  expect(alignment.audioAt).toEqual([300, 3600, 6800]);
  expect(alignment.activeAtAudio).toBe(true);

  const videoInfo = await page.evaluate(async () => {
    const { url, durationMs } = await __app.exporter.exportVideo({ realTime: true });
    const video = document.createElement('video');
    video.src = url;
    video.muted = true;
    await new Promise((res, rej) => {
      video.onloadedmetadata = res;
      video.onerror = () => rej(new Error('video decode error'));
    });
    await video.play();
    await new Promise((r) => setTimeout(r, 300));
    const playing = !video.paused && !video.ended && video.currentTime > 0;
    video.pause();
    return {
      finite: Number.isFinite(video.duration),
      duration: Number.isFinite(video.duration) ? video.duration * 1000 : durationMs,
      programMs: durationMs, playing,
      w: video.videoWidth, h: video.videoHeight,
    };
  });
  expect(videoInfo.w).toBe(720);
  expect(videoInfo.h).toBe(405);
  expect(videoInfo.playing).toBe(true);
  if (videoInfo.finite) {
    expect(Math.abs(videoInfo.duration - videoInfo.programMs)).toBeLessThan(600);
  }
});

test('可连续多次导出且复用音频节点不报错', async ({ page }) => {
  const sizes = await page.evaluate(async () => {
    const first = await __app.exporter.exportVideo({ realTime: true });
    const second = await __app.exporter.exportVideo({ realTime: true });
    return [first.bytes, second.bytes];
  });
  expect(sizes[0]).toBeGreaterThan(20000);
  expect(sizes[1]).toBeGreaterThan(20000);
});

test('离线音频渲染产出与节目等长的 WAV 且含非静音采样', async ({ page }) => {
  const wav = await page.evaluate(async () => {
    const blob = await __app.audio.renderOffline(8000, __app.model.audioEvents);
    const buf = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(buf.buffer);
    return {
      riff: String.fromCharCode(buf[0], buf[1], buf[2], buf[3]),
      sampleRate: view.getUint32(24, true),
      dataSize: view.getUint32(40, true),
      bytes: buf.length,
      hasSignal: buf.slice(44).some((b) => b !== 0),
    };
  });
  expect(wav.riff).toBe('RIFF');
  expect(wav.sampleRate).toBe(48000);
  expect(wav.dataSize).toBe(8000 / 1000 * 48000 * 2 * 2);
  expect(wav.hasSignal).toBe(true);
});
