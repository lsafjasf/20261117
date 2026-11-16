import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

async function openStudio(page) {
  await page.goto("/");
  await page.waitForFunction(() => document.fonts?.status === "loaded");
  await expect(page.locator("#validationSummary")).toContainText("排版检查通过");
}

test("standard case keeps text editable and zoom does not alter tile coordinates", async ({
  page
}) => {
  await openStudio(page);
  const title = page.locator('[data-field="text.title"]');
  await expect(title).toHaveValue("同心花砖");

  await title.fill("回纹");
  await page.locator('[data-field="text.subtitle"]').click();
  await page.locator("#undoButton").click();
  await expect(title).toHaveValue("同心花砖");
  await page.locator("#redoButton").click();
  await expect(title).toHaveValue("回纹");
  await expect(page.locator("#historyCount")).toHaveText("1 / 0");

  await page.locator("#zoomRange").evaluate((element) => {
    element.value = "200";
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#zoomOutput")).toHaveText("200%");
  await expect(page.locator("#tileCanvas")).toHaveCSS("width", "1024px");
  await expect(page.locator("#validationSummary")).toContainText("排版检查通过");
});

test("primary lock is synchronized, saved, and restored on reload", async ({ page }) => {
  await openStudio(page);
  const primaryInputs = page.locator('[data-color-role="primary"]');
  await primaryInputs.first().evaluate((input) => {
    input.value = "#2a6f97";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect
    .poll(async () => {
      return (await primaryInputs.evaluateAll((items) => items.map((item) => item.value))).map(
        (value) => value.toUpperCase()
      );
    })
    .toEqual(["#2A6F97", "#2A6F97", "#2A6F97"]);

  await page.locator("#saveButton").click();
  await expect(page.locator("#saveStatusText")).toContainText("已保存");
  await expect(page.locator("#toastRegion")).toContainText("工程已保存");

  await page.locator('[data-scheme-index="0"][data-color-role="secondary"]').evaluate((input) => {
    input.value = "#112233";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#reloadButton").click();
  await expect(page.locator("#toastRegion")).toContainText("已重新载入");
  await expect(page.locator("#paletteLock")).toBeChecked();
  await expect
    .poll(async () => {
      return (await primaryInputs.evaluateAll((items) => items.map((item) => item.value))).map(
        (value) => value.toUpperCase()
      );
    })
    .toEqual(["#2A6F97", "#2A6F97", "#2A6F97"]);

  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("seamless-pattern-studio:project:v1"))
  );
  expect(stored.palette.locked).toBe(true);
  expect(stored.palette.schemes[2].colors.primary).toBe("#2A6F97");
});

test("extreme text is retained, specific rules are reported, and export is blocked", async ({
  page
}) => {
  await openStudio(page);
  await page.locator('[data-preset="extreme"]').click();
  const title = page.locator('[data-field="text.title"]');
  const original = await title.inputValue();
  expect(original).toContain("极长标题连续纹样");
  await expect(page.locator("#validationSummary")).toContainText("4 个阻塞错误");
  const extremeWidth = await page
    .locator("#tileCanvas")
    .evaluate((canvas) => Number.parseFloat(canvas.style.width));
  expect(extremeWidth).toBeGreaterThan(211);
  expect(extremeWidth).toBeLessThan(212);

  const panel = page.locator("#validationPanel");
  await expect(panel).toContainText("文字最大宽度超出安全区");
  await expect(panel).toContainText("文字组超出画布并被裁切");
  await expect(panel).toContainText("文字进入安全边距");
  await expect(panel).toContainText("文字与中心图形留白区重叠");

  const titleSize = page.locator('[data-field="text.titleSize"]');
  await titleSize.fill("999");
  await page.locator('[data-field="text.maxWidth"]').click();
  await expect(page.locator("#toastRegion")).toContainText("本次修改未应用，原有内容已保留");
  await expect(titleSize).toHaveValue("22");
  await expect(title).toHaveValue(original);

  let downloaded = false;
  page.once("download", () => {
    downloaded = true;
  });
  await page.locator("#exportSvgButton").click();
  await page.waitForTimeout(350);
  expect(downloaded).toBe(false);
  await expect(page.locator("#toastRegion")).toContainText("SVG 导出已取消");
  await expect(page.locator("#toastRegion")).toContainText("当前输入和画布内容均保留");
});

test("PNG download matches the Canvas tile pixel-for-pixel", async ({ page }) => {
  await openStudio(page);
  await page.locator("#zoomRange").evaluate((element) => {
    element.value = "100";
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#zoomOutput")).toHaveText("100%");
  await expect
    .poll(() => page.locator("#tileCanvas").evaluate((canvas) => canvas.width))
    .toBe(512);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#exportPngButton").click()
  ]);
  const pngData = readFileSync(await download.path()).toString("base64");
  const comparison = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const exportedCanvas = document.createElement("canvas");
    exportedCanvas.width = image.naturalWidth;
    exportedCanvas.height = image.naturalHeight;
    const exportedContext = exportedCanvas.getContext("2d");
    exportedContext.drawImage(image, 0, 0);
    const tileCanvas = document.querySelector("#tileCanvas");
    if (
      exportedCanvas.width !== tileCanvas.width ||
      exportedCanvas.height !== tileCanvas.height
    ) {
      return {
        mismatch: true,
        size: [exportedCanvas.width, exportedCanvas.height],
        previewSize: [tileCanvas.width, tileCanvas.height]
      };
    }
    const exported = exportedContext.getImageData(
      0,
      0,
      exportedCanvas.width,
      exportedCanvas.height
    ).data;
    const preview = tileCanvas
      .getContext("2d")
      .getImageData(0, 0, tileCanvas.width, tileCanvas.height).data;
    let differingPixels = 0;
    let maxChannelDelta = 0;
    for (let offset = 0; offset < exported.length; offset += 4) {
      const channelDelta = Math.max(
        Math.abs(exported[offset] - preview[offset]),
        Math.abs(exported[offset + 1] - preview[offset + 1]),
        Math.abs(exported[offset + 2] - preview[offset + 2])
      );
      if (channelDelta > 0) differingPixels += 1;
      maxChannelDelta = Math.max(maxChannelDelta, channelDelta);
    }
    return {
      mismatch: false,
      differingPixels,
      maxChannelDelta,
      width: exportedCanvas.width,
      height: exportedCanvas.height
    };
  }, pngData);
  expect(comparison.mismatch).toBe(false);
  expect(comparison.width).toBe(512);
  expect(comparison.height).toBe(512);
  expect(comparison.maxChannelDelta).toBe(0);
  expect(comparison.differingPixels).toBe(0);
});

test("three-by-three preview repeats with no seam mismatch", async ({ page }) => {
  await openStudio(page);
  const result = await page.evaluate(async () => {
    const [{ buildScene, renderPreviewBuffer }, { createStandardProject, getActiveScheme }] =
      await Promise.all([import("/src/render.js"), import("/src/model.js")]);
    const project = createStandardProject();
    const measureContext = document.createElement("canvas").getContext("2d");
    const measure = (text, font) => {
      measureContext.font = font;
      return measureContext.measureText(text).width;
    };
    const scene = buildScene(project, getActiveScheme(project), measure);
    const canvas = renderPreviewBuffer(scene, 3);
    const context = canvas.getContext("2d", { alpha: false });
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let mismatches = 0;
    let compared = 0;
    for (let y = 5; y < project.canvas.height - 5; y += 3) {
      for (let x = 5; x < project.canvas.width - 5; x += 3) {
        const first = (y * canvas.width + x) * 4;
        const second = (y * canvas.width + x + project.canvas.width) * 4;
        compared += 1;
        if (
          data[first] !== data[second] ||
          data[first + 1] !== data[second + 1] ||
          data[first + 2] !== data[second + 2]
        ) {
          mismatches += 1;
        }
      }
    }
    return { mismatches, compared };
  });
  expect(result.compared).toBeGreaterThan(20_000);
  expect(result.mismatches).toBe(0);
});
