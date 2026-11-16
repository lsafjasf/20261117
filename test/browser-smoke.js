// Browser smoke test (puppeteer). Run: node test/browser-smoke.js
// Requires puppeteer installed at /tmp/salt-smoke (see README).
"use strict";

const path = require("node:path");
const http = require("node:http");
const fs = require("node:fs");
const assert = require("node:assert");

const ROOT = path.join(__dirname, "..");

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = path.join(ROOT, req.url === "/" ? "index.html" : req.url.split("?")[0]);
      fs.readFile(p, (err, data) => {
        if (err) { res.writeHead(404); res.end("nf"); return; }
        res.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "application/octet-stream" });
        res.end(data);
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

async function main() {
  let puppeteer;
  try { puppeteer = require("puppeteer"); }
  catch { puppeteer = require("/tmp/salt-smoke/node_modules/puppeteer"); }
  const srv = await serve();
  const PORT = srv.address().port;
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  let failed = 0;
  const ok = (name, cond) => {
    console.log((cond ? "ok - " : "FAIL - ") + name);
    if (!cond) failed++;
  };

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle0" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 1500));

    ok("page loads without JS errors", errors.length === 0);

    // Canvas is not blank.
    const pixelStats = await page.evaluate(() => {
      const c = document.getElementById("mainCanvas");
      const ctx = c.getContext("2d");
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let sum = 0, distinct = new Set();
      for (let i = 0; i < d.length; i += 400) {
        sum += d[i] + d[i + 1] + d[i + 2];
        distinct.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
      }
      return { sum, distinct: distinct.size };
    });
    ok("main canvas renders non-blank, varied pixels", pixelStats.sum > 0 && pixelStats.distinct > 20);

    // Preview canvas tiled.
    const previewOk = await page.evaluate(() => {
      const c = document.getElementById("tilePreview");
      const ctx = c.getContext("2d");
      const a = ctx.getImageData(10, 10, 1, 1).data;
      const b = ctx.getImageData(106, 106, 1, 1).data; // same spot in next tile
      return Math.abs(a[0] - b[0]) <= 2 && Math.abs(a[1] - b[1]) <= 2;
    });
    ok("3x3 preview tiles match at tile corners", previewOk);

    // Invalid param: error bar shows, canvas keeps last good frame.
    const before = await page.evaluate(() => {
      const c = document.getElementById("mainCanvas");
      return c.getContext("2d").getImageData(0, 0, 64, 64).data.join(",");
    });
    await page.evaluate(() => {
      const el = document.getElementById("pSeed");
      el.value = "-3"; // out of range [0, 99999999]
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 400));
    const errVisible = await page.evaluate(() => !document.getElementById("errorBar").hidden);
    const errText = await page.evaluate(() => document.getElementById("errorBar").textContent);
    const after = await page.evaluate(() => {
      const c = document.getElementById("mainCanvas");
      return c.getContext("2d").getImageData(0, 0, 64, 64).data.join(",");
    });
    ok("invalid param shows error bar with reason", errVisible && errText.includes("seed"));
    ok("invalid param keeps last good frame (no blank)", before === after);

    // Restore valid param, error clears.
    await page.evaluate(() => {
      const el = document.getElementById("pSeed");
      el.value = "12345";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 600));
    ok("valid param clears error", await page.evaluate(() => document.getElementById("errorBar").hidden));

    // Paint a brush stroke on the main canvas.
    await page.evaluate(() => { document.getElementById("panMode").checked = false; });
    await page.mouse.move(200, 200);
    await page.mouse.down();
    for (let i = 0; i < 10; i++) await page.mouse.move(200 + i * 8, 200 + i * 4);
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 800));
    const dabCount = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("rocksalt.state.v1"));
      return s ? s.dabs.length : -1;
    });
    ok("brush dabs persisted to localStorage", dabCount > 5);

    // Reload: state (params, dabs, view) restored, render identical.
    const beforeReload = await page.evaluate(() => {
      const c = document.getElementById("mainCanvas");
      return c.getContext("2d").getImageData(0, 0, 128, 128).data.join(",");
    });
    await page.reload({ waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 1500));
    const afterReload = await page.evaluate(() => {
      const c = document.getElementById("mainCanvas");
      return c.getContext("2d").getImageData(0, 0, 128, 128).data.join(",");
    });
    const dabCount2 = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("rocksalt.state.v1"));
      return s ? s.dabs.length : -1;
    });
    ok("reload restores dab count (object count stable)", dabCount2 === dabCount);
    ok("reload reproduces identical frame (positions stable)", beforeReload === afterReload);

    // Export path renders 512/1024 in-page without error.
    const exportOk = await page.evaluate(() => {
      const p = JSON.parse(localStorage.getItem("rocksalt.state.v1")).params;
      const fields = SaltRender.buildBrushFields([], SaltRender.BRUSH_FIELD_SIZE);
      const a = SaltRender.renderTile(p, fields, SaltParams.DEFAULT_LAYERS, 512, 512);
      const b = SaltRender.renderTile(p, fields, SaltParams.DEFAULT_LAYERS, 1024, 1024);
      return a.data.length === 512 * 512 * 4 && b.data.length === 1024 * 1024 * 4;
    });
    ok("in-page export renders 512 and 1024", exportOk);

    // Pause + screenshot buttons exist and toggle.
    await page.click("#btnPause");
    const pauseLabel = await page.evaluate(() => document.getElementById("btnPause").textContent);
    ok("pause button toggles", pauseLabel === "继续");

    await page.screenshot({ path: path.join(ROOT, "artifacts", "ui-screenshot.png") });
    ok("ui screenshot captured", true);

    ok("no page errors accumulated", errors.length === 0);
    if (errors.length) console.log(errors);
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(failed ? `\n${failed} smoke checks FAILED` : "\nall smoke checks passed");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
