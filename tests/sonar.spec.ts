import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

const APP = "http://127.0.0.1:4389";

test.beforeEach(async ({ page }) => {
  await page.goto(APP);
  await page.waitForFunction(() => Boolean(window.sonarLab));
});

test("scan exposes distinct L/R, band and delay dimensions", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.getByRole("button", { name: /发射声呐/ }).click();
  await expect(page.locator(".echo-item")).toHaveCount(4);
  await expect(page.locator("#battery-value")).toHaveText("87%");

  const state = await page.evaluate(() => window.sonarLab.getState());
  expect(state.discovered).toHaveLength(4);
  expect(new Set(state.contacts.map((contact: { pan: number }) => contact.pan.toFixed(2))).size).toBe(4);
  expect(new Set(state.contacts.map((contact: { delay: number }) => Math.round(contact.delay * 1000))).size).toBe(4);
  expect(new Set(state.contacts.map((contact: { profile: { freq: number } }) => contact.profile.freq)).size).toBe(4);
  expect(state.contacts.some((contact: { pan: number }) => contact.pan < -0.2)).toBeTruthy();
  expect(state.contacts.some((contact: { pan: number }) => contact.pan > 0.2)).toBeTruthy();

  await page.waitForTimeout(120);
  expect(state.activeNodes).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("pause removes every active node and leaves silence", async ({ page }) => {
  await page.getByRole("button", { name: /发射声呐/ }).click();
  await page.waitForTimeout(180);
  const paused = await page.evaluate(() => window.sonarLab.pause());
  expect(paused.activeNodes).toBe(0);
  await page.waitForTimeout(450);
  const state = await page.evaluate(() => window.sonarLab.getState());
  expect(state.activeNodes).toBe(0);
  expect(state.levels.left).toBeLessThan(0.0002);
  expect(state.levels.right).toBeLessThan(0.0002);
  await expect(page.locator("#audio-state")).toHaveText(/已暂停|尾音收束/);
});

test("save, reload, double export and replays without drift or tails", async ({ page }) => {
  await page.getByRole("button", { name: /发射声呐/ }).click();
  await page.waitForTimeout(120);
  const result = await page.evaluate(() => window.sonarLab.verify());
  expect(result.passed).toBe(true);
  expect(result.durationDrift).toBeLessThan(0.002);
  expect(result.peakDrift).toBeLessThan(0.001);
  expect(result.timingDrift).toBeLessThan(0.002);
  expect(result.tailRms).toBeLessThan(0.004);
  expect(result.activeNodes).toBe(0);
  expect(result.bands).toBeGreaterThanOrEqual(3);
  expect(result.delays).toBeGreaterThanOrEqual(3);
  await expect(page.locator("#verify-badge")).toHaveText("PASS");
  await expect(page.locator("#verify-channels")).toHaveText("2 · L/R");

  await page.waitForTimeout(250);
  const replayState = await page.evaluate(() => window.sonarLab.getState());
  expect(replayState.playing).toBe(true);
  expect(replayState.activeNodes).toBeGreaterThan(0);
  await page.evaluate(() => window.sonarLab.pause());
});

test("exported WAV has stereo PCM and a ten second duration", async ({ page }) => {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 WAV" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  const buffer = await readFile(path!);
  expect(buffer.toString("ascii", 0, 4)).toBe("RIFF");
  expect(buffer.toString("ascii", 8, 12)).toBe("WAVE");
  expect(buffer.readUInt16LE(22)).toBe(2);
  expect(buffer.readUInt32LE(24)).toBe(44100);
  expect(buffer.readUInt16LE(34)).toBe(16);
  const dataBytes = buffer.readUInt32LE(40);
  const duration = dataBytes / (44100 * 2 * 2);
  expect(duration).toBeGreaterThan(9.99);
  expect(duration).toBeLessThan(10.01);
  await expect(page.locator("#verify-duration")).toHaveText(/10\.000 s/);
  await expect(page.locator("#verify-channels")).toHaveText("2 · L/R");
});

test("three monitor paths and the full success state work", async ({ page }) => {
  await page.getByRole("button", { name: "旁路" }).click();
  await expect(page.locator('[data-monitor="bypass"]')).toHaveClass(/active/);
  let state = await page.evaluate(() => window.sonarLab.getState());
  expect(state.monitor).toBe("bypass");
  await page.evaluate(() => window.sonarLab.play());
  await page.waitForTimeout(260);
  state = await page.evaluate(() => window.sonarLab.getState());
  expect(state.activeNodes).toBeGreaterThan(0);

  await page.getByRole("button", { name: "静音" }).click();
  await expect(page.locator('[data-monitor="mute"]')).toHaveClass(/active/);
  await page.waitForTimeout(220);
  state = await page.evaluate(() => window.sonarLab.getState());
  expect(state.monitor).toBe("mute");
  expect(state.levels.left).toBeLessThan(0.00001);
  expect(state.levels.right).toBeLessThan(0.00001);

  await page.getByRole("button", { name: "主输出" }).click();
  await page.waitForTimeout(120);
  state = await page.evaluate(() => window.sonarLab.getState());
  expect(state.levels.left).toBeGreaterThan(0.00001);
  await page.evaluate(() => window.sonarLab.pause());
  await page.evaluate(() => window.sonarLab.markAllCorrect());
  await expect(page.locator("#sail-button")).toBeEnabled();
  await page.getByRole("button", { name: /驶出航道/ }).click();
  await expect(page.locator("#result-modal")).toBeVisible();
  await expect(page.getByText("航道已贯通")).toBeVisible();
  state = await page.evaluate(() => window.sonarLab.getState());
  expect(state.success).toBe(true);
});

test("parameter edits change stereo width and beat timing in the WAV", async ({ page }) => {
  const baseline = await page.evaluate(() => window.sonarLab.renderAnalysis());
  await page.evaluate(() =>
    window.sonarLab.setParams({ panWidth: 0.2, tempo: 100, master: 0.9, echoGain: 0.4 }),
  );
  const varied = await page.evaluate(() => window.sonarLab.renderAnalysis());
  const baselineSpread = Math.abs(baseline.peakLeft - baseline.peakRight);
  const variedSpread = Math.abs(varied.peakLeft - varied.peakRight);
  expect(Math.abs(baselineSpread - variedSpread)).toBeGreaterThan(0.05);
  expect(Math.abs(baseline.peakTimeLeft - varied.peakTimeLeft)).toBeGreaterThan(0.05);
  expect(varied.channels).toBe(2);
  expect(varied.peakLeft).toBeGreaterThan(0.01);
  expect(varied.peakRight).toBeGreaterThan(0.01);

  await page.evaluate(() => window.sonarLab.setMonitor("bypass"));
  const bypass = await page.evaluate(() => window.sonarLab.renderAnalysis());
  expect(Math.abs(bypass.rmsLeft - varied.rmsLeft)).toBeGreaterThan(0.001);
  await page.evaluate(() => window.sonarLab.setMonitor("main"));

  await page.getByRole("button", { name: "保存参数" }).click();
  await page.evaluate(() => window.sonarLab.setParams({ tempo: 60, panWidth: 1 }));
  await page.getByRole("button", { name: "重载并播放" }).click();
  await page.waitForTimeout(220);
  const loaded = await page.evaluate(() => window.sonarLab.getState());
  expect(loaded.params.tempo).toBe(100);
  expect(loaded.params.panWidth).toBeCloseTo(0.2, 2);
  expect(loaded.playing).toBe(true);
  await page.evaluate(() => window.sonarLab.pause());
});
