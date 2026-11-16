import test from "node:test";
import assert from "node:assert/strict";
import { CraneMission, LINK_TIMEOUT } from "../src/core.js";

function angleDelta(from, to) {
  return ((to - from + 540) % 360) - 180;
}

function setKey(game, player, action, pressed) {
  if (game.keys[player][action] !== pressed) {
    game.setInput(player, action, pressed);
  }
}

function driveMissionToSuccess(game) {
  for (
    let index = 0;
    index < 60 * 170 && !["success", "failed"].includes(game.status);
    index += 1
  ) {
    const cargo = game.cargo;
    const targetDelta = angleDelta(game.slewAngle, cargo.targetAngle);
    const pickupDelta = angleDelta(game.slewAngle, cargo.pickupAngle ?? 0);
    for (const player of ["p1", "p2"]) {
      for (const action of ["left", "right", "up", "down", "steady"]) {
        if (game.keys[player][action]) setKey(game, player, action, false);
      }
    }

    if (game.phase === "carry") {
      const aligned = Math.abs(targetDelta) < 1.5;
      if (!aligned && game.hoistHeight >= 24) {
        const action = targetDelta > 0 ? "right" : "left";
        if (Math.abs(game.slewSpeed) < 42) setKey(game, "p1", action, true);
      } else if (aligned && game.hoistHeight > 10) {
        if (Math.abs(game.hoistSpeed) < 14) setKey(game, "p2", "down", true);
      } else if (
        aligned &&
        Math.abs(game.slewSpeed) < 8 &&
        Math.abs(game.hoistSpeed) < 4.5
      ) {
        setKey(game, "p1", "steady", true);
        setKey(game, "p2", "steady", true);
      } else if (!aligned && game.hoistHeight < 24) {
        if (Math.abs(game.hoistSpeed) < 14) setKey(game, "p2", "up", true);
      }
    } else if (game.phase === "pickup") {
      if (Math.abs(pickupDelta) >= 1.5) {
        const action = pickupDelta > 0 ? "right" : "left";
        if (Math.abs(game.slewSpeed) < 42) setKey(game, "p1", action, true);
      } else if (game.hoistHeight > 7 && Math.abs(game.hoistSpeed) < 14) {
        setKey(game, "p2", "down", true);
      }
    }
    game.tick(1 / 60);
  }
  return game;
}

test("P1 and P2 controls are role-exclusive", () => {
  const game = new CraneMission();
  game.start();
  const angle = game.slewAngle;
  const height = game.hoistHeight;

  game.setInput("p1", "right", true);
  for (let index = 0; index < 30; index += 1) game.tick(1 / 60);
  game.setInput("p1", "right", false);

  assert.notEqual(game.slewAngle, angle, "P1 must move slew");
  assert.equal(game.hoistHeight, height, "P1 must not move hoist");

  game.reset();
  game.start();
  const resetAngle = game.slewAngle;
  game.setInput("p2", "down", true);
  for (let index = 0; index < 30; index += 1) game.tick(1 / 60);

  assert.ok(
    Math.abs(angleDelta(resetAngle, game.slewAngle)) < 0.001,
    "P2 must not move slew",
  );
  assert.notEqual(game.hoistHeight, height, "P2 must move hoist");
  assert.equal(game.setInput("p1", "up", true), false);
  assert.equal(game.setInput("p2", "right", true), false);
});

test("landing requires both players to hold stabilization", () => {
  const game = new CraneMission();
  game.start();
  game.slewAngle = game.cargo.targetAngle;
  game.hoistHeight = 10;
  game.slewSpeed = 0;
  game.hoistSpeed = 0;
  game.swayX = 0;
  game.swayY = 0;

  game.setInput("p1", "steady", true);
  for (let index = 0; index < 100; index += 1) game.tick(1 / 60);
  assert.equal(game.placed, 0);
  assert.equal(game.stabilityProgress, 0);

  game.setInput("p2", "steady", true);
  for (let index = 0; index < 90; index += 1) game.tick(1 / 60);
  assert.equal(game.placed, 1, "both F and J must complete the landing");
  assert.equal(game.cargoAttached, false);
});

test("three synchronized landings complete the mission and record both players", () => {
  const game = new CraneMission();
  game.start();
  driveMissionToSuccess(game);

  assert.equal(game.status, "success");
  assert.equal(game.placed, 3);
  assert.equal(game.result.outcome, "success");

  const replay = game.getReplay();
  assert.ok(replay.snapshots.length > 100);
  assert.ok(replay.inputs.some((input) => input.player === "p1" && input.pressed));
  assert.ok(replay.inputs.some((input) => input.player === "p2" && input.pressed));
  assert.ok(replay.snapshots.some((snapshot) => snapshot.steadyP1 && snapshot.steadyP2));
  assert.ok(
    replay.snapshots.every((snapshot) =>
      ["hydraulic", "integrity", "remaining"].every(
        (key) => typeof snapshot[key] === "number",
      ),
    ),
  );
});

test("a sustained P1 overspeed causes a one-sided failure with conflict records", () => {
  const game = new CraneMission();
  game.start();
  game.setInput("p1", "right", true);
  for (
    let index = 0;
    index < 60 * 20 && !["success", "failed"].includes(game.status);
    index += 1
  ) {
    game.tick(1 / 60);
  }

  assert.equal(game.status, "failed");
  assert.equal(game.result.side, "p1");
  assert.match(game.result.label, /P1/);
  assert.ok(game.collisions >= 4);
  assert.ok(game.conflicts.length >= 4);
  assert.ok(game.inputs.some((input) => input.player === "p1"));
  assert.equal(game.inputs.some((input) => input.player === "p2"), false);
});

test("one-sided disconnect freezes shared resources and recovers to the same clock", () => {
  const game = new CraneMission();
  game.start();
  for (let index = 0; index < 30; index += 1) game.tick(1 / 60);
  const frozenTime = game.remaining;
  const frozenHydraulic = game.hydraulic;

  game.simulateDisconnect("p1");
  assert.equal(game.status, "protected");
  assert.equal(game.protection.kind, "disconnect");
  assert.equal(game.links.p1.connected, false);
  for (let index = 0; index < 120; index += 1) game.tick(1 / 60);
  assert.equal(game.remaining, frozenTime);
  assert.equal(game.hydraulic, frozenHydraulic);

  assert.equal(game.reconnect("p1"), true);
  assert.equal(game.status, "playing");
  assert.equal(game.protection, null);
  assert.ok(game.remaining <= frozenTime);
  assert.ok(game.events.some((event) => event.type === "recovery"));
});

test("missing input on either side triggers timeout protection", () => {
  const game = new CraneMission();
  game.start();
  for (
    let index = 0;
    index < Math.ceil((LINK_TIMEOUT + 0.2) * 60) && game.status === "playing";
    index += 1
  ) {
    game.tick(1 / 60);
  }

  assert.equal(game.status, "protected");
  assert.equal(game.protection.kind, "timeout");
  assert.equal(game.links.p1.timedOut, true);
  assert.ok(game.events.some((event) => event.type === "protection"));
});

test("restart resets instruments, target progress, resources and clock together", () => {
  const game = new CraneMission();
  game.start();
  game.setInput("p1", "right", true);
  for (let index = 0; index < 120; index += 1) game.tick(1 / 60);
  game.hydraulic = 31;
  game.integrity = 48;
  game.placed = 2;
  game.cargoIndex = 2;

  game.reset();
  const state = game.telemetry();
  assert.equal(state.status, "ready");
  assert.equal(state.remaining, 180);
  assert.equal(state.hydraulic, 100);
  assert.equal(state.integrity, 100);
  assert.equal(state.placed, 0);
  assert.equal(state.cargoIndex, 0);
  assert.equal(state.slewAngle, -72);
  assert.equal(state.hoistHeight, 76);
  assert.equal(state.phase, "carry");
  assert.equal(state.cargoAttached, true);
  assert.deepEqual(state.keys, {
    p1: { left: false, right: false, steady: false },
    p2: { up: false, down: false, steady: false },
  });
});
