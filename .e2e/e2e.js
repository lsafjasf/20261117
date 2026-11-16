/* 端到端验证（无头 Chromium）：
   1. 页面无报错、地图/曲线真实绘制 2. 筛选与空结果联动
   3. 切回前一数据集时筛选/窗口/视图/选择保留 4. 导出 PNG 数值与屏幕一致 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const URL = 'file://' + path.join(ROOT, 'index.html');
let failures = 0;
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (!cond && detail ? ' — ' + detail : ''));
  if (!cond) failures++;
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL);
  await page.waitForTimeout(300);

  console.log('一、页面装载与真实绘制');
  ok('无 JS 报错', errors.length === 0, errors.join('; '));
  const mapPainted = await page.evaluate(() => {
    const c = document.getElementById('mapCanvas');
    return c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((v) => v !== 0);
  });
  ok('地图 Canvas 已绘制内容', mapPainted);
  const chartPainted = await page.evaluate(() => {
    const c = document.getElementById('chartCanvas');
    return c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((v) => v !== 0);
  });
  ok('曲线 Canvas 已绘制内容', chartPainted);
  ok('站点列表已渲染', (await page.locator('.list-row').count()) > 0);
  ok('显示数据版本号', (await page.locator('#versionTag').textContent()).includes('数据版本'));

  console.log('二、正常筛选联动（地图/曲线/列表同源）');
  await page.selectOption('#lineSelect', 'L1');
  await page.selectOption('#transferSelect', 'transfer');
  await page.selectOption('#windowSelect', 'w_morning');
  await page.waitForTimeout(100);
  const screenA = await page.evaluate(() => {
    const totals = [...document.querySelectorAll('.list-row .list-total')].map((e) => e.textContent);
    return {
      filterText: document.getElementById('filterBar').innerText,
      listSum: totals.reduce((a, t) => a + parseInt(t), 0),
      version: document.getElementById('versionTag').textContent,
      matched: parseInt(/命中记录\s*(\d+)/.exec(document.getElementById('filterBar').innerText)[1]),
    };
  });
  ok('筛选栏反映 L1/换乘/早高峰', screenA.filterText.includes('1 路') && screenA.filterText.includes('仅换乘') && screenA.filterText.includes('早高峰'));

  console.log('三、空结果');
  // 确定性空结果：运营数据仅 6–21 点，收班后 22:00 窗口任何数据集都命中 0
  await page.selectOption('#datasetSelect', 'missing');
  await page.selectOption('#lineSelect', 'ALL');
  await page.selectOption('#transferSelect', 'all');
  await page.selectOption('#windowSelect', 'w_night');
  await page.waitForTimeout(100);
  const emptyTip = await page.locator('.empty-tip').count();
  const matchedNow = await page.evaluate(() =>
    parseInt(/命中记录\s*(\d+)/.exec(document.getElementById('filterBar').innerText)[1]));
  ok('空结果：缺失桶组合命中 0 且显示空提示', emptyTip === 1 && matchedNow === 0,
    'tip=' + emptyTip + ' matched=' + matchedNow);
  const chartAlive = await page.evaluate(() => document.getElementById('chartCanvas').toDataURL().length > 100);
  ok('空结果下曲线画布仍正常', chartAlive);

  console.log('四、切回前一数据集时状态保留');
  await page.selectOption('#datasetSelect', 'normal');
  const restored = await page.evaluate(() => ({
    line: document.getElementById('lineSelect').value,
    transfer: document.getElementById('transferSelect').value,
    window: document.getElementById('windowSelect').value,
    saved: JSON.parse(localStorage.getItem('bus-hotspot-state-v1')),
  }));
  // normal 之前保存的是 L1/transfer/w_morning
  ok('线路筛选恢复为 L1', restored.line === 'L1', restored.line);
  ok('换乘筛选恢复为 transfer', restored.transfer === 'transfer', restored.transfer);
  ok('时间窗口恢复为早高峰', restored.window === 'w_morning', restored.window);
  ok('perDataset 中持久化了各数据集状态', !!restored.saved.perDataset && Object.keys(restored.saved.perDataset).length >= 2);

  console.log('四（补）、显示范围（缩放/平移）随数据集保留');
  await page.evaluate(() => App.state.setView({ scale: 2.25, offsetX: 137, offsetY: -64 }));
  await page.selectOption('#datasetSelect', 'missing');
  await page.waitForTimeout(80);
  await page.selectOption('#datasetSelect', 'normal');
  const viewBack = await page.evaluate(() => App.state.state.view);
  ok('切回后缩放比例保留', Math.abs(viewBack.scale - 2.25) < 1e-9, JSON.stringify(viewBack));
  ok('切回后平移偏移保留', viewBack.offsetX === 137 && viewBack.offsetY === -64, JSON.stringify(viewBack));

  console.log('五、点击站点显示进出量');
  await page.evaluate(() => {
    const r = App.state.currentResult();
    const s = r.agg.stations.find((x) => x.total > 0);
    App.state.setSelected(s.stationId);
  });
  await page.waitForTimeout(100);
  const detail = await page.locator('#stationDetail').innerText();
  ok('详情面板显示进站/出站/换乘/总量', /进站\s*\d+/.test(detail) && /出站\s*\d+/.test(detail) && /总量\s*\d+/.test(detail), detail);

  console.log('六、导出 PNG 且数值与屏幕一致');
  const before = await page.evaluate(() => {
    const r = App.state.currentResult();
    return {
      version: r.version,
      rows: r.agg.stations.slice().sort((a, b) => b.total - a.total)
        .map((s) => [s.name, s.entry, s.exit, s.transfer, s.total]),
    };
  });
  const downloadPromise = page.waitForEvent('download', { timeout: 5000 });
  await page.click('#exportBtn');
  const download = await downloadPromise;
  const outPath = path.join(__dirname, download.suggestedFilename());
  await download.saveAs(outPath);
  ok('PNG 文件已下载', fs.existsSync(outPath) && fs.statSync(outPath).size > 1000);
  ok('文件名含数据版本', download.suggestedFilename().includes(before.version));
  const logText = await page.locator('#exportLog').innerText();
  ok('导出日志记录版本与命中量', logText.includes(before.version));
  const screenConsistent = await page.evaluate(() => {
    const r = App.state.currentResult();
    const listRows = [...document.querySelectorAll('.list-row')].map((row) => ({
      name: row.querySelector('.list-name').textContent,
      total: parseInt(row.querySelector('.list-total').textContent),
      sub: row.querySelector('.list-sub').textContent,
    }));
    const aggRows = r.agg.stations.slice().sort((a, b) => b.total - a.total).map((s) => ({
      name: s.name + (s.transfer ? '（换乘）' : ''),
      total: s.total,
      sub: '进 ' + s.entry + ' / 出 ' + s.exit + ' / 换乘 ' + s.transfer,
    }));
    // 热区半径与其他站点标签矩形零重叠
    let overlap = false;
    r.agg.stations.forEach((s, i) => {
      r.agg.stations.forEach((o, j) => {
        if (i === j || r.radii[i] === 0) return;
        const rect = App.pipeline.labelRect(o);
        const dx = Math.max(rect.x - s.x, 0, s.x - (rect.x + rect.width));
        const dy = Math.max(rect.y - s.y, 0, s.y - (rect.y + rect.height));
        if (Math.hypot(dx, dy) < r.radii[i] - 0.5) overlap = true;
      });
    });
    return { listEqualsAgg: JSON.stringify(listRows) === JSON.stringify(aggRows), overlap };
  });
  ok('屏幕列表数值与聚合结果逐项一致', screenConsistent.listEqualsAgg);
  ok('热区半径不覆盖任何其他站点标签', !screenConsistent.overlap);

  console.log('七、页面内自检全部通过');
  await page.click('#selftestBtn');
  await page.waitForTimeout(100);
  const selfTest = await page.evaluate(() => ({
    pass: document.querySelectorAll('#selftestResult .test-pass').length,
    fail: document.querySelectorAll('#selftestResult .test-fail').length,
  }));
  ok('自检断言全绿', selfTest.fail === 0 && selfTest.pass >= 12, JSON.stringify(selfTest));

  await browser.close();
  console.log('\n' + (failures === 0 ? 'E2E 全部通过 ✓ 导出图：' + path.basename(outPath) : failures + ' 项失败 ✗'));
  process.exit(failures === 0 ? 0 : 1);
})();
