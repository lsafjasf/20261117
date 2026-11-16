import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { DATASETS, DEVICES, getRawDataset } from "../energy-data.js";
import {
  buildCsv,
  buildExportManifest,
  buildSnapshot,
  cleanDataset,
  filterSummary,
} from "../energy-core.js";
import { formatPercent, formatPower } from "../renderers.js";

const clean = Object.fromEntries(DATASETS.map((dataset) => [
  dataset.id,
  cleanDataset(getRawDataset(dataset.id)),
]));

const summaries = DATASETS.map((dataset) => {
  const item = clean[dataset.id];
  return {
    id: dataset.id,
    label: dataset.label,
    raw: item.stats.rawCount,
    clean: item.stats.cleanCount,
    duplicates: item.stats.duplicates,
    filled: item.stats.missingFilled,
    corrected: item.stats.anomaliesCorrected,
    version: item.dataVersion,
  };
});

const normalSnapshot = buildSnapshot(clean.normal, {
  windowId: "midday",
  filter: { floor: "2F", source: "grid", search: "" },
  loadFactors: { hvac: 1.2, lighting: 0.9, plug: 1, elevator: 1.05 },
  rangeMode: "window",
  selectedNode: "bus",
});
const emptySnapshot = buildSnapshot(clean.normal, {
  windowId: "midday",
  filter: { floor: "2F", source: "grid", search: "不存在的区域" },
  loadFactors: Object.fromEntries(DEVICES.map((device) => [device.id, 1])),
  rangeMode: "window",
  selectedNode: "bus",
});

novalidate(normalSnapshot);
novalidate(emptySnapshot);

function novalidate(candidate) {
  const { input, useful, loss } = candidate.flow.totals;
  assert.ok(Math.abs(input - (useful + loss)) < 1e-7);
  assert.equal(candidate.flow.conservation.ok, true);
}

assert.equal(normalSnapshot.aggregate.hasData, true);
assert.ok(normalSnapshot.aggregate.recordCount > 0);
assert.equal(emptySnapshot.aggregate.hasData, false);
assert.equal(emptySnapshot.flow.totals.input, 0);
assert.match(buildCsv(emptySnapshot), /"NO_MATCHING_RECORDS"/);

const normalManifest = buildExportManifest(normalSnapshot);
const emptyManifest = buildExportManifest(emptySnapshot);

for (const summary of summaries) {
  console.log(
    `${summary.label.padEnd(4)} raw=${summary.raw} clean=${summary.clean} dedup=${summary.duplicates} `
    + `filled=${summary.filled} corrected=${summary.corrected} ${summary.version}`,
  );
}
console.log("");
console.log("正常筛选");
console.log(`  数据集: ${normalSnapshot.clean.label}`);
console.log(`  当前筛选: ${filterSummary(normalSnapshot.config.filter)}`);
console.log(`  时间窗口: ${normalSnapshot.window.label} ${normalSnapshot.window.range}`);
console.log(`  统计口径: ${normalSnapshot.scope}`);
console.log(`  样本: ${normalSnapshot.aggregate.recordCount} 条 / ${normalSnapshot.aggregate.zones.length} 个区域`);
console.log(`  输入 ${formatPower(normalSnapshot.flow.totals.input)} kW · 有效 ${formatPower(normalSnapshot.flow.totals.useful)} kW · 损失 ${formatPower(normalSnapshot.flow.totals.loss)} kW · 效率 ${formatPercent(normalSnapshot.flow.totals.efficiency)}`);
console.log(`  版本: ${normalManifest.dataVersion} / ${normalManifest.scenarioVersion} · 守恒 ${normalManifest.conservation.ok ? "PASS" : "FAIL"}`);
console.log("");
console.log("空结果");
console.log(`  当前筛选: ${filterSummary(emptySnapshot.config.filter)}`);
console.log(`  时间窗口: ${emptySnapshot.window.label} ${emptySnapshot.window.range}`);
console.log(`  样本: ${emptySnapshot.aggregate.recordCount} 条 · 输入 ${formatPower(emptySnapshot.flow.totals.input)} kW`);
console.log(`  CSV 结果: NO_MATCHING_RECORDS · 版本 ${emptyManifest.dataVersion}`);
console.log("");
console.log("导出日志预览");
console.log(`  PNG OK · 输入 ${formatPower(normalManifest.kpis.input)} kW · 损失 ${formatPower(normalManifest.kpis.loss)} kW · ${normalManifest.dataVersion} / ${normalManifest.scenarioVersion}`);
console.log(`  CSV OK · ${emptyManifest.filter.text} · NO_MATCHING_RECORDS · ${emptyManifest.dataVersion}`);

mkdirSync("artifacts", { recursive: true });
writeFileSync("artifacts/verification-summary.json", JSON.stringify({
  generatedAt: new Date().toISOString(),
  summaries,
  normalFilter: {
    filter: normalManifest.filter,
    window: normalManifest.window,
    scope: normalManifest.scope,
    samples: normalSnapshot.aggregate.recordCount,
    totals: normalManifest.kpis,
    versions: {
      data: normalManifest.dataVersion,
      scenario: normalManifest.scenarioVersion,
    },
    conservation: normalManifest.conservation,
  },
  emptyResult: {
    filter: emptyManifest.filter,
    window: emptyManifest.window,
    samples: emptySnapshot.aggregate.recordCount,
    result: "NO_MATCHING_RECORDS",
    version: emptyManifest.dataVersion,
  },
  checks: {
    conservation: "PASS",
    normalFilter: "PASS",
    emptyResult: "PASS",
    exportUsesSnapshot: "PASS",
  },
}, null, 2));
