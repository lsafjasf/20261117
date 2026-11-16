/* 全流程浏览器测试：用键盘事件模拟两人协作跑完三圈并成功，验证最终落盘回放。 */
"use strict";
const path = require("path");
const { chromium } = require("playwright");

(async function () {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on("pageerror", function (e) { errors.push(String(e)); });
  await page.goto("file://" + path.join(__dirname, "..", "index.html"));
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");

  // 简单巡航策略：W 加速到 ~12.5，接近曲线/终点用 ↑ 制动，←/→ 按每圈要求摆道岔
  const T = await page.evaluate(function () { return window.MC.Track; });
  const timer = setInterval(async function () {}, 100);
  for (let tick = 0; tick < 60 * 175; tick++) {
    const s = await page.evaluate(function () {
      const e = window.MC_APP.engine;
      return {
        phase: e.phase, speed: e.speed, lap: e.lap, dist: e.distance,
        cross: e.lapCrossings, pos: e.switchPos, branch: e.Track ? 0 : 0,
        pv: e.preview()
      };
    });
    if (s.phase !== "RUN") break;
    const reqRoute = ["inner", "outer", "inner"][s.lap - 1];
    if (s.dist < 44 && s.pos !== reqRoute) {
      await page.keyboard.press(reqRoute === "inner" ? "ArrowLeft" : "ArrowRight");
    }
    let w = false, up = false;
    if (s.cross >= 3) {
      if (s.speed > 4.0) up = true;
    } else if (s.pv && s.pv.kind === "curve" && s.pv.dist < 70 && s.speed > 12.3) {
      up = true;
    } else if (s.speed < 12.2) {
      w = true;
    }
    await page.keyboard.down("KeyW");
    if (w) await page.keyboard.down("KeyW"); else await page.keyboard.up("KeyW");
    if (up) await page.keyboard.down("ArrowUp"); else await page.keyboard.up("ArrowUp");
    await page.waitForTimeout(1000 / 20);
  }
  clearInterval(timer);
  await page.keyboard.up("KeyW");
  await page.keyboard.up("ArrowUp");
  await page.waitForTimeout(800);

  const result = await page.evaluate(function () {
    const e = window.MC_APP.engine;
    return {
      phase: e.phase, reason: e.failReason, simTime: +e.simTime.toFixed(1),
      mission: +e.missionTime.toFixed(1), crossings: e.lapCrossings,
      replaySaved: !!localStorage.getItem(window.MC.Replay.STORE_KEY),
      snapshotCount: e.snapshots.length
    };
  });
  console.log(JSON.stringify(result, null, 1));
  const ok = result.phase === "SUCCESS" && result.replaySaved && errors.length === 0;
  console.log(ok ? "PASS | 全流程键盘协作成功并落盘回放" : "FAIL | 全流程未成功");
  if (errors.length) console.log(errors.join("\n"));
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
