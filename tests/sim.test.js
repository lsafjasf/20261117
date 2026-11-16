const test = require("node:test");
const assert = require("node:assert/strict");
const Sim = require("../sim.js");

function setKey(state, side, key, down) {
  if (state.keys[key] !== down) Sim.setKey(state, side, key, down, "test");
}

function driveToward(state, targetX, speedLimit = 82) {
  const dx = targetX - state.trolley.x;
  const vx = state.trolley.vx;
  let desired = Math.max(-speedLimit, Math.min(speedLimit, dx * 2.1));
  if (Math.abs(dx) < 16) desired = 0;
  const dv = desired - vx;
  setKey(state, "left", "a", dv < -35);
  setKey(state, "left", "d", dv > 35);
  setKey(state, "left", "s", false);
}

function alignArm(state) {
  const metrics = Sim.alignMetrics(state, Sim.target(state));
  if (!metrics.valid) return metrics;
  setKey(state, "right", "j", metrics.angleError > 0.012);
  setKey(state, "right", "l", metrics.angleError < -0.012);
  setKey(state, "right", "k", metrics.aligned);
  return metrics;
}

function stepMission(state, frames, onFrame) {
  for (let frame = 0; frame < frames; frame += 1) {
    const current = Sim.target(state);
    if (current) driveToward(state, current.x);
    alignArm(state);
    if (onFrame && onFrame(state, frame) === false) return frame;
    Sim.tick(state, 1 / 120);
    if (state.status !== "running") return frame;
  }
  return frames;
}

test("key ownership is split: neither seat can borrow the other seat's actions", () => {
  const state = Sim.createState();
  assert.equal(Sim.setKey(state, "left", "j", true, "test"), false);
  assert.equal(Sim.setKey(state, "left", "k", true, "test"), false);
  assert.equal(Sim.setKey(state, "right", "a", true, "test"), false);
  assert.equal(Sim.setKey(state, "right", "s", true, "test"), false);
  assert.deepEqual(Sim.KEYS.left, ["a", "d", "s"]);
  assert.deepEqual(Sim.KEYS.right, ["j", "l", "k"]);
  assert.equal(state.keys.a, false);
  assert.equal(state.keys.j, false);
});

test("left seat alone can position but cannot install a pulley", () => {
  const state = Sim.createState();
  for (let frame = 0; frame < 120 * 4; frame += 1) {
    driveToward(state, Sim.target(state).x);
    Sim.tick(state, 1 / 120);
  }
  assert.equal(state.targetIndex, 0);
  assert.equal(state.installProgress, 0);
  assert.equal(state.resources.spares, 3);
  assert.equal(Sim.alignMetrics(state, Sim.target(state)).aligned, false);
});

test("right seat alone cannot move the gondola or finish the objective", () => {
  const state = Sim.createState();
  for (let frame = 0; frame < 120 * 4; frame += 1) {
    alignArm(state);
    Sim.tick(state, 1 / 120);
  }
  assert.equal(state.stats.inputs.left, 0);
  assert.ok(state.stats.inputs.right > 0);
  assert.equal(state.targetIndex, 0);
  assert.equal(state.installProgress, 0);
});

test("dual-seat run completes three pulleys with synchronized shared resources", () => {
  const state = Sim.createState();
  const frames = stepMission(state, 120 * 30);
  assert.equal(state.status, "won");
  assert.equal(state.targetIndex, 3);
  assert.equal(state.resources.spares, 0);
  assert.equal(state.pulleys.filter((item) => item.status === "done").length, 3);
  assert.ok(state.timeLeft > 0 && state.timeLeft < 150);
  assert.ok(state.stats.inputs.left > 0);
  assert.ok(state.stats.inputs.right > 0);
  assert.ok(frames < 120 * 30);
  assert.match(state.taskLog[0].text, /三组滑轮全部完成/);

  const inputEvents = state.feed.filter((event) => event.type === "input");
  assert.ok(inputEvents.some((event) => event.side === "left"));
  assert.ok(inputEvents.some((event) => event.side === "right"));
  inputEvents.forEach((event) => {
    assert.equal(typeof event.snap.timeLeft, "number");
    assert.equal(typeof event.snap.spares, "number");
    assert.equal(typeof event.snap.tool, "string");
  });
});

test("one-sided emergency brake causes a drop and both seats must recover", () => {
  const state = Sim.createState();
  let dropped = false;
  stepMission(state, 120 * 12, (current) => {
    if (!dropped && current.installProgress > 0.24) {
      Sim.setKey(state, "left", "s", true, "test");
      dropped = true;
      return false;
    }
  });
  assert.equal(dropped, true);
  assert.equal(state.resources.tool, "lost");
  assert.equal(state.stats.drops, 1);
  assert.ok(state.installProgress < 0.25);
  assert.ok(state.conflicts.some((event) => event.code === "ESTOP_INSTALL"));
  assert.ok(state.conflicts.some((event) => event.code === "TOOL_DROP"));
  assert.equal(state.conflicts.find((event) => event.code === "TOOL_DROP").snap.tool, "lost");

  setKey(state, "right", "k", false);
  const dropX = state.resources.dropX;
  let recovered = false;
  for (let frame = 0; frame < 120 * 8; frame += 1) {
    driveToward(state, dropX, 48);
    const near = Math.abs(state.trolley.x - dropX) <= 44;
    const slow = Math.abs(state.trolley.vx) <= 45;
    setKey(state, "right", "k", near && slow);
    Sim.tick(state, 1 / 120);
    if (state.resources.tool === "secured") {
      recovered = true;
      break;
    }
  }
  assert.equal(recovered, true);
  assert.equal(state.stats.recoveries, 1);
  assert.ok(state.conflicts.some((event) => event.code === "TOOL_RECOVERED"));
  assert.match(state.taskLog[0].text, /锁扣已回收/);
});

test("link timeout freezes the shared clock and blocks both control streams", () => {
  const state = Sim.createState();
  Sim.setKey(state, "left", "d", true, "test");
  for (let frame = 0; frame < 30; frame += 1) Sim.tick(state, 1 / 120);
  Sim.setKey(state, "left", "d", false, "test");
  for (let frame = 0; frame < 120 * 13; frame += 1) {
    Sim.tick(state, 1 / 120);
    if (state.protection) break;
  }
  assert.ok(state.protection);
  assert.equal(state.protection.side, "left");
  assert.equal(state.protection.reason, "timeout");
  assert.equal(state.links.left.state, "timeout");

  const frozenTime = state.timeLeft;
  const frozenX = state.trolley.x;
  for (let frame = 0; frame < 120 * 2; frame += 1) Sim.tick(state, 1 / 120);
  assert.equal(state.timeLeft, frozenTime);
  assert.equal(state.trolley.x, frozenX);
  assert.equal(Sim.setKey(state, "right", "j", true, "test"), false);

  assert.equal(Sim.restoreLink(state), true);
  assert.equal(state.protection, null);
  assert.equal(state.links.left.state, "online");
  Sim.tick(state, 1 / 60);
  assert.ok(state.timeLeft < frozenTime);
});

test("explicit disconnect protection and fresh-state restart are deterministic", () => {
  const state = Sim.createState();
  Sim.setKey(state, "left", "d", true, "test");
  Sim.tick(state, 1 / 60);
  Sim.setKey(state, "left", "d", false, "test");
  Sim.setKey(state, "right", "k", true, "test");
  Sim.tick(state, 1 / 60);
  assert.equal(Sim.activateProtection(state, "right", "disconnect"), true);
  assert.equal(state.protection.reason, "disconnect");
  const frozen = state.timeLeft;
  Sim.tick(state, 1);
  assert.equal(state.timeLeft, frozen);

  const fresh = Sim.createState();
  assert.equal(fresh.timeLeft, 150);
  assert.equal(fresh.targetIndex, 0);
  assert.equal(fresh.resources.spares, 3);
  assert.equal(fresh.resources.tool, "secured");
  assert.equal(fresh.installProgress, 0);
  assert.equal(fresh.protection, null);
  assert.deepEqual(fresh.pulleys.map((item) => item.status), ["pending", "pending", "pending"]);
});
