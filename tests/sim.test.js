import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPARABLE_WINDOW,
  DURATION,
  ExperimentEngine,
  RECOVERY_DURATION,
  SAMPLE_UNLOCK,
  generateTargets,
  targetFingerprint,
  weatherFingerprint,
} from "../src/sim.js";

function sampleAll(engine) {
  for (const target of [...engine.targets]) {
    const result = engine.sampleAt(target.x, target.y);
    assert.equal(result.ok, true, result.message);
  }
}

test("同一 seed 复现天气与目标分布，不同 seed 产生差异", () => {
  const first = new ExperimentEngine("MF-2407");
  const second = new ExperimentEngine("MF-2407");
  const different = new ExperimentEngine("MF-2408");

  assert.equal(weatherFingerprint("MF-2407"), weatherFingerprint("MF-2407"));
  assert.equal(targetFingerprint(generateTargets("MF-2407")), targetFingerprint(generateTargets("MF-2407")));
  assert.deepEqual(first.targets, second.targets);
  assert.notEqual(weatherFingerprint("MF-2407"), weatherFingerprint("MF-2408"));
  assert.notEqual(targetFingerprint(first.targets), targetFingerprint(different.targets));
});

test("稳定期确认写入记录，采样锁定在 12 秒解除", () => {
  const engine = new ExperimentEngine("MF-2407");
  assert.equal(engine.sampleUnlocked, false);
  engine.advanceTo(8);
  assert.equal(engine.sampleUnlocked, false);
  assert.equal(engine.sampleAt(engine.targets[0].x, engine.targets[0].y).ok, false);
  engine.advanceTo(19);
  assert.equal(engine.sampleUnlocked, true);
  const steady = engine.logs.find((entry) => entry.type === "steady");
  assert.ok(steady, "应记录稳态确认");
  assert.match(steady.detail, /温度波动/);
  assert.ok(steady.time >= 18);
  assert.ok(engine.observed.temp > 20);
});

test("三组各 3 个靶心样本在可比窗口内触发成功", () => {
  const engine = new ExperimentEngine("MF-2407");
  engine.advanceTo(SAMPLE_UNLOCK + 2);
  sampleAll(engine);

  assert.equal(engine.sampledCount, 9);
  assert.equal(engine.biasCount, 0);
  assert.equal(engine.success, true);
  assert.ok(engine.sampleSpan <= COMPARABLE_WINDOW);
  assert.equal(engine.groupState("A").complete, true);
  assert.equal(engine.groupState("B").complete, true);
  assert.equal(engine.groupState("C").complete, true);
  assert.ok(engine.logs.some((entry) => entry.title === "三组可比较数据已建立"));
});

test("偏离靶心产生对照偏差且不消耗目标", () => {
  const engine = new ExperimentEngine("MF-2407");
  engine.advanceTo(SAMPLE_UNLOCK + 1);
  const target = engine.targets[0];
  const biased = engine.sampleAt(target.x + 30, target.y);
  assert.equal(biased.ok, true);
  assert.equal(biased.bias, true);
  assert.equal(engine.sampledCount, 0);
  assert.equal(engine.biasCount, 1);
  assert.ok(biased.dish.distance > target.radius);

  const retry = engine.sampleAt(target.x, target.y);
  assert.equal(retry.ok, true);
  assert.equal(retry.bias, false);
  assert.equal(engine.sampledCount, 1);
});

test("温度越过 34°C 临界阈值并记录触发时刻", () => {
  const engine = new ExperimentEngine("MF-2407");
  engine.advanceTo(42);
  const warning = engine.logs.find(
    (entry) =>
      entry.type === "threshold" &&
      entry.data?.metric === "temp" &&
      entry.severity === "critical",
  );
  assert.ok(warning, "应捕获温度临界记录");
  assert.ok(engine.actual.temp >= 34);
  assert.ok(warning.time > 0 && warning.time < DURATION);
  assert.ok(warning.detail.includes("实际"));
  assert.ok(warning.detail.includes("观测"));
  assert.ok(engine.criticalCount >= 1);
});

test("高湿灌溉形成处置失败并保留操作前后指标", () => {
  const engine = new ExperimentEngine("MF-2407");
  engine.advanceTo(62);
  const before = engine.snapshot();
  const result = engine.applyIntervention("irrigation");

  assert.equal(result.ok, true);
  assert.equal(result.failed, true);
  assert.equal(engine.failureCount, 1);
  assert.ok(engine.latent >= 20);
  assert.ok(result.operation.after.water > result.operation.before.water);
  assert.ok(result.operation.after.contamination > result.operation.before.contamination);
  assert.ok(result.operation.after.species.A !== before.species.A);
  const failure = engine.logs.find((entry) => entry.severity === "failure");
  assert.ok(failure);
  assert.equal(failure.data.triggerTime, 62);
  assert.equal(failure.time, 62);
});

test("处置失败后固定运行 8 秒确认无隐藏残留", () => {
  const engine = new ExperimentEngine("MF-2407");
  engine.advanceTo(62);
  engine.applyIntervention("irrigation");
  const started = engine.beginRecovery();
  assert.equal(started.ok, true);
  const startTime = engine.elapsed;

  engine.advanceTo(startTime + RECOVERY_DURATION - 1);
  assert.equal(engine.recovery.active, true);
  assert.equal(engine.recovery.completed, false);

  engine.advanceTo(startTime + RECOVERY_DURATION + 0.1);
  assert.equal(engine.recovery.active, false);
  assert.equal(engine.recovery.completed, true);
  assert.equal(engine.recovery.clean, true);
  assert.ok(engine.latent < 4.5);
  assert.equal(engine.recoveryRuns.length, 1);
  assert.ok(engine.recoveryRuns[0].duration >= RECOVERY_DURATION - 0.1);
  assert.ok(
    engine.logs.some(
      (entry) => entry.type === "recovery" && entry.title.includes("无隐藏残留"),
    ),
  );
});

test("恢复校验保留触发时刻，重开后指纹与目标坐标一致", () => {
  const original = new ExperimentEngine("MF-2407");
  original.advanceTo(40);
  original.advanceTo(62);
  original.applyIntervention("irrigation");
  original.beginRecovery();
  original.advanceTo(70.2);
  const verification = original.verificationSummary();
  assert.equal(verification.pass, true);
  assert.equal(verification.criticalVerified, true);
  assert.equal(verification.failureVerified, true);
  assert.equal(verification.recoveryVerified, true);
  assert.ok(verification.triggerTimes.every((entry) => Number.isFinite(entry.time)));

  const reopened = new ExperimentEngine("MF-2407");
  assert.equal(weatherFingerprint(original.seed), reopened.initialWeatherHash);
  assert.equal(targetFingerprint(original.targets), reopened.initialTargetHash);
  assert.deepEqual(
    original.targets.map((target) => [target.id, target.x, target.y]),
    reopened.targets.map((target) => [target.id, target.x, target.y]),
  );
});
