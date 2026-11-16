import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FIXED_STEP } from "../src/config.js";
import { runFaultScenario, runLimitScenario, runNormalScenario } from "../src/scenarios.js";
import { FlourSimulation } from "../src/simulation.js";

function runUntil(sim, predicate, maxSteps = 20000) {
  for (let index = 0; index < maxSteps; index += 1) {
    if (predicate(sim)) return;
    sim.advance(FIXED_STEP);
  }
  assert.fail(`condition not reached at ${sim.clock}`);
}

function completeNormalBatch(sim) {
  assert.equal(sim.startDosing(), true);
  runUntil(sim, (state) => state.phase === "weighing");
  assert.equal(sim.openWeighGate(), true);
  runUntil(sim, (state) => state.phase === "mix_ready");
  assert.equal(sim.startMixing(), true);
  runUntil(sim, (state) => state.phase === "mix_done");
  assert.equal(sim.dischargeBatch(), true);
  runUntil(sim, (state) => ["batch_done", "success"].includes(state.phase));
}

test("production, power and cache only move on the shared simulation clock", () => {
  const sim = new FlourSimulation({ silent: true });
  assert.equal(sim.startDosing(), true);
  runUntil(sim, (state) => state.clock >= 4);
  const energy = sim.power.energyKwh;
  const measured = sim.weigh.measuredKg;
  assert.ok(energy > 0);

  assert.equal(sim.pause(), true);
  const clock = sim.clock;
  assert.equal(sim.advance(FIXED_STEP), false);
  assert.equal(sim.clock, clock);
  assert.equal(sim.power.energyKwh, energy);
  assert.equal(sim.weigh.measuredKg, measured);

  sim.step(FIXED_STEP);
  assert.equal(sim.clock, Number((clock + FIXED_STEP).toFixed(4)));
  assert.equal(sim.paused, true);
  assert.ok(sim.events.some((event) => event.type === "pause"));
  assert.ok(sim.events.some((event) => event.type === "step"));

  sim.resume();
  assert.equal(sim.paused, false);
  assert.ok(sim.events.some((event) => event.type === "resume"));
});

test("normal production reaches three good batches and reports yield, peak and cache", () => {
  const result = runNormalScenario();
  assert.equal(result.passed, true);
  assert.equal(result.goodBatches, 3);
  assert.equal(result.totalBatches, 3);
  assert.equal(result.goodRate, 1);
  assert.equal(result.success, true);
  assert.ok(result.peakPowerKw > 0);
  assert.ok(result.energyKwh > 0);
  assert.ok(result.batches.every((batch) => batch.result === "good"));
});

test("parameter limits are rejected with clock, value and recovery records", () => {
  const result = runLimitScenario();
  assert.equal(result.passed, true);
  const speed = result.triggers.find((item) => item.location.includes("高筋粉螺旋"));
  const mix = result.triggers.find((item) => item.location.includes("混合时间"));
  const gate = result.triggers.find((item) => item.location.includes("称重门联锁"));
  assert.equal(speed.values.requested, -10);
  assert.notEqual(speed.recoveredAt, null);
  assert.match(speed.recovery, /合法转速/);
  assert.equal(mix.values.requested, 120);
  assert.notEqual(mix.recoveredAt, null);
  assert.ok(gate.values.oscillationKg > 0.08);
  assert.equal(result.goodBatches, 2);
  assert.equal(result.totalBatches, 3);
  assert.equal(result.batches[0].result, "scrap");
});

test("equipment stops record trigger values and resume the current batch", () => {
  const result = runFaultScenario();
  assert.equal(result.passed, true);
  assert.equal(result.stops.length, 2);
  assert.equal(result.stops[0].device, "中筋粉螺旋");
  assert.equal(result.stops[0].values.setpoint, 30);
  assert.ok(result.stops[0].values.batchKg > 0);
  assert.equal(result.stops[1].device, "混合机");
  assert.ok(result.stops[1].values.mixElapsed > 0);
  assert.equal(result.goodBatches, 3);
  assert.equal(result.success, true);
  for (const trigger of result.triggers.filter((item) => item.kind === "equipment_stop")) {
    assert.notEqual(trigger.recoveredAt, null);
    assert.ok(trigger.recovery.length > 0);
  }
});

test("recipe change is interlocked until residue is purged", () => {
  const sim = new FlourSimulation({ silent: true });
  assert.equal(sim.startDosing(), true);
  runUntil(sim, (state) => state.clock >= 2);
  assert.equal(sim.selectRecipe("R2"), false);
  assert.equal(sim.phase, "dosing");

  sim.resetBatch();
  assert.equal(sim.selectRecipe("R2"), true);
  assert.equal(sim.purgeRequired, true);
  assert.equal(sim.startDosing(), false);
  assert.equal(sim.clearLine(), true);
  runUntil(sim, (state) => !state.purgeInProgress);
  assert.equal(sim.purgeRequired, false);
  assert.equal(sim.startDosing(), true);
});

test("hard reset discards batch, energy and package cache state", () => {
  const sim = new FlourSimulation({ silent: true });
  sim.setSpeeds([50, 30, 20]);
  completeNormalBatch(sim);
  assert.equal(sim.cache.kg > 0, true);
  assert.equal(sim.batches.length, 1);
  assert.ok(sim.power.energyKwh > 0);

  sim.hardReset();
  assert.equal(sim.clock, 0);
  assert.equal(sim.cache.kg, 0);
  assert.equal(sim.cache.batches, 0);
  assert.equal(sim.batches.length, 0);
  assert.equal(sim.goodBatches, 0);
  assert.equal(sim.power.energyKwh, 0);
  assert.equal(sim.power.peakKw, 0);
  assert.equal(sim.events.length, 1);
  assert.match(sim.events[0].detail, /缓存与全部批次状态已清空/);
});

test("events include device start/stop, parameter changes and batch result; exports are coherent", () => {
  const sim = new FlourSimulation({ silent: true });
  sim.setSpeeds([50, 30, 20]);
  sim.setMixTime(24);
  completeNormalBatch(sim);
  const report = sim.exportReport();
  assert.ok(sim.events.some((event) => event.type === "device_start"));
  assert.ok(sim.events.some((event) => event.type === "device_stop"));
  assert.ok(sim.events.some((event) => event.type === "param"));
  assert.ok(sim.events.some((event) => event.type === "batch_good"));
  assert.equal(report.goodBatches, 1);
  assert.ok(report.peakPowerKw > 0);
  assert.ok(report.events.length > 10);
  assert.match(sim.exportEventsCsv(), /device_start/);
  assert.match(sim.exportBatchesCsv(), /"batch_no","recipe","result"/);
});

test("the browser entry does not persist simulation state across reopen", async () => {
  const source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/);
  assert.match(source, /pageshow/);
});
