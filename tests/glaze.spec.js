const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');

async function setSlider(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function setHealthyParameters(page) {
  await setSlider(page, 'soak-time', 4.5);
  await setSlider(page, 'rotation-speed', 42);
  await setSlider(page, 'drip-speed', 0.6);
}

async function advance(page, seconds) {
  await page.evaluate((duration) => {
    const simulator = window.glazeLab.sim;
    let remaining = duration;
    while (remaining > 1e-9) {
      const slice = Math.min(0.1, remaining);
      simulator._advance(slice, { force: false, source: 'e2e' });
      remaining -= slice;
    }
  }, seconds);
}

async function startAndReachDrip(page, first = false) {
  if (first) {
    await page.locator('#primary-action').click();
  } else {
    await expect(page.locator('#primary-action')).toHaveText('开始浸釉');
    await page.locator('#primary-action').click();
  }
  await advance(page, 6.4);
  await expect(page.locator('#secondary-action')).toHaveText('完成当前件');
  await expect(page.locator('#secondary-action')).toBeEnabled();
}

test('normal batch supports pause, single-step, completion and CSV export', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/');
  await expect(page.locator('#stage')).toBeVisible();
  await expect(page.locator('#system-status')).toContainText('待机');
  await setHealthyParameters(page);

  await page.locator('#primary-action').click();
  await expect(page.locator('#phase-label')).toHaveText('沉浸上釉');
  await page.waitForTimeout(250);
  await page.locator('#pause-button').click();
  await expect(page.locator('#system-status')).toContainText('已暂停');

  const frozenAt = await page.evaluate(() => window.glazeLab.sim.simTime);
  const frozenState = await page.evaluate(() => ({
    energy: window.glazeLab.sim.energyKWh,
    cacheCount: window.glazeLab.sim.cache.length,
    cacheTime: window.glazeLab.sim.cache.at(-1).simTime
  }));
  await page.waitForTimeout(350);
  const stillFrozen = await page.evaluate(() => window.glazeLab.sim.simTime);
  const frozenAfter = await page.evaluate(() => ({
    energy: window.glazeLab.sim.energyKWh,
    cacheCount: window.glazeLab.sim.cache.length,
    cacheTime: window.glazeLab.sim.cache.at(-1).simTime
  }));
  expect(stillFrozen).toBeCloseTo(frozenAt, 5);
  expect(frozenAfter.energy).toBeCloseTo(frozenState.energy, 8);
  expect(frozenAfter.cacheCount).toBe(frozenState.cacheCount);
  expect(frozenAfter.cacheTime).toBe(frozenState.cacheTime);

  await page.locator('#step-button').click();
  const stepped = await page.evaluate(() => window.glazeLab.sim.simTime);
  expect(stepped - frozenAt).toBeCloseTo(0.1, 5);
  const pauseEvidence = await page.evaluate(() => {
    const sim = window.glazeLab.sim;
    return {
      paused: sim.paused,
      cacheCount: sim.cache.length,
      latestCacheTime: sim.cache.at(-1).simTime
    };
  });
  expect(pauseEvidence.paused).toBe(true);
  expect(pauseEvidence.cacheCount).toBeGreaterThan(0);

  await page.locator('#pause-button').click();
  await expect(page.locator('#system-status')).toContainText('生产中');
  await advance(page, 6.0);
  await expect(page.locator('#secondary-action')).toBeEnabled();
  await page.locator('#secondary-action').click();

  await startAndReachDrip(page);
  await page.locator('#secondary-action').click();
  await startAndReachDrip(page);
  await page.locator('#secondary-action').click();

  await expect(page.locator('#system-status')).toContainText('批次完成');
  await expect(page.locator('#metric-good')).toContainText('3');
  await expect(page.locator('#metric-yield')).toContainText('100%');
  await expect(page.locator('#log-count')).not.toHaveText('0 条');

  const report = await page.evaluate(() => window.glazeLab.buildJsonReport());
  expect(report.batch.goodCount).toBe(3);
  expect(report.batch.yieldRate).toBe(1);
  expect(report.summary.peakThickness).toBeGreaterThan(0);
  expect(report.summary.peakPowerW).toBeGreaterThanOrEqual(100);
  expect(report.events.some((entry) => entry.type === 'device-start')).toBeTruthy();
  expect(report.events.some((entry) => entry.type === 'device-stop')).toBeTruthy();
  expect(report.events.some((entry) => entry.type === 'param-change')).toBeTruthy();
  expect(report.events.some((entry) => entry.type === 'batch-result')).toBeTruthy();
  expect(report.cache.count).toBeGreaterThan(0);
  expect(report.cache.storage).toBe('memory-only');
  expect(errors).toEqual([]);

  await page.locator('#audio-toggle').click();
  await expect(page.locator('#audio-toggle')).toHaveAttribute('aria-pressed', 'true');
  const audioState = await page.evaluate(() => ({
    enabled: window.glazeLab.audio.enabled,
    state: window.glazeLab.audio.context.state,
    motorFrequency: window.glazeLab.audio.motorOsc.frequency.value
  }));
  expect(audioState.enabled).toBe(true);
  expect(audioState.state).toBe('running');
  expect(audioState.motorFrequency).toBeGreaterThan(0);
  await page.locator('#audio-toggle').click();
  await expect(page.locator('#audio-toggle')).toHaveAttribute('aria-pressed', 'false');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-csv').click();
  const download = await downloadPromise;
  const path = await download.path();
  const csv = await fs.readFile(path, 'utf8');
  expect(csv).toContain('good_count');
  expect(csv).toContain('peak_thickness_mm');
  expect(csv).toContain('batch-result');
  expect(csv).toContain('memory-only');
});

test('built-in validation runs normal, limit and shutdown flows with evidence', async ({ page }) => {
  await page.goto('/');
  await page.locator('#run-validation').click();
  await expect(page.locator('#run-validation')).toHaveText('运行全部验收', { timeout: 15000 });

  const report = await page.evaluate(() => window.glazeLab.sim.validation);
  expect(report.summary.allPassed).toBe(true);
  expect(report.summary.goodCount).toBe(9);
  expect(report.summary.finishedCount).toBe(9);
  expect(report.summary.yieldRate).toBe(1);
  expect(report.scenarios.map((scenario) => scenario.id)).toEqual(['normal', 'limit', 'stop']);
  expect(report.scenarios.every((scenario) => scenario.evidence.cacheCount > 0)).toBeTruthy();
  expect(report.scenarios.find((scenario) => scenario.id === 'limit').reading.rejected).toBe(true);
  expect(report.scenarios.find((scenario) => scenario.id === 'stop').result.stopReasons).toContain('旋转电机过流');
  expect(report.summary.stopReasons.join(' ')).toContain('参数越限');
  expect(report.summary.anomalyLocations.join(' ')).toContain('设备');

  await expect(page.locator('.validation-card')).toHaveCount(3);
  await expect(page.locator('.validation-card.fail')).toHaveCount(0);
  await expect(page.locator('#validation-yield')).toHaveText('100%');
  await expect(page.locator('#validation-list')).toContainText('12s');
  await expect(page.locator('#validation-list')).toContainText('旋转电机过流');
  await expect(page.locator('#event-log')).toContainText('流程验收');
});

test('manual limit and equipment stop record readings and recover the same batch', async ({ page }) => {
  await page.goto('/');
  await setHealthyParameters(page);
  await page.locator('#primary-action').click();
  await advance(page, 0.8);

  const limit = await page.evaluate(() => {
    const result = window.glazeLab.sim.setParameter('soakTime', 14, { source: 'e2e-limit' });
    const fault = window.glazeLab.sim.fault;
    return { result, fault };
  });
  expect(limit.result.ok).toBe(false);
  expect(limit.fault.reason).toContain('参数越限');
  await expect(page.locator('#system-status')).toContainText('设备停机');

  await page.locator('#primary-action').click();
  const recoveredLimit = await page.evaluate(() => ({
    fault: window.glazeLab.sim.fault,
    phase: window.glazeLab.sim.phase,
    recovery: window.glazeLab.sim.events.find((entry) => entry.type === 'equipment-recover')
  }));
  expect(recoveredLimit.fault).toBe(null);
  expect(recoveredLimit.phase).toBe('dip');
  expect(recoveredLimit.recovery.message).toContain('继续当前批次');

  await setHealthyParameters(page);
  await advance(page, 5.8);
  await expect(page.locator('#secondary-action')).toBeEnabled();
  await page.locator('#secondary-action').click();

  await startAndReachDrip(page);
  await advance(page, 0.4);
  await page.locator('#estop-button').click();
  await expect(page.locator('#system-status')).toContainText('设备停机');
  const stop = await page.evaluate(() => window.glazeLab.sim.fault);
  expect(stop.reason).toBe('人工设备急停');
  expect(stop.thickness).toBeGreaterThan(0);
  expect(stop.level).toBeGreaterThan(0);
  expect(stop.devices.pump).toBe(false);
  expect(stop.devices.motor).toBe(false);

  await page.locator('#primary-action').click();
  await advance(page, 5.9);
  await expect(page.locator('#secondary-action')).toBeEnabled();
  await page.locator('#secondary-action').click();
  await startAndReachDrip(page);
  await page.locator('#secondary-action').click();
  await expect(page.locator('#system-status')).toContainText('批次完成');

  const report = await page.evaluate(() => window.glazeLab.buildJsonReport());
  expect(report.summary.stopReasons).toContain('人工设备急停');
  expect(report.anomalyLocations.some((entry) => entry.location.includes('浸釉时长'))).toBeTruthy();
  expect(report.events.filter((entry) => entry.type === 'equipment-recover').length).toBeGreaterThanOrEqual(2);
  expect(report.events.filter((entry) => entry.type === 'emergency-stop').length).toBeGreaterThanOrEqual(2);
});

test('batch reset and page reload discard production state and cache', async ({ page }) => {
  await page.goto('/');
  await setHealthyParameters(page);
  await page.locator('#primary-action').click();
  await advance(page, 1.2);

  const beforeReset = await page.evaluate(() => ({
    cache: window.glazeLab.sim.cache.length,
    batch: window.glazeLab.sim.batch.id,
    storage: { ...localStorage }
  }));
  expect(beforeReset.cache).toBeGreaterThan(0);
  expect(Object.keys(beforeReset.storage)).toHaveLength(0);

  await page.locator('#reset-button').click();
  const afterReset = await page.evaluate(() => window.glazeLab.sim.getSummary());
  expect(afterReset.batchId).toBe(null);
  expect(afterReset.cacheCount).toBe(0);
  expect(afterReset.level).toBe(100);
  expect(afterReset.goodCount).toBe(0);

  await page.locator('#primary-action').click();
  await advance(page, 1.1);
  const oldSimTime = await page.evaluate(() => window.glazeLab.sim.simTime);
  expect(oldSimTime).toBeGreaterThan(1);

  await page.reload();
  const afterReload = await page.evaluate(() => {
    const sim = window.glazeLab.sim;
    return {
      summary: sim.getSummary(),
      history: sim.history.length,
      events: sim.events.length,
      cacheTimes: sim.cache.map((entry) => entry.simTime),
      storageKeys: Object.keys(localStorage),
      sessionKeys: Object.keys(sessionStorage)
    };
  });
  expect(afterReload.summary.batchId).toBe(null);
  expect(afterReload.summary.goodCount).toBe(0);
  expect(afterReload.summary.simTime).toBeLessThan(1);
  expect(afterReload.history).toBe(0);
  expect(afterReload.events).toBe(0);
  expect(afterReload.cacheTimes.every((time) => time < 1)).toBeTruthy();
  expect(afterReload.storageKeys).toHaveLength(0);
  expect(afterReload.sessionKeys).toHaveLength(0);
});
