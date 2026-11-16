const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
  ".png": "image/png"
};

function createServer() {
  return http.createServer((request, response) => {
    const urlPath = decodeURIComponent((request.url || "/").split("?")[0]);
    const relative = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
    const filename = path.resolve(root, relative);
    if (!filename.startsWith(root + path.sep)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    fs.readFile(filename, (error, data) => {
      if (error) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      response.writeHead(200, {
        "Content-Type": mime[path.extname(filename)] || "application/octet-stream",
        "Cache-Control": "no-store"
      });
      response.end(data);
    });
  });
}

let checks = 0;
function assert(name, condition, detail) {
  checks += 1;
  if (!condition) {
    throw new Error(`FAILED: ${name}${detail ? `\n${JSON.stringify(detail, null, 2)}` : ""}`);
  }
  console.log(`✓ ${name}`);
}

async function snapshot(page) {
  return page.evaluate(() => window.CanyonGame.getSnapshot());
}

async function state(page) {
  return page.evaluate(() => window.CanyonGame.getState());
}

async function advance(page, seconds, inputs) {
  return page.evaluate(
    ([duration, controls]) => window.CanyonGame.advanceSimulation(duration, controls),
    [seconds, inputs || {}]
  );
}

async function driveTo(page, targetX) {
  for (let step = 0; step < 1000; step += 1) {
    const current = await state(page);
    if (current.mode !== "running") {
      return { ok: false, state: current };
    }
    const delta = targetX - current.position;
    const distance = Math.abs(delta);
    const heading = Math.sign(delta) || 1;
    const desired = heading * (
      distance > 0.14 ? 0.08 : Math.max(0.004, Math.min(0.042, distance * 0.65))
    );
    const inputs = {};
    if (distance < 0.006 && Math.abs(current.speed) < 0.012) {
      inputs.brake = true;
    } else if (desired > 0 && current.speed < desired - 0.004) {
      inputs.right = true;
    } else if (desired < 0 && current.speed > desired + 0.004) {
      inputs.left = true;
    } else if (desired > 0 && current.speed > desired + 0.004) {
      inputs.brake = true;
    } else if (desired < 0 && current.speed < desired - 0.004) {
      inputs.brake = true;
    }
    const next = await advance(page, 0.04, inputs);
    if (next.mode !== "running") {
      return { ok: false, state: next };
    }
    if (Math.abs(targetX - next.position) < 0.015 && Math.abs(next.speed) < 0.009) {
      return { ok: true, state: next };
    }
  }
  return { ok: false, state: await state(page) };
}

async function completeNormalRoute(page) {
  const level = await page.evaluate(() => window.CanyonGame.getLevel());
  for (let index = 1; index <= 3; index += 1) {
    const station = level.stations[index];
    const docked = await driveTo(page, station.x);
    assert(`正常路线停靠 ${station.id}`, docked.ok, docked.state);
    await advance(page, 0.25, { brake: true });
    const repaired = await page.evaluate(() => window.CanyonGame.repair());
    const current = await state(page);
    assert(`完成 ${station.id} 维修`, repaired && current.completed[index - 1], current);
  }
  const home = await driveTo(page, level.stations[0].x);
  return { home, state: await state(page) };
}

module.exports = { assert, snapshot, state, advance, driveTo, completeNormalRoute };

(async () => {
  const server = createServer();
  let browser;
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1019 } });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") {
        pageErrors.push(message.text());
      }
    });

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle" });
    await page.click("#startBtn");
    assert("点击开始后进入作业", (await state(page)).mode === "running");

    const route = await completeNormalRoute(page);
    await page.waitForTimeout(350);
    assert(
      "正常路线完成三处维修并返回 L0",
      route.state.mode === "won" && route.state.completed.every(Boolean),
      route.state
    );
    assert("胜利覆盖层可见", await page.locator("#winOverlay").evaluate((node) => node.classList.contains("visible")));
    assert("目标进度显示 3 / 3", (await page.locator("#progressValue").textContent()) === "3 / 3");
    await page.screenshot({ path: path.join(root, "artifacts", "verified-win.png"), fullPage: true });

    await page.evaluate(() => window.CanyonGame.setSeed("REPEAT-77"));
    const firstLevel = await page.evaluate(() => window.CanyonGame.getLevel());
    await page.evaluate(() => window.CanyonGame.setSeed("NOISE-01"));
    await page.evaluate(() => window.CanyonGame.setSeed("REPEAT-77"));
    const secondLevel = await page.evaluate(() => window.CanyonGame.getLevel());
    assert("同 seed 地图一致", JSON.stringify(firstLevel.stations) === JSON.stringify(secondLevel.stations));
    assert("同 seed 任务一致", JSON.stringify(firstLevel.signature.tasks) === JSON.stringify(secondLevel.signature.tasks));
    assert(
      "同 seed 障碍顺序一致",
      JSON.stringify(firstLevel.obstacleOrder) === JSON.stringify(secondLevel.obstacleOrder)
    );
    assert("同 seed 指纹一致", firstLevel.fingerprint === secondLevel.fingerprint);

    await page.evaluate(() => window.CanyonGame.applyScenario("overspeed"));
    await advance(page, 0.5);
    await page.waitForTimeout(300);
    const collision = await snapshot(page);
    assert("过速场景触发轮组碰撞", collision.mode === "failed" && collision.failure.code === "overspeed");
    assert("失败原因显示在覆盖层", (await page.locator("#failTitle").textContent()).includes("P1"));
    await page.screenshot({ path: path.join(root, "artifacts", "verified-collision.png"), fullPage: true });
    await page.click("#continueBtn");
    const continued = await state(page);
    assert("碰撞后可从最近检查点继续", continued.mode === "running" && continued.position === collision.checkpoint.position);
    assert("继续后保留最近失败原因", continued.recentFailure && continued.recentFailure.code === "overspeed");

    await page.evaluate(() => window.CanyonGame.applyScenario("stranded"));
    await page.waitForTimeout(280);
    const stranded = await state(page);
    const strandedSnapshot = await snapshot(page);
    assert("中线场景进入搁浅失败", stranded.mode === "failed" && stranded.failure.code === "stranded");
    assert("搁浅时检查点为 P1", strandedSnapshot.checkpoint.label.includes("P1"));
    assert("回收操作按钮可见", await page.locator("#recoverOverlayBtn").isVisible());
    await page.click("#recoverOverlayBtn");
    await advance(page, 4);
    await page.waitForTimeout(280);
    const recovered = await state(page);
    assert(
      "缓慢回收回到检查点",
      recovered.mode === "running" && recovered.position === strandedSnapshot.checkpoint.position
    );
    assert("回收消耗一根回收索", recovered.rope === stranded.rope - 1);
    assert("检查点目标状态已恢复", recovered.completed[0] === true && recovered.targetIndex === 1);

    await page.click("#pauseBtn");
    const paused = await state(page);
    await page.waitForTimeout(550);
    const pausedLater = await state(page);
    assert("暂停冻结模拟位置与时间", paused.elapsed === pausedLater.elapsed && paused.position === pausedLater.position);
    await page.click("#pauseBtn");
    assert("暂停后可继续", (await state(page)).mode === "running");

    await page.click("#restartBtn");
    const reset = await snapshot(page);
    assert(
      "重开恢复全部目标与资源",
      reset.mode === "running" &&
      reset.completed.every((value) => value === false) &&
      reset.targetIndex === 0 &&
      reset.battery === 100 &&
      reset.spare === 3 &&
      reset.rope === 2 &&
      reset.load === 164,
      reset
    );
    assert("重开清空失败与检查点", reset.failure === null && reset.checkpoint.label.includes("L0"));

    await advance(page, 1.15, { right: true });
    await page.evaluate(() => window.CanyonGame.pause());
    await page.waitForTimeout(120);
    const beforeSave = await snapshot(page);
    await page.click("#saveBtn");
    await page.waitForTimeout(200);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(250);
    const afterReload = await snapshot(page);
    assert("存档重载保持暂停与关键位置", afterReload.mode === "paused" && afterReload.position === beforeSave.position);
    assert(
      "存档重载保持目标、资源与摆角",
      afterReload.angle === beforeSave.angle &&
      afterReload.battery === beforeSave.battery &&
      JSON.stringify(afterReload.completed) === JSON.stringify(beforeSave.completed)
    );
    assert(
      "存档重载保持地图与胜负条件",
      afterReload.fingerprint === beforeSave.fingerprint &&
      JSON.stringify(afterReload.level.obstacles) === JSON.stringify(beforeSave.level.obstacles) &&
      afterReload.conditions.win === beforeSave.conditions.win &&
      afterReload.conditions.lose === beforeSave.conditions.lose
    );

    await page.evaluate(() => window.CanyonGame.resume());
    await advance(page, 0.7, { right: true });
    await page.evaluate(() => window.CanyonGame.pause());
    const moved = await state(page);
    await page.click("#loadBtn");
    await page.waitForTimeout(250);
    const manuallyLoaded = await state(page);
    assert("载入按钮恢复已保存位置", manuallyLoaded.position === beforeSave.position);
    assert("载入前位置确实发生变化", moved.position !== manuallyLoaded.position);
    assert("关键对象与条件未变化", manuallyLoaded.fingerprint === beforeSave.fingerprint);
    assert("页面无脚本错误", pageErrors.length === 0, pageErrors);

    console.log(`\n${checks} checks passed.`);
  } catch (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close();
    }
    await new Promise((resolve) => server.close(resolve));
  }
})();
