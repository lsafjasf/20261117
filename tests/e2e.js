/* 端到端：浏览器里同时按下两套键区，验证多键同按、冲突记录与双仪表数字同源。 */
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
  // 同时按住 P1 的 W 与 P2 的 ↑ —— 必须同时生效并产生冲突记录
  await page.keyboard.down("KeyW");
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(2600);
  await page.keyboard.up("KeyW");
  await page.keyboard.up("ArrowUp");

  const state = await page.evaluate(function () {
    const app = window.MC_APP;
    const e = app.engine;
    return {
      phase: e.phase,
      throttle: +e.throttle.toFixed(2),
      brake: Math.round(e.brakePct),
      conflicts: e.conflictCount,
      inputEvents: e.events.filter(function (x) { return x.type === "input"; }).length,
      speedTop: document.getElementById("ssSpeed").textContent,
      speedP1: document.querySelector("#panelP1 [data-speed]").textContent,
      speedP2: document.querySelector("#panelP2 [data-speed]").textContent,
      tractionTop: document.getElementById("ssTraction").textContent,
      tractionP1: document.querySelector("#panelP1 [data-traction]").textContent,
      airTop: document.getElementById("ssBrake").textContent,
      airP2: document.querySelector("#panelP2 [data-air]").textContent
    };
  });

  const checks = [
    ["牵引与制动同时生效", state.throttle > 1 && state.brake > 20],
    ["冲突被记录", state.conflicts >= 1],
    ["双方输入均入回放", state.inputEvents >= 2],
    ["双仪表速度同源", state.speedTop.indexOf(state.speedP1) >= 0 && state.speedP1 === state.speedP2],
    ["储能双端同源", state.tractionTop === state.tractionP1],
    ["风缸双端同源", state.airTop === state.airP2]
  ];
  checks.forEach(function (c) { console.log((c[1] ? "PASS" : "FAIL") + " | " + c[0]); });
  console.log(JSON.stringify(state, null, 1));
  const ok = checks.every(function (c) { return c[1]; }) && errors.length === 0;
  console.log(errors.length ? "CONSOLE ERRORS:\n" + errors.join("\n") : "CONSOLE ERRORS: none");
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
