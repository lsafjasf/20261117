const { test, expect } = require("@playwright/test");

async function openEditor(page) {
  await page.goto("/");
  await expect(page.locator("#layoutSummary")).toContainText("自动", { timeout: 15_000 });
  await expect(page.locator("#validationTitle")).toBeVisible();
}

test("标准案例自动三栏且通过安全区、重叠和裁切检查", async ({ page }) => {
  await openEditor(page);
  await expect(page.locator("#layoutSummary")).toContainText("自动 3 栏");
  await expect(page.locator("#layoutDetail")).toContainText("1240 × 1754px");
  await expect(page.locator("#validationTitle")).toContainText("版式检查通过");
  await expect(page.locator("#itemCount")).toHaveText("8");

  const canvas = page.locator("#menuCanvas");
  const box = await canvas.boundingBox();
  expect(box.width).toBeGreaterThan(300);
  expect(box.height).toBeGreaterThan(400);

  await page.locator(".toggle-label").click();
  await expect(page.locator("#safeMarginToggle")).toBeChecked();
  const zoomBefore = await page.locator("#zoomLabel").textContent();
  await page.locator("#zoomIn").click();
  await expect(page.locator("#zoomLabel")).not.toHaveText(zoomBefore);
});

test("长菜名触发两栏重排，撤销重做恢复完整输入", async ({ page }) => {
  await openEditor(page);
  const nameInput = page.locator('.item-editor').first().locator('[data-item-field="name"]');
  const original = await nameInput.inputValue();
  const longName = "极长菜名测试：慢烤香草柠檬填馅春鸡配焦糖小洋葱与山野菌菇汁与季节根茎蔬菜";

  await nameInput.fill(longName);
  await expect(page.locator("#layoutSummary")).toContainText("自动 2 栏");
  await expect(page.locator("#undoBtn")).toBeEnabled();
  await page.locator("#undoBtn").click();
  await expect(page.locator('.item-editor').first().locator('[data-item-field="name"]')).toHaveValue(original);
  await page.locator("#redoBtn").click();
  await expect(page.locator('.item-editor').first().locator('[data-item-field="name"]')).toHaveValue(longName);
});

test("保存、重新载入与错误输入处理不会丢失内容", async ({ page }) => {
  await openEditor(page);
  const restaurant = page.locator("#restaurantInput");
  await restaurant.fill("保存测试餐厅");
  await page.locator("#saveBtn").click();
  await restaurant.fill("未保存的临时名称");
  await page.waitForTimeout(500);

  await page.locator("#reloadBtn").click();
  await expect(page.locator("#confirmModal")).toBeVisible();
  await page.locator("#confirmAccept").click();
  await expect(restaurant).toHaveValue("保存测试餐厅");

  const itemCount = await page.locator("#itemCount").textContent();
  const priceInput = page.locator('.item-editor').first().locator('[data-item-field="price"]');
  await priceInput.fill("-8");
  await expect(page.locator("#validationTitle")).toContainText("导出阻断问题");
  await expect(page.locator("#validationList")).toContainText("E-PRICE-02");
  await expect(page.locator("#itemCount")).toHaveText(itemCount);

  await page.locator("#exportBtn").click();
  await page.locator('[data-export="png"]').click();
  await expect(page.locator(".toast").last()).toContainText("无法导出");
  await expect(page.locator("#validationList")).toContainText("修复：");

  await priceInput.fill("128");
  await expect(page.locator("#validationTitle")).toContainText("版式检查通过");
  await page.locator("#importInput").setInputFiles({
    name: "bad-page.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      '{"items":[{"name":"不应覆盖现有内容","price":"10"}],"page":{"width":"abc","height":900}}',
    ),
  });
  await expect(page.locator("#validationList")).toContainText("E-IMPORT-01");
  await expect(page.locator("#itemCount")).toHaveText(itemCount);
  await expect(page.locator("#restaurantInput")).toHaveValue("保存测试餐厅");
});

test("极端长文本与极小尺寸案例保持可导出", async ({ page }) => {
  await openEditor(page);
  await page.locator("#sampleSelect").selectOption("extreme");
  await expect(page.locator("#layoutSummary")).toContainText("自动 2 栏");
  await expect(page.locator("#validationTitle")).toContainText("版式检查通过");

  await page.locator("#sampleSelect").selectOption("tiny");
  await expect(page.locator("#layoutSummary")).toContainText("自动 2 栏");
  await expect(page.locator("#layoutDetail")).toContainText("360 × 520px");
  await expect(page.locator("#validationTitle")).toContainText("版式检查通过");
});

test("不可容纳的极小画布保留全部菜品并给出阻断规则", async ({ page }) => {
  await openEditor(page);
  const items = Array.from({ length: 12 }, (_, index) => ({
    id: `stress-${index}`,
    name: `超长菜名测试第${index + 1}道配山野菌菇与季节时蔬`,
    description: "这是一段会反复换行的极长描述文字，用于验证安全边距、重叠检测与页脚裁切。",
    price: String(20 + index),
    tags: ["含麸质", "含乳制品", "纯素"],
  }));
  const documentJson = {
    schema: "mise.restaurant-menu",
    version: 1,
    restaurant: "压力测试餐厅",
    headline: "极 小 画 布",
    subheading: "十二道菜与超长文本",
    note: "红色为过敏原提示。",
    currency: "¥",
    page: { preset: "custom", width: 300, height: 320, margin: 8 },
    theme: { accent: "#ad4a32", motif: "arch", paper: "cream" },
    items,
  };

  await page.locator("#importInput").setInputFiles({
    name: "stress.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(documentJson)),
  });
  await expect(page.locator("#itemCount")).toHaveText("12");
  await expect(page.locator("#validationTitle")).toContainText("导出阻断问题");
  await expect(page.locator("#validationList")).toContainText("E-CLIP-01");
  await expect(page.locator("#validationList")).toContainText("E-SAFE-01");
  await expect(page.locator("#validationList")).toContainText("E-OVERLAP-01");

  await page.locator("#exportBtn").click();
  await page.locator('[data-export="json"]').click();
  await expect(page.locator(".toast").last()).toContainText("无法导出");
  await expect(page.locator("#itemCount")).toHaveText("12");
});

test("导出 PNG、SVG 与版式 JSON 可重新载入且文字保持矢量", async ({ page }) => {
  await openEditor(page);

  await page.locator("#exportBtn").click();
  const jsonDownload = page.waitForEvent("download");
  await page.locator('[data-export="json"]').click();
  const json = JSON.parse(await (await jsonDownload).createReadStream().then(streamToBuffer));
  expect(json.document.items).toHaveLength(8);
  expect(json.layout.computedColumns).toBe(3);
  await page.locator("#importInput").setInputFiles({
    name: "roundtrip.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(json)),
  });
  await expect(page.locator("#itemCount")).toHaveText("8");
  await expect(page.locator(".toast").last()).toContainText("已载入 8 道菜");
  await expect(page.locator("#validationTitle")).toContainText("版式检查通过");

  await page.locator("#exportBtn").click();
  const pngDownload = page.waitForEvent("download");
  await page.locator('[data-export="png"]').click();
  const png = await (await pngDownload).createReadStream().then(streamToBuffer);
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect(png.readUInt32BE(16)).toBe(2480);
  expect(png.readUInt32BE(20)).toBe(3508);

  await page.locator("#exportBtn").click();
  const svgDownload = page.waitForEvent("download");
  await page.locator('[data-export="svg"]').click();
  const svg = (await (await svgDownload).createReadStream().then(streamToBuffer)).toString("utf8");
  expect(svg).toContain("<text");
  expect(svg).toContain('class="allergen-tag"');
  expect(svg).toContain("@font-face");
  expect(svg).toContain("data:font/woff2;base64,");
  expect(svg).not.toContain("<image");
});

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}
