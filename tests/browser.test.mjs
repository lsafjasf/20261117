import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const port = 43000 + (process.pid % 1000);
const baseURL = `http://127.0.0.1:${port}`;
let server;
let browser;
let page;
const browserErrors = [];

async function waitForServer(child) {
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (output.includes("Plaza running")) return;
    if (child.exitCode !== null) throw new Error(`测试服务器提前退出：${output}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("测试服务器启动超时");
}

function pngDimensions(buffer) {
  const signature = buffer.subarray(0, 8).toString("hex");
  assert.equal(signature, "89504e470d0a1a0a", "必须是有效 PNG 文件头");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function saveDataURL(dataURL, path) {
  assert.ok(dataURL.startsWith("data:image/png;base64,"));
  const buffer = Buffer.from(dataURL.split(",")[1], "base64");
  assert.ok(buffer.length > 50000, "导出 PNG 不应为空白小文件");
  writeFileSync(path, buffer);
  const dimensions = pngDimensions(buffer);
  assert.ok(dimensions.width > 1200 && dimensions.height > 900);
  return dimensions;
}

test("浏览器端：图层、遮挡、导出、错误保留与刷新恢复", async (t) => {
  mkdirSync("artifacts", { recursive: true });
  server = spawn(process.execPath, ["server.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await waitForServer(server);
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);

  await t.test("默认参数：固定数量、深度排序和图层轨迹正确", async () => {
    const diagnostics = await page.evaluate(() => window.__plaza.getDiagnostics());
    assert.equal(diagnostics.bedCount, 4);
    assert.equal(diagnostics.plantCount, 232);
    assert.equal(diagnostics.benches.length, 3);
    assert.deepEqual(diagnostics.layers, {
      ground: true,
      paths: true,
      beds: true,
      plants: true,
      benches: true,
      decor: true
    });

    const trace = await page.evaluate(() => window.__plaza.renderTrace());
    assert.deepEqual(trace, [
      "background", "ground", "paths", "beds", "decor-back", "objects", "decor-front"
    ]);

    const order = await page.evaluate(() => window.__plaza.getObjectOrder());
    assert.equal(order.length, 235, "232 株植物加 3 张长椅都必须进入绘制队列");
    for (let index = 1; index < order.length; index += 1) {
      assert.ok(order[index - 1].depth <= order[index].depth, "对象必须按投影深度由远及近绘制");
    }

    const before = await page.evaluate(() => window.__plaza.projectPoint(1, 0, 0));
    await page.evaluate(() => {
      window.__plaza.setView(90, 1);
      window.__plaza.redraw();
    });
    const after = await page.evaluate(() => window.__plaza.projectPoint(1, 0, 0));
    assert.notEqual(Math.round(before.x), Math.round(after.x), "旋转视角后同一世界点应改变屏幕位置");
    await page.evaluate(() => window.__plaza.setView(0, 1));
  });

  await t.test("边界参数：缩放极值与图层隐藏不产生空白或异常", async () => {
    await page.evaluate(() => {
      const state = window.__plaza.getState();
      return window.__plaza.setState({
        ...state,
        season: "winter",
        paused: true,
        view: { angle: 180, zoom: 1.45 },
        layers: { ...state.layers, paths: false, decor: false }
      });
    });
    await page.waitForTimeout(250);
    const trace = await page.evaluate(() => window.__plaza.renderTrace());
    assert.deepEqual(trace, ["background", "ground", "beds", "objects"]);
    const snapshot = await page.evaluate(() => window.__plaza.canvasSnapshot());
    assert.ok(snapshot.length > 50000, "隐藏部分图层后仍应保留有效画面");
    const diagnostics = await page.evaluate(() => window.__plaza.getDiagnostics());
    assert.equal(diagnostics.view.zoom, 1.45);
    assert.equal(diagnostics.season, "winter");
  });

  await t.test("交互链路：季节、暂停、视角、拖椅、保存与下载按钮", async () => {
    await page.evaluate(() => {
      const state = window.__plaza.getState();
      return window.__plaza.setState({
        ...state,
        season: "spring",
        paused: true,
        view: { angle: 0, zoom: 1 },
        layers: {
          ground: true, paths: true, beds: true, plants: true, benches: true, decor: true
        }
      });
    });
    await page.locator('[data-season="summer"]').click();
    assert.equal((await page.evaluate(() => window.__plaza.getState())).season, "summer");

    await page.locator("#pause-button").click();
    assert.equal((await page.evaluate(() => window.__plaza.getState())).paused, false);
    await page.locator("#pause-button").click();
    assert.equal((await page.evaluate(() => window.__plaza.getState())).paused, true);

    await page.locator("#angle-range").evaluate((input) => {
      input.value = "45";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.equal((await page.evaluate(() => window.__plaza.getState())).view.angle, 45);
    await page.evaluate(() => window.__plaza.redraw());
    await page.waitForTimeout(30);

    const canvasBox = await page.locator("#scene").boundingBox();
    const benchPoint = await page.evaluate(() => {
      const bench = window.__plaza.getState().benches[0];
      return window.__plaza.projectPoint(bench.x, bench.z, 0.55);
    });
    await page.mouse.move(canvasBox.x + benchPoint.x, canvasBox.y + benchPoint.y);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + benchPoint.x - 70, canvasBox.y + benchPoint.y + 28, { steps: 8 });
    await page.mouse.up();
    const movedState = await page.evaluate(() => window.__plaza.getState());
    assert.notEqual(
      `${movedState.benches[0].x},${movedState.benches[0].z}`,
      "0.78,-3.7",
      "拖拽长椅应改变其步道位置"
    );
    assert.ok(movedState.benches[0].x <= 5.75 && movedState.benches[0].z <= 5.75);

    await page.locator("#save-preset").click();
    const saved = await page.evaluate(() => localStorage.getItem("isometric-plaza.saved.v1"));
    assert.ok(saved && JSON.parse(saved).state.benches.length === 3);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("#export-button").click()
    ]);
    assert.match(download.suggestedFilename(), /^xiaoman-plaza-summer-seed-20261117\.png$/);
    assert.equal(await download.failure(), null);
    const downloadPath = await download.path();
    const buffer = readFileSync(downloadPath);
    const dimensions = pngDimensions(buffer);
    assert.ok(dimensions.width > 1200 && dimensions.height > 900);
  });

  await t.test("异常参数：显示原因并逐像素保留上一张有效画面", async () => {
    await page.evaluate(() => {
      const state = window.__plaza.getState();
      return window.__plaza.setState({ ...state, paused: true });
    });
    await page.waitForTimeout(180);
    const before = await page.evaluate(() => window.__plaza.canvasSnapshot());
    const result = await page.evaluate(() => window.__plaza.setState({
      season: "monsoon",
      view: { angle: 999, zoom: 0 }
    }));
    assert.equal(result.ok, false);
    assert.match(result.error, /season|视角|缩放/);
    assert.equal(await page.locator("#error-banner").isVisible(), true);
    assert.match(await page.locator("#error-message").textContent(), /season/);
    const after = await page.evaluate(() => window.__plaza.canvasSnapshot());
    assert.equal(after, before, "无效参数不能触发重绘或白屏");
    await page.locator("#dismiss-error").click();
  });

  await t.test("刷新恢复：视角、图层、种子与长椅位置一致", async () => {
    const expected = await page.evaluate(() => {
      const state = window.__plaza.getState();
      const next = {
        ...state,
        seed: 42,
        season: "autumn",
        paused: true,
        view: { angle: 137, zoom: 0.85 },
        layers: { ...state.layers, plants: true, paths: true, decor: true },
        benches: state.benches.map((bench, index) => index === 0
          ? { ...bench, x: 0.8, z: -5.5 }
          : bench)
      };
      const result = window.__plaza.setState(next);
      return { result, state: window.__plaza.getState() };
    });
    assert.equal(expected.result.ok, true);
    await page.waitForTimeout(260);
    const beforeReload = await page.evaluate(() => window.__plaza.getDiagnostics());
    await page.reload({ waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(180);
    const restored = await page.evaluate(() => window.__plaza.getDiagnostics());
    assert.equal(restored.seed, expected.state.seed);
    assert.equal(restored.season, expected.state.season);
    assert.deepEqual(restored.view, expected.state.view);
    assert.deepEqual(restored.layers, expected.state.layers);
    assert.deepEqual(restored.benches, expected.state.benches);
    assert.equal(restored.plantCount, 232);
    assert.deepEqual(restored.plantSample, beforeReload.plantSample, "重新载入后每株植物的位置应一致");
    assert.equal(restored.plantFingerprint, beforeReload.plantFingerprint, "全部 232 株植物坐标应完全一致");
  });

  await t.test("默认与极端两组画面可导出为有效 PNG", async () => {
    await page.evaluate(() => {
      const state = window.__plaza.getState();
      return window.__plaza.setState({
        ...state,
        seed: 20261117,
        season: "spring",
        paused: true,
        view: { angle: 0, zoom: 1 },
        layers: {
          ground: true, paths: true, beds: true, plants: true, benches: true, decor: true
        },
        benches: [
          { id: "bench-a", x: 0.78, z: -3.7, rotation: 90 },
          { id: "bench-b", x: -0.78, z: 3.7, rotation: -90 },
          { id: "bench-c", x: 3.7, z: 0.78, rotation: 180 }
        ]
      });
    });
    await page.waitForTimeout(220);
    const defaultPNG = await page.evaluate(() => window.__plaza.exportDataURL());
    const defaultSize = saveDataURL(defaultPNG, "artifacts/default-export.png");
    await page.screenshot({ path: "artifacts/default.png", fullPage: true });

    await page.evaluate(() => {
      const state = window.__plaza.getState();
      return window.__plaza.setState({
        ...state,
        seed: 4294967295,
        season: "autumn",
        paused: true,
        view: { angle: 180, zoom: 1.45 },
        benches: [
          { id: "bench-a", x: 0.82, z: -5.75, rotation: 90 },
          { id: "bench-b", x: -0.82, z: 5.75, rotation: -90 },
          { id: "bench-c", x: 5.75, z: 0.82, rotation: 180 }
        ]
      });
    });
    await page.waitForTimeout(220);
    const extremePNG = await page.evaluate(() => window.__plaza.exportDataURL());
    const extremeSize = saveDataURL(extremePNG, "artifacts/extreme-export.png");
    await page.screenshot({ path: "artifacts/extreme.png", fullPage: true });
    assert.notEqual(defaultPNG, extremePNG, "两组参数应生成不同画面");
    assert.ok(defaultSize.width === extremeSize.width);
    assert.deepEqual(browserErrors, [], "浏览器控制台不应出现错误");
  });
});

after(async () => {
  await browser?.close();
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await once(server, "exit");
  }
});
