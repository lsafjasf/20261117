import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import test from "node:test";
import { chromium } from "playwright-core";

const root = process.cwd();
const port = 9387;
const baseUrl = `http://127.0.0.1:${port}`;

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "/tmp/chrome-for-testing/chrome-linux64/chrome",
    "/tmp/maglev-browser/chrome-linux64/chrome",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("未找到 Chromium，请设置 CHROME_PATH");
  return found;
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error("测试服务器启动超时");
}

test("界面交互、窗口状态、空结果与导出一致性", { timeout: 60000 }, async () => {
  const server = spawn(process.execPath, ["scripts/serve.mjs"], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore",
  });
  let browser;
  try {
    await waitForServer(baseUrl);
    browser = await chromium.launch({
      headless: true,
      executablePath: chromePath(),
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1100 },
      acceptDownloads: true,
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);

    const dataVersion = (await page.locator("#flowDataVersion").textContent()).trim();
    assert.match(dataVersion, /^DV-[0-9A-F]{8}$/);
    assert.equal((await page.locator("#tableDataVersion").textContent()).trim(), dataVersion);
    assert.equal((await page.locator("#curveDataVersion").textContent()).trim(), dataVersion);
    assert.equal((await page.locator("#mapDataVersion").textContent()).trim(), dataVersion);
    assert.equal((await page.locator("#scopeDataVersion").textContent()).trim(), dataVersion);
    assert.match(await page.locator("#balanceBadge").innerText(), /输入 = 有效服务 \+ 损失/);
    assert.equal((await page.locator("#kpiBalance").textContent()).trim(), "PASS");
    assert.equal(await page.locator("#intervalTable tr").count(), 16);
    await page.screenshot({ path: "artifacts/energy-atlas.png", fullPage: true });

    const flowCanvas = page.locator("#flowCanvas");
    const flowBox = await flowCanvas.boundingBox();
    await page.mouse.click(flowBox.x + flowBox.width * 0.075, flowBox.y + flowBox.height * 0.78);
    await page.waitForTimeout(80);
    assert.equal((await page.locator("#nodeName").textContent()).trim(), "光伏");
    assert.match(await page.locator("#nodePower").textContent(), /^\d+\.\d$/);

    await page.locator('[data-floor="2F"]').click();
    await page.locator("#searchInput").fill("办公");
    await page.locator('[data-range="day"]').click();
    await page.locator("#load-hvac").evaluate((input) => {
      input.value = "130";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForTimeout(100);
    const normalFilterText = (await page.locator("#activeFilterText").textContent()).trim();
    assert.match(normalFilterText, /二层/);
    assert.match((await page.locator("#activeRecordCount").textContent()).trim(), /^16 条/);
    assert.ok((await page.locator("#intervalTable tr").count()) > 0);

    await page.locator('[data-window="midday"]').click();
    await page.locator('[data-window="morning"]').click();
    await page.waitForTimeout(100);
    assert.equal((await page.locator("#activeFilterText").textContent()).trim(), normalFilterText);
    assert.equal(await page.locator("#searchInput").inputValue(), "办公");
    assert.match(await page.locator('[data-floor="2F"]').getAttribute("class"), /active/);
    assert.match(await page.locator('[data-range="day"]').getAttribute("class"), /active/);
    assert.equal(await page.locator("#load-hvac").inputValue(), "130");
    assert.equal((await page.locator("#nodeName").textContent()).trim(), "光伏");

    await page.locator("#searchInput").fill("不存在的区域");
    await page.waitForTimeout(100);
    assert.equal((await page.locator("#filterStatusLight").textContent()).trim(), "空结果");
    assert.equal(await page.locator("#flowEmpty").isVisible(), true);
    assert.equal(await page.locator("#tableEmpty").isVisible(), true);
    assert.equal((await page.locator("#kpiInput").textContent()).trim(), "0.0");
    assert.equal(await page.locator("#intervalTable tr").count(), 0);

    const emptyCsvPromise = page.waitForEvent("download");
    await page.locator("#exportCsv").click();
    const emptyCsv = await emptyCsvPromise;
    const emptyCsvPath = "/tmp/energy-atlas-empty.csv";
    await emptyCsv.saveAs(emptyCsvPath);
    const emptyContent = readFileSync(emptyCsvPath, "utf8");
    assert.match(emptyContent, /"result","NO_MATCHING_RECORDS"/);
    assert.match(emptyContent, new RegExp(dataVersion));
    assert.equal((await page.locator("#exportLogCount").textContent()).trim(), "1");
    assert.match(await page.locator("#exportLog").innerText(), /CSV OK/);

    await page.locator("#resetFilters").click();
    await page.locator('[data-dataset="abnormal"]').click();
    await page.waitForTimeout(120);
    assert.equal((await page.locator("#summaryDedup").textContent()).trim(), "5");
    assert.equal((await page.locator("#summaryAnomaly").textContent()).trim(), "5");
    assert.ok(Number(await page.locator("#summaryFilled").textContent()) > 0);
    assert.equal((await page.locator("#kpiBalance").textContent()).trim(), "PASS");

    const pngPromise = page.waitForEvent("download");
    await page.locator("#exportPng").click();
    const png = await pngPromise;
    await png.saveAs("artifacts/energy-atlas-export.png");
    assert.ok(existsSync("artifacts/energy-atlas-export.png"));
    assert.equal((await page.locator("#exportLogCount").textContent()).trim(), "2");
    const screenInput = (await page.locator("#kpiInput").textContent()).trim();
    const screenLoss = (await page.locator("#kpiLoss").textContent()).trim();
    const screenVersion = (await page.locator("#flowDataVersion").textContent()).trim();
    const logText = await page.locator("#exportLog").innerText();
    assert.match(logText, /PNG OK/);
    assert.ok(logText.includes(`输入 ${screenInput} kW · 损失 ${screenLoss} kW`));
    assert.ok(logText.includes(screenVersion));
    assert.deepEqual(errors, []);

    const dimensions = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    assert.equal(dimensions.scrollWidth, dimensions.clientWidth);
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
  }
});
