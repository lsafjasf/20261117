import test from "node:test";
import assert from "node:assert/strict";
import {
  BATCHES,
  advance,
  createSimulation,
  currentBatch,
  exportReport,
  loadNextBatch,
  pauseSimulation,
  recoverEquipment,
  resetSession,
  resumeSimulation,
  setParameter,
  startProduction,
  stepSimulation
} from "../src/simulation.js";
import { runAllScenarios, runScenario } from "../src/validation.js";

const closeTo = (actual, expected, tolerance = 0.15) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

function setRecommended(sim) {
  for (const [key, value] of Object.entries(currentBatch(sim).recommended)) {
    setParameter(sim, key, value);
  }
}

function finishThreeBatches() {
  const sim = createSimulation();
  for (let index = 0; index < BATCHES.length; index += 1) {
    if (index > 0) loadNextBatch(sim);
    setParameter(sim, "temp", currentBatch(sim).recommended.temp + 1, {
      source: "test"
    });
    setRecommended(sim);
    const started = startProduction(sim);
    assert.equal(started.started, true);
    advance(sim, 300);
  }
  return sim;
}

test("normal production passes all three inspections through the engine", () => {
  const sim = finishThreeBatches();
  assert.equal(sim.status, "complete");
  assert.equal(sim.production.goodUnits, 3);
  assert.equal(sim.production.inspectedUnits, 3);
  assert.equal(sim.production.failedInspections, 0);
  assert.equal(sim.production.batchResults.length, 3);
  assert.ok(sim.production.batchResults.every((result) => result.passed));
  assert.equal(sim.energy.peakKw, 3.6);
  assert.equal(sim.cache.hits, 3);
});

test("production, energy and cache share the frozen simulation clock", () => {
  const sim = createSimulation();
  setRecommended(sim);
  startProduction(sim);
  advance(sim, 5.3);
  const pausedAt = sim.clock;
  const paused = pauseSimulation(sim);
  assert.equal(paused.paused, true);
  assert.equal(advance(sim, 30), 0);
  assert.equal(sim.clock, pausedAt);
  assert.equal(sim.production.lastUpdate, pausedAt);
  assert.equal(sim.energy.lastUpdate, pausedAt);
  assert.equal(sim.cache.lastUpdate, pausedAt);

  stepSimulation(sim, 1);
  assert.equal(sim.status, "paused");
  closeTo(sim.clock, pausedAt + 1);
  assert.equal(sim.production.lastUpdate, sim.clock);
  assert.equal(sim.energy.lastUpdate, sim.clock);
  assert.equal(sim.cache.lastUpdate, sim.clock);
  assert.equal(sim.production.inspectedUnits, 0);

  resumeSimulation(sim);
  assert.equal(sim.status, "running");
  advance(sim, 10);
  assert.ok(sim.clock > pausedAt + 10);
});

test("parameter changes and equipment starts/stops are all audit logged", () => {
  const sim = createSimulation();
  setRecommended(sim);
  startProduction(sim);
  advance(sim, 2);
  setParameter(sim, "temp", 54, { source: "test" });
  advance(sim, 70);
  const types = new Set(sim.events.map((event) => event.type));
  for (const type of [
    "parameter-change",
    "equipment-start",
    "equipment-stop",
    "batch-result"
  ]) {
    assert.ok(types.has(type), `missing ${type}`);
  }
  const change = sim.events.find((event) => event.type === "parameter-change");
  assert.equal(change.previous, 50);
  assert.equal(change.value, 54);
  assert.equal(change.at, 2);
});

test("parameter window excess records trigger values and a failed inspection", () => {
  const sim = createSimulation();
  setRecommended(sim);
  startProduction(sim);
  advance(sim, 4);
  setParameter(sim, "duration", 66, { source: "test" });
  const warning = sim.events.find(
    (event) => event.type === "quality-limit" && event.parameter === "duration"
  );
  assert.ok(warning);
  assert.equal(warning.at, 4);
  assert.deepEqual(warning.values, { duration: 66, temp: 50, rpm: 900 });
  advance(sim, 300);
  assert.equal(sim.status, "inspection");
  assert.equal(sim.inspection.passed, false);
  assert.match(sim.inspection.reason, /腐蚀/);
  assert.match(sim.inspection.anomalyLocation, /超声槽/);
});

test("short cleaning leaves residue while low drying temperature causes rust", () => {
  const short = createSimulation();
  setParameter(short, "duration", 20);
  setParameter(short, "temp", 62);
  setParameter(short, "rpm", 1350);
  startProduction(short);
  advance(short, 300);
  assert.equal(short.inspection.passed, false);
  assert.ok(short.inspection.issues.some((issue) => issue.type === "residue"));
  assert.match(short.inspection.anomalyLocation, /盲孔/);

  const cold = createSimulation();
  setParameter(cold, "duration", 60);
  setParameter(cold, "temp", 30);
  setParameter(cold, "rpm", 1250);
  startProduction(cold);
  advance(cold, 300);
  assert.equal(cold.inspection.passed, false);
  assert.ok(cold.inspection.issues.some((issue) => issue.type === "rust"));
  assert.match(cold.inspection.anomalyLocation, /烘干腔/);
});

test("hard-limit change stops equipment and recovery preserves the current batch", () => {
  const sim = createSimulation();
  setRecommended(sim);
  startProduction(sim);
  advance(sim, 6);
  setParameter(sim, "rpm", 1500, { source: "test" });
  assert.equal(sim.status, "fault");
  assert.equal(sim.fault.code, "BASKET_OVERLOAD");
  assert.equal(sim.fault.at, 6);
  assert.equal(sim.fault.values.rpm, 1500);
  assert.equal(sim.activeEquipment.length, 0);
  assert.ok(sim.events.some((event) => event.type === "equipment-fault"));

  const batchBefore = currentBatch(sim).id;
  const recovered = recoverEquipment(sim);
  assert.equal(recovered.recovered, true);
  assert.equal(sim.status, "idle");
  assert.equal(currentBatch(sim).id, batchBefore);
  setRecommended(sim);
  startProduction(sim);
  advance(sim, 300);
  assert.equal(sim.inspection.passed, true);
});

test("session reset discards prior cache and telemetry", () => {
  const sim = finishThreeBatches();
  assert.ok(sim.cache.entries.length > 0);
  assert.ok(sim.events.length > 0);
  const oldEpoch = sim.sessionEpoch;
  resetSession(sim);
  assert.equal(sim.sessionEpoch, oldEpoch + 1);
  assert.equal(sim.clock, 0);
  assert.equal(sim.cache.entries.length, 0);
  assert.equal(sim.cache.hits, 0);
  assert.equal(sim.production.goodUnits, 0);
  assert.equal(sim.events.length, 1);
  assert.equal(sim.events[0].type, "session-reset");
  assert.equal(exportReport(sim).cacheClearedOnReset, true);
});

test("normal, parameter-limit, shutdown and extreme scenarios execute", () => {
  const results = runAllScenarios();
  assert.equal(results.length, 4);
  assert.ok(results.every((result) => result.passed), JSON.stringify(results, null, 2));
  const abnormal = results.find((result) => result.id === "parameter-limit");
  assert.equal(abnormal.trigger.at, 4);
  assert.equal(abnormal.trigger.values.duration, 66);
  assert.equal(abnormal.recovery.result, "pass");
  assert.equal(abnormal.yieldRate, 75);

  const shutdown = results.find((result) => result.id === "equipment-stop");
  assert.equal(shutdown.trigger.code, "BASKET_OVERLOAD");
  assert.equal(shutdown.trigger.values.rpm, 1500);
  assert.equal(shutdown.recovery.result, "pass");
  assert.equal(shutdown.stopCount, 1);
  assert.match(shutdown.stopReasons[0], /联锁停机/);
});

test("exported report contains yield, peak, stops and anomaly locations", () => {
  const scenario = runScenario("parameter-limit");
  const sim = finishThreeBatches();
  const report = exportReport(sim, { scenarios: [scenario] });
  assert.equal(report.goodUnits, 3);
  assert.equal(report.goodRatePercent, 100);
  assert.equal(report.peakKw, 3.6);
  assert.ok(Array.isArray(report.stopReasons));
  assert.equal(report.scenarios[0].trigger.at, 4);
  assert.match(report.scenarios[0].anomalies[0].location, /超声槽/);
  assert.ok(report.events.some((event) => event.type === "parameter-change"));
  assert.ok(report.events.some((event) => event.type === "equipment-start"));
  assert.ok(report.events.some((event) => event.type === "equipment-stop"));
});
