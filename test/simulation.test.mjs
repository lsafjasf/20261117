import test from "node:test";
import assert from "node:assert/strict";
import {
  KEY_BINDINGS,
  MISSION_DURATION,
  REQUIRED_POINTS,
  SurveySimulation,
} from "../simulation.js";

function align(sim) {
  sim.controls.azimuth = sim.target.az;
  sim.controls.elevation = sim.target.el;
  sim.controls.focus = sim.target.focus;
}

function tick(sim, seconds) {
  for (let elapsed = 0; elapsed < seconds; elapsed += 0.05) sim.update(0.05);
}

function startAligned() {
  const sim = new SurveySimulation();
  sim.start();
  align(sim);
  tick(sim, 0.7);
  return sim;
}

test("dual confirmation captures one point and shares all mirrored fields", () => {
  const sim = startAligned();
  assert.equal(sim.inputDown("Space").accepted, true);
  assert.equal(sim.inputDown("Enter").accepted, true);

  assert.equal(sim.successCount, 1);
  assert.equal(sim.shotsLeft, 5);
  assert.equal(sim.records[0].kind, "dual-success");
  assert.deepEqual(
    sim.records[0].pair.P1.source,
    "keyboard:Space",
  );
  assert.deepEqual(
    sim.records[0].pair.P2.source,
    "keyboard:Enter",
  );

  const a = sim.getRoleView("P1");
  const b = sim.getRoleView("P2");
  assert.equal(a.remaining, b.remaining);
  assert.equal(a.shotsLeft, b.shotsLeft);
  assert.equal(a.revision, b.revision);
  assert.deepEqual(a.records, b.records);
  assert.ok(sim.replay.events.some((event) => event.type === "resource_change"));
});

test("only one side confirming expires and cannot substitute for both", () => {
  const sim = startAligned();
  sim.inputDown("Space");
  tick(sim, 1.2);

  assert.equal(sim.successCount, 0);
  assert.equal(sim.records.length, 1);
  assert.equal(sim.records[0].status, "missed");
  assert.equal(sim.records[0].kind, "single-side-confirm");
  assert.equal(sim.records[0].actor, "P1");
  assert.equal(sim.shotsLeft, 5);
  assert.ok(sim.replay.conflicts.some((conflict) => conflict.kind === "single-side-confirm"));
});

test("disconnect freezes shared time and resources until both keys acknowledge", () => {
  const sim = new SurveySimulation();
  sim.start();
  tick(sim, 1);
  const remaining = sim.remaining;
  const shots = sim.shotsLeft;

  sim.simulateDisconnect("P2");
  assert.equal(sim.mode, "protection");
  assert.equal(sim.protection.phase, "waiting");
  tick(sim, 3);
  assert.equal(sim.remaining, remaining);
  assert.equal(sim.shotsLeft, shots);

  sim.reconnect("P2");
  const firstAck = sim.inputDown("Space");
  assert.equal(firstAck.accepted, true);
  assert.equal(sim.mode, "protection");
  assert.equal(sim.protection.acks.P1, true);
  assert.equal(sim.protection.acks.P2, false);

  const secondAck = sim.inputDown("Enter");
  assert.equal(secondAck.accepted, true);
  assert.equal(sim.mode, "live");
  assert.equal(sim.protection, null);
  assert.ok(sim.replay.events.some((event) => event.type === "protection_resume"));
});

test("single-side input timeout automatically enters the same safe hold", () => {
  const sim = new SurveySimulation();
  sim.start();
  tick(sim, 32.2);
  assert.equal(sim.mode, "protection");
  assert.equal(sim.protection.reason, "input-timeout");
  assert.equal(sim.protection.phase, "handshake");
  const frozen = sim.remaining;
  tick(sim, 2);
  assert.equal(sim.remaining, frozen);
  assert.ok(sim.replay.events.some((event) => event.type === "idle_warning"));
});

test("debug mode intentionally allows one operator to control all three axes", () => {
  const sim = new SurveySimulation();
  sim.setDebug(true);
  sim.start();
  sim.controls.azimuth = sim.target.az;
  sim.controls.elevation = sim.target.el;
  sim.controls.focus = sim.target.focus;
  tick(sim, 0.7);
  sim.inputDown("Space");
  assert.equal(sim.successCount, 1);
  assert.equal(sim.records[0].debug, true);
  assert.equal(sim.debug, true);
});

test("pause freezes a hidden target window without jumping to visible", () => {
  const sim = new SurveySimulation();
  sim.start();
  tick(sim, 11);
  assert.equal(sim.targetVisible, false);
  const frozenWindow = sim.targetWindowRemaining;
  assert.ok(frozenWindow > 0 && frozenWindow < 4.5);
  sim.togglePause("test");
  tick(sim, 2);
  assert.equal(sim.targetVisible, false);
  assert.equal(sim.targetWindowRemaining, frozenWindow);
  sim.togglePause("test");
  assert.equal(sim.mode, "live");
  assert.equal(sim.targetVisible, false);
});

test("restart atomically resets controls, target, timer and shared resources", () => {
  const sim = startAligned();
  sim.inputDown("Space");
  sim.inputDown("Enter");
  tick(sim, 4);
  sim.inputDown("KeyD");
  tick(sim, 0.4);
  sim.inputUp("KeyD");
  assert.notEqual(sim.elapsed, 0);

  const restarted = sim.restart("test");
  assert.equal(restarted.mode, "ready");
  assert.equal(restarted.t, 0);
  assert.equal(restarted.remaining, MISSION_DURATION);
  assert.equal(restarted.shotsLeft, 6);
  assert.equal(restarted.successCount, 0);
  assert.equal(restarted.target.id, "K-01");
  assert.equal(restarted.controls.azimuth, 0);
  assert.equal(restarted.controls.elevation, 0);
  assert.equal(restarted.controls.focus, 0.5);
  assert.equal(sim.mode, "ready");
});

test("key ownership is disjoint and only owning actions move", () => {
  const sim = new SurveySimulation();
  sim.start();
  const az = sim.controls.azimuth;
  const el = sim.controls.elevation;
  sim.inputDown("KeyA");
  tick(sim, 0.2);
  sim.inputUp("KeyA");
  assert.notEqual(sim.controls.azimuth, az);
  assert.equal(sim.controls.elevation, el);

  const azAfterA = sim.controls.azimuth;
  sim.inputDown("ArrowUp");
  tick(sim, 0.2);
  sim.inputUp("ArrowUp");
  assert.equal(sim.controls.azimuth, azAfterA);
  assert.notEqual(sim.controls.elevation, el);

  assert.equal(KEY_BINDINGS.Space.role, "P1");
  assert.equal(KEY_BINDINGS.Enter.role, "P2");
  assert.notEqual(KEY_BINDINGS.Space.role, KEY_BINDINGS.Enter.role);
});

test("report is available only after three coordinated points", () => {
  const sim = new SurveySimulation();
  sim.start();
  for (let point = 0; point < REQUIRED_POINTS; point += 1) {
    align(sim);
    tick(sim, 0.65);
    sim.inputDown("Space");
    sim.inputDown("Enter");
  }
  assert.equal(sim.successCount, REQUIRED_POINTS);
  assert.equal(sim.canExport, true);
  assert.equal(sim.mode, "complete");
  const report = sim.getReport();
  assert.equal(report.capturedPoints.length, 3);
  assert.equal(report.syncAudit.sharedFieldsMatch, true);
  assert.ok(report.replay.events.length > 3);
  assert.ok(report.replay.snapshots.length > 3);
});
