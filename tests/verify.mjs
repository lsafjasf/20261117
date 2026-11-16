import assert from "node:assert/strict";
import {
  AREAS,
  DATASETS,
  RAW_TIMES,
  THRESHOLD,
  getProcessedDataset,
  getWindowRows
} from "../data.js";

const results = [];
const check = (name, condition, detail) => {
  assert.ok(condition, `${name}: ${detail}`);
  results.push(`PASS ${name} — ${detail}`);
};

const expectedSamples = AREAS.length * RAW_TIMES.length;
for (const dataset of DATASETS) {
  const processed = getProcessedDataset(dataset.id);
  const summary = processed.summary;
  const uniqueKeys = new Set(processed.deduped.map((row) => `${row.zoneId}|${row.time}`));
  check(`${dataset.id} / 去重`, uniqueKeys.size === summary.uniqueRows && summary.rawRows > summary.uniqueRows,
    `${summary.rawRows} 原始 → ${summary.uniqueRows} 唯一，折叠 ${summary.duplicateRows}`);
  check(`${dataset.id} / 补缺`, summary.remainingGaps === 0 && summary.imputedRows === summary.missingRows,
    `${summary.missingRows} 缺失 → ${summary.imputedRows} 补全，${summary.remainingGaps} 残留`);
  check(`${dataset.id} / 聚合`, summary.aggregatedRows === AREAS.length * 24,
    `${summary.aggregatedRows} 行 = ${AREAS.length} 区域 × 24 个 5 min 桶`);
  check(`${dataset.id} / 版本`, getProcessedDataset(dataset.id).summary.version === summary.version,
    `#${summary.version} 稳定`);
}

const normal = getProcessedDataset("normal");
const missing = getProcessedDataset("missing");
const anomaly = getProcessedDataset("anomaly");
check("正常组阈值", normal.aggregated.every((row) => row.density < THRESHOLD),
  `最大密度 ${Math.max(...normal.aggregated.map((row) => row.density)).toFixed(2)} < ${THRESHOLD}`);
check("缺失组缺口", missing.summary.missingRows === 24 && missing.summary.imputedRows === 24,
  `${missing.summary.missingRows} 个空洞全部线性补缺`);
const anomalyZones = [...new Set(anomaly.aggregated.filter((row) => row.anomaly).map((row) => row.zoneId))].sort();
check("异常组区域", anomalyZones.join(",") === "B,M,S",
  `具体异常区域：${anomalyZones.map((id) => AREAS.find((area) => area.id === id).name).join("、")}`);
check("版本隔离", new Set([normal, missing, anomaly].map((item) => item.summary.version)).size === 3,
  `${normal.summary.version} / ${missing.summary.version} / ${anomaly.summary.version}`);

const normalFilterRows = getWindowRows(normal, "0809").filter((row) => {
  const area = AREAS.find((item) => item.id === row.zoneId);
  return area.type === "passage" && ["N", "M"].includes(area.id);
});
check("正常筛选", normalFilterRows.length === 24,
  "08:00–09:00 / 进站 / 通道 / 北通道+中央通道 → 24 聚合行");
const emptyRows = getWindowRows(normal, "0809").filter(() => false);
const emptyAverage = emptyRows.length ? emptyRows.reduce((sum, row) => sum + row.density, 0) / emptyRows.length : null;
check("空结果", emptyRows.length === 0 && emptyAverage === null,
  "空区域集合 → 0 行，曲线均值为空，不读取预设值");

console.log(results.join("\n"));
console.log(`\n${results.length} checks passed · samples=${expectedSamples} · normal/missing/anomaly versions ready`);
