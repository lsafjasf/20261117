const { chromium } = require('playwright-core');
const assert = require('assert');
const path = require('path');

const URL = 'file://' + path.resolve(__dirname, '..', 'index.html');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL);
  await page.waitForTimeout(300);

  const T = async (name, fn) => {
    try { await fn(); console.log('PASS', name); }
    catch (e) { console.log('FAIL', name, '-', e.message); process.exitCode = 1; }
  };

  // 1. 标准案例：6 块、三栏、无排版问题
  await T('standard demo loads clean', async () => {
    const n = await page.evaluate(() => document.querySelectorAll('#issue-list li.ok').length);
    assert.strictEqual(n, 1, 'expected all-checks-pass');
    const blocks = await page.evaluate(() => window.__doc().blocks.length);
    assert.strictEqual(blocks, 6);
  });

  // 2. 三栏切四栏：内容不丢失
  await T('column switch preserves content', async () => {
    const before = await page.evaluate(() =>
      window.__doc().blocks.map(b => b.title + '|' + b.text).join(';;'));
    await page.selectOption('#columns', '4');
    await page.waitForTimeout(100);
    const after = await page.evaluate(() =>
      window.__doc().blocks.map(b => b.title + '|' + b.text).join(';;'));
    assert.strictEqual(after, before);
    const cols = await page.evaluate(() => window.__doc().canvas.columns);
    assert.strictEqual(cols, 4);
    await page.selectOption('#columns', '3');
  });

  // 3. 撤销/重做
  await T('undo/redo', async () => {
    const n0 = await page.evaluate(() => window.__doc().blocks.length);
    await page.click('#btn-add');
    const n1 = await page.evaluate(() => window.__doc().blocks.length);
    assert.strictEqual(n1, n0 + 1);
    await page.click('#btn-undo');
    const n2 = await page.evaluate(() => window.__doc().blocks.length);
    assert.strictEqual(n2, n0);
    await page.click('#btn-redo');
    const n3 = await page.evaluate(() => window.__doc().blocks.length);
    assert.strictEqual(n3, n0 + 1);
    await page.click('#btn-undo');
  });

  // 4. 保存 / 重新载入
  await T('save and reload', async () => {
    await page.click('#btn-add');
    await page.click('#btn-save');
    await page.click('#btn-delete'); // 删除刚选中的新区块
    await page.click('#btn-reload');
    const titles = await page.evaluate(() => window.__doc().blocks.map(b => b.title));
    assert.ok(titles.includes('新区块'), 'reloaded doc should contain saved block');
  });

  // 5. 极端案例：触发裁切/重叠/边距问题，且修复建议可用
  await T('extreme demo flags issues and fixes work', async () => {
    await page.click('#btn-demo-extreme');
    await page.waitForTimeout(100);
    const msgs = await page.evaluate(() =>
      [...document.querySelectorAll('#issue-list li')].map(li => li.textContent));
    const joined = msgs.join('\n');
    assert.ok(/裁切/.test(joined), 'expect clip issue');
    assert.ok(/重叠/.test(joined), 'expect overlap issue');
    assert.ok(/边距/.test(joined), 'expect margin issue');
    // 内容未丢失：超长文本仍在文档中
    const hasLong = await page.evaluate(() =>
      window.__doc().blocks.some(b => b.text.length > 500));
    assert.ok(hasLong, 'long text must be preserved');
    // 应用“两者都取消固定”修复重叠
    await page.getByRole('button', { name: '两者都取消固定' }).click();
    await page.waitForTimeout(100);
    const after = await page.evaluate(() =>
      [...document.querySelectorAll('#issue-list li')].map(li => li.textContent).join('\n'));
    assert.ok(!/重叠/.test(after), 'overlap should be fixed');
  });

  // 6. 导出 PNG 与预览一致（同参数离屏渲染对比）
  await T('PNG export matches preview render', async () => {
    await page.click('#btn-demo-standard');
    await page.waitForTimeout(100);
    const match = await page.evaluate(() => window.__exportMatchesPreview());
    assert.strictEqual(match, true);
  });

  // 7. 导出 SVG 行数与预览一致
  await T('SVG export line count matches layout', async () => {
    const ok = await page.evaluate(() => window.__svgMatchesLayout());
    assert.strictEqual(ok, true);
  });

  // 8. 导出网格 JSON 包含布局与问题
  await T('grid JSON export', async () => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#btn-export-json')
    ]);
    const path = await download.path();
    const data = JSON.parse(require('fs').readFileSync(path, 'utf8'));
    assert.ok(data.canvas && data.blocks.length === 6 && data.layout.length === 6);
    assert.ok(Array.isArray(data.issues));
  });

  // 9. 导入非法 JSON：保留现有内容并报错
  await T('invalid import keeps content and reports', async () => {
    const before = await page.evaluate(() => window.__doc().blocks.length);
    await page.setInputFiles('#file-import', {
      name: 'bad.json', mimeType: 'application/json',
      buffer: Buffer.from('{"canvas":{"width":-5}}')
    });
    await page.waitForTimeout(100);
    const after = await page.evaluate(() => window.__doc().blocks.length);
    assert.strictEqual(after, before);
    const toast = await page.textContent('#toast');
    assert.ok(/导入失败/.test(toast) && /正数/.test(toast), 'toast should explain violation');
  });

  // 10. 缩放不改变文档坐标
  await T('zoom does not affect layout coords', async () => {
    const before = await page.evaluate(() =>
      window.__doc().blocks.map(b => [b.x, b.y, b.w, b.h].join(',')).join(';'));
    await page.selectOption('#zoom', '0.4');
    await page.waitForTimeout(50);
    const after = await page.evaluate(() =>
      window.__doc().blocks.map(b => [b.x, b.y, b.w, b.h].join(',')).join(';'));
    assert.strictEqual(after, before);
    const w = await page.evaluate(() => document.getElementById('poster').style.width);
    assert.strictEqual(w, '480px');
    await page.selectOption('#zoom', '0.6');
  });

  // 11. 固定区块后重排其余部分
  await T('pin and reflow', async () => {
    await page.click('#btn-demo-standard');
    await page.waitForTimeout(100);
    // 固定第二个区块在其当前位置
    await page.evaluate(() => {
      const d = window.__doc();
      const b = d.blocks[1];
      b.pinned = true; b.gridCol = b._col; b.gridRow = b._row;
    });
    await page.click('#btn-reflow');
    await page.waitForTimeout(100);
    const pos = await page.evaluate(() => {
      const b = window.__doc().blocks[1];
      return [b._col, b._row];
    });
    assert.deepStrictEqual(pos, [1, 0]);
    // 无重叠
    const issues = await page.evaluate(() =>
      [...document.querySelectorAll('#issue-list li')].map(li => li.textContent).join('\n'));
    assert.ok(/✓/.test(issues), 'expected all checks to pass, got: ' + issues);
  });

  assert.deepStrictEqual(errors, [], 'no page errors: ' + errors.join('; '));
  await browser.close();
  console.log('DONE');
})();
