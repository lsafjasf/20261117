import test from "node:test";
import assert from "node:assert/strict";
import { DiveGame, TARGETS, angleDelta } from "../src/game-engine.js";

const DT = 0.02;

function createRun() {
  const game = new DiveGame({ seed: 7 });
  let now = 1000;
  game.start(now);
  const tick = (count = 1, callback) => {
    for (let index = 0; index < count; index += 1) {
      now += DT * 1000;
      game.heartbeat("pilot", now);
      game.heartbeat("photo", now);
      callback?.();
      game.update(DT, now);
      if (["success", "failed"].includes(game.state.phase)) return;
    }
  };
  const set = (role, action, active) => game.setControl(role, action, active, now);
  const releasePilot = () => ["up", "down", "left", "right", "boost"]
    .forEach((action) => set("pilot", action, false));
  const releasePhoto = () => ["lampUp", "lampDown", "aimLeft", "aimRight"]
    .forEach((action) => set("photo", action, false));
  return { game, tick, set, releasePilot, releasePhoto, now: () => now };
}

function moveToComposition(game, tick, set, releasePilot) {
  const target = TARGETS[game.state.targetIndex];
  const cameraX = target.x - 260;
  const cameraY = target.y - 20;
  for (let guard = 0; guard < 1300; guard += 1) {
    const dx = cameraX - game.state.camera.x;
    const dy = cameraY - game.state.camera.y;
    if (Math.hypot(dx, dy) < 9) break;
    set("pilot", "right", dx > 2);
    set("pilot", "left", dx < -2);
    set("pilot", "down", dy > 2);
    set("pilot", "up", dy < -2);
    tick();
  }
  releasePilot();
}

function alignLight(game, tick, set, releasePhoto, desiredIntensity = null) {
  const target = TARGETS[game.state.targetIndex];
  const desired = desiredIntensity ?? (target.lightMin + target.lightMax) / 2;
  for (let guard = 0; guard < 260; guard += 1) {
    const difference = desired - game.state.lamp.intensity;
    if (Math.abs(difference) < 0.018) break;
    set("photo", "lampUp", difference > 0);
    set("photo", "lampDown", difference < 0);
    tick();
  }
  releasePhoto();
  for (let guard = 0; guard < 260; guard += 1) {
    const error = angleDelta(game.state.lamp.aim, game.targetBearing());
    if (Math.abs(error) < 0.04) break;
    set("photo", "aimRight", error > 0);
    set("photo", "aimLeft", error < 0);
    tick();
  }
  releasePhoto();
}

function fire(game, set, now) {
  const outcome = set("photo", "shutter", true);
  set("photo", "shutter", false);
  return outcome;
}

test("controls are role-isolated in the shared engine", () => {
  const game = new DiveGame();
  game.start(1);
  const forbiddenPilot = game.setControl("pilot", "shutter", true, 1);
  const forbiddenPhoto = game.setControl("photo", "up", true, 1);
  assert.equal(forbiddenPilot.ok, false);
  assert.equal(forbiddenPhoto.ok, false);
  assert.equal(game.controls.pilot.shutter, undefined);
  assert.equal(game.controls.photo.up, undefined);
  assert.equal(game.rejectedInputs, 2);

  game.setControl("pilot", "right", true, 1);
  game.setControl("photo", "lampUp", true, 1);
  game.setControl("photo", "aimLeft", true, 1);
  game.update(0.5, 1);
  game.update(0.5, 1);
  assert.ok(game.state.camera.x > 0, "pilot input moves the shared camera");
  assert.ok(game.state.lamp.intensity > 0, "photo input changes the shared lamp");
  assert.ok(game.state.battery < 100, "photo light drains shared battery");
});

test("pause freezes timer and resources; restart resets both sides at once", () => {
  const { game, tick, set, releasePilot } = createRun();
  set("pilot", "right", true);
  set("pilot", "up", true);
  tick(18);
  releasePilot();
  const beforePause = {
    remaining: game.state.remaining,
    turbidity: game.state.turbidity,
    battery: game.state.battery,
    cameraX: game.state.camera.x,
  };
  game.pause();
  tick(40);
  assert.equal(game.state.remaining, beforePause.remaining);
  assert.equal(game.state.turbidity, beforePause.turbidity);
  assert.equal(game.state.battery, beforePause.battery);
  game.resume();
  tick(1);
  assert.ok(game.state.remaining < beforePause.remaining);

  game.restart();
  assert.equal(game.state.phase, "ready");
  assert.equal(game.state.remaining, 90);
  assert.equal(game.state.turbidity, 18);
  assert.equal(game.state.battery, 100);
  assert.equal(game.state.shotsRemaining, 6);
  assert.equal(game.state.accepted, 0);
  assert.equal(game.state.targetIndex, 0);
  assert.equal(game.state.failures, 0);
  assert.equal(game.state.recoveries, 0);
});

test("heartbeat timeout or explicit disconnect freezes one-side protection", () => {
  const game = new DiveGame({ seed: 7 });
  let now = 1000;
  game.start(now);
  game.heartbeat("pilot", now);
  game.heartbeat("photo", now);
  for (let index = 0; index < 180; index += 1) {
    now += DT * 1000;
    game.heartbeat("photo", now);
    game.update(DT, now);
  }
  const remaining = game.state.remaining;
  assert.equal(game.state.phase, "protected");
  assert.equal(game.state.protectedRole, "pilot");
  assert.equal(game.state.remaining, remaining);
  game.heartbeat("pilot", now);
  game.reconnect("pilot");
  game.heartbeat("photo", now);
  assert.equal(game.state.phase, "running");

  game.disconnect("photo");
  assert.equal(game.state.phase, "protected");
  assert.equal(game.state.protectedRole, "photo");
  const frozen = game.state.remaining;
  game.update(3, 200100);
  assert.equal(game.state.remaining, frozen);
});

test("success, photographer-side mistake and recovery share one replay", () => {
  const run = createRun();
  const { game, tick, set, releasePilot, releasePhoto, now } = run;

  set("pilot", "right", true);
  set("photo", "lampUp", true);
  assert.equal(game.conflicts.length, 1, "simultaneous A/B input is logged");
  set("pilot", "right", false);
  set("photo", "lampUp", false);

  for (let targetNumber = 0; targetNumber < 3; targetNumber += 1) {
    moveToComposition(game, tick, set, releasePilot);
    alignLight(game, tick, set, releasePhoto);
    assert.equal(game.evaluation().complete, true, `target ${targetNumber + 1} composes`);

    if (targetNumber === 0) {
      set("photo", "lampUp", true);
      tick(115);
      releasePhoto();
      assert.ok(game.state.lamp.intensity > 0.8);
      assert.ok(game.calmLevel() < 0.7, "strong light scares the school");
      const failed = fire(game, set, now());
      assert.equal(failed.ok, false);
      assert.equal(game.lastFailure.faultRole, "photo");
      assert.ok(
        game.lastFailure.reasons.some((reason) => reason.includes("柔光") || reason.includes("鱼群")),
      );

      set("photo", "lampDown", true);
      for (let guard = 0; guard < 280 && game.state.lamp.intensity > 0.5; guard += 1) {
        tick();
      }
      releasePhoto();
      let recoveryTicks = 0;
      while (game.calmLevel() < 0.94 && recoveryTicks < 560) {
        tick();
        recoveryTicks += 1;
      }
      assert.ok(game.calmLevel() >= 0.9, "school settles after lamp is lowered");
      alignLight(game, tick, set, releasePhoto);
    }

    const accepted = fire(game, set, now());
    assert.equal(
      accepted.ok,
      true,
      `target ${targetNumber + 1} accepted: ${JSON.stringify({
        checks: game.evaluation().checks,
        lamp: game.state.lamp,
        calm: game.calmLevel(),
      })}`,
    );
    if (targetNumber === 0) {
      assert.equal(game.state.recoveries, 1);
    }
    if (targetNumber < 2) {
      set("photo", "lampDown", true);
      for (let guard = 0; guard < 220 && game.state.lamp.intensity > 0.002; guard += 1) {
        tick();
      }
      releasePhoto();
    }
  }

  assert.equal(game.state.phase, "success");
  assert.equal(game.state.accepted, 3);
  assert.ok(game.state.failures >= 1);
  assert.equal(game.state.recoveries, 1);
  assert.ok(game.state.remaining > 0);
  assert.ok(game.events.some((event) => event.type === "failed-photo"));
  assert.ok(game.events.some((event) => event.type === "recovery"));
  assert.ok(game.events.some((event) => event.type === "photo"));
  assert.ok(game.events.some((event) => event.role === "pilot" && event.type === "input"));
  assert.ok(game.events.some((event) => event.role === "photo" && event.type === "input"));
  assert.ok(game.conflicts.length >= 1);
  assert.ok(game.snapshots.length > 100);

  const replay = game.replayData();
  assert.equal(replay.phase, "success");
  assert.ok(replay.snapshots.some((snapshot) => snapshot.turbidity > 18));
  assert.ok(replay.snapshots.some((snapshot) => snapshot.battery < 100));
  assert.ok(replay.snapshots.every((snapshot) => snapshot.shotsRemaining >= 0));
  assert.ok(replay.photos.some((photo) => photo.recovered));
  assert.equal(replay.metrics.accepted, 3);
});
