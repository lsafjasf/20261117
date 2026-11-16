import test from "node:test";
import assert from "node:assert/strict";
import {
  EstuarySimulation,
  GAME,
  runAcceptance,
} from "../src/sim.js";

test("稳态窗口会在连续观测稳定后触发", () => {
  const simulation = new EstuarySimulation({ seed: GAME.seedDefault });
  simulation.advance(6);
  const steady = simulation.events.find((event) => event.type === "steady");
  assert.ok(steady);
  assert.match(steady.triggeredAt, /^T\+/);
  assert.equal(steady.before.species > 0, true);
  assert.equal(steady.after.species > 0, true);
});

test("临界阈值、恢复观察与处置失败均可复现", () => {
  const result = runAcceptance(GAME.seedDefault);
  assert.equal(result.passed, true);
  assert.ok(result.critical);
  assert.ok(result.failure);
  assert.ok(result.failure.comparison.before.species >= result.failure.comparison.after.species);
  assert.equal(result.checks.find((check) => check.id === "recovery").passed, true);
  assert.equal(result.checks.find((check) => check.id === "timestamps").passed, true);
});

test("同 seed 重开复现目标分布与天气序列", () => {
  const first = new EstuarySimulation({ seed: 82117 });
  const second = new EstuarySimulation({ seed: 82117 });
  assert.deepEqual(first.getFingerprint(), second.getFingerprint());
  first.advance(20);
  second.advance(20);
  assert.deepEqual(first.actual, second.actual);
  assert.deepEqual(first.observed, second.observed);
  assert.equal(first.weatherAt(20).type, second.weatherAt(20).type);
});

test("不同 seed 会产生不同目标与天气", () => {
  const first = new EstuarySimulation({ seed: 82117 });
  const second = new EstuarySimulation({ seed: 82118 });
  assert.notDeepEqual(first.getFingerprint(), second.getFingerprint());
});

test("临界解除后固定观察结束才写入恢复记录", () => {
  const simulation = new EstuarySimulation({ seed: GAME.seedDefault });
  simulation.advance(55);
  const critical = simulation.events.find((event) => event.type === "critical");
  const recovery = simulation.events.find((event) => event.type === "recovery");
  assert.ok(critical);
  assert.ok(recovery);
  assert.ok(recovery.timeMin - critical.timeMin >= GAME.recoveryWatchMinutes);
  assert.equal(recovery.meta.watchMinutes, GAME.recoveryWatchMinutes);
  assert.ok(recovery.triggeredAt);
});

test("三批良好的放流会成为完整成功任务", () => {
  const simulation = new EstuarySimulation({ seed: GAME.seedDefault });
  simulation.setControls({ mixTemp: 20.2, releaseX: 0.5, gateSpeed: 1.2 });
  for (let index = 0; index < GAME.batchCount; index += 1) {
    const target = simulation.targets[index];
    simulation.setControls({ mixTemp: simulation.actual.estuaryTemp, releaseX: target.x });
    const batch = simulation.startBatch();
    assert.ok(batch);
    simulation.advance(batch.duration + 0.1);
  }
  assert.equal(simulation.batches.length, GAME.batchCount);
  assert.equal(simulation.missionComplete, true);
  assert.equal(simulation.missionSuccess, true);
  assert.equal(simulation.failureCount, 0);
});
