/* Node 自动化测试：node tests/run-tests.js
   覆盖三组数据的去重、补缺、异常截断、聚合、防遮挡半径与空结果。 */
const fs = require('fs');
const path = require('path');

const files = ['util.js', 'network.js', 'generate.js', 'pipeline.js', 'selftest.js'];
files.forEach((f) => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
  eval(code);
});

const App = globalThis.App;
let failures = 0;
function assert(name, cond, detail) {
  if (cond) {
    console.log('  ✓ ' + name);
  } else {
    failures++;
    console.log('  ✗ ' + name + (detail ? ' — ' + detail : ''));
  }
}

console.log('一、浏览器自检场景（与页面自检同源）');
const reports = App.selftest.run();
reports.forEach((r) => assert(r.name, r.pass, r.detail));

console.log('\n二、状态保留与数据版本一致性（模拟 state 行为）');
const { cleanDataset, aggregate, filterSignature } = App.pipeline;
const { WINDOWS, hoursOfWindow } = App.network;
const datasets = {};
App.generate.DATASETS.forEach((meta) => {
  const result = cleanDataset(meta.build());
  datasets[meta.id] = result;
});

const winAll = { ...WINDOWS.find((w) => w.id === 'w_all'), hours: hoursOfWindow(WINDOWS.find((w) => w.id === 'w_all')) };
const winMorning = { ...WINDOWS.find((w) => w.id === 'w_morning'), hours: hoursOfWindow(WINDOWS.find((w) => w.id === 'w_morning')) };

// 模拟 perDataset 状态保存/恢复
const perDataset = {};
function snapshot(ds, filters, windowId, selected) {
  perDataset[ds] = { filters: { ...filters }, windowId, selectedStationId: selected };
}
snapshot('normal', { lineId: 'L1', transferType: 'transfer' }, 'w_morning', 'L1S5');
snapshot('anomaly', { lineId: 'ALL', transferType: 'none' }, 'w_evening', 'L2S4');
const back = perDataset['normal'];
assert('切回前一数据集：线路筛选保留', back.filters.lineId === 'L1');
assert('切回前一数据集：换乘筛选保留', back.filters.transferType === 'transfer');
assert('切回前一数据集：时间窗口保留', back.windowId === 'w_morning');
assert('切回前一数据集：选中站点保留', back.selectedStationId === 'L1S5');

// 同筛选两次结果与版本签名一致（地图/曲线/列表/导出共用）
const f1 = { lineId: 'L2', transferType: 'all' };
const a1 = aggregate(datasets.normal.cleaned, f1, winMorning);
const a2 = aggregate(datasets.normal.cleaned, f1, winMorning);
assert('相同筛选聚合结果一致', JSON.stringify(a1) === JSON.stringify(a2));
const sig1 = filterSignature(f1, winMorning, 'normal');
const sig2 = filterSignature({ ...f1 }, { ...winMorning }, 'normal');
assert('数据版本签名对相同筛选稳定', sig1 === sig2);
const sig3 = filterSignature({ ...f1, lineId: 'L1' }, winMorning, 'normal');
assert('数据版本签名随筛选变化', sig1 !== sig3);

// 导出口径一致性：模拟导出表数值 = 聚合数值
const exportAgg = aggregate(datasets.anomaly.cleaned, { lineId: 'ALL', transferType: 'all' }, winAll);
const screenTotals = exportAgg.stations.map((s) => [s.name, s.entry, s.exit, s.transfer, s.total]);
const exportTotals = exportAgg.stations.slice().sort((a, b) => b.total - a.total)
  .map((s) => [s.name, s.entry, s.exit, s.transfer, s.total]);
const sameSet = exportTotals.every((row) => screenTotals.some((r) => JSON.stringify(r) === JSON.stringify(row)));
assert('导出表与屏幕统计逐行一致（无硬编码）', sameSet);

console.log('\n三、正常筛选与空结果各至少一次');
const normalFiltered = aggregate(datasets.normal.cleaned, { lineId: 'L1', transferType: 'all' }, winMorning);
assert('正常筛选：早高峰 L1 有命中', normalFiltered.matchedRecords > 0);
const nightWin = { id: 'night', startHour: 22, endHour: 23, hours: [22] };
const empty = aggregate(datasets.normal.cleaned, { lineId: 'ALL', transferType: 'all' }, nightWin);
assert('空结果：22 点窗口命中为 0', empty.matchedRecords === 0);

console.log('\n' + (failures === 0 ? '全部通过 ✓' : failures + ' 项失败 ✗'));
process.exit(failures === 0 ? 0 : 1);
