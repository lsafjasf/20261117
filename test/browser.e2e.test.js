import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const PORT = 5199;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function startServer() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const filePath = join(ROOT, normalize(urlPath === "/" ? "index.html" : urlPath));
      try {
        const body = await readFile(filePath);
        res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end("not found");
      }
    }).listen(PORT, () => resolve(server));
  });
}

async function newPage(browser, caseName) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector("#canvas");
  if (caseName) {
    const json = await readFile(join(ROOT, "cases", caseName), "utf8");
    await page.evaluate((data) => {
      localStorage.setItem("poster-studio:document:v1", data);
      location.reload();
    }, json);
    await page.waitForSelector(".layer-item");
  }
  return { page, errors };
}

let browser;
let server;

test.before(async () => {
  server = await startServer();
  browser = await chromium.launch();
});

test.after(async () => {
  await browser?.close();
  server?.close();
});

test("standard case renders without console errors and shows editable layers", async () => {
  const { page, errors } = await newPage(browser, "standard.poster.json");
  const layerCount = await page.locator(".layer-item").count();
  assert.equal(layerCount, 7);
  const issues = await page.locator("#issues .issue.error").count();
  assert.equal(issues, 0);
  await page.screenshot({ path: "test/screenshot-standard.png" });
  assert.deepEqual(errors, []);
  await page.close();
});

test("extreme case surfaces every rule violation with a concrete fix hint", async () => {
  const { page } = await newPage(browser, "extreme.poster.json");
  const text = await page.locator("#issues").innerText();
  for (const rule of ["MIN_SIZE", "OUT_OF_CANVAS", "TEXT_OVERFLOW"]) {
    assert.ok(text.includes(rule), `missing rule ${rule}`);
  }
  assert.ok(text.includes("修复建议"));
  await page.screenshot({ path: "test/screenshot-extreme.png" });
  await page.close();
});

test("drag move creates one undo step and restore returns the element home", async () => {
  const { page } = await newPage(browser, "standard.poster.json");
  const box = await page.locator("#canvas").boundingBox();
  const screenPoint = await page.evaluate(() => {
    const canvas = document.getElementById("canvas");
    const rect = canvas.getBoundingClientRect();
    const doc = JSON.parse(localStorage.getItem("poster-studio:document:v1"));
    const star = doc.elements.find((e) => e.id === "star-1");
    const scale = Math.min((rect.width - 80) / doc.width, (rect.height - 80) / doc.height, 1.5);
    const offsetX = (rect.width - doc.width * scale) / 2;
    const offsetY = (rect.height - doc.height * scale) / 2;
    return {
      x: rect.left + offsetX + (star.x + star.width / 2) * scale,
      y: rect.top + offsetY + (star.y + star.height / 2) * scale,
    };
  });
  await page.mouse.move(screenPoint.x, screenPoint.y);
  await page.mouse.down();
  await page.mouse.move(screenPoint.x + 120, screenPoint.y + 80, { steps: 6 });
  await page.mouse.up();
  const undoDisabledBefore = await page.locator("#undo").isDisabled();
  assert.equal(undoDisabledBefore, false);
  await page.screenshot({ path: "test/screenshot-drag.png" });
  await page.locator("#undo").click();
  const afterUndo = await page.locator("#undo").isDisabled();
  assert.equal(afterUndo, true);
  await page.close();
});

test("export guard blocks on out-of-canvas elements and explains the fix", async () => {
  const { page } = await newPage(browser, "extreme.poster.json");
  page.once("dialog", (dialog) => {
    assert.ok(dialog.message().includes("OUT_OF_CANVAS"));
    assert.ok(dialog.message().includes("修复"));
    dialog.dismiss();
  });
  await page.locator("#export-svg").click();
  await page.close();
});

test("SVG export keeps text and path elements, PNG export matches preview dimensions", async () => {
  const { page } = await newPage(browser, "standard.poster.json");
  const [svgDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#export-svg").click(),
  ]);
  const svgPath = "test/exported.svg";
  await svgDownload.saveAs(svgPath);
  const svg = await readFile(svgPath, "utf8");
  assert.match(svg, /<text/);
  assert.match(svg, /<tspan/);
  assert.match(svg, /<path/);
  assert.doesNotMatch(svg, /<image|base64/);

  const [pngDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#export-png").click(),
  ]);
  const pngPath = "test/exported.png";
  await pngDownload.saveAs(pngPath);
  const dims = await page.evaluate(async () => {
    const buf = new Uint8Array(await (await fetch("/test/exported.png")).arrayBuffer());
    return { width: new DataView(buf.buffer).getUint32(16), height: new DataView(buf.buffer).getUint32(20) };
  });
  assert.equal(dims.width, 800);
  assert.equal(dims.height, 600);
  await page.close();
});

test("bad project file is rejected and the current canvas stays intact", async () => {
  const { page } = await newPage(browser, "standard.poster.json");
  await page.setInputFiles("#load-file", {
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ width: -1, height: 10, elements: [] })),
  });
  await page.waitForFunction(() => document.querySelector("#status").textContent.includes("载入已取消"));
  const status = await page.locator("#status").innerText();
  assert.ok(status.includes("width 必须是正数"));
  const layerCount = await page.locator(".layer-item").count();
  assert.equal(layerCount, 7);
  await page.close();
});

test("double-click edits text, keyboard shortcuts drive undo/redo, crop mode works", async () => {
  const { page } = await newPage(browser, "standard.poster.json");
  const point = await page.evaluate(() => {
    const canvas = document.getElementById("canvas");
    const rect = canvas.getBoundingClientRect();
    const doc = JSON.parse(localStorage.getItem("poster-studio:document:v1"));
    const title = doc.elements.find((e) => e.id === "title");
    const scale = Math.min((rect.width - 80) / doc.width, (rect.height - 80) / doc.height, 1.5);
    return {
      x: rect.left + (rect.width - doc.width * scale) / 2 + (title.x + title.width / 2) * scale,
      y: rect.top + (rect.height - doc.height * scale) / 2 + (title.y + title.height / 2) * scale,
    };
  });
  await page.mouse.dblclick(point.x, point.y);
  const textarea = page.locator('#properties textarea[data-prop="text"]');
  await textarea.waitFor();
  await textarea.fill("键盘快捷键验证标题");
  await page.waitForTimeout(800);
  const saved = await page.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem("poster-studio:document:v1") || "{}");
    return doc.elements?.find((e) => e.id === "title")?.text;
  });
  assert.equal(saved, "键盘快捷键验证标题");

  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(400);
  const afterUndo = await page.locator('#properties textarea[data-prop="text"]').inputValue();
  assert.notEqual(afterUndo, "键盘快捷键验证标题");
  await page.keyboard.press("Control+y");
  await page.waitForTimeout(400);
  const restored = await page.locator('#properties textarea[data-prop="text"]').inputValue();
  assert.equal(restored, "键盘快捷键验证标题");

  await page.locator("#crop-toggle").click();
  await page.waitForFunction(() => document.querySelector("#issues"));
  assert.ok(await page.locator("#crop-reset").isEnabled());
  await page.close();
});
