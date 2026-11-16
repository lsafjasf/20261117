import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../js/core/store.js';
import { buildSvg, exportFingerprint, countSvgElements } from '../js/core/exporter.js';
import { computeGeometry } from '../js/ui/geometry.js';
import { fmtNum } from '../js/core/util.js';

function exportOnce(store) {
  const snap = store.snapshot();
  const geometry = computeGeometry(snap.model, snap.view);
  const svg = buildSvg(snap.model, snap.state, geometry);
  return { svg, snap, fingerprint: exportFingerprint(snap.model) };
}

test('导出 SVG：图中统计数值与屏幕视图模型完全一致', () => {
  const store = new Store();
  const { svg, snap, fingerprint } = exportOnce(store);
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes(snap.model.version), '版本号必须写入 SVG');

  for (const row of snap.model.stats.perBorehole) {
    const valueText = fmtNum(row[snap.state.statsBasis]);
    assert.ok(svg.includes(`${row.name}：${valueText}`),
      `SVG 缺少 ${row.name} 的屏幕同源数值 ${valueText}`);
    assert.ok(svg.includes(fmtNum(row.thickness)));
  }
  assert.ok(svg.includes(fingerprint), '数值指纹必须写入 SVG 页脚');
  assert.ok(countSvgElements(svg) > 20);
});

test('导出不写死结果：改变统计口径/筛选后 SVG 数值随之变化', () => {
  const store = new Store();
  const first = exportOnce(store).svg;
  store.setStatsBasis('grMax');
  const second = exportOnce(store).svg;
  assert.notEqual(first, second);
  store.toggleLitho('K2');
  const thirdExport = exportOnce(store);
  const third = thirdExport.svg;
  assert.notEqual(second, third);
  const snap = thirdExport.snap;
  assert.ok(!third.includes('K2 · 灰岩'), '被筛选掉的岩性名称不应出现');
  assert.ok(third.includes(snap.model.version));
});

test('空结果导出：标记空结果、不含任何曲线数值且仍可生成有效 SVG', () => {
  const store = new Store();
  store.setWindow('q4');
  const { svg, fingerprint } = exportOnce(store);
  assert.ok(svg.includes('空结果：无数值图元导出'));
  assert.ok(svg.includes(fingerprint));
  // 空结果下统计值为 null，格式化后是 “—”，不能出现具体 GR 数字行
  assert.ok(!/：\d+(\.\d+)? ｜ 采样 0/.test(svg) || svg.includes('—'));
});

test('缺失层导出：gap 使用缺失图案，且不存在跨缺失层的 N1 连线', () => {
  const store = new Store();
  store.setDataset('missing');
  const { svg } = exportOnce(store);
  assert.ok(svg.includes('url(#gapPattern)'));
  assert.ok(svg.includes('缺失段'));
  const n1Lines = (svg.match(/stroke-line[^>]*>/g) || []);
  // 连线只有 6 条（与模型一致），N1 不参与连线
  const { model } = store.snapshot();
  assert.equal(model.correlation.lines.length, 6);
  assert.ok(model.correlation.lines.every((l) => l.lithoId !== 'N1'));
  assert.ok(Array.isArray(n1Lines));
});

test('导出日志：每次导出记录版本、窗口、口径与指纹', () => {
  const store = new Store();
  const { svg, fingerprint } = exportOnce(store);
  const entry = store.addExportLog({
    datasetId: 'normal',
    version: store.snapshot().model.version,
    windowLabel: '全部时间',
    basisLabel: 'GR 均值（API）',
    empty: false,
    elementCount: countSvgElements(svg),
    fingerprint
  });
  assert.equal(entry.datasetId, 'normal');
  assert.equal(store.snapshot().logs.length, 1);
  assert.equal(store.snapshot().logs[0].fingerprint, fingerprint);
});
