import test from "node:test";
import assert from "node:assert/strict";
import { BoxMachine, RECIPES, recommendedParams } from "../js/engine.js";
import { runAllValidations } from "../js/validation.js";

function advance(machine, seconds, step = 0.05) {
  let remaining = seconds;
  while (remaining > 0) {
    machine.update(Math.min(step, remaining));
    remaining -= step;
  }
}

function completeWithRecommended(machine) {
  const limit = 30000;
  for (let index = 0; index < limit; index += 1) {
    if (machine.mode === "paused" && machine.changeoverPending) {
      machine.applyRecommended(machine.currentSize, { log: false });
      machine.resumeBatch("test continue");
    }
    if (["complete", "failed", "idle"].includes(machine.mode)) break;
    machine.update(0.05);
  }
}

test("production, energy and buffer use one pause-aware simulation clock", () => {
  const machine = new BoxMachine();
  machine.startBatch();
  advance(machine, 3);
  assert.ok(machine.simTime >= 3);
  assert.ok(machine.energyKwh > 0);
  assert.ok(machine.samples.length >= 3);
  assert.ok(machine.totalProduced >= 1);
  const sample = machine.samples.find((item) => item.t >= 2);
  assert.ok(sample);
  assert.equal(sample.t, machine.samples.find((item) => item.t === sample.t).t);
  assert.ok(Number.isFinite(sample.energy));
  assert.ok(Number.isFinite(sample.buffer));

  machine.pauseBatch();
  const pausedClock = machine.simTime;
  const pausedEnergy = machine.energyKwh;
  const pausedCycle = machine.cycleElapsed;
  machine.update(1);
  assert.equal(machine.simTime, pausedClock);
  assert.equal(machine.energyKwh, pausedEnergy);
  assert.equal(machine.cycleElapsed, pausedCycle);
  machine.step(0.25);
  assert.equal(machine.mode, "paused");
  assert.ok(machine.simTime > pausedClock);
  assert.ok(machine.cycleElapsed > pausedCycle);
});

test("normal batch produces 4 S, 4 M and 4 L boxes at 100 percent yield", () => {
  const machine = new BoxMachine();
  machine.startBatch();
  completeWithRecommended(machine);
  assert.equal(machine.batchResult?.result, "success");
  assert.equal(machine.goodCount, 12);
  assert.equal(machine.attempts, 12);
  assert.equal(machine.batchResult.yieldRate, 100);
  assert.deepEqual(machine.batchResult.sizeResults.S.good, 4);
  assert.deepEqual(machine.batchResult.sizeResults.M.good, 4);
  assert.deepEqual(machine.batchResult.sizeResults.L.good, 4);
  assert.ok(machine.peakPowerKw > 0);
  assert.ok(machine.logs.some((entry) => entry.event === "输送带启动"));
  assert.ok(machine.logs.some((entry) => entry.event === "压轮组停止"));
  assert.ok(machine.logs.some((entry) => entry.event === "批次完成"));
});

test("extreme parameters create located defects and recommended values recover production", () => {
  const machine = new BoxMachine();
  const recipe = RECIPES.S;
  machine.setParam("glue", recipe.glue.min - 0.16);
  machine.setParam("press", recipe.press.min - 0.08);
  machine.setParam("speed", recipe.speed.max + 10);
  machine.startBatch();
  advance(machine, 3);
  assert.equal(machine.anomalies.length, 1);
  const anomaly = machine.anomalies[0];
  assert.ok(anomaly.issues.some((issue) => issue.code === "GLUE_LOW"));
  assert.ok(anomaly.issues.some((issue) => issue.code === "PRESS_LOW"));
  assert.ok(anomaly.issues.some((issue) => issue.code === "SPEED_HIGH"));
  assert.ok(anomaly.location.length > 0);
  assert.ok(machine.logs.some((entry) => entry.tone === "bad" && entry.detail.includes(anomaly.location)));

  machine.applyRecommended("S");
  const before = machine.goodCount;
  advance(machine, 4);
  assert.ok(machine.goodCount > before);
  assert.ok(machine.qualityHistory.some((item) => item.ok));
});

test("equipment stop holds production while the shared clock and idle energy continue", () => {
  const machine = new BoxMachine();
  machine.startBatch();
  for (let index = 0; index < 200 && machine.phase !== "press"; index += 1) machine.update(0.05);
  assert.equal(machine.phase, "press");
  const produced = machine.totalProduced;
  const energy = machine.energyKwh;
  const snapshot = machine.stopEquipment("test overload", "main shaft");
  assert.ok(snapshot);
  assert.equal(machine.mode, "stopped");
  assert.equal(machine.equipmentActive, false);
  advance(machine, 1.5);
  assert.ok(machine.simTime > snapshot.time + 1.4);
  assert.equal(machine.totalProduced, produced);
  assert.ok(machine.energyKwh > energy);
  assert.equal(machine.stops[0].reason, "test overload");
  const recovery = machine.restartEquipment();
  assert.equal(machine.mode, "running");
  assert.ok(recovery.stoppedFor >= 1.4);
  advance(machine, 3);
  assert.ok(machine.goodCount >= 1);
  assert.ok(machine.logs.filter((entry) => entry.event.includes("停止")).length >= 4);
});

test("report contains yield, peak values and stop reasons; reset removes old cache", () => {
  const machine = new BoxMachine();
  machine.startBatch();
  advance(machine, 2.5);
  machine.stopEquipment("sensor fault", "glue head");
  const report = machine.buildReport();
  assert.equal(report.summary.goodCount, machine.goodCount);
  assert.ok(report.summary.peakPowerKw > 0);
  assert.deepEqual(report.summary.stopReasons, ["sensor fault"]);
  assert.equal(report.stops[0].location, "glue head");
  assert.ok(report.parameterChanges.length >= 0);
  assert.ok(report.equipmentEvents.length >= 5);
  assert.ok(report.telemetrySamples.length > 0);

  machine.resetBatch();
  assert.equal(machine.simTime, 0);
  assert.equal(machine.goodCount, 0);
  assert.equal(machine.attempts, 0);
  assert.equal(machine.energyKwh, 0);
  assert.equal(machine.bufferCount, 0);
  assert.equal(machine.anomalies.length, 0);
  assert.equal(machine.stops.length, 0);
  assert.equal(machine.logs.length, 1);
  assert.match(machine.logs[0].detail, /清空/);
  assert.equal(machine.samples.length, 1);
});

test("embedded validation suite exercises all three flows with actual engine state", () => {
  const suite = runAllValidations();
  assert.equal(suite.total, 3);
  assert.equal(suite.passed, 3);
  assert.equal(suite.results.normal.yieldRate, 100);
  assert.equal(suite.results.extreme.anomalyLocation.includes("侧边接缝"), true);
  assert.equal(suite.results.extreme.passed, true);
  assert.equal(suite.results.fault.duringStop.produced, 0);
  assert.ok(suite.results.fault.recovery.restoredAt > suite.results.fault.triggeredAt);
});

test("recommended recipes stay inside their process windows for all sizes", () => {
  for (const sizeId of ["S", "M", "L"]) {
    const values = recommendedParams(sizeId);
    const recipe = RECIPES[sizeId];
    assert.ok(values.glue >= recipe.glue.min && values.glue <= recipe.glue.max);
    assert.ok(values.press >= recipe.press.min && values.press <= recipe.press.max);
    assert.ok(values.speed >= recipe.speed.min && values.speed <= recipe.speed.max);
  }
});

test("changing parameters mid-cycle cannot make the process clock run backwards", () => {
  const machine = new BoxMachine();
  machine.startBatch();
  advance(machine, 1.7);
  const before = machine.simTime;
  machine.setParam("press", 0.2);
  machine.setParam("speed", 120);
  advance(machine, 1);
  assert.ok(machine.simTime > before);
  assert.ok(machine.cycleElapsed >= 0);
  assert.ok(machine.totalProduced >= 1);
});
