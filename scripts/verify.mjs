import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  runFaultScenario,
  runLimitScenario,
  runNormalScenario
} from "../src/scenarios.js";

const artifactDir = fileURLToPath(new URL("../artifacts/", import.meta.url));
const runners = [
  { key: "normal", label: "正常生产", run: runNormalScenario },
  { key: "limit", label: "参数越限", run: runLimitScenario },
  { key: "fault", label: "设备停机", run: runFaultScenario }
];

function cell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function rowsToCsv(rows) {
  return rows.map((row) => row.map(cell).join(",")).join("\n");
}

function eventsCsv(events) {
  return rowsToCsv([
    ["t_s", "type", "device", "detail", "values_json"],
    ...events.map((event) => [
      event.t,
      event.type,
      event.device,
      event.detail,
      JSON.stringify(event.values)
    ])
  ]);
}

function batchesCsv(batches) {
  return rowsToCsv([
    ["batch_no", "recipe", "result", "started_s", "finished_s", "total_kg", "reasons"],
    ...batches.map((batch) => [
      batch.no,
      batch.recipeId,
      batch.result,
      batch.startedAt ?? "",
      batch.finishedAt,
      batch.totalKg,
      batch.reasons.join("；")
    ])
  ]);
}

await mkdir(artifactDir, { recursive: true });
const summaries = [];
for (const runner of runners) {
  const summary = runner.run();
  const report = summary._report;
  report.scenario = runner.label;
  report.passed = summary.passed;
  report.exceptionLocations = summary.exceptionLocations;
  report.triggerRecords = summary.triggers;
  report.validationChecks = summary.checks;

  await writeFile(`${artifactDir}/report-${runner.key}.json`, JSON.stringify(report, null, 2) + "\n");
  await writeFile(`${artifactDir}/events-${runner.key}.csv`, eventsCsv(report.events) + "\n");
  await writeFile(`${artifactDir}/batches-${runner.key}.csv`, batchesCsv(report.batches) + "\n");
  summaries.push(summary);
}

const validation = {
  generatedAt: new Date().toISOString(),
  passed: summaries.every((summary) => summary.passed),
  scenarios: summaries
};
await writeFile(`${artifactDir}/validation-summary.json`, JSON.stringify(validation, null, 2) + "\n");

console.log("Verification artifacts");
for (const summary of summaries) {
  console.log(
    `${summary.passed ? "PASS" : "FAIL"}  ${summary.scenario.padEnd(6)}  ` +
    `good=${summary.goodBatches}/${summary.totalBatches}  ` +
    `rate=${(summary.goodRate * 100).toFixed(1)}%  ` +
    `peak=${summary.peakPowerKw.toFixed(2)}kW  ` +
    `stops=${summary.stops.length}  ` +
    `exceptions=${summary.exceptionLocations.join(" | ") || "none"}`
  );
}
if (!validation.passed) process.exitCode = 1;
