"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Lab = require("../data.js");

function filtersFor(overrides = {}) {
  return { ...Lab.defaultFilters(), ...overrides };
}

test("three prepared datasets expose deterministic summaries", () => {
  const expected = {
    normal: { duplicates: 6, filled: 0, anomalies: 0 },
    missing: { duplicates: 6, filled: 17, anomalies: 2 },
    abnormal: { duplicates: 9, filled: 0, anomalies: 6 }
  };

  for (const [scenario, summary] of Object.entries(expected)) {
    const dataset = Lab.getDataset(scenario);
    assert.equal(dataset.duplicateCount, summary.duplicates);
    assert.equal(dataset.filledCount, summary.filled);
    assert.equal(dataset.anomalyCount, summary.anomalies);
    assert.equal(dataset.rawCount - dataset.duplicateCount, dataset.uniqueCount);
    assert.equal(dataset.filledCount, dataset.expectedCount - dataset.uniqueCount);
    assert.match(dataset.version.short, /^DS-[0-9A-F]{4}$/);
  }
});

test("normal filter returns data and no-sensor filter returns an empty result", () => {
  const normal = Lab.createSnapshot("normal", filtersFor());
  assert.equal(normal.points.length, 108);
  assert.equal(normal.tableRows.length, 6);
  assert.equal(normal.counts.valid, 108);
  assert.equal(normal.counts.anomaly, 0);
  assert.equal(normal.stats.count, 108);

  const empty = Lab.createSnapshot("normal", filtersFor({ sensors: [], status: "valid" }));
  assert.equal(empty.points.length, 0);
  assert.equal(empty.tableRows.length, 0);
  assert.equal(empty.errorBand.length, 0);
  assert.equal(empty.stats.count, 0);
  assert.equal(empty.stats.rmse, null);
});

test("status and time filters keep every surface on one snapshot version", () => {
  const snapshot = Lab.createSnapshot("missing", filtersFor({
    windowKey: "first",
    status: "imputed",
    sensors: ["T-01", "T-03"]
  }));
  assert.equal(snapshot.window.start, 0);
  assert.equal(snapshot.window.end, 17);
  assert.equal(snapshot.points.length, snapshot.counts.imputed);
  assert.ok(snapshot.points.every((point) => point.status === "imputed"));
  assert.ok(snapshot.series.every((series) => series.points.every((point) => point.status === "imputed")));
  assert.equal(snapshot.version.short, Lab.getDataset("missing").version.short);
  assert.equal(snapshot.tableRows.length, snapshot.points.length);
  assert.equal(snapshot.bucketStats.reduce((sum, bucket) => sum + bucket.count, 0), snapshot.points.length);
});

test("calibration and reference adjustments never change sample count", () => {
  const original = Lab.createSnapshot("abnormal", filtersFor());
  const movedWindow = Lab.createSnapshot("abnormal", filtersFor({
    calibration: { start: 14, end: 24 }
  }));
  const movedReference = Lab.createSnapshot("abnormal", filtersFor({ reference: 69.4 }));

  assert.equal(original.points.length, movedWindow.points.length);
  assert.equal(original.points.length, movedReference.points.length);
  assert.equal(original.counts.all, movedWindow.counts.all);
  assert.equal(original.digest.duplicateCount, movedWindow.digest.duplicateCount);
  assert.notDeepEqual(
    original.points.map((point) => point.corrected),
    movedWindow.points.map((point) => point.corrected)
  );
  assert.deepEqual(
    original.points.map((point) => point.corrected),
    movedReference.points.map((point) => point.corrected)
  );
  const delta = 69.4 - original.reference;
  original.points.forEach((point, index) => {
    assert.ok(Math.abs((point.error - movedReference.points[index].error) - delta) < 0.002);
  });
});

test("minute aggregation reconciles with filtered sample count and mean", () => {
  const snapshot = Lab.createSnapshot("missing", filtersFor({ status: "all" }));
  const bucketCount = snapshot.bucketStats.reduce((sum, bucket) => sum + bucket.count, 0);
  assert.equal(bucketCount, snapshot.points.length);
  const weightedMean = snapshot.bucketStats
    .filter((bucket) => bucket.meanTemp !== null)
    .reduce((sum, bucket) => sum + bucket.meanTemp * bucket.count, 0) / snapshot.points.length;
  assert.ok(Math.abs(weightedMean - snapshot.stats.meanTemp) < 0.0001);
});

test("view state round-trips without losing window, selection, status, or range", () => {
  const original = Lab.createSnapshot("missing", filtersFor({
    sensors: ["T-01", "T-03"],
    windowKey: "second",
    status: "anomaly",
    reference: 68.9,
    calibration: { start: 20, end: 31 }
  }));
  const restoredState = Lab.viewStateFromSnapshot(JSON.parse(JSON.stringify(original)));
  const restored = Lab.createSnapshot(restoredState.scenario, restoredState.filters);

  assert.deepEqual(restored.filters, original.filters);
  assert.equal(restored.window.key, "second");
  assert.deepEqual(restored.filters.sensors, ["T-01", "T-03"]);
  assert.equal(restored.filters.status, "anomaly");
  assert.equal(restored.reference, 68.9);
  assert.deepEqual(restored.calibrationRange, { start: 20, end: 31 });
  assert.deepEqual(
    restored.points.map((point) => [point.sensorId, point.index, point.raw, point.corrected]),
    original.points.map((point) => [point.sensorId, point.index, point.raw, point.corrected])
  );
});

test("pipeline self-check covers normal and empty paths for all datasets", () => {
  for (const scenario of Object.keys(Lab.DATASETS)) {
    const report = Lab.pipelineReport(scenario);
    assert.equal(report.checks.dedupe, true);
    assert.equal(report.checks.gapFill, true);
    assert.equal(report.checks.aggregation, true);
    assert.equal(report.checks.sampleInvariant, true);
    assert.equal(report.checks.emptyResult, true);
    assert.equal(report.checks.normalFilterHasData, true);
  }
});
