import { test, expect } from '@playwright/test';
import { probeWebm } from './webm-probe.js';

const FRAMES = 360; // 12s * 30fps

async function appState(page) {
  return page.evaluate(() => {
    const transport = window.__app.transport;
    return {
      time: transport.time,
      playing: transport.playing,
      frame: transport.frame,
    };
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__app));
});

test('play / pause / scrub / loop all drive the single shared timebase', async ({ page }) => {
  await page.click('#play-pause');
  await page.waitForFunction(() => window.__app.transport.playing === true);
  await page.waitForTimeout(400);
  const moving = await appState(page);
  expect(moving.time).toBeGreaterThan(0.2);
  await page.click('#play-pause');
  expect(await page.evaluate(() => window.__app.transport.playing)).toBe(false);

  await page.evaluate(() => window.__app.transport.seek(6.5));
  expect(await page.textContent('#time-readout')).toContain('6.50s');
  expect(await page.evaluate(() => window.__app.transport.frame)).toBe(195);

  await page.check('#loop-toggle');
  await page.evaluate(() => {
    const t = window.__app.transport;
    t.seek(11.95);
    t.play();
  });
  await page.waitForFunction(() => window.__app.transport.time < 1, { timeout: 4000 });
  expect(await page.evaluate(() => window.__app.transport.playing)).toBe(true);
});

test('editing data updates labels and ratio proportions on the canvas', async ({ page }) => {
  const before = await page.evaluate(() => window.__app.canvas.toDataURL().length);
  await page.fill('#data-rows .data-row:first-child input[data-field="label"]', '一季度');
  await page.fill('#data-rows .data-row:first-child input[data-field="value"]', '999');
  await page.waitForFunction(() => {
    const clip = window.__app.project.tracks.video[0];
    return clip.data.labels[0] === '一季度' && clip.data.series[0].values[0] === 999;
  });
  const after = await page.evaluate(() => window.__app.canvas.toDataURL().length);
  expect(before).not.toBe(after);
  const ratios = await page.evaluate(() => {
    const values = window.__app.project.tracks.video[0].data.series[0].values;
    const total = values.reduce((a, b) => a + b, 0);
    return values.map((v) => Number(((v / total) * 100).toFixed(1)));
  });
  expect(Math.round(ratios.reduce((a, b) => a + b, 0))).toBe(100);
});

test('move, split and transition keep audio events aligned with clip frames', async ({ page }) => {
  const report = await page.evaluate(async () => {
    const { absoluteAudioEvents, moveClip, splitClip, setTransitionDuration } =
      await import('/src/engine.js');
    const app = window.__app;
    const original = absoluteAudioEvents(app.project);

    const movedProject = moveClip(app.project, 'clip-b', 0.5);
    const movedEvents = absoluteAudioEvents(movedProject);
    const movedBeatB = movedEvents.find((e) => e.clipId === 'clip-b');

    app.applyProject(movedProject);
    const { project: splitProject, newClipId } = splitClip(app.project, 'clip-a', 3);
    const splitEvents = absoluteAudioEvents(splitProject);
    const splitACount = splitEvents.filter(
      (e) => e.clipId === 'clip-a' || e.clipId === newClipId,
    ).length;
    const originalACount = original.filter((e) => e.clipId === 'clip-a').length;

    const fadeProject = setTransitionDuration(splitProject, 'clip-b', 3);
    return {
      originalFirstB: original.find((e) => e.clipId === 'clip-b').time,
      movedFirstB: movedBeatB.time,
      splitACount,
      originalACount,
      totalEvents: splitEvents.length,
      fadeConflictCount: (await import('/src/engine.js')).validateProject(fadeProject).conflicts.length,
    };
  });
  expect(report.movedFirstB - report.originalFirstB).toBeCloseTo(0.5, 5);
  expect(report.splitACount).toBe(report.originalACount);
  expect(report.totalEvents).toBeGreaterThan(20);
  expect(report.fadeConflictCount).toBeGreaterThan(0);
});

test('save then reload preserves in/out points and audio event positions', async ({ page }) => {
  await page.evaluate(async () => {
    const { setTrim } = await import('/src/engine.js');
    const app = window.__app;
    app.applyProject(setTrim(app.project, 'clip-a', 1, 4));
    app.transport.seek(7.25);
    app.transport.saveToStorage();
  });
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__app));
  const restored = await page.evaluate(() => {
    const clip = window.__app.project.tracks.video.find((c) => c.id === 'clip-a');
    return {
      sourceIn: clip.sourceIn,
      sourceOut: clip.sourceOut,
      events: (() => {
        const clip2 = window.__app.project.tracks.video.find((c) => c.id === 'clip-a');
        return clip2.audioEvents.slice(0, 3).map((e) => e.time);
      })(),
    };
  });
  expect(restored.sourceIn).toBe(1);
  expect(restored.sourceOut).toBe(4);
  expect(restored.events).toEqual([0, 0.5, 1]);
});

test('illegal overlap blocks export and marks the conflict location', async ({ page }) => {
  await page.evaluate(async () => {
    const { moveClip } = await import('/src/engine.js');
    window.__app.applyProject(moveClip(window.__app.project, 'clip-b', -1.5));
  });
  await expect(page.locator('#conflict-box')).toBeVisible();
  await expect(page.locator('#export-btn')).toBeDisabled();
  const marks = page.locator('.tl-conflict-mark');
  await expect(marks).toHaveCount(1);
  const conflictText = await page.locator('#conflict-list').innerText();
  expect(conflictText).toContain('3.50s');
  expect(conflictText).toContain('illegal overlap');
});

test('exports a playable 360-frame WebM with no black edges and A/V alignment', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { exportWebM } = await import('/src/exporter.js');
    const app = window.__app;
    const output = await exportWebM(app.project, app.canvas, {
      onProgress: () => {},
    });
    const bytes = new Uint8Array(await output.blob.arrayBuffer());
    return {
      ...output,
      blob: undefined,
      bytes: Array.from(bytes),
      type: output.blob.type,
    };
  });

  expect(result.type).toContain('video/webm');
  expect(result.framesRequested).toBe(FRAMES);
  expect(result.frameCount).toBe(FRAMES);
  expect(result.alignment).toHaveLength(FRAMES);

  const probe = probeWebm(Uint8Array.from(result.bytes));
  // VP8 video frames land in BlockGroups; Opus audio in SimpleBlocks.
  expect(probe.blockGroups).toBe(FRAMES);
  expect(probe.simpleBlocks).toBeGreaterThan(100);
  expect(probe.trackNumbers.length).toBeGreaterThanOrEqual(2);
  expect(probe.clusterCount).toBeGreaterThan(1);

  expect(result.luma.first).toBeGreaterThan(12);
  expect(result.luma.last).toBeGreaterThan(12);

  const beatFrames = result.alignment.filter((entry) => entry.beats.length > 0);
  expect(beatFrames.length).toBeGreaterThan(20);
  const firstBeat = beatFrames[0];
  expect(firstBeat.beats[0].time).toBeCloseTo(firstBeat.time, 2);

  const canPlay = await page.evaluate(({ bytes, type, expectedDuration }) => new Promise((resolve) => {
    const blob = new Blob([Uint8Array.from(bytes)], { type });
    const el = document.createElement('video');
    el.src = URL.createObjectURL(blob);
    el.onloadedmetadata = () => {
      // Streaming WebM may report Infinity duration; prove real seekability
      // by jumping close to the expected end and decoding a frame there.
      el.currentTime = expectedDuration - 0.2;
    };
    el.onseeked = () => resolve({
      ok: true,
      duration: el.duration,
      seekable: el.seekable.length ? el.seekable.end(el.seekable.length - 1) : 0,
      reachedTime: el.currentTime,
      videoWidth: el.videoWidth,
      videoHeight: el.videoHeight,
    });
    el.onerror = () => resolve({ ok: false });
  }), { bytes: result.bytes, type: result.type, expectedDuration: 12 });
  expect(canPlay.ok).toBe(true);
  expect(canPlay.videoWidth).toBe(960);
  expect(canPlay.videoHeight).toBe(540);
  expect(canPlay.reachedTime).toBeGreaterThan(11.5);
  // Frame count itself is the authoritative duration evidence: 360 @ 30fps.
  expect(probe.clusterCount).toBeGreaterThan(1);
});

test('failed export supports replay, then a clean retry with all frames intact', async ({ page }) => {
  await page.evaluate(() => window.__app.transport.markPendingExport());
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__app));
  await expect(page.locator('#replay-panel')).toBeVisible();

  const failed = page.evaluate(async () => {
    const { exportWebM } = await import('/src/exporter.js');
    try {
      await exportWebM(window.__app.project, window.__app.canvas, { failOnAttempt: 1 });
      return 'unexpected success';
    } catch (error) {
      return error.message;
    }
  });
  expect(await failed).toContain('simulated export failure');

  const retry = await page.evaluate(async () => {
    const { exportWebM } = await import('/src/exporter.js');
    const output = await exportWebM(window.__app.project, window.__app.canvas);
    return {
      frames: output.framesRequested,
      luma: output.luma,
      audio: output.audioDurationSec,
    };
  });
  expect(retry.frames).toBe(FRAMES);
  expect(retry.luma.first).toBeGreaterThan(12);
  expect(retry.luma.last).toBeGreaterThan(12);
  expect(Math.abs(retry.audio - 12)).toBeLessThan(0.1);
});
