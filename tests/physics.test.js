"use strict";

const assert = require("assert");
const P = require("../js/physics.js");

function runUntilFault(controls, mutate, maxSteps) {
  let state = P.createInitialState(controls);
  const limit = maxSteps || 700;
  for (let index = 0; index < limit; index += 1) {
    if (mutate) mutate(state, controls, index);
    P.step(state, controls);
    if (state.status === "failed") return state;
  }
  return state;
}

function testDeterministicTrajectory() {
  const controls = { load: 74, valveA: 60, valveB: 52 };
  const first = P.runSimulation(controls, 600);
  const second = P.runSimulation(controls, 600);
  assert.deepStrictEqual(first.trajectory, second.trajectory);
  assert.strictEqual(first.state.status, second.state.status);
  assert.strictEqual(first.state.time, second.state.time);
}

function testStepAndResumeEquivalence() {
  const controls = P.createInitialControls();
  const stepped = P.createInitialState(controls);
  for (let index = 0; index < 50; index += 1) P.step(stepped, controls);
  const pausedSnapshot = P.snapshot(stepped);

  P.step(stepped, controls);
  const resumedSnapshot = P.snapshot(stepped);

  const reference = P.runSimulation(controls, 51).trajectory;
  assert.deepStrictEqual(pausedSnapshot, reference[50]);
  assert.deepStrictEqual(resumedSnapshot, reference[51]);
}

function testRepeatedResetHasNoDrift() {
  const baseline = P.snapshot(P.createInitialState(P.createInitialControls()));
  for (let reset = 0; reset < 5; reset += 1) {
    const state = P.createInitialState(P.createInitialControls());
    assert.deepStrictEqual(P.snapshot(state), baseline);
    for (let index = 0; index < 20; index += 1) P.step(state, P.createInitialControls());
  }
  assert.deepStrictEqual(P.snapshot(P.createInitialState(P.createInitialControls())), baseline);
}

function testWaterHammerFaultAndFreeze() {
  const controls = { load: 78, valveA: 72, valveB: 64 };
  const state = runUntilFault(controls, function (current, input) {
    if (current.time === 5) input.valveA = 20;
  });

  assert.strictEqual(state.status, "failed");
  assert.strictEqual(state.fault.key, "hammer");
  assert.strictEqual(state.fault.code, "V-01");
  assert.strictEqual(state.fault.time, 5.1);
  assert.ok(state.fault.location);
  assert.ok(state.fault.value > state.fault.limit);

  const frozen = JSON.stringify(P.snapshot(state));
  P.step(state, controls);
  assert.strictEqual(JSON.stringify(P.snapshot(state)), frozen);
}

function testOverloadFaultStopsAtPump() {
  const controls = { load: 115, valveA: 72, valveB: 64 };
  const state = runUntilFault(controls);
  assert.strictEqual(state.status, "failed");
  assert.strictEqual(state.fault.code, "P-01");
  assert.strictEqual(state.fault.key, "load");
  assert.strictEqual(state.fault.time, 0.1);
  assert.ok(state.fault.location);
  assert.strictEqual(state.peaks.load, 115);
}

function testMissionSuccessAndPeaks() {
  const result = P.runSimulation(P.createInitialControls(), 600);
  assert.strictEqual(result.state.status, "success");
  assert.strictEqual(result.state.success, true);
  assert.strictEqual(result.state.fault, null);
  assert.ok(result.state.time < P.MISSION_TIME);
  result.state.tanks.forEach(function (tank) {
    assert.ok(Math.abs(tank.level - tank.target) <= P.TOLERANCE);
  });
  ["load", "speed", "pressure", "temperature", "hammer", "flow"].forEach(function (key) {
    assert.ok(Number.isFinite(result.state.peaks[key]));
  });
}

function testPressureDropUsesPipeGeometry() {
  const state = P.createInitialState(P.createInitialControls());
  for (let index = 0; index < 200; index += 1) P.step(state, P.createInitialControls());
  const a01 = state.pipes.find(function (pipe) { return pipe.id === "A-01"; });
  const a02 = state.pipes.find(function (pipe) { return pipe.id === "A-02"; });
  assert.strictEqual(a02.dn, 50);
  assert.strictEqual(a02.length, 25);
  assert.ok(a02.drop > 0);
  assert.ok(a01.drop > 0);
  assert.ok(a02.drop > a01.drop, "更细更长的 A-02 应产生更高单位压降");
}

const tests = [
  testDeterministicTrajectory,
  testStepAndResumeEquivalence,
  testRepeatedResetHasNoDrift,
  testWaterHammerFaultAndFreeze,
  testOverloadFaultStopsAtPump,
  testMissionSuccessAndPeaks,
  testPressureDropUsesPipeGeometry
];

tests.forEach(function (test) {
  test();
  console.log("PASS " + test.name);
});

console.log("\n" + tests.length + " physics tests passed.");
