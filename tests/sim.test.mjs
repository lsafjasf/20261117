import test from "node:test";
import assert from "node:assert/strict";

import {
  RECOVERY_HOURS,
  advanceSimulation,
  createSimulation,
  formatSimTime,
  injectCritical,
  recordSteadySample,
  startFailureDemo,
  targetMet,
  toggleControl
} from "../sim.js";

function simulate(state, hours, step = 0.1) {
  let remaining = hours;
  while (remaining > 0.00001) {
    const slice = Math.min(step, remaining);
    advanceSimulation(state, slice);
    remaining -= slice;
  }
  return state;
}

test("same seed reproduces weather sequence, target positions and initial seedlings", () => {
  const first = createSimulation(47291);
  const second = createSimulation(47291);
  assert.deepEqual(first.weather, second.weather);
  assert.deepEqual(first.targets, second.targets);
  assert.deepEqual(
    first.plants.map((plant) => [plant.id, plant.height, plant.health]),
    second.plants.map((plant) => [plant.id, plant.height, plant.health])
  );
  assert.equal(first.weatherDigest, second.weatherDigest);

  const different = createSimulation(47292);
  assert.notDeepEqual(
    first.weather.map((day) => [day.kind, day.temperature, day.humidity]),
    different.weather.map((day) => [day.kind, day.temperature, day.humidity])
  );
});

test("observed values stay distinct from actual greenhouse state", () => {
  const state = createSimulation(47291);
  const initialDifference =
    Math.abs(state.observed.humidity - state.actual.humidity) +
    Math.abs(state.observed.temperature - state.actual.temperature);
  assert.ok(initialDifference > 0.05);
  simulate(state, 0.4);
  state.actual.humidity = 85;
  advanceSimulation(state, 0.05);
  assert.notEqual(state.observed.humidity, state.actual.humidity);
});

test("steady sample records timestamp and comparable before/after snapshot", () => {
  const state = createSimulation(47291);
  const entry = recordSteadySample(state, { manual: true });
  assert.equal(entry.kind, "steady");
  assert.equal(entry.outcome, "通过");
  assert.match(entry.triggeredAt, /^D\d{2} · \d{2}:00$/);
  assert.ok(entry.before);
  assert.ok(entry.after);
  assert.ok(entry.before.species.includes("罗勒"));
});

test("critical threshold triggers, actions resolve, and fixed recovery window completes", () => {
  const state = createSimulation(47291);
  const event = injectCritical(state, { type: "humidity" });
  assert.ok(event);
  assert.ok(state.actual.humidity >= 86);
  assert.ok(state.logs.some((entry) => entry.kind === "critical" && entry.triggeredAt));

  advanceSimulation(state, 0.1);
  toggleControl(state, "fan");
  simulate(state, RECOVERY_HOURS + 2);

  assert.equal(state.lastRecoveryResult, "passed");
  const completion = state.logs.find((entry) => entry.title.includes("无隐藏残留"));
  assert.ok(completion);
  assert.equal(completion.outcome, "通过");
  assert.ok(completion.triggeredAt);
  assert.ok(completion.after);
});

test("handling failure logs trigger time and before/after species, water and disease", () => {
  const state = createSimulation(47291);
  const event = startFailureDemo(state);
  assert.ok(event);
  simulate(state, 4.5);

  assert.equal(state.lastEvent.status, "failed");
  const failure = state.logs.find((entry) => entry.kind === "failure");
  assert.ok(failure);
  assert.equal(failure.outcome, "失败");
  assert.equal(failure.triggeredAt, formatSimTime(state.lastEvent.startedAt));
  assert.ok(failure.before.species.includes("奶油生菜"));
  assert.ok(failure.after);
  assert.ok(failure.after.water < failure.before.water);
  assert.ok(failure.after.contamination > failure.before.contamination);
});

test("rapid device switching adds energy penalty and switch count", () => {
  const state = createSimulation(47291);
  toggleControl(state, "fan");
  toggleControl(state, "fan");
  toggleControl(state, "mist");
  assert.equal(state.switchCount, 3);
  assert.ok(state.switchPenaltyKwh > 0);
  assert.ok(state.energyKwh >= state.switchPenaltyKwh);
  assert.ok(state.logs.some((entry) => entry.title.includes("频繁切换") || entry.detail.includes("频繁切换")));
});

test("balanced intervention reaches the 20-day success target", () => {
  const state = createSimulation(47291);
  for (let index = 0; index < 5000 && !state.finished; index += 1) {
    if (state.actual.humidity > 72 && !state.controls.fan) toggleControl(state, "fan");
    if (state.actual.humidity < 56 && state.controls.fan) toggleControl(state, "fan");
    if (state.actual.humidity < 54 && !state.controls.mist) toggleControl(state, "mist");
    if (state.actual.humidity > 64 && state.controls.mist) toggleControl(state, "mist");
    if (!state.controls.lights) toggleControl(state, "lights");
    advanceSimulation(state, 0.1);
    if (state.activeEvent && !state.controls.fan) toggleControl(state, "fan");
  }
  assert.equal(state.finished, true);
  assert.equal(state.outcome, "success");
  assert.equal(targetMet(state), 9);
});
