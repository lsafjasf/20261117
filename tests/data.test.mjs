import assert from "node:assert/strict";
import test from "node:test";
import {
  AIRLINES,
  SCENARIOS,
  WINDOWS,
  buildSnapshot,
  processFlights,
} from "../js/data.js";
import { buildExportModel } from "../js/export.js";
import { DEFAULT_MAP_VIEW, WindowStateStore, normalizeMapView } from "../js/state.js";
import { runValidationTests } from "../js/validation.js";

const allAirlines = Object.keys(AIRLINES);

test("normal scenario is clean and aggregation conserves flights", () => {
  const processed = processFlights(SCENARIOS.normal.flights);
  assert.equal(processed.quality.sourceRows, 96);
  assert.equal(processed.quality.accepted, 96);
  assert.equal(processed.quality.duplicatesRemoved, 0);
  assert.equal(processed.quality.repairedMissing, 0);
  assert.equal(processed.quality.repairedInvalid, 0);

  const snapshot = buildSnapshot({
    scenarioId: "normal",
    windowId: "morning",
    airlines: allAirlines,
  });
  assert.equal(snapshot.summary.flights, 24);
  assert.equal(snapshot.summary.routes, 12);
  assert.equal(
    snapshot.routes.reduce((sum, route) => sum + route.count, 0),
    snapshot.flights.length,
  );
  assert.equal(
    snapshot.routes.reduce((sum, route) => sum + route.cancelledCount, 0),
    snapshot.summary.cancelled,
  );
  assert.ok(new Set(snapshot.routes.map((route) => route.count)).size > 1);
});

test("missing scenario removes duplicates and repairs every missing delay", () => {
  const processed = processFlights(SCENARIOS.missing.flights);
  assert.equal(processed.quality.duplicatesRemoved, 1);
  assert.equal(processed.quality.repairedMissing, 3);
  assert.equal(processed.quality.sourceRows - processed.quality.duplicatesRemoved, processed.quality.accepted);
  assert.equal(
    new Set(processed.flights.map((flight) => flight.flightKey)).size,
    processed.flights.length,
  );
  assert.ok(
    processed.flights.every(
      (flight) => flight.cancelled || Number.isFinite(flight.delayMinFinal),
    ),
  );
});

test("anomalous scenario repairs invalid values before aggregation", () => {
  const processed = processFlights(SCENARIOS.anomalous.flights);
  assert.equal(processed.quality.duplicatesRemoved, 2);
  assert.equal(processed.quality.repairedMissing, 2);
  assert.equal(processed.quality.repairedInvalid, 2);
  assert.ok(
    processed.flights.every(
      (flight) =>
        flight.cancelled ||
        (flight.delayMinFinal >= 0 && flight.delayMinFinal <= 720),
    ),
  );
  assert.ok(
    processed.flights.some((flight) => flight.qualityFlag === "invalid-repaired"),
  );
});

test("normal window returns data and empty airline selection returns empty state", () => {
  const normal = buildSnapshot({
    scenarioId: "normal",
    windowId: "morning",
    airlines: allAirlines,
  });
  const empty = buildSnapshot({
    scenarioId: "normal",
    windowId: "morning",
    airlines: [],
  });
  assert.ok(normal.summary.flights > 0);
  assert.ok(normal.summary.avgDelay > 0);
  assert.equal(empty.summary.flights, 0);
  assert.equal(empty.summary.routes, 0);
  assert.equal(empty.summary.avgDelay, null);
  assert.equal(empty.trend.every((bin) => bin.count === 0), true);
});

test("all four windows keep flights inside their own range", () => {
  for (const window of WINDOWS) {
    const snapshot = buildSnapshot({
      scenarioId: "normal",
      windowId: window.id,
      airlines: allAirlines,
    });
    assert.ok(snapshot.summary.flights > 0);
    assert.ok(
      snapshot.flights.every(
        (flight) =>
          flight.scheduledMinutes >= window.start &&
          flight.scheduledMinutes < window.end,
      ),
    );
  }
});

test("export model is numerically identical to the rendered snapshot", () => {
  const snapshot = buildSnapshot({
    scenarioId: "anomalous",
    windowId: "midday",
    airlines: ["CA", "MU", "3U"],
  });
  const model = buildExportModel(snapshot, {
    selectedRouteKey: snapshot.routes[0]?.key,
  });
  assert.deepEqual(model.summary, snapshot.summary);
  assert.equal(model.viewVersion, snapshot.viewVersion);
  assert.equal(model.dataVersion, snapshot.dataVersion);
  assert.equal(model.flights.length, snapshot.flights.length);
  assert.deepEqual(
    model.routes.map((route) => route.count),
    snapshot.routes.map((route) => route.count),
  );
});

test("window state round trip preserves airline, route and map extent", () => {
  const store = new WindowStateStore();
  const morning = {
    airlines: ["CA", "MU"],
    selectedRouteKey: "PEK-PVG",
    mapView: { scale: 1.62, panX: 44, panY: -18 },
  };
  store.save("normal", "morning", morning);
  store.save("normal", "midday", {
    airlines: allAirlines,
    selectedRouteKey: null,
    mapView: DEFAULT_MAP_VIEW,
  });
  assert.deepEqual(store.load("normal", "morning"), morning);
  assert.equal(store.load("normal", "midday").selectedRouteKey, null);
  assert.deepEqual(normalizeMapView({ scale: 9, panX: 8 }), {
    scale: 2.8,
    panX: 8,
    panY: 0,
  });
});

test("embedded quality validation suite passes", () => {
  const tests = runValidationTests();
  assert.equal(tests.length, 8);
  assert.equal(tests.every((item) => item.pass), true);
});
