export const GAME_CONFIG = Object.freeze({
  duration: 90,
  maxShots: 6,
  startBattery: 100,
  baseTurbidity: 18,
  maxTurbidity: 100,
  moveSpeed: 112,
  boostMultiplier: 1.55,
  lampRise: 0.62,
  lampFall: 0.9,
  lampTurn: 1.15,
  heartbeatTimeout: 3500,
  snapshotInterval: 0.08,
  frame: { left: 120, top: 58, right: 840, bottom: 562 },
});

export const TARGETS = Object.freeze([
  {
    id: "coral",
    name: "珊瑚台 · 群鱼穿行",
    short: "珊瑚台",
    x: 470,
    y: -150,
    minDistance: 225,
    maxDistance: 390,
    fishRequired: 4,
    lightMin: 0.28,
    lightMax: 0.7,
    accent: "#63e4cf",
  },
  {
    id: "wreck",
    name: "沉船窗 · 低光侧影",
    short: "沉船窗",
    x: -420,
    y: 175,
    minDistance: 185,
    maxDistance: 345,
    fishRequired: 4,
    lightMin: 0.1,
    lightMax: 0.44,
    accent: "#f6b85d",
  },
  {
    id: "bluehole",
    name: "蓝洞穹顶 · 全景",
    short: "蓝洞穹顶",
    x: 145,
    y: -430,
    minDistance: 255,
    maxDistance: 435,
    fishRequired: 6,
    lightMin: 0.2,
    lightMax: 0.64,
    accent: "#7db9ff",
  },
]);

export const PILOT_ACTIONS = Object.freeze(["up", "down", "left", "right", "boost"]);
export const PHOTO_ACTIONS = Object.freeze([
  "lampUp",
  "lampDown",
  "aimLeft",
  "aimRight",
  "shutter",
]);

const CENTER = { x: 480, y: 310 };

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

export function angleDelta(from, to) {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function formatClock(seconds, tenths = false) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const base = `${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}`;
  return tenths ? `${base}.${Math.floor((safe % 1) * 10)}` : base;
}

function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultControls() {
  return {
    pilot: { up: false, down: false, left: false, right: false, boost: false },
    photo: { lampUp: false, lampDown: false, aimLeft: false, aimRight: false },
  };
}

function createFish(seed) {
  const random = makeRandom(seed);
  const fish = [];
  TARGETS.forEach((target, targetIndex) => {
    const count = targetIndex === 2 ? 9 : 7;
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2 + random() * 0.62;
      const radius = 42 + random() * 63;
      fish.push({
        id: `fish-${targetIndex}-${index}`,
        group: targetIndex,
        baseX: target.x + Math.cos(angle) * radius,
        baseY: target.y + Math.sin(angle) * radius * 0.62,
        homeAngle: angle,
        homeRadius: radius,
        phase: random() * Math.PI * 2,
        speed: 0.45 + random() * 0.4,
        size: 5.5 + random() * 4,
        tint: index % 3,
        fear: 0,
        offsetX: 0,
        offsetY: 0,
        x: target.x,
        y: target.y,
        vx: 0,
        vy: 0,
      });
    }
  });
  return fish;
}

export class DiveGame {
  constructor({ seed = 20261117, heartbeatTimeout = GAME_CONFIG.heartbeatTimeout } = {}) {
    this.seed = seed;
    this.heartbeatTimeout = heartbeatTimeout;
    this.phaseBeforeProtection = "ready";
    this.reset({ seed });
  }

  reset({ seed = this.seed } = {}) {
    this.seed = seed;
    this.phaseBeforeProtection = "ready";
    this.controls = defaultControls();
    this.pressed = new Set();
    this.elapsed = 0;
    this.lastSnapshotAt = -1;
    this.lastRoleInput = { pilot: -99, photo: -99 };
    this.lastInputLabel = { pilot: "待命", photo: "待命" };
    this.lastConflictAt = -99;
    this.lastFailure = null;
    this.recoveryCount = 0;
    this.photoAttempts = 0;
    this.rejectedInputs = 0;
    this.snapshots = [];
    this.events = [];
    this.conflicts = [];
    this.photos = [];
    this.soloMode = false;
    this.state = {
      phase: "ready",
      remaining: GAME_CONFIG.duration,
      turbidity: GAME_CONFIG.baseTurbidity,
      battery: GAME_CONFIG.startBattery,
      shotsRemaining: GAME_CONFIG.maxShots,
      targetIndex: 0,
      accepted: 0,
      failures: 0,
      recoveries: 0,
      conflictCount: 0,
      camera: { x: 0, y: 0 },
      lamp: { intensity: 0, aim: 0, on: false },
      fish: createFish(seed),
      players: {
        pilot: { connected: true, lastHeartbeat: 0, status: "ready" },
        photo: { connected: true, lastHeartbeat: 0, status: "ready" },
      },
      protectedRole: null,
      endReason: "",
      shotFlash: 0,
      lastEvent: "等待下潜",
    };
    this.addEvent({
      role: "system",
      type: "system",
      action: "新任务装载",
      detail: "仪表、目标与计时已同步复位",
      state: "ok",
    });
    this.captureSnapshot(true);
  }

  start(nowMs = 0) {
    if (this.state.phase !== "ready") return this.result(false, "当前状态不能开始");
    this.state.phase = "running";
    this.phaseBeforeProtection = "running";
    this.state.players.pilot.lastHeartbeat = nowMs;
    this.state.players.photo.lastHeartbeat = nowMs;
    this.addEvent({
      role: "system",
      type: "system",
      action: "下潜开始",
      detail: "共享计时、资源与回放录制启动",
      state: "ok",
    });
    this.captureSnapshot(true);
    return this.result(true);
  }

  pause(reason = "双人确认暂停") {
    if (this.state.phase === "protected") return this.result(false, "保护状态不可暂停");
    if (!["running", "ready"].includes(this.state.phase)) return this.result(false, "当前不可暂停");
    if (this.state.phase === "ready") return this.result(false, "尚未开始");
    this.phaseBeforeProtection = "paused";
    this.state.phase = "paused";
    this.clearControls();
    this.addEvent({
      role: "system",
      type: "system",
      action: "共享暂停",
      detail: reason,
      state: "neutral",
    });
    this.captureSnapshot(true);
    return this.result(true);
  }

  resume() {
    if (this.state.phase !== "paused") return this.result(false, "当前不可继续");
    this.state.phase = "running";
    this.phaseBeforeProtection = "running";
    this.addEvent({
      role: "system",
      type: "system",
      action: "继续下潜",
      detail: "计时与资源从冻结快照恢复",
      state: "ok",
    });
    this.captureSnapshot(true);
    return this.result(true);
  }

  restart({ autoStart = false, nowMs = 0 } = {}) {
    this.reset({ seed: this.seed });
    if (autoStart) this.start(nowMs);
    return this.result(true);
  }

  setSoloMode(enabled) {
    this.soloMode = Boolean(enabled);
    this.addEvent({
      role: "system",
      type: "system",
      action: enabled ? "进入单人调试" : "退出单人调试",
      detail: enabled ? "键位并入单人调试，正式同步验收标记暂停" : "恢复双人键位隔离",
      state: enabled ? "neutral" : "ok",
    });
    return this.result(true);
  }

  result(ok, message = "") {
    return { ok, message, state: this.state };
  }

  clearControls() {
    this.controls = defaultControls();
    this.pressed.clear();
  }

  roleActions(role) {
    return role === "pilot" ? PILOT_ACTIONS : role === "photo" ? PHOTO_ACTIONS : [];
  }

  setControl(role, action, active, nowMs = 0) {
    if (!["pilot", "photo"].includes(role)) {
      return this.rejectInput("unknown", action, "未知操作台");
    }
    if (!this.roleActions(role).includes(action)) {
      this.rejectedInputs += 1;
      const owner = role === "pilot" ? "B 摄影师" : "A 领航员";
      this.addEvent({
        role: "system",
        type: "rejected",
        action: "越权键位被拦截",
        detail: `${role === "pilot" ? "A" : "B"} 尝试 ${action}；该动作仅属于 ${owner}`,
        state: "bad",
      });
      return this.rejectInput(role, action, "该动作不属于此操作台");
    }

    this.controls[role][action] = Boolean(active);
    if (!active) {
      this.pressed.delete(`${role}:${action}`);
      return this.result(true);
    }

    if (this.state.phase !== "running") return this.result(false, "游戏未运行");
    const key = `${role}:${action}`;
    if (this.pressed.has(key)) return this.result(false, "忽略重复输入");
    this.pressed.add(key);

    this.lastRoleInput[role] = this.elapsed;
    const label = this.inputLabel(role, action);
    this.lastInputLabel[role] = label;
    this.addEvent({
      role,
      type: "input",
      action: label,
      detail: role === "pilot" ? "方向 / 距离控制" : "灯光 / 构图控制",
      state: "neutral",
    });
    this.detectInputConflict(role, label);
    if (role === "photo" && action === "shutter") return this.takePhoto(nowMs);
    return this.result(true);
  }

  inputLabel(role, action) {
    const labels = {
      pilot: {
        up: "↑ 前进",
        down: "↓ 后退",
        left: "← 左移",
        right: "→ 右移",
        boost: "加速",
      },
      photo: {
        lampUp: "增强灯光",
        lampDown: "减弱灯光",
        aimLeft: "光束左转",
        aimRight: "光束右转",
        shutter: "按下快门",
      },
    };
    return labels[role]?.[action] || action;
  }

  rejectInput(role, action, message) {
    return { ok: false, message, role, action, state: this.state };
  }

  detectInputConflict(role, label) {
    const other = role === "pilot" ? "photo" : "pilot";
    const delta = Math.abs(this.elapsed - this.lastRoleInput[other]);
    if (delta > 0.16 || this.elapsed - this.lastConflictAt < 0.8) return;
    this.lastConflictAt = this.elapsed;
    this.state.conflictCount += 1;
    const actions = {
      pilot: role === "pilot" ? label : this.lastInputLabel.pilot,
      photo: role === "photo" ? label : this.lastInputLabel.photo,
    };
    const conflict = {
      id: `conflict-${this.conflicts.length + 1}`,
      t: this.elapsed,
      role,
      label: `A ${actions.pilot} / B ${actions.photo}`,
      actions,
    };
    this.conflicts.push(conflict);
    this.addEvent({
      role: "system",
      type: "conflict",
      action: "同步冲突时刻",
      detail: conflict.label,
      state: "conflict",
      conflictId: conflict.id,
    });
  }

  addEvent(event) {
    const entry = {
      id: `evt-${this.events.length + 1}`,
      t: this.elapsed,
      ...event,
    };
    this.events.push(entry);
    this.state.lastEvent = entry.action;
    return entry;
  }

  target() {
    return TARGETS[this.state.targetIndex] || null;
  }

  screenPoint(worldX, worldY) {
    return {
      x: CENTER.x + (worldX - this.state.camera.x),
      y: CENTER.y + (worldY - this.state.camera.y),
    };
  }

  targetDistance() {
    const target = this.target();
    if (!target) return 0;
    return Math.hypot(
      target.x - this.state.camera.x,
      target.y - this.state.camera.y,
    );
  }

  targetBearing() {
    const target = this.target();
    if (!target) return 0;
    return Math.atan2(target.y - this.state.camera.y, target.x - this.state.camera.x);
  }

  fishInFrame() {
    if (!this.target()) return [];
    const { frame } = GAME_CONFIG;
    return this.state.fish.filter((fish) => {
      if (fish.group !== this.state.targetIndex || fish.fear > 0.66) return false;
      const point = this.screenPoint(fish.x, fish.y);
      return point.x >= frame.left && point.x <= frame.right
        && point.y >= frame.top && point.y <= frame.bottom;
    });
  }

  evaluation() {
    const target = this.target();
    if (!target) {
      return {
        complete: true,
        checks: [],
        fishCount: 0,
        distance: 0,
        aimError: 0,
      };
    }
    const point = this.screenPoint(target.x, target.y);
    const { frame } = GAME_CONFIG;
    const distance = this.targetDistance();
    const aimError = Math.abs(angleDelta(this.state.lamp.aim, this.targetBearing()));
    const inFrame = point.x >= frame.left && point.x <= frame.right
      && point.y >= frame.top && point.y <= frame.bottom;
    const fish = this.fishInFrame();
    const checks = [
      {
        key: "frame",
        role: "pilot",
        label: "主体进入取景框",
        ok: inFrame,
        value: inFrame ? "已入框" : "偏离画幅",
      },
      {
        key: "distance",
        role: "pilot",
        label: `距离 ${target.minDistance}–${target.maxDistance}`,
        ok: distance >= target.minDistance && distance <= target.maxDistance,
        value: `${Math.round(distance)}`,
      },
      {
        key: "fish",
        role: "photo",
        label: `鱼群 ${target.fishRequired}+ 入框`,
        ok: fish.length >= target.fishRequired,
        value: `${fish.length}`,
      },
      {
        key: "aim",
        role: "photo",
        label: "光束对准主体",
        ok: aimError <= 0.18,
        value: `${Math.round((1 - Math.min(1, aimError / Math.PI)) * 100)}%`,
      },
      {
        key: "light",
        role: "photo",
        label: "柔光区间",
        ok: this.state.lamp.intensity >= target.lightMin
          && this.state.lamp.intensity <= target.lightMax,
        value: `${Math.round(this.state.lamp.intensity * 100)}%`,
      },
      {
        key: "visibility",
        role: "shared",
        label: "浊度 < 76%",
        ok: this.state.turbidity < 76,
        value: `${Math.round(this.state.turbidity)}%`,
      },
    ];
    return {
      complete: checks.every((check) => check.ok),
      checks,
      fishCount: fish.length,
      distance,
      aimError,
      inFrame,
      point,
    };
  }

  update(dt, nowMs = 0) {
    if (!Number.isFinite(dt) || dt <= 0) return this.result(true);
    const step = clamp(dt, 0, 0.08);

    if (nowMs > 0 && !this.checkHeartbeats(nowMs)) {
      return this.result(false, "链路超时保护");
    }
    if (this.state.phase !== "running") return this.result(true);

    this.elapsed += step;
    this.state.remaining = Math.max(0, this.state.remaining - step);
    this.state.shotFlash = Math.max(0, this.state.shotFlash - step * 3.2);

    if (this.state.remaining <= 0) {
      this.endMission("failed", "共享倒计时耗尽");
      return this.result(false, "倒计时结束");
    }

    this.updateCamera(step);
    this.updateLamp(step);
    this.updateTurbidity(step);
    this.updateFish(step);

    if (this.elapsed - this.lastSnapshotAt >= GAME_CONFIG.snapshotInterval) {
      this.captureSnapshot();
    }
    return this.result(true);
  }

  updateCamera(dt) {
    const input = this.controls.pilot;
    let dx = Number(input.right) - Number(input.left);
    let dy = Number(input.down) - Number(input.up);
    const magnitude = Math.hypot(dx, dy);
    if (magnitude === 0) return;
    dx /= magnitude;
    dy /= magnitude;
    const boost = input.boost ? GAME_CONFIG.boostMultiplier : 1;
    const speed = GAME_CONFIG.moveSpeed * boost;
    const moved = speed * dt;
    this.state.camera.x = clamp(this.state.camera.x + dx * moved, -980, 980);
    this.state.camera.y = clamp(this.state.camera.y + dy * moved, -680, 680);
    this.state.turbidity = clamp(
      this.state.turbidity + moved * 0.0065 + (boost > 1 ? dt * 0.22 : 0),
      0,
      GAME_CONFIG.maxTurbidity,
    );
    this.state.battery = Math.max(0, this.state.battery - dt * 0.045 * boost);
  }

  updateLamp(dt) {
    const input = this.controls.photo;
    const lamp = this.state.lamp;
    if (this.state.battery <= 0) {
      lamp.intensity = 0;
      lamp.on = false;
      return;
    }
    if (input.lampUp) lamp.intensity += GAME_CONFIG.lampRise * dt;
    if (input.lampDown) lamp.intensity -= GAME_CONFIG.lampFall * dt;
    if (input.aimLeft) lamp.aim -= GAME_CONFIG.lampTurn * dt;
    if (input.aimRight) lamp.aim += GAME_CONFIG.lampTurn * dt;
    lamp.intensity = clamp(lamp.intensity, 0, 1);
    if (lamp.intensity < 0.002) lamp.intensity = 0;
    lamp.on = lamp.intensity > 0.002;
    if (lamp.aim > Math.PI) lamp.aim -= Math.PI * 2;
    if (lamp.aim < -Math.PI) lamp.aim += Math.PI * 2;

    if (lamp.on) {
      const drain = (0.72 + lamp.intensity * 2.25) * dt;
      this.state.battery = Math.max(0, this.state.battery - drain);
      this.state.turbidity = clamp(
        this.state.turbidity + lamp.intensity * 0.28 * dt,
        0,
        GAME_CONFIG.maxTurbidity,
      );
      if (this.state.battery <= 0) {
        lamp.intensity = 0;
        lamp.on = false;
      }
    }
  }

  updateTurbidity(dt) {
    const moving = this.controls.pilot.up || this.controls.pilot.down
      || this.controls.pilot.left || this.controls.pilot.right;
    const lampOn = this.state.lamp.on;
    if (!moving && !lampOn) {
      this.state.turbidity = Math.max(
        GAME_CONFIG.baseTurbidity,
        this.state.turbidity - dt * 0.085,
      );
    }
  }

  updateFish(dt) {
    const camera = this.state.camera;
    const lamp = this.state.lamp;
    const target = this.target();
    this.state.fish.forEach((fish) => {
      const distance = Math.hypot(fish.x - camera.x, fish.y - camera.y);
      const bearing = Math.atan2(fish.y - camera.y, fish.x - camera.x);
      const inBeam = Math.abs(angleDelta(lamp.aim, bearing)) < 0.48;
      const strongLight = lamp.on && lamp.intensity > 0.72 && this.state.battery > 0;
      const nearTarget = target && fish.group === this.state.targetIndex;

      if (strongLight && inBeam && distance < 330 && nearTarget) {
        fish.fear = clamp(fish.fear + dt * 0.86, 0, 1);
        const push = (45 + fish.fear * 120) * dt;
        fish.offsetX += Math.cos(bearing) * push;
        fish.offsetY += Math.sin(bearing) * push;
      } else {
        fish.fear = Math.max(0, fish.fear - dt * 0.21);
        fish.offsetX *= Math.max(0, 1 - dt * 0.5);
        fish.offsetY *= Math.max(0, 1 - dt * 0.5);
      }

      const offsetLimit = 235;
      const offsetLength = Math.hypot(fish.offsetX, fish.offsetY);
      if (offsetLength > offsetLimit) {
        fish.offsetX = (fish.offsetX / offsetLength) * offsetLimit;
        fish.offsetY = (fish.offsetY / offsetLength) * offsetLimit;
      }

      const tail = this.elapsed * fish.speed + fish.phase;
      fish.x = fish.baseX + fish.offsetX + Math.cos(tail) * 5;
      fish.y = fish.baseY + fish.offsetY + Math.sin(tail * 0.7) * 4;
      fish.vx = -Math.sin(tail) * fish.speed * 4;
      fish.vy = Math.cos(tail * 0.7) * fish.speed * 2.6;
    });
  }

  calmLevel() {
    const active = this.state.fish.filter((fish) => fish.group === this.state.targetIndex);
    if (!active.length) return 1;
    const fear = active.reduce((sum, fish) => sum + fish.fear, 0) / active.length;
    return 1 - fear;
  }

  checkHeartbeats(nowMs) {
    if (this.state.phase === "protected") return true;
    const roles = ["pilot", "photo"];
    for (const role of roles) {
      const player = this.state.players[role];
      if (!player.connected) continue;
      if (player.lastHeartbeat > 0 && nowMs - player.lastHeartbeat > this.heartbeatTimeout) {
        this.protect(role, "心跳超时，自动冻结共享状态");
        return false;
      }
    }
    return true;
  }

  heartbeat(role, nowMs) {
    if (!this.state.players[role]) return this.result(false, "未知角色");
    if (this.state.players[role].connected) {
      this.state.players[role].lastHeartbeat = nowMs;
    }
    return this.result(true);
  }

  disconnect(role, reason = "操作台断线") {
    const player = this.state.players[role];
    if (!player) return this.result(false, "未知角色");
    if (!player.connected) return this.result(false, "该侧已离线");
    player.connected = false;
    player.status = "offline";
    this.protect(role, reason);
    return this.result(true);
  }

  protect(role, reason) {
    if (this.state.phase === "protected") return;
    this.phaseBeforeProtection = this.state.phase;
    this.state.phase = "protected";
    this.state.protectedRole = role;
    this.clearControls();
    this.addEvent({
      role: "system",
      type: "protection",
      action: role === "pilot" ? "A 侧离线保护" : "B 侧离线保护",
      detail: `${reason}；倒计时与共享资源已冻结`,
      state: "bad",
    });
    this.captureSnapshot(true);
  }

  reconnect(role) {
    const player = this.state.players[role];
    if (!player) return this.result(false, "未知角色");
    player.connected = true;
    player.status = "online";
    player.lastHeartbeat = this.state.players.pilot.lastHeartbeat;
    const bothBack = this.state.players.pilot.connected && this.state.players.photo.connected;
    if (this.state.phase === "protected" && bothBack) {
      this.state.phase = this.phaseBeforeProtection || "running";
      this.state.protectedRole = null;
      this.addEvent({
        role: "system",
        type: "protection",
        action: "双人链路恢复",
        detail: "从冻结快照同步恢复仪表、资源、倒计时与任务记录",
        state: "ok",
      });
      this.captureSnapshot(true);
      return this.result(true);
    }
    return this.result(true);
  }

  takePhoto() {
    if (this.state.phase !== "running") {
      return this.result(false, "当前状态不能拍摄");
    }
    if (this.state.shotsRemaining <= 0) {
      this.endMission("failed", "共享底片耗尽");
      return this.result(false, "没有可用底片");
    }
    if (this.state.battery < 5) {
      this.addEvent({
        role: "photo",
        type: "rejected",
        action: "快门被资源保护拦截",
        detail: "共享电量低于 5%，无法完成曝光",
        state: "bad",
      });
      return this.result(false, "共享电量不足");
    }

    const moving = this.controls.pilot.up || this.controls.pilot.down
      || this.controls.pilot.left || this.controls.pilot.right;
    if (moving && this.elapsed - this.lastConflictAt > 0.45) {
      this.lastConflictAt = this.elapsed;
      this.state.conflictCount += 1;
      const conflict = {
        id: `conflict-${this.conflicts.length + 1}`,
        t: this.elapsed,
        role: "photo",
        label: "A 正在移动时，B 按下快门",
        actions: {
          pilot: this.lastInputLabel.pilot,
          photo: "快门",
        },
      };
      this.conflicts.push(conflict);
      this.addEvent({
        role: "system",
        type: "conflict",
        action: "移动 / 快门重叠",
        detail: conflict.label,
        state: "conflict",
        conflictId: conflict.id,
      });
    }

    const evaluation = this.evaluation();
    const target = this.target();
    this.photoAttempts += 1;
    this.state.shotsRemaining -= 1;
    this.state.battery = Math.max(0, this.state.battery - 6.4);
    this.state.turbidity = clamp(
      this.state.turbidity + 2.6,
      0,
      GAME_CONFIG.maxTurbidity,
    );
    this.state.shotFlash = 1;

    if (evaluation.complete) {
      this.completeTarget(target, evaluation);
    } else {
      this.failTarget(target, evaluation);
    }
    this.captureSnapshot(true);
    return {
      ok: evaluation.complete,
      message: evaluation.complete ? "目标照片达成" : "曝光未达标",
      evaluation,
      state: this.state,
    };
  }

  completeTarget(target, evaluation) {
    this.state.accepted += 1;
    const previousFailure = this.lastFailure;
    const recovered = previousFailure && previousFailure.targetIndex === this.state.targetIndex;
    if (recovered) {
      this.recoveryCount += 1;
      this.state.recoveries = this.recoveryCount;
    }
    this.photos.push({
      targetId: target.id,
      name: target.name,
      t: this.elapsed,
      fish: evaluation.fishCount,
      distance: Math.round(evaluation.distance),
      light: Math.round(this.state.lamp.intensity * 100),
      recovered: Boolean(recovered),
    });
    this.addEvent({
      role: "photo",
      type: "photo",
      action: `目标照片 ${this.state.accepted}/3 达成`,
      detail: `${target.short} · ${evaluation.fishCount} 尾鱼 · ${Math.round(evaluation.distance)} 距离`,
      state: "ok",
    });
    if (recovered) {
      this.addEvent({
        role: "system",
        type: "recovery",
        action: "单侧失误后恢复",
        detail: `断点 ${formatClock(previousFailure.t, true)} → ${formatClock(this.elapsed, true)}，双方状态重新同步`,
        state: "ok",
      });
    }
    this.lastFailure = null;
    this.state.targetIndex += 1;
    if (this.state.targetIndex >= TARGETS.length) {
      this.endMission("success", "三张目标照片全部达成");
    }
  }

  failTarget(target, evaluation) {
    this.state.failures += 1;
    const failedChecks = evaluation.checks.filter((check) => !check.ok);
    const roles = new Set(failedChecks.map((check) => check.role));
    let faultRole = "photo";
    if (roles.has("pilot") && !roles.has("photo")) faultRole = "pilot";
    if (roles.has("pilot") && roles.has("photo")) faultRole = "shared";
    if (roles.has("shared") && !roles.has("pilot")) faultRole = "photo";
    this.lastFailure = {
      targetIndex: this.state.targetIndex,
      t: this.elapsed,
      faultRole,
      reasons: failedChecks.map((check) => check.label),
    };
    this.addEvent({
      role: "photo",
      type: "failed-photo",
      action: `快门未达标 · ${
        faultRole === "pilot" ? "A 侧失误" : faultRole === "photo" ? "B 侧失误" : "双方失误"
      }`,
      detail: `${target.short} · ${failedChecks.map((check) => check.label).join("、")}`,
      state: "bad",
      faultRole,
    });
    if (this.state.shotsRemaining <= 0) {
      this.endMission("failed", "共享底片耗尽");
    }
  }

  endMission(phase, reason) {
    if (!["success", "failed"].includes(phase)) return;
    this.state.phase = phase;
    this.state.endReason = reason;
    this.clearControls();
    this.addEvent({
      role: "system",
      type: "mission",
      action: phase === "success" ? "任务成功" : "任务失败",
      detail: reason,
      state: phase === "success" ? "ok" : "bad",
    });
    this.captureSnapshot(true);
  }

  captureSnapshot(force = false) {
    if (!force && this.elapsed - this.lastSnapshotAt < GAME_CONFIG.snapshotInterval) return;
    this.lastSnapshotAt = this.elapsed;
    const snapshot = {
      t: Number(this.elapsed.toFixed(3)),
      phase: this.state.phase,
      remaining: Number(this.state.remaining.toFixed(3)),
      turbidity: Number(this.state.turbidity.toFixed(2)),
      battery: Number(this.state.battery.toFixed(2)),
      shotsRemaining: this.state.shotsRemaining,
      accepted: this.state.accepted,
      failures: this.state.failures,
      targetIndex: this.state.targetIndex,
      camera: {
        x: Number(this.state.camera.x.toFixed(2)),
        y: Number(this.state.camera.y.toFixed(2)),
      },
      lamp: {
        intensity: Number(this.state.lamp.intensity.toFixed(3)),
        aim: Number(this.state.lamp.aim.toFixed(3)),
        on: this.state.lamp.on,
      },
      calm: Number(this.calmLevel().toFixed(3)),
      fish: this.state.fish.map((fish) => [
        Number(fish.x.toFixed(1)),
        Number(fish.y.toFixed(1)),
        fish.group,
        Number(fish.fear.toFixed(2)),
        Number(fish.size.toFixed(1)),
        fish.tint,
      ]),
    };
    const previous = this.snapshots[this.snapshots.length - 1];
    if (previous && previous.t === snapshot.t && !force) return;
    this.snapshots.push(snapshot);
    if (this.snapshots.length > 5000) this.snapshots.shift();
  }

  snapshotAt(time) {
    if (!this.snapshots.length) return null;
    let closest = this.snapshots[0];
    for (const snapshot of this.snapshots) {
      if (snapshot.t <= time) closest = snapshot;
      else break;
    }
    return closest;
  }

  metrics() {
    return {
      accepted: this.state.accepted,
      attempts: this.photoAttempts,
      failures: this.state.failures,
      recoveries: this.state.recoveries,
      conflicts: this.conflicts.length,
      rejectedInputs: this.rejectedInputs,
      elapsed: Number(this.elapsed.toFixed(2)),
      remaining: Number(this.state.remaining.toFixed(2)),
      turbidity: Number(this.state.turbidity.toFixed(1)),
      battery: Number(this.state.battery.toFixed(1)),
    };
  }

  replayData() {
    return {
      version: 1,
      seed: this.seed,
      startedAt: new Date().toISOString(),
      soloMode: this.soloMode,
      duration: Number(this.elapsed.toFixed(3)),
      phase: this.state.phase,
      endReason: this.state.endReason,
      metrics: this.metrics(),
      events: clonePlain(this.events),
      conflicts: clonePlain(this.conflicts),
      photos: clonePlain(this.photos),
      snapshots: clonePlain(this.snapshots),
      finalState: {
        remaining: this.state.remaining,
        turbidity: this.state.turbidity,
        battery: this.state.battery,
        shotsRemaining: this.state.shotsRemaining,
        accepted: this.state.accepted,
        targetIndex: this.state.targetIndex,
        failures: this.state.failures,
        recoveries: this.state.recoveries,
      },
    };
  }
}

export function formatClockForReplay(seconds) {
  return formatClock(seconds, true);
}
