import test from "node:test";
import assert from "node:assert/strict";
import { CONFIG, TOTAL_SECONDS, WetlandSim } from "../src/sim.js";

function runUntil(sim, predicate, limit = TOTAL_SECONDS) {
  while (!predicate(sim) && sim.elapsed < limit) sim.advance(0.05);
  return predicate(sim);
}

test("same seed reproduces weather, target layout, and sensor noise", () => {
  const first = new WetlandSim({ seed: 82417 });
  const second = new WetlandSim({ seed: 82417 });
  const different = new WetlandSim({ seed: 82418 });

  assert.deepEqual(first.getReproductionPayload(), second.getReproductionPayload());
  assert.deepEqual(first.getSignature(), second.getSignature());
  assert.notDeepEqual(first.getReproductionPayload(), different.getReproductionPayload());

  first.advance(37.5);
  second.advance(37.5);
  assert.equal(first.level, second.level);
  assert.equal(first.observed.level, second.observed.level);
  assert.equal(first.beaver.activity, second.beaver.activity);
});

test("environment changes continuously and observed data lags actual data", () => {
  const sim = new WetlandSim({ seed: 82417 });
  const initialLevel = sim.level;
  sim.advance(10);
  assert.notEqual(sim.level, initialLevel);
  assert.ok(sim.history.length > 40);
  assert.ok(Math.abs(sim.observed.level - sim.level) > 0.0001);

  runUntil(sim, (state) => state.alerts.actual !== "normal");
  assert.notEqual(sim.alerts.actual, "normal");
  assert.ok(
    sim.alerts.observed !== sim.alerts.actual
      || Math.abs(sim.observed.level - sim.level) > 0.01,
    "alert state and observed/actual readings must remain distinguishable"
  );
});

test("steady state, critical threshold, and handling failure are timestamped", () => {
  const sim = new WetlandSim({ seed: 82417 });
  sim.advance(100);

  assert.equal(typeof sim.stats.steadyAt, "number");
  assert.equal(typeof sim.stats.criticalAt, "number");
  assert.equal(typeof sim.stats.failureAt, "number");
  assert.ok(sim.stats.maxLevel >= CONFIG.criticalLevel - 0.001);

  for (const title of ["稳态窗口确认", "越过高水位临界阈值", "处置失败：水位仍超阈值"]) {
    const entry = sim.logs.find((log) => log.title === title);
    assert.ok(entry, `missing log: ${title}`);
    assert.equal(typeof entry.simTime, "number");
    assert.match(entry.clock, /第 \d+ 天/);
  }

  const failure = sim.logs.find((log) => log.title.startsWith("处置失败"));
  assert.ok(failure.before.level > 0);
  assert.ok(failure.snapshot.safeTargets <= failure.before.safeTargets);
  assert.ok(Number.isFinite(failure.snapshot.turbidity));
});

test("recovery remains active for the fixed watch period without residual rebound", () => {
  const sim = new WetlandSim({ seed: 82417 });
  sim.advance(60);
  assert.equal(sim.alerts.actual, "warning");
  sim.applyControls({ spillway: 0.95, stakes: 0.8 });

  const entered = runUntil(sim, (state) => state.recovery !== null, 90);
  assert.ok(entered, "recovery watch should start after water recedes");
  const startedAt = sim.recovery.startedAt;
  assert.equal(sim.stats.recoveryPassAt, null);
  sim.advance(6);
  sim.applyControls({ spillway: 0.58, stakes: 0.8 });
  sim.advance(CONFIG.recoveryWatch - 6.1);
  assert.equal(sim.stats.recoveryPassAt, null);
  sim.advance(0.2);
  assert.equal(typeof sim.stats.recoveryPassAt, "number");
  assert.ok(sim.stats.recoveryPassAt - startedAt >= CONFIG.recoveryWatch - 0.2);
  assert.equal(sim.stats.recoveryFailAt, null);
  assert.ok(sim.logs.some((log) => log.title === "恢复观察通过"));
});

test("intervention comparison records level, target count, and pollution before and after", () => {
  const sim = new WetlandSim({ seed: 82417 });
  sim.advance(60);
  assert.equal(sim.applyControls({ spillway: 0.9, stakes: 0.72 }), true);
  sim.advance(5.2);
  assert.ok(sim.lastComparison);
  assert.notEqual(sim.lastComparison.before.level, sim.lastComparison.after.level);
  assert.equal(typeof sim.lastComparison.before.safeTargets, "number");
  assert.equal(typeof sim.lastComparison.before.turbidity, "number");
  assert.equal(sim.stats.interventions, 1);
});

test("recovery watch fails when aggressive release drains shallow habitat", () => {
  const sim = new WetlandSim({ seed: 82417 });
  sim.advance(60);
  sim.applyControls({ spillway: 0.95, stakes: 0.8 });
  assert.ok(runUntil(sim, (state) => state.recovery !== null, 90));
  sim.advance(CONFIG.recoveryWatch + 0.2);
  assert.equal(sim.stats.recoveryPassAt, null);
  assert.equal(typeof sim.stats.recoveryFailAt, "number");
  assert.ok(sim.logs.some((log) => (
    log.title.includes("残留")
    || log.title.includes("抽干")
    || log.title.includes("受威胁")
  )));
});

test("same-seed reset reproduces target positions and weather sequence", () => {
  const sim = new WetlandSim({ seed: 98765 });
  sim.advance(72.4);
  const before = sim.getReproductionPayload();
  const beforeSignature = sim.getSignature();
  sim.reset(98765);
  const after = sim.getReproductionPayload();

  assert.deepEqual(after.weather, before.weather);
  assert.deepEqual(after.targets, before.targets);
  assert.deepEqual(sim.getSignature(), beforeSignature);
  assert.equal(sim.elapsed, 0);
  assert.equal(sim.stats.failureAt, null);
});

test("ten-day run evaluates both habitats and road with a complete log", () => {
  const sim = new WetlandSim({ seed: 82417 });
  sim.advance(TOTAL_SECONDS + 1);
  assert.equal(sim.completed, true);
  assert.equal(sim.elapsed, TOTAL_SECONDS);
  assert.ok(sim.result);
  assert.equal(typeof sim.result.birdHabitat, "boolean");
  assert.equal(typeof sim.result.beaverHabitat, "boolean");
  assert.equal(typeof sim.result.roadIntact, "boolean");
  assert.ok(sim.logs.some((log) => log.title.includes("十日验收")));
  assert.ok(sim.logs.every((log) => Number.isFinite(log.simTime) && log.clock));
  assert.equal(sim.result.success, false);
  assert.ok(sim.result.birdsAlive < 4);
});

test("a staged control strategy can preserve both habitats for ten days", () => {
  const sim = new WetlandSim({ seed: 82417 });
  while (sim.elapsed < TOTAL_SECONDS) {
    if (sim.alerts.actual !== "normal") {
      sim.applyControls({ spillway: 0.95, stakes: 0.8 });
    }
    if (sim.recovery && sim.recovery.remaining <= 6.2) {
      sim.applyControls({ spillway: 0.45, stakes: 0.8 });
    }
    sim.advance(0.05);
  }
  assert.equal(sim.completed, true);
  assert.equal(sim.result.success, true);
  assert.equal(sim.result.birdsAlive, 4);
  assert.equal(sim.result.lodgesAlive, 2);
  assert.ok(sim.result.roadFloodSeconds <= 1.5);
});

test("closing the spillway during a storm can flood the road and harm targets", () => {
  const sim = new WetlandSim({ seed: 82417 });
  sim.advance(52);
  sim.applyControls({ spillway: 0, stakes: 0.1 });
  sim.advance(25);
  assert.ok(sim.stats.maxLevel > CONFIG.criticalLevel);
  assert.ok(sim.stats.failureAt !== null);
  assert.ok(sim.stats.roadFloodSeconds > 0);
  assert.ok(sim.stats.roadCriticalAt !== null);
  assert.ok(sim.stats.maxTurbidity > 25);
});
