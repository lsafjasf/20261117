import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test("interactive wash line reaches validation, pause, fault and export flows", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await expect(page.locator("#statusPill")).toHaveText("待生产");
  await expect(page.locator("#scenarioButtons .scenario-btn")).toHaveCount(4);
  await expect(page.locator("#washCanvas")).toBeVisible();

  await page.locator("#runAllBtn").click();
  await expect(page.locator("#validationStatus")).toContainText("4/4 场景通过");
  await expect(page.locator("#scenarioResults")).toContainText("参数越限");
  await expect(page.locator("#scenarioResults")).toContainText("T+4.00s");
  await expect(page.locator("#scenarioResults")).toContainText("检查合格");

  await page.selectOption("#speedSelect", "4");
  await page.locator("#startBtn").click();
  await expect(page.locator("#statusPill")).toHaveText("清洗运行");
  await page.waitForTimeout(600);
  await page.locator("#pauseBtn").click();
  await expect(page.locator("#statusPill")).toHaveText("已暂停");
  const frozen = await page.locator("#clockValue").textContent();
  await page.waitForTimeout(700);
  await expect(page.locator("#clockValue")).toHaveText(frozen);
  await page.locator("#stepBtn").click();
  await expect(page.locator("#statusPill")).toHaveText("已暂停");
  await expect(page.locator("#clockValue")).not.toHaveText(frozen);

  await page.locator("#rpmInput").evaluate((input) => {
    input.value = "1600";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#statusPill")).toHaveText("联锁停机");
  await expect(page.locator("#canvasFault")).toBeVisible();
  await expect(page.locator("#eventRows")).toContainText("BASKET_OVERLOAD");
  await page.locator("#recoverBtn").click();
  await expect(page.locator("#statusPill")).toHaveText("待生产");

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#exportBtn").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^wash-report-.*\.json$/);
  const reportPath = await download.path();
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  expect(report.schema).toBe("precision-wash-report/v1");
  expect(report.scenarios).toHaveLength(4);
  expect(report.scenarios.every((scenario) => scenario.passed)).toBe(true);
  expect(report.scenarios.find((scenario) => scenario.id === "parameter-limit").trigger.at).toBe(4);
  expect(report.scenarios.find((scenario) => scenario.id === "equipment-stop").stopReasons[0]).toContain("联锁停机");

  page.on("dialog", (dialog) => dialog.accept());
  await page.locator("#sessionResetBtn").click();
  await expect(page.locator("#cacheCount")).toHaveText("0");
  await expect(page.locator("#eventCount")).toHaveText("1 条记录");

  expect(errors).toEqual([]);
});
