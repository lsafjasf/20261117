import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateRaw, BASE_TIME, STEP_MS, SLOT_COUNT, NODES, METRICS } from '../src/data.js';
import { dedupe, fillGaps, aggregate, buildSnapshot, detectAnomalies, selectWindow } from '../src/pipeline.js';

const END = BASE_TIME + SLOT_COUNT * STEP_MS;
const baseOpts = (over = {}) => ({
  windowEnd: END,
  windowMs: 21600000,
  intervalMs: 900000,
  basis: 'avg',
  filters: { zone: '', nodeId: '', metric: '', min: '', max: '', anomalyOnly: false },
  ...over
});

test('三组数据都能生成，且缺失/异常组包含设计好的缺陷', () => {
  for (const ds of ['normal', 'missing', 'anomaly']) {
    const { records, note } = generateRaw(ds);
    assert.ok(records.length > 0);
    if (ds === 'missing') {
      assert.ok(note.duplicates > 0, '缺失组应包含重复记录');
      assert.ok(note.missing > 0, '缺失组应包含缺失记录');
    }
    if (ds === 'anomaly') assert.ok(note.anomalies > 0, '异常组应包含异常注入');
  }
});

test('去重：同键保留最后一条，删除数与重复数一致', () => {
  const { records, note } = generateRaw('missing');
  const { records: cleaned, removed } = dedupe(records);
  assert.equal(removed, note.duplicates);
  const keys = new Set(cleaned.map((r) => `${r.nodeId}|${r.metric}|${r.ts}`));
  assert.equal(keys.size, cleaned.length);
  // 重复键最终保留的是后写入的值
  for (const dupKey of note.duplicateKeys.slice(0, 5)) {
    const matches = records.filter((r) => `${r.nodeId}|${r.metric}|${r.ts}` === dupKey);
    const kept = cleaned.find((r) => `${r.nodeId}|${r.metric}|${r.ts}` === dupKey);
    assert.equal(kept.value, matches[matches.length - 1].value);
  }
});

test('补缺：输出对齐完整网格，缺口被填充且标记 filled', () => {
  const { records } = generateRaw('missing');
  const cleaned = dedupe(records).records;
  const { records: full, filled } = fillGaps(cleaned);
  const expected = NODES.length * METRICS.length * SLOT_COUNT;
  assert.equal(full.length, expected);
  assert.ok(filled > 0);
  assert.ok(full.every((r) => r.ts >= BASE_TIME && r.ts < END));
  const filledRecords = full.filter((r) => r.quality === 'filled');
  assert.equal(filledRecords.length, filled);
  // N07 压力的连续缺口（槽 50~58）必须被线性补出
  const gap = full.filter((r) => r.nodeId === 'N07' && r.metric === 'pressure' &&
    r.ts >= BASE_TIME + 50 * STEP_MS && r.ts < BASE_TIME + 59 * STEP_MS);
  assert.equal(gap.length, 9);
  assert.ok(gap.every((r) => r.quality === 'filled'));
  // 线性插值单调段检查：首末之间无突变
  const vals = gap.map((r) => r.value);
  for (let i = 1; i < vals.length - 1; i += 1) {
    assert.ok(Math.abs(vals[i + 1] - vals[i]) < 0.05);
  }
});

test('聚合：15 分钟桶均值与手工计算一致，桶样本数正确', () => {
  const full = fillGaps(dedupe(generateRaw('normal').records).records).records;
  const windowed = selectWindow(full, END, 3600000);
  const agg = aggregate(windowed, 900000, 'avg', END);
  // 完整桶包含 3 个 5 分钟样本（窗口首桶可能被截断为 2 个）
  const one = agg.find((r) => r.sampleCount === 3);
  assert.ok(one, '应至少存在一个完整 15 分钟桶');
  const same = windowed.filter((r) => r.nodeId === one.nodeId && r.metric === one.metric &&
    Math.floor(r.ts / 900000) * 900000 + 900000 === one.ts);
  assert.equal(one.sampleCount, 3);
  assert.equal(same.length, 3);
  const expect = Math.round((same.reduce((s, r) => s + r.value, 0) / 3) * 1000) / 1000;
  assert.equal(one.value, expect);
});

test('统计口径 avg/max/min/p95 结果不同且可复现', () => {
  const full = fillGaps(dedupe(generateRaw('anomaly').records).records).records;
  const windowed = selectWindow(full, END, 21600000);
  const results = {};
  for (const basis of ['avg', 'max', 'min', 'p95']) {
    results[basis] = aggregate(windowed, 3600000, basis);
  }
  const key = (r) => `${r.nodeId}|${r.metric}|${r.ts}`;
  const firstKey = key(results.avg[0]);
  const pick = (list) => list.find((r) => key(r) === firstKey).value;
  assert.ok(pick(results.max) >= pick(results.avg));
  assert.ok(pick(results.avg) >= pick(results.min));
  assert.ok(pick(results.p95) >= pick(results.min) && pick(results.p95) <= pick(results.max));
});

test('异常检测：异常数据集快照包含异常点，正常数据集为零', () => {
  const normal = buildSnapshot(generateRaw('normal').records, baseOpts());
  const anomaly = buildSnapshot(generateRaw('anomaly').records,
    baseOpts({ windowMs: 86400000 })); // 24h 窗口覆盖注入的爆管时段
  assert.equal(normal.anomalies.length, 0);
  assert.ok(anomaly.anomalies.length > 0);
  assert.ok(anomaly.anomalies.every((a) => a.anomalyType));
});

test('正常筛选：按分区+指标过滤后只保留匹配记录，版本号随筛选变化', () => {
  const raw = generateRaw('normal').records;
  const all = buildSnapshot(raw, baseOpts());
  const filtered = buildSnapshot(raw, baseOpts({
    filters: { zone: '北区', nodeId: '', metric: 'pressure', min: '', max: '', anomalyOnly: false }
  }));
  const northNodes = new Set(NODES.filter((n) => n.zone === '北区').map((n) => n.id));
  assert.ok(filtered.records.length > 0);
  assert.ok(filtered.records.every((r) => northNodes.has(r.nodeId) && r.metric === 'pressure'));
  assert.notEqual(all.version, filtered.version);
  assert.ok(filtered.nodeIds.every((id) => northNodes.has(id)));
});

test('空结果：不可能满足的数值区间产生零记录且统计安全降级', () => {
  const snap = buildSnapshot(generateRaw('normal').records, baseOpts({
    filters: { zone: '', nodeId: '', metric: '', min: 99999, max: '', anomalyOnly: false }
  }));
  assert.equal(snap.records.length, 0);
  assert.equal(snap.nodeIds.length, 0);
  assert.equal(snap.anomalies.length, 0);
  assert.equal(snap.stats.totalPoints, 0);
  assert.equal(snap.stats.activeNodes, 0);
  for (const m of METRICS) assert.equal(snap.stats.byMetric[m], null);
});

test('同一参数重复构建快照版本号一致（数据版本确定性）', () => {
  const raw = generateRaw('missing').records;
  const a = buildSnapshot(raw, baseOpts());
  const b = buildSnapshot(raw, baseOpts());
  assert.equal(a.version, b.version);
  assert.deepEqual(a.records, b.records);
});

test('窗口截取：右边界外的数据不会进入快照', () => {
  const raw = generateRaw('normal').records;
  const wEnd = BASE_TIME + 2 * 3600000;
  const snap = buildSnapshot(raw, baseOpts({ windowEnd: wEnd, windowMs: 3600000 }));
  assert.ok(snap.records.every((r) => r.ts <= wEnd));
  const full = fillGaps(dedupe(raw).records).records;
  const inRange = full.filter((r) => r.ts > wEnd - 3600000 && r.ts <= wEnd);
  assert.equal(snap.quality.windowCount, inRange.length);
  assert.ok(inRange.length > 0);
});
