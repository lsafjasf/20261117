import test from "node:test";
import assert from "node:assert/strict";
import { GRADES, ROADS } from "../src/data.js";
import {
  buildView,
  computeRoute,
  getPreparedDataset,
  runSelfChecks,
} from "../src/engine.js";

const allGrades = GRADES.map((grade) => grade.id);

test("normal dataset keeps all samples and aggregates one view", () => {
  const prepared = getPreparedDataset("normal");
  assert.equal(prepared.summary.rawRows, 672);
  assert.equal(prepared.summary.finalRows, 672);
  assert.equal(prepared.summary.duplicateRows, 0);
  assert.equal(prepared.summary.invalidRows, 0);

  const view = buildView("normal", "w0809", { direction: "all", grades: allGrades });
  assert.equal(view.roads.length, 14);
  assert.equal(view.series.length, 12);
  assert.equal(view.stats.samples, 168);
  assert.equal(view.stats.coverage, 1);
  assert.equal(
    view.legend.reduce((sum, bin) => sum + bin.count, 0),
    view.roads.length,
    "legend counts must equal rendered road count",
  );
  assert.equal(view.stats.hotspotCount, view.roads.filter((road) => road.index >= 50).length);
  assert.deepEqual(view.roads.map((road) => road.id).length, new Set(view.roads.map((road) => road.id)).size);
});

test("missing dataset is deduplicated and imputed before aggregation", () => {
  const prepared = getPreparedDataset("missing");
  assert.ok(prepared.summary.duplicateRows > 0);
  assert.ok(prepared.summary.filledFields > 0);
  assert.equal(prepared.summary.finalRows, 672);
  const keys = new Set(prepared.rows.map((row) => `${row.roadId}|${row.timestamp}|${row.direction}`));
  assert.equal(keys.size, prepared.rows.length, "clean rows must be unique by the declared key");
  assert.ok(
    prepared.rows.every(
      (row) => Number.isFinite(row.speed) && Number.isFinite(row.queue) && Number.isFinite(row.volume),
    ),
  );
});

test("anomaly dataset drops bad timestamps and repairs out-of-range values", () => {
  const prepared = getPreparedDataset("anomaly");
  assert.ok(prepared.summary.invalidRows > 0);
  assert.ok(prepared.summary.anomalyFields > 0);
  assert.ok(prepared.summary.filledFields > 0);
  assert.ok(prepared.summary.coverage < 1);
  assert.ok(
    prepared.rows.every(
      (row) =>
        row.speed >= 1 &&
        row.speed <= 140 &&
        row.queue >= 0 &&
        row.queue <= 500 &&
        row.volume >= 0 &&
        row.volume <= 10000,
    ),
  );
});

test("empty filter returns a real zero snapshot without fabricated series", () => {
  const view = buildView("normal", "w0809", {
    direction: "south-north",
    grades: ["expressway"],
  });
  assert.equal(view.roads.length, 0);
  assert.equal(view.series.length, 0);
  assert.equal(view.stats.samples, 0);
  assert.equal(view.stats.speed, 0);
  assert.equal(view.stats.queue, 0);
  assert.equal(view.stats.hotspotCount, 0);
  assert.equal(view.legend.reduce((sum, bin) => sum + bin.count, 0), 0);
});

test("view revision is stable for map, chart and export consumers", () => {
  const first = buildView("normal", "w0809", { direction: "all", grades: allGrades });
  const second = buildView("normal", "w0809", { direction: "all", grades: allGrades });
  assert.equal(first.viewRevision, second.viewRevision);
  assert.deepEqual(first.stats, second.stats);
});

test("route planner excludes closures and refuses closed endpoints", () => {
  const route = computeRoute("r05", "r12", ["r06"]);
  assert.equal(route.status, "ok");
  assert.ok(route.roadIds.length > 0);
  assert.ok(!route.roadIds.includes("r06"));
  assert.equal(computeRoute("r06", "r12", ["r06"]).status, "closed-endpoint");
});

test("runtime checks cover normal and empty conditions", () => {
  const checks = runSelfChecks();
  assert.equal(checks.passed, checks.total);
  assert.ok(checks.items.find((item) => item.id === "normal")?.ok);
  assert.ok(checks.items.find((item) => item.id === "empty")?.ok);
  assert.ok(checks.items.find((item) => item.id === "dedupe")?.ok);
  assert.ok(checks.items.find((item) => item.id === "anomaly")?.ok);
  assert.equal(new Set(ROADS.map((road) => road.id)).size, ROADS.length);
});
