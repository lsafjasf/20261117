export const MISSION_SECONDS = 180;
export const LINK_TIMEOUT = 14;
export const TOTAL_CARGO = 3;

const DEG = Math.PI / 180;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const approach = (value, target, amount) => {
  if (value < target) return Math.min(value + amount, target);
  return Math.max(value - amount, target);
};

export const CARGO = [
  {
    id: "C-01",
    label: "钢构箱",
    weight: 1.2,
    pickupAngle: null,
    targetAngle: -4,
    color: "#d7a24b",
  },
  {
    id: "C-02",
    label: "设备箱",
    weight: 1.8,
    pickupAngle: 166,
    targetAngle: 10,
    color: "#c57d45",
  },
  {
    id: "C-03",
    label: "备件箱",
    weight: 0.9,
    pickupAngle: 194,
    targetAngle: 25,
    color: "#b78f57",
  },
];

export const ACTIONS = {
  p1: ["left", "right", "steady"],
  p2: ["up", "down", "steady"],
};

function initialKeys() {
  return {
    p1: { left: false, right: false, steady: false },
    p2: { up: false, down: false, steady: false },
  };
}

export class CraneMission {
  constructor({ onEvent } = {}) {
    this.onEvent = onEvent || (() => {});
    this.mode = "coop";
    this.reset();
  }

  reset() {
    this.status = "ready";
    this.result = null;
    this.elapsed = 0;
    this.remaining = MISSION_SECONDS;
    this.slewAngle = -72;
    this.slewSpeed = 0;
    this.hoistHeight = 76;
    this.hoistSpeed = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.swayVX = 0;
    this.swayVY = 0;
    this.hydraulic = 100;
    this.integrity = 100;
    this.placed = 0;
    this.cargoIndex = 0;
    this.cargoAttached = true;
    this.phase = "carry";
    this.pickupProgress = 0;
    this.stabilityProgress = 0;
    this.steadyP1 = false;
    this.steadyP2 = false;
    this.keys = initialKeys();
    this.phaseTimer = 0;
    this.impactLock = 0;
    this.impactCooldown = 0;
    this.risk = { p1: 0, p2: 0 };
    this.lastInputAt = { p1: 0, p2: 0 };
    this.links = {
      p1: { connected: true, timedOut: false },
      p2: { connected: true, timedOut: false },
    };
    this.protection = null;
    this.resumeGrace = 0;
    this.collisions = 0;
    this.lastCollisionBy = null;
    this.hint = "等待任务开始";
    this.snapshots = [];
    this.events = [];
    this.inputs = [];
    this.conflicts = [];
    this.recording = true;
    this.lastSnapshotAt = -1;
    this.lastConflictAt = { sway: -10, steady: -10, interlock: -10 };
    this.sessionStartedAt = new Date().toISOString();
    this.replayId = `lift-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.startedAt = null;
    this.endedAt = null;
  }

  start() {
    if (this.status !== "ready") return false;
    this.status = "playing";
    this.startedAt = new Date().toISOString();
    this.lastInputAt.p1 = 0;
    this.lastInputAt.p2 = 0;
    this.hint = "P1 回转对位，P2 控制吊钩高度";
    this.record("state", "任务开始", "system");
    this.captureSnapshot(true);
    return true;
  }

  togglePause() {
    if (this.status === "playing") {
      this.status = "paused";
      this.releaseAllInputs();
      this.record("state", "任务已暂停", "system");
      return "paused";
    }
    if (this.status === "paused") {
      this.status = "playing";
      this.lastInputAt.p1 = this.elapsed;
      this.lastInputAt.p2 = this.elapsed;
      this.record("state", "任务继续", "system");
      return "playing";
    }
    return this.status;
  }

  setMode(mode) {
    this.mode = mode === "solo" ? "solo" : "coop";
  }

  setInput(player, action, pressed) {
    if (!ACTIONS[player]?.includes(action)) return false;
    const wasPressed = this.keys[player][action];
    this.keys[player][action] = Boolean(pressed);

    if (pressed && !wasPressed) {
      this.lastInputAt[player] = this.elapsed;
      this.inputs.push({
        t: Number(this.elapsed.toFixed(2)),
        player,
        action,
        pressed: true,
        shared: {
          remaining: Number(this.remaining.toFixed(2)),
          hydraulic: Number(this.hydraulic.toFixed(1)),
          integrity: Number(this.integrity.toFixed(1)),
        },
      });
    } else if (!pressed && wasPressed) {
      this.inputs.push({
        t: Number(this.elapsed.toFixed(2)),
        player,
        action,
        pressed: false,
      });
    }
    return true;
  }

  releaseAllInputs() {
    for (const player of ["p1", "p2"]) {
      for (const action of ACTIONS[player]) {
        this.keys[player][action] = false;
      }
    }
  }

  get cargo() {
    return CARGO[Math.min(this.cargoIndex, TOTAL_CARGO - 1)];
  }

  get loadMass() {
    return this.cargoAttached ? this.cargo.weight : 0.45;
  }

  get swayMagnitude() {
    return Math.hypot(this.swayX, this.swayY);
  }

  get loadPosition() {
    const radius = 250;
    const baseX = Math.cos(this.slewAngle * DEG) * radius;
    const baseY = Math.sin(this.slewAngle * DEG) * radius;
    return { x: baseX + this.swayX, y: baseY + this.swayY };
  }

  get isMovingP1() {
    return this.keys.p1.left || this.keys.p1.right;
  }

  get isMovingP2() {
    return this.keys.p2.up || this.keys.p2.down;
  }

  get isLinked() {
    return this.links.p1.connected && this.links.p2.connected;
  }

  get roleLocks() {
    return {
      p1: this.cargoAttached && this.hoistHeight < 22 ? "提升互锁" : null,
      p2: null,
    };
  }

  linkRemaining(player) {
    if (!this.links[player].connected || this.status !== "playing") return null;
    return Math.max(0, LINK_TIMEOUT - (this.elapsed - this.lastInputAt[player]));
  }

  simulateDisconnect(player) {
    if (!["p1", "p2"].includes(player)) return;
    this.links[player].connected = false;
    this.links[player].timedOut = false;
    this.tripProtection(player, "disconnect", "链路断开");
  }

  tripProtection(player, kind, reason) {
    if (["success", "failed"].includes(this.status)) return;
    this.releaseAllInputs();
    this.slewSpeed = 0;
    this.hoistSpeed = 0;
    this.swayVX *= 0.2;
    this.swayVY *= 0.2;
    this.protection = {
      active: true,
      player,
      kind,
      reason,
      since: this.elapsed,
    };
    this.status = "protected";
    this.record(
      "protection",
      `${player.toUpperCase()} ${reason}，安全制动已接管`,
      player,
      "danger",
    );
  }

  reconnect(player) {
    if (!this.protection || this.protection.player !== player) return false;
    this.links[player].connected = true;
    this.links[player].timedOut = false;
    this.protection = null;
    this.status = "playing";
    this.resumeGrace = 1.2;
    this.lastInputAt[player] = this.elapsed;
    this.record("recovery", `${player.toUpperCase()} 已重新接入，任务恢复`, player);
    return true;
  }

  tick(dt) {
    if (this.status !== "playing") return;
    dt = clamp(dt, 0, 0.05);
    if (dt <= 0) return;

    this.elapsed += dt;
    this.remaining = Math.max(0, MISSION_SECONDS - this.elapsed);
    this.resumeGrace = Math.max(0, this.resumeGrace - dt);
    this.impactLock = Math.max(0, this.impactLock - dt);
    this.impactCooldown = Math.max(0, this.impactCooldown - dt);

    if (this.remaining <= 0) {
      this.fail("timeout", "任务时限耗尽");
      return;
    }

    this.updateLinks();
    if (this.status !== "playing") return;

    this.stepMachines(dt);
    if (this.status !== "playing") return;
    this.stepSway(dt);
    this.detectImpacts(dt);
    if (this.status !== "playing") return;
    this.stepTask(dt);
    if (this.status !== "playing") return;
    this.detectConflicts(dt);
    this.captureSnapshot();
  }

  updateLinks() {
    if (this.resumeGrace > 0) return;
    if (this.isMovingP1 || this.keys.p1.steady) {
      this.lastInputAt.p1 = this.elapsed;
    }
    if (this.isMovingP2 || this.keys.p2.steady) {
      this.lastInputAt.p2 = this.elapsed;
    }
    for (const player of ["p1", "p2"]) {
      if (!this.links[player].connected) continue;
      const idle = this.elapsed - this.lastInputAt[player];
      if (idle >= LINK_TIMEOUT) {
        this.links[player].timedOut = true;
        this.tripProtection(player, "timeout", "操作超时");
        return;
      }
    }
  }

  stepMachines(dt) {
    const locked = Boolean(this.roleLocks.p1);
    const activeP1 = !locked && (this.keys.p1.left || this.keys.p1.right);
    const activeP2 = this.keys.p2.up || this.keys.p2.down;
    const demand = (activeP1 ? 4.4 : 0) + (activeP2 ? 5.2 * this.loadMass : 0);
    const powerScale = this.hydraulic > 2 ? 1 : 0.35;

    if (demand > 0) {
      this.hydraulic = Math.max(0, this.hydraulic - demand * dt);
    } else {
      this.hydraulic = Math.min(100, this.hydraulic + 4.1 * dt);
    }

    const previousSlew = this.slewSpeed;
    const previousHoist = this.hoistSpeed;

    if (this.impactLock <= 0) {
      const slewTarget = locked
        ? 0
        : (this.keys.p1.right ? 1 : 0) - (this.keys.p1.left ? 1 : 0);
      const slewMax = 88 * powerScale;
      if (activeP1) {
        this.slewSpeed = approach(
          this.slewSpeed,
          slewTarget * slewMax,
          138 * powerScale * dt,
        );
      } else {
        this.slewSpeed = approach(this.slewSpeed, 0, 116 * dt);
      }

      const hoistTarget =
        (this.keys.p2.up ? 1 : 0) - (this.keys.p2.down ? 1 : 0);
      if (activeP2) {
        this.hoistSpeed = approach(
          this.hoistSpeed,
          hoistTarget * 34 * powerScale,
          92 * dt,
        );
      } else {
        this.hoistSpeed = approach(this.hoistSpeed, 0, 84 * dt);
      }
    } else {
      this.slewSpeed = approach(this.slewSpeed, 0, 220 * dt);
      this.hoistSpeed = approach(this.hoistSpeed, 0, 180 * dt);
    }

    this.slewAngle += this.slewSpeed * dt;
    if (this.slewAngle > 360) this.slewAngle -= 360;
    if (this.slewAngle < 0) this.slewAngle += 360;

    const nextHeight = this.hoistHeight + this.hoistSpeed * dt;
    if (nextHeight <= 0 || nextHeight >= 100) {
      this.hoistHeight = clamp(nextHeight, 0, 100);
      this.hoistSpeed = 0;
    } else {
      this.hoistHeight = nextHeight;
    }

    this._slewAccel = (this.slewSpeed - previousSlew) / dt;
    this._hoistAccel = (this.hoistSpeed - previousHoist) / dt;

    const speedHighP1 = Math.abs(this.slewSpeed) > 62;
    const speedHighP2 = Math.abs(this.hoistSpeed) > 22;
    this.risk.p1 = speedHighP1
      ? this.risk.p1 + dt
      : Math.max(0, this.risk.p1 - dt * 1.7);
    this.risk.p2 = speedHighP2
      ? this.risk.p2 + dt * 1.12
      : Math.max(0, this.risk.p2 - dt * 1.7);

    if (this.risk.p1 >= 1.15) this.guardrailImpact("p1", "回转速度超限");
    if (this.risk.p2 >= 1.15) this.guardrailImpact("p2", "吊钩升降超速");
  }

  stepSway(dt) {
    const mass = this.loadMass;
    const angularAcceleration = clamp(this._slewAccel || 0, -240, 240);
    const hoistAcceleration = clamp(this._hoistAccel || 0, -140, 140);
    const omega = Math.abs(this.slewSpeed) * DEG;

    const tangentialDrive =
      -angularAcceleration * 250 * DEG * 0.2 * mass -
      this.slewSpeed * 0.055 * omega * mass;
    const radialDrive =
      -hoistAcceleration * 0.52 * mass +
      Math.abs(hoistAcceleration) * 0.035 * mass;

    this.swayVY += tangentialDrive * dt;
    this.swayVX += radialDrive * dt;

    const stiffness = 4.15;
    const damping = 2.15;
    this.swayVX += (-this.swayX * stiffness - this.swayVX * damping) * dt;
    this.swayVY += (-this.swayY * stiffness - this.swayVY * damping) * dt;

    const maxSway = 118;
    const speed = Math.hypot(this.swayVX, this.swayVY);
    if (speed > maxSway) {
      this.swayVX = (this.swayVX / speed) * maxSway;
      this.swayVY = (this.swayVY / speed) * maxSway;
    }
    this.swayX = clamp(this.swayX + this.swayVX * dt, -112, 112);
    this.swayY = clamp(this.swayY + this.swayVY * dt, -112, 112);
  }

  guardrailImpact(player, reason) {
    if (this.impactCooldown > 0) return;
    this.impactCooldown = 1.05;
    this.impactLock = 0.72;
    this.collisions += 1;
    this.lastCollisionBy = player;
    this.integrity = Math.max(0, this.integrity - 26);
    this.hydraulic = Math.max(0, this.hydraulic - 7);
    this.risk[player] = 0;
    this.swayVX = -this.swayVX * 0.35;
    this.swayVY = -this.swayVY * 0.35;
    this.swayX *= 0.55;
    this.swayY *= 0.55;
    this.record(
      "collision",
      `${player.toUpperCase()} ${reason}，货箱撞击护栏`,
      player,
      "danger",
      { conflict: true, integrity: this.integrity },
    );

    if (this.integrity <= 0) {
      this.fail("collision", `${player.toUpperCase()} 侧连续超速，结构失稳`);
    }
  }

  detectImpacts() {
    if (this.impactCooldown > 0) return;
    if (this.swayMagnitude <= 69) return;
    const player =
      Math.abs(this._hoistAccel || 0) > Math.abs(this._slewAccel || 0) * 0.7
        ? "p2"
        : "p1";
    this.guardrailImpact(player, "摆动幅值越界");
  }

  stepTask(dt) {
    this.steadyP1 = this.keys.p1.steady && this.status === "playing";
    this.steadyP2 = this.keys.p2.steady && this.status === "playing";
    const angleError = this.angleErrorTo(this.cargo.targetAngle);
    const hoistReady = this.hoistHeight <= 14;
    const speedsReady =
      Math.abs(this.slewSpeed) < 8 && Math.abs(this.hoistSpeed) < 4.5;
    const swayReady = this.swayMagnitude < 25;
    const inPosition = Math.abs(angleError) < 5.2;

    if (this.phase === "carry" && this.cargoAttached) {
      if (inPosition && hoistReady && speedsReady && swayReady) {
        this.hint = "落点已对齐 · 双方按住 F + J 完成稳定落箱";
        if (this.steadyP1 && this.steadyP2) {
          this.stabilityProgress = Math.min(1, this.stabilityProgress + dt / 1.1);
        } else {
          this.stabilityProgress = Math.max(
            0,
            this.stabilityProgress - dt / 0.72,
          );
        }
      } else {
        this.stabilityProgress = Math.max(
          0,
          this.stabilityProgress - dt / 0.55,
        );
        this.hint = this.taskHint(inPosition, hoistReady, speedsReady, swayReady);
      }

      if (this.stabilityProgress >= 1) this.placeCargo();
      return;
    }

    if (this.phase === "pickup" && !this.cargoAttached) {
      const pickupReady =
        Math.abs(this.angleErrorTo(this.cargo.pickupAngle)) < 3.8 &&
        this.hoistHeight <= 15 &&
        Math.abs(this.slewSpeed) < 6 &&
        Math.abs(this.hoistSpeed) < 3.5;
      if (pickupReady) {
        this.pickupProgress = Math.min(1, this.pickupProgress + dt / 0.55);
        this.hint = "吊钩已对准货箱 · 保持稳定完成挂载";
      } else {
        this.pickupProgress = Math.max(0, this.pickupProgress - dt / 0.4);
        this.hint = "P1 对准左侧货箱，P2 将吊钩降至 15% 以下";
      }
      if (this.pickupProgress >= 1) this.attachCargo();
      return;
    }

    if (this.phase === "settle") {
      this.phaseTimer = Math.max(0, this.phaseTimer - dt);
      if (this.phaseTimer <= 0) {
        this.cargoIndex += 1;
        if (this.cargoIndex >= TOTAL_CARGO) {
          this.succeed();
        } else {
          this.phase = "pickup";
          this.pickupProgress = 0;
          this.stabilityProgress = 0;
          this.hint = `下一箱 ${this.cargo.id} · 前往左侧取货位`;
        }
      }
    }
  }

  taskHint(inPosition, hoistReady, speedsReady, swayReady) {
    if (!inPosition) return "回转未对位 · P1 调整吊臂角度";
    if (!hoistReady) return "高度过高 · P2 将吊钩降至 14% 以下";
    if (!speedsReady) return "仍有滑行 · 等待回转与升降停稳";
    if (!swayReady) return "载荷摆动过大 · 降低动作速度";
    return "等待双方稳定";
  }

  angleErrorTo(target) {
    if (target == null) return 0;
    const error = ((target - this.slewAngle + 540) % 360) - 180;
    return error;
  }

  placeCargo() {
    this.placed += 1;
    this.cargoAttached = false;
    this.stabilityProgress = 0;
    this.pickupProgress = 0;
    this.phase = "settle";
    this.phaseTimer = 1.25;
    this.hoistSpeed = 0;
    this.slewSpeed = 0;
    this.swayVX = 0;
    this.swayVY = 0;
    this.record(
      "task",
      `${this.cargo.id} 落位完成 · ${this.placed}/${TOTAL_CARGO}`,
      "system",
      "success",
    );
    if (this.placed >= TOTAL_CARGO) {
      this.succeed();
    } else {
      this.hint = `${this.cargo.id} 已入位 · 准备下一箱`;
    }
  }

  attachCargo() {
    this.cargoAttached = true;
    this.phase = "carry";
    this.pickupProgress = 0;
    this.stabilityProgress = 0;
    this.record("task", `${this.cargo.id} 已挂载 · ${this.cargo.weight}t`, "system");
    this.hint = "P2 先提升吊钩，P1 再回转至右侧落箱区";
  }

  detectConflicts(dt) {
    if (
      this.isMovingP1 &&
      this.isMovingP2 &&
      this.swayMagnitude > 31 &&
      this.elapsed - this.lastConflictAt.sway > 2.4
    ) {
      this.lastConflictAt.sway = this.elapsed;
      this.record(
        "conflict",
        "双轴同时施力，载荷摆幅进入警戒区",
        "both",
        "warn",
        { conflict: true, sway: Number(this.swayMagnitude.toFixed(1)) },
      );
    }

    const oneSidedSteady =
      (this.steadyP1 && !this.steadyP2) ||
      (this.steadyP2 && !this.steadyP1);
    if (
      this.phase === "carry" &&
      oneSidedSteady &&
      this.hoistHeight <= 18 &&
      this.elapsed - this.lastConflictAt.steady > 1.8
    ) {
      this.lastConflictAt.steady = this.elapsed;
      this.record(
        "conflict",
        "稳定输入单侧缺失，落箱同步中断",
        this.steadyP1 ? "p1" : "p2",
        "warn",
        { conflict: true },
      );
    }

    if (
      this.roleLocks.p1 &&
      this.isMovingP1 &&
      this.elapsed - this.lastConflictAt.interlock > 2
    ) {
      this.lastConflictAt.interlock = this.elapsed;
      this.record(
        "conflict",
        "P1 在低吊高状态尝试回转，提升互锁拦截",
        "p1",
        "warn",
        { conflict: true },
      );
    }
  }

  succeed() {
    if (this.status === "success") return;
    this.status = "success";
    this.result = {
      outcome: "success",
      label: "三箱全部落位",
      elapsed: Number(this.elapsed.toFixed(2)),
      integrity: Number(this.integrity.toFixed(1)),
      hydraulic: Number(this.hydraulic.toFixed(1)),
      collisions: this.collisions,
    };
    this.endedAt = new Date().toISOString();
    this.releaseAllInputs();
    this.steadyP1 = false;
    this.steadyP2 = false;
    this.stabilityProgress = 0;
    this.pickupProgress = 0;
    this.phase = "complete";
    this.hint = "任务成功 · 三箱全部落位";
    this.record("result", "任务成功 · 三箱全部落位", "system", "success");
    this.captureSnapshot(true);
    this.emit("finish", this.getReplay());
  }

  fail(kind, label) {
    if (["success", "failed"].includes(this.status)) return;
    this.status = "failed";
    this.result = {
      outcome: "failure",
      kind,
      label,
      elapsed: Number(this.elapsed.toFixed(2)),
      integrity: Number(this.integrity.toFixed(1)),
      hydraulic: Number(this.hydraulic.toFixed(1)),
      collisions: this.collisions,
      side: this.lastCollisionBy,
    };
    this.endedAt = new Date().toISOString();
    this.releaseAllInputs();
    this.steadyP1 = false;
    this.steadyP2 = false;
    this.slewSpeed = 0;
    this.hoistSpeed = 0;
    this.hint = `任务中止 · ${label}`;
    this.record("result", `任务中止 · ${label}`, this.lastCollisionBy || "system", "danger");
    this.captureSnapshot(true);
    this.emit("finish", this.getReplay());
  }

  record(type, message, actor, severity = "info", extra = {}) {
    const event = {
      t: Number(this.elapsed.toFixed(2)),
      type,
      message,
      actor,
      severity,
      shared: {
        remaining: Number(this.remaining.toFixed(2)),
        hydraulic: Number(this.hydraulic.toFixed(1)),
        integrity: Number(this.integrity.toFixed(1)),
        placed: this.placed,
      },
      ...extra,
    };
    this.events.push(event);
    if (extra.conflict) this.conflicts.push(event);
    this.emit("event", event);
  }

  emit(type, detail) {
    this.onEvent({ type, detail, state: this.telemetry() });
  }

  captureSnapshot(force = false) {
    if (!this.recording) return;
    const bucket = Math.floor(this.elapsed * 10);
    if (!force && bucket === this.lastSnapshotAt) return;
    this.lastSnapshotAt = bucket;
    this.snapshots.push({
      t: Number(this.elapsed.toFixed(2)),
      status: this.status,
      slewAngle: Number(this.slewAngle.toFixed(2)),
      slewSpeed: Number(this.slewSpeed.toFixed(1)),
      hoistHeight: Number(this.hoistHeight.toFixed(1)),
      hoistSpeed: Number(this.hoistSpeed.toFixed(1)),
      swayX: Number(this.swayX.toFixed(1)),
      swayY: Number(this.swayY.toFixed(1)),
      hydraulic: Number(this.hydraulic.toFixed(1)),
      integrity: Number(this.integrity.toFixed(1)),
      remaining: Number(this.remaining.toFixed(2)),
      placed: this.placed,
      cargoIndex: this.cargoIndex,
      cargoAttached: this.cargoAttached,
      phase: this.phase,
      pickupProgress: Number(this.pickupProgress.toFixed(2)),
      stabilityProgress: Number(this.stabilityProgress.toFixed(2)),
      steadyP1: this.steadyP1,
      steadyP2: this.steadyP2,
      keys: JSON.parse(JSON.stringify(this.keys)),
    });
    if (this.snapshots.length > 3600) this.snapshots.shift();
  }

  telemetry() {
    return {
      status: this.status,
      mode: this.mode,
      elapsed: Number(this.elapsed.toFixed(2)),
      remaining: Number(this.remaining.toFixed(2)),
      slewAngle: Number(this.slewAngle.toFixed(1)),
      slewSpeed: Number(this.slewSpeed.toFixed(1)),
      hoistHeight: Number(this.hoistHeight.toFixed(1)),
      hoistSpeed: Number(this.hoistSpeed.toFixed(1)),
      sway: Number(this.swayMagnitude.toFixed(1)),
      swayX: Number(this.swayX.toFixed(1)),
      swayY: Number(this.swayY.toFixed(1)),
      hydraulic: Number(this.hydraulic.toFixed(1)),
      integrity: Number(this.integrity.toFixed(1)),
      placed: this.placed,
      cargoIndex: this.cargoIndex,
      cargoAttached: this.cargoAttached,
      phase: this.phase,
      pickupProgress: Number(this.pickupProgress.toFixed(2)),
      stabilityProgress: Number(this.stabilityProgress.toFixed(2)),
      steadyP1: this.steadyP1,
      steadyP2: this.steadyP2,
      riskP1: Number((this.risk.p1 / 1.15) * 100),
      riskP2: Number((this.risk.p2 / 1.15) * 100),
      collisions: this.collisions,
      hint: this.hint,
      keys: JSON.parse(JSON.stringify(this.keys)),
      links: {
        p1: {
          ...this.links.p1,
          remaining: this.linkRemaining("p1"),
        },
        p2: {
          ...this.links.p2,
          remaining: this.linkRemaining("p2"),
        },
      },
      protection: this.protection ? { ...this.protection } : null,
      roleLocks: this.roleLocks,
      cargo: { ...this.cargo },
      result: this.result ? { ...this.result } : null,
      sessionStartedAt: this.sessionStartedAt,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
    };
  }

  getReplay() {
    return {
      version: 1,
      id: this.replayId,
      mode: this.mode,
      startedAt: this.startedAt || this.sessionStartedAt,
      endedAt: this.endedAt || new Date().toISOString(),
      result: this.result ? { ...this.result } : null,
      telemetry: this.telemetry(),
      snapshots: this.snapshots.slice(),
      events: this.events.slice(),
      inputs: this.inputs.slice(),
      conflicts: this.conflicts.slice(),
    };
  }
}
