const test = require("node:test");
const assert = require("node:assert/strict");
const { PendulumSim, LIMITS } = require("../physics.js");

function runSchedule(sim, ticks, commandForTick) {
  for (let tick = 0; tick < ticks; tick += 1) {
    if (sim.isLocked()) break;
    sim.setCommand(commandForTick(tick, sim));
    sim.advance();
  }
  return sim;
}

const schedule = (tick) => {
  if (tick < 120) return 1.5;
  if (tick < 168) return -1.2;
  return 0;
};

test("identical inputs produce an identical trajectory", () => {
  const first = runSchedule(new PendulumSim({ target: 1.8 }), 420, schedule);
  const second = runSchedule(new PendulumSim({ target: 1.8 }), 420, schedule);
  assert.deepEqual(first.state, second.state);
  assert.equal(first.trace.length, second.trace.length);
  assert.deepEqual(first.trace.at(-1), second.trace.at(-1));
});

test("pause and resume do not alter the fixed-step trajectory", () => {
  const continuous = runSchedule(new PendulumSim({ target: 1.8 }), 240, schedule);
  const interrupted = new PendulumSim({ target: 1.8 });
  runSchedule(interrupted, 120, schedule);
  const pausedState = JSON.parse(JSON.stringify(interrupted.state));
  const pausedTime = performance.now() + 25;
  while (performance.now() < pausedTime) {
    // Wall-clock pause: deliberately perform no physics updates.
  }
  assert.deepEqual(interrupted.state, pausedState);
  runSchedule(interrupted, 120, (tick) => schedule(tick + 120));
  assert.deepEqual(interrupted.state, continuous.state);
  assert.deepEqual(interrupted.trace.at(-1), continuous.trace.at(-1));
});

test("single stepping advances exactly one fixed physics tick", () => {
  const sim = new PendulumSim({ target: 1.8 });
  const dt = sim.config.dt;
  sim.advance(dt);
  assert.ok(Math.abs(sim.state.t - dt) < 1e-12);
  sim.advance(dt);
  assert.ok(Math.abs(sim.state.t - dt * 2) < 1e-12);
  assert.equal(sim.trace.length, 3);
});

test("repeated reset restores the exact same initial state and peaks", () => {
  const sim = new PendulumSim({ target: 1.8, payload: 1.4 });
  runSchedule(sim, 300, schedule);
  assert.ok(sim.state.t > 0);
  const snapshots = [];
  for (let reset = 0; reset < 5; reset += 1) {
    sim.reset();
    snapshots.push({
      state: JSON.parse(JSON.stringify(sim.state)),
      peaks: JSON.parse(JSON.stringify(sim.peaks)),
      traceLength: sim.trace.length,
      target: sim.target,
      payload: sim.payload
    });
  }
  snapshots.slice(1).forEach((snapshot) => assert.deepEqual(snapshot, snapshots[0]));
  assert.equal(snapshots[0].state.x, 0);
  assert.equal(snapshots[0].state.v, 0);
  assert.equal(snapshots[0].state.force, 0);
  assert.equal(snapshots[0].state.temperature, sim.config.tempAmbient);
});

test("first safety violation freezes computation at the trigger point", () => {
  const sim = new PendulumSim({ target: 2.6 });
  runSchedule(sim, 1200, () => 1.5);
  assert.equal(sim.status, "failure");
  assert.equal(sim.fault.key, "rail");
  assert.equal(sim.fault.part, "导轨末端");
  assert.ok(Math.abs(sim.fault.x) <= LIMITS.rail.max + 1e-6);
  assert.ok(sim.fault.t > 0);
  const frozenState = JSON.parse(JSON.stringify(sim.state));
  const frozenTraceLength = sim.trace.length;
  const result = sim.advance();
  assert.equal(result.advanced, false);
  assert.deepEqual(sim.state, frozenState);
  assert.equal(sim.trace.length, frozenTraceLength);
  const report = sim.getReport();
  assert.equal(report.faultPosition.component, "导轨末端");
  assert.equal(report.faultPosition.t, sim.fault.t);
});

test("success requires stable dwell inside the target zone", () => {
  const sim = new PendulumSim({ target: 1.8 });
  runSchedule(sim, 720, (tick) => (tick < 120 ? 1.5 : 0));
  assert.equal(sim.status, "success");
  assert.ok(Math.abs(sim.state.x - sim.target) <= sim.config.targetTolerance);
  assert.ok(Math.abs(sim.state.v) <= sim.config.speedTolerance);
  assert.ok(sim.dwell >= sim.config.dwellRequired);
  assert.ok(sim.getReport().peaks.angle >= Math.abs(sim.angleDegrees()));
});

test("load and target inputs are clamped to the declared envelope", () => {
  const sim = new PendulumSim({ payload: 99, target: 99 });
  assert.equal(sim.payload, LIMITS.load.max);
  assert.equal(sim.target, 2.6);
  sim.setPayload(-1);
  sim.setTarget(-99);
  assert.equal(sim.payload, LIMITS.load.min);
  assert.equal(sim.target, -2.6);
});
