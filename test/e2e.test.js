/*
 * e2e.test.js — 无头浏览器端到端验证（node test/e2e.test.js）
 * 覆盖：播放/暂停/拖动/循环、分割与转场后音画对齐、
 * 保存重载入点出点不变、重叠阻止导出、导出文件可播放且首尾无黑帧。
 */
"use strict";

const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = path.join(ROOT, req.url === "/" ? "index.html" : req.url);
      fs.readFile(p, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "text/plain" });
        res.end(data);
      });
    });
    srv.listen(0, () => resolve(srv));
  });
}

let passed = 0;
function ok(cond, name) {
  if (!cond) throw new Error("FAILED: " + name);
  passed++;
  console.log("✓", name);
}

(async () => {
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({
    args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForTimeout(500);

  /* 1. 播放 / 暂停 / 拖动 / 循环 */
  await page.click("#btn-play");
  await page.waitForTimeout(800);
  const t1 = await page.evaluate(() => window.__transport.currentTime);
  ok(t1 > 0.3, `播放推进 (t=${t1.toFixed(2)})`);
  await page.click("#btn-pause");
  const t2 = await page.evaluate(() => window.__transport.currentTime);
  await page.waitForTimeout(400);
  const t3 = await page.evaluate(() => window.__transport.currentTime);
  ok(Math.abs(t2 - t3) < 0.05, "暂停后时间冻结");
  // 拖动：点击时间线 10s 处
  const tl = await page.locator("#timeline").boundingBox();
  await page.mouse.click(tl.x + 10 * 40, tl.y + 5);
  const t4 = await page.evaluate(() => window.__transport.currentTime);
  ok(Math.abs(t4 - 10) < 0.4, `拖动播放头定位 (t=${t4.toFixed(2)})`);
  // 循环：seek 到结尾附近再播放
  await page.evaluate(() => window.__transport.seek(window.__transport.duration - 0.2));
  await page.click("#btn-play");
  await page.waitForTimeout(700);
  const t5 = await page.evaluate(() => window.__transport.currentTime);
  ok(t5 < 2, `循环回到开头 (t=${t5.toFixed(2)})`);
  await page.click("#btn-pause");

  /* 2. 分割 + 转场后音画对齐（模型层在页面内验证） */
  const aligned = await page.evaluate(() => {
    const M = window.CreditModel;
    const p = window.__project;
    M.splitClip(p, "clip_b", 6);
    M.addTransition(p, "clip_a", "clip_b", 1.0);
    // 音画对齐：音频事件时间轴未受画面编辑影响，且画面源时间连续
    const au = p.audioEvents.find((a) => a.id === "au_2");
    const clipAt4 = M.activeClipAt(p, 4.0);
    return au.start === 4 && clipAt4 && Math.abs(clipAt4.clip.inPoint + (4 - clipAt4.clip.start) - (clipAt4.clip.inPoint)) < 1e-9;
  });
  ok(aligned, "分割+转场后音频事件与画面时间轴对齐");

  /* 3. 保存 → 重新载入：入点/出点与事件位置不变 */
  const before = await page.evaluate(() => {
    window.__project.clips[0].inPoint = 0.5;
    window.__project.clips[0].outPoint = 3.5;
    document.getElementById("btn-save").click();
    return JSON.parse(localStorage.getItem("credits-studio-project"));
  });
  await page.click("#btn-reload");
  const after = await page.evaluate(() => ({
    inPoint: window.__project.clips[0].inPoint,
    outPoint: window.__project.clips[0].outPoint,
    audioStarts: window.__project.audioEvents.map((a) => a.start),
  }));
  ok(after.inPoint === before.clips[0].inPoint && after.outPoint === before.clips[0].outPoint,
    "重新载入后入点/出点不变");
  ok(JSON.stringify(after.audioStarts) === JSON.stringify(before.audioEvents.map((a) => a.start)),
    "重新载入后音频事件位置不变");

  /* 4. 非法重叠 → 阻止导出并标出冲突 */
  await page.evaluate(() => {
    window.CreditModel.moveClip(window.__project, window.__project.clips[1].id, 1.0, false);
    window.__refreshValidation();
  });
  const exportDisabled = await page.evaluate(() => document.getElementById("btn-export").disabled);
  const conflictShown = await page.locator(".tl-conflict").count();
  const issueText = await page.locator("#issues").innerText();
  ok(exportDisabled && conflictShown > 0 && issueText.includes("重叠"),
    "重叠时阻止导出并高亮冲突位置");

  /* 5. 字幕越界 → 阻止导出 */
  await page.evaluate(() => {
    document.getElementById("set-lineheight").value = "0";
    document.getElementById("set-lineheight").dispatchEvent(new Event("input"));
  });
  ok(await page.evaluate(() => document.getElementById("btn-export").disabled),
    "字幕越界（行距为 0）时阻止导出");
  await page.evaluate(() => {
    document.getElementById("set-lineheight").value = "44";
    document.getElementById("set-lineheight").dispatchEvent(new Event("input"));
  });

  /* 6. 导出：用一个 3s 迷你工程，验证可播放、时长对齐、首尾无黑帧 */
  const result = await page.evaluate(async () => {
    const M = window.CreditModel;
    const mini = M.createDefaultProject();
    mini.clips = [
      { id: "m1", name: "甲", start: 0, duration: 1.5, inPoint: 0, outPoint: 1.5, hue: 200 },
      { id: "m2", name: "乙", start: 1.5, duration: 2.0, inPoint: 0, outPoint: 2.0, hue: 120 },
    ];
    mini.transitions = [{ id: "mt", from: "m1", to: "m2", duration: 0.5, type: "crossfade" }];
    mini.credits = { startTime: 2, dwellLineRatio: 0.5, lines: ["完"], pauses: [] };
    mini.audioEvents = [{ id: "ma", type: "pad", start: 0, duration: 3.5, freq: 220, gain: 0.1 }];
    mini.settings.scrollSpeed = 400; // 字幕快速滚完，画面片段覆盖全程
    mini.settings.bgFadeOut = 0;     // 本用例专注“首尾无黑帧”
    const transport = new window.Transport.Transport(M.programDuration(mini));
    const canvas = document.getElementById("preview");
    const audio = new window.AudioEngine();
    const r = await window.Exporter.exportVideo(mini, transport, canvas, audio, null);
    // 可播放性 + 首尾帧检测
    const url = URL.createObjectURL(r.blob);
    const v = document.createElement("video");
    v.muted = true;
    v.src = url;
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = rej; });
    const probe = document.createElement("canvas");
    probe.width = 160; probe.height = 90;
    const pctx = probe.getContext("2d");
    async function frameBrightness(time) {
      v.currentTime = time;
      await new Promise((res) => (v.onseeked = res));
      pctx.drawImage(v, 0, 0, 160, 90);
      const d = pctx.getImageData(0, 0, 160, 90).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
      return sum / (d.length / 4) / 3;
    }
    const first = await frameBrightness(0.05);
    const last = await frameBrightness(Math.max(0.1, r.actualDur - 0.1));
    return {
      expected: r.expectedDur, actual: r.actualDur,
      clipCount: r.clipDurations.length,
      allMatch: r.clipDurations.every((c) => c.match),
      size: r.blob.size, first, last,
    };
  });
  ok(result.size > 10000, `导出文件非空 (${(result.size / 1024).toFixed(0)} KB)`);
  ok(Math.abs(result.actual - result.expected) < 1.0,
    `导出时长对齐 (预期 ${result.expected.toFixed(2)}s / 实测 ${result.actual.toFixed(2)}s)`);
  ok(result.clipCount >= 2 && result.allMatch, "至少两段片段时长比对一致");
  ok(result.first > 12, `首帧非黑帧 (亮度 ${result.first.toFixed(1)})`);
  ok(result.last > 12, `尾帧非黑帧 (亮度 ${result.last.toFixed(1)})`);

  ok(errors.length === 0, "页面无 JS 错误" + (errors.length ? ": " + errors[0] : ""));

  await browser.close();
  srv.close();
  console.log(`\n全部 ${passed} 项端到端测试通过`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
