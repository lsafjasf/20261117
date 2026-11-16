/* 无头浏览器截图：初始/运行/保护/回放 + 触发页面内置自检。 */
"use strict";
const path = require("path");
const { chromium } = require("playwright");

const url = "file://" + path.join(__dirname, "..", "index.html");
const outDir = path.join(__dirname, "..", "artifacts");

(async function () {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(url);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, "shot-initial.png"), fullPage: true });

  // 发车并运行 6 秒
  await page.keyboard.press("Enter");
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(4500);
  await page.keyboard.up("KeyW");
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(1200);
  await page.keyboard.up("ArrowUp");
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, "shot-running.png"), fullPage: true });

  // P1 断链保护
  await page.keyboard.press("KeyQ");
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, "shot-protect.png"), fullPage: true });
  await page.keyboard.press("KeyQ");
  await page.waitForTimeout(300);

  // 回放
  await page.keyboard.press("KeyV");
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, "shot-replay.png"), fullPage: true });
  await page.keyboard.press("Escape");

  // 内置自检
  await page.keyboard.press("F3");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, "shot-selftest.png"), fullPage: true });
  const summary = await page.textContent("#selftest .summary");

  console.log("SUMMARY:", summary);
  console.log("CONSOLE ERRORS:", errors.length ? errors.join("\n") : "none");
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
