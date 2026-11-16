import assert from "node:assert/strict";
import test from "node:test";
import { DATASETS, DEVICES, FLOORS, WINDOWS, getRawDataset } from "../energy-data.js";
import {
  aggregateDataset,
  buildCsv,
  buildExportManifest,
  buildFlow,
  buildSnapshot,
  cleanDataset,
  filterRecords,
} from "../energy-core.js";

const cleaned = Object.fromEntries(DATASETS.map((dataset) => [
  dataset.id,
  cleanDataset(getRawDataset(dataset.id)),
]));

const allFilter = { floor: "all", source: "all", search: "" };

test("正常数据完整且版本稳定", () => {
  const clean = cleaned.normal;
  assert.equal(clean.stats.rawCount, 880);
  assert.equal(clean.stats.cleanCount, 880);
  assert.equal(clean.stats.duplicates, 0);
  assert.equal(clean.stats.missingFilled, 0);
  assert.equal(clean.stats.anomaliesCorrected, 0);
  assert.match(clean.dataVersion, /^DV-[0-9A-F]{8}$/);
  const repeated = cleanDataset(getRawDataset("normal"));
  assert.equal(repeated.dataVersion, clean.dataVersion);
});

test("缺失数据补缺后恢复完整 15 分钟序列", () => {
  const clean = cleaned.missing;
  assert.ok(clean.stats.missingFilled > 0);
  assert.equal(clean.stats.cleanCount, 880);
  assert.equal(clean.stats.anomaliesCorrected, 0);
  assert.equal(clean.records.filter((record) => record.quality === "filled").length, clean.stats.missingFilled);
});

test("异常数据完成去重、补缺与异常修正", () => {
  const clean = cleaned.abnormal;
  assert.equal(clean.stats.duplicates, 5);
  assert.ok(clean.stats.missingFilled > 0);
  assert.equal(clean.stats.anomaliesCorrected, 5);
  assert.equal(clean.stats.cleanCount, 880);
  assert.equal(
    clean.records.filter((record) => record.quality === "corrected").length,
    clean.stats.anomaliesCorrected,
  );
  assert.ok(clean.records.every((record) => record.kwh >= 0));
});

test("正常筛选返回 2F 市电并聚合 16 个区间", () => {
  const clean = cleaned.normal;
  const filter = { floor: "2F", source: "grid", search: "" };
  const records = filterRecords(clean.records, filter);
  const aggregate = aggregateDataset(clean, filter, "midday");
  assert.equal(records.length, 264);
  assert.equal(aggregate.intervals.length, 16);
  assert.equal(aggregate.recordCount, 48);
  assert.equal(aggregate.zones.length, 3);
  assert.ok(aggregate.gridAvg > 0);
  assert.equal(aggregate.pvAvg, 0);
  assert.equal(aggregate.hasData, true);
});

test("空搜索返回空结果，所有统计为零", () => {
  const clean = cleaned.normal;
  const filter = { floor: "all", source: "all", search: "不存在的区域" };
  const aggregate = aggregateDataset(clean, filter, "morning");
  const flow = buildFlow(aggregate, {});
  assert.equal(aggregate.hasData, false);
  assert.equal(aggregate.recordCount, 0);
  assert.equal(aggregate.totalKwh, 0);
  assert.equal(flow.totals.input, 0);
  assert.equal(flow.totals.useful, 0);
  assert.equal(flow.totals.loss, 0);
  assert.equal(flow.conservation.ok, true);
  const candidate = buildSnapshot(clean, {
    windowId: "morning",
    filter,
    loadFactors: {},
    rangeMode: "window",
  });
  const csv = buildCsv(candidate);
  assert.match(csv, /"result","NO_MATCHING_RECORDS"/);
  assert.doesNotMatch(csv, /"06:00","0\.0000"/);
});

test("设备负载变化后总输入严格守恒", () => {
  const clean = cleaned.normal;
  const baseConfig = {
    windowId: "afternoon",
    filter: allFilter,
    loadFactors: Object.fromEntries(DEVICES.map((device) => [device.id, 1])),
  };
  const baseline = buildSnapshot(clean, baseConfig);
  const adjusted = buildSnapshot(clean, {
    ...baseConfig,
    loadFactors: { hvac: 1.4, lighting: 1.3, plug: 1.2, elevator: 1.1 },
  });
  assert.ok(adjusted.flow.totals.input > baseline.flow.totals.input);
  assert.notEqual(adjusted.flow.totals.loss, baseline.flow.totals.loss);
  for (const candidate of [baseline, adjusted]) {
    const { input, useful, loss } = candidate.flow.totals;
    const nodeIn = candidate.flow.links
      .filter((link) => link.target === "bus")
      .reduce((sum, link) => sum + link.value, 0);
    const nodeOut = candidate.flow.links
      .filter((link) => link.source === "bus")
      .reduce((sum, link) => sum + link.value, 0);
    assert.ok(Math.abs(input - (useful + loss)) < 1e-7);
    assert.ok(Math.abs(nodeIn - nodeOut) < 1e-7);
    assert.equal(candidate.flow.conservation.ok, true);
  }
});

test("所有数据集、窗口和边界负载均保持守恒", () => {
  for (const dataset of DATASETS) {
    for (const window of WINDOWS) {
      for (const factor of [0.2, 1, 1.4]) {
        const candidate = buildSnapshot(cleaned[dataset.id], {
          windowId: window.id,
          filter: allFilter,
          loadFactors: Object.fromEntries(DEVICES.map((device) => [device.id, factor])),
        });
        const { input, useful, loss } = candidate.flow.totals;
        assert.ok(Math.abs(input - (useful + loss)) < 1e-7, `${dataset.id}/${window.id}/${factor}`);
        assert.equal(candidate.flow.conservation.ok, true);
      }
    }
  }
});

test("导出清单与 CSV 复用当前快照数值", () => {
  const candidate = buildSnapshot(cleaned.abnormal, {
    windowId: "midday",
    filter: { floor: "3F", source: "grid", search: "" },
    loadFactors: { hvac: 1.2, lighting: 0.8, plug: 1, elevator: 1.1 },
    rangeMode: "day",
  });
  const manifest = buildExportManifest(candidate);
  assert.equal(manifest.kpis.input, candidate.flow.totals.input);
  assert.equal(manifest.kpis.useful, candidate.flow.totals.useful);
  assert.equal(manifest.kpis.loss, candidate.flow.totals.loss);
  assert.equal(manifest.dataVersion, candidate.dataVersion);
  assert.equal(manifest.scenarioVersion, candidate.scenarioVersion);
  assert.equal(manifest.displayRange, "全天 00:00–22:00");
  assert.equal(manifest.nodes.length, candidate.flow.nodes.length);
  const csv = buildCsv(candidate);
  assert.match(csv, new RegExp(manifest.dataVersion));
  assert.match(csv, /"conservation","PASS"/);
  assert.match(csv, /"interval","grid_kW","pv_kW","total_kW"/);
  assert.equal(csv.split("\n").length >= candidate.aggregate.intervals.length + 16, true);
});

test("相同条件得到相同场景版本，条件变化则版本变化", () => {
  const config = {
    windowId: "evening",
    filter: { floor: "1F", source: "grid", search: "" },
    loadFactors: { hvac: 1, lighting: 1, plug: 1, elevator: 1 },
    rangeMode: "window",
  };
  const first = buildSnapshot(cleaned.normal, config);
  const second = buildSnapshot(cleaned.normal, config);
  const changed = buildSnapshot(cleaned.normal, {
    ...config,
    loadFactors: { ...config.loadFactors, hvac: 1.3 },
  });
  assert.equal(first.scenarioVersion, second.scenarioVersion);
  assert.notEqual(first.scenarioVersion, changed.scenarioVersion);
  assert.equal(first.dataVersion, second.dataVersion);
  assert.deepEqual(FLOORS.map((floor) => floor.id), ["1F", "2F", "3F", "roof"]);
});
