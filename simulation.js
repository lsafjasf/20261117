export const MISSION_DURATION = 150;
export const MAX_ATTEMPTS = 6;
export const REQUIRED_POINTS = 3;
export const CONFIRM_WINDOW = 0.95;
export const STABLE_THRESHOLD = 88;
export const STABLE_HOLD = 0.55;
export const IDLE_WARNING = 24;
export const IDLE_TIMEOUT = 32;
export const TARGET_VISIBLE_SECONDS = 10;
export const TARGET_HIDDEN_SECONDS = 4.5;

export const TARGETS = [
  { id: "K-01", name: "北脊标桩", az: 6.8, el: 3.2, focus: 0.64, tint: "#87e8ff" },
  { id: "K-02", name: "断崖棱镜", az: -5.4, el: -2.6, focus: 0.38, tint: "#ffd37a" },
  { id: "K-03", name: "风蚀基线", az: 12.2, el: 5.6, focus: 0.74, tint: "#ff9c7d" },
];

export const KEY_BINDINGS = {
  KeyA: { role: "P1", action: "azLeft", key: "A", label: "方位 −" },
  KeyD: { role: "P1", action: "azRight", key: "D", label: "方位 +" },
  Space: { role: "P1", action: "confirm", key: "SPACE", label: "记录确认" },
  ArrowUp: { role: "P2", action: "elUp", key: "↑", label: "仰角 +" },
  ArrowDown: { role: "P2", action: "elDown", key: "↓", label: "仰角 −" },
  KeyW: { role: "P2", action: "focusFar", key: "W", label: "焦距 +" },
  KeyS: { role: "P2", action: "focusNear", key: "S", label: "焦距 −" },
  Enter: { role: "P2", action: "confirm", key: "ENTER", label: "记录确认" },
  KeyP: { role: "SHARED", action: "pause", key: "P", label: "暂停" },
  KeyV: { role: "SHARED", action: "replay", key: "V", label: "回放" },
};

export const ROLE_KEYS = {
  P1: ["A", "D", "SPACE"],
  P2: ["↑", "↓", "W", "S", "ENTER"],
  DEBUG: ["A", "D", "↑", "↓", "W", "S", "SPACE"],
};

export const ROLE_META = {
  P1: { name: "观测员 A", duty: "方位控制", color: "#63dcff" },
  P2: { name: "观测员 B", duty: "仰角 / 焦距", color: "#ffc766" },
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, digits = 2) => Number(value.toFixed(digits));
const copyObject = (value) => JSON.parse(JSON.stringify(value));

export class SurveySimulation {
  constructor() {
    this.seed = Date.now();
    this.runNumber = 1;
    this.history = [];
    this.held = new Map();
    this.replay = null;
    this.snapshotClock = 0;
    this.lastTickAt = 0;
    this._beginRun("initial");
  }

  _makeRunId() {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    return `SV-${stamp}-${String(this.runNumber).padStart(2, "0")}`;
  }

  _beginRun(reason = "reset") {
    this.runNumber += 1;
    const runId = this._makeRunId();
    this.elapsed = 0;
    this.targetElapsed = 0;
    this.stableFor = 0;
    this.records = [];
    this.conflicts = [];
    this.confirmations = { P1: null, P2: null };
    this.protection = null;
    this.latestNotice = "系统待命，等待双人开始";
    this.mode = "ready";
    this.debug = false;
    this.pausedFrom = null;
    this.revision = 0;
    this.outcome = null;
    this.completedAt = null;
    this.sceneTime = this.sceneTime || 0;
    this._frozenTargetVisible = null;
    this._frozenTargetWindow = null;
    this._lastVisible = true;
    this._idleWarned = { P1: false, P2: false };
    this.lastReplayNotice = "";
    this.targetIndex = 0;
    this.attemptsUsed = 0;
    this.controls = { azimuth: 0, elevation: 0, focus: 0.5 };
    this.players = {
      P1: { connected: true, idle: 0, acceptedInputs: 0, rejectedInputs: 0 },
      P2: { connected: true, idle: 0, acceptedInputs: 0, rejectedInputs: 0 },
    };
    this.held.clear();
    this.replay = {
      id: runId,
      startedAt: new Date().toISOString(),
      reason,
      events: [],
      snapshots: [],
      conflicts: [],
      resetReason: reason,
    };
    this.snapshotClock = 0;
    this.seed += 7919;
    this._log("run_created", { runId, reason }, true);
  }

  get target() {
    return TARGETS[Math.min(this.targetIndex, TARGETS.length - 1)];
  }

  get targetVisible() {
    const cycle = TARGET_VISIBLE_SECONDS + TARGET_HIDDEN_SECONDS;
    const phase = this.targetElapsed % cycle;
    if (this.mode === "ready" || this.mode === "paused" || this.mode === "protection") {
      return this._frozenTargetVisible ?? true;
    }
    return phase < TARGET_VISIBLE_SECONDS;
  }

  get targetWindowRemaining() {
    const cycle = TARGET_VISIBLE_SECONDS + TARGET_HIDDEN_SECONDS;
    const phase = this.targetElapsed % cycle;
    if (this.mode === "ready" || this.mode === "paused" || this.mode === "protection") {
      const frozen = this._frozenTargetWindow ?? TARGET_VISIBLE_SECONDS;
      return frozen;
    }
    return phase < TARGET_VISIBLE_SECONDS
      ? TARGET_VISIBLE_SECONDS - phase
      : cycle - phase;
  }

  get remaining() {
    return Math.max(0, MISSION_DURATION - this.elapsed);
  }

  get shotsLeft() {
    return Math.max(0, MAX_ATTEMPTS - this.attemptsUsed);
  }

  get successCount() {
    return this.records.filter((record) => record.status === "captured").length;
  }

  get canExport() {
    return this.successCount >= REQUIRED_POINTS;
  }
}

SurveySimulation.prototype.KEY_BINDINGS = KEY_BINDINGS;
SurveySimulation.prototype.TARGETS = TARGETS;
SurveySimulation.prototype.copyObject = copyObject;
SurveySimulation.prototype.clamp = clamp;
SurveySimulation.prototype.round = round;

SurveySimulation.prototype.metrics = function metrics() {
  const target = this.target;
  const azError = target.az - this.controls.azimuth;
  const elError = target.el - this.controls.elevation;
  const focusError = target.focus - this.controls.focus;
  const quality = clamp(
    100 - Math.abs(azError) * 7.5 - Math.abs(elError) * 10 - Math.abs(focusError) * 150,
    0,
    100,
  );
  return {
    azError: round(azError),
    elError: round(elError),
    focusError: round(focusError),
    quality: round(quality, 1),
    aligned: quality >= STABLE_THRESHOLD,
    visible: this.targetVisible,
  };
};

SurveySimulation.prototype.start = function start() {
  if (this.mode !== "ready") return false;
  this.mode = "live";
  this._frozenTargetVisible = null;
  this._frozenTargetWindow = null;
  this.latestNotice = this.debug
    ? "单人调试运行中：所有控制器可用"
    : "双人链路在线，开始捕获测点";
  this._log("mission_start", {
    debug: this.debug,
    duration: MISSION_DURATION,
    target: this.target.id,
  }, true);
  return true;
};

SurveySimulation.prototype.togglePause = function togglePause(source = "shared") {
  if (this.mode === "live") {
    const frozenVisible = this.targetVisible;
    const frozenWindow = this.targetWindowRemaining;
    this.mode = "paused";
    this.pausedFrom = "live";
    this._frozenTargetVisible = frozenVisible;
    this._frozenTargetWindow = frozenWindow;
    this.held.clear();
    this.confirmations = { P1: null, P2: null };
    this.latestNotice = "任务已暂停，计时与目标窗口冻结";
    this._log("pause", { actor: source, remaining: round(this.remaining, 2) }, true);
    return true;
  }
  if (this.mode === "paused") {
    this.mode = "live";
    this.pausedFrom = null;
    this._frozenTargetVisible = null;
    this._frozenTargetWindow = null;
    this.latestNotice = "任务继续，双方控制恢复";
    this._log("resume", { actor: source, remaining: round(this.remaining, 2) }, true);
    return true;
  }
  return false;
};

SurveySimulation.prototype._acceptPlayerActivity = function _acceptPlayerActivity(role) {
  if (!this.players[role]) return;
  this.players[role].idle = 0;
  if (this.mode === "live") this.players[role].acceptedInputs += 1;
};

SurveySimulation.prototype._rejectInput = function _rejectInput(binding, code, reason) {
  const role = binding?.role;
  if (this.players[role]) this.players[role].rejectedInputs += 1;
  this.latestNotice = reason;
  this._log("input_rejected", {
    actor: role === "SHARED" ? "SYS" : role,
    code,
    action: binding?.action || "unknown",
    reason,
  });
  return { accepted: false, reason };
};

SurveySimulation.prototype.inputDown = function inputDown(code, origin = "keyboard") {
  const binding = KEY_BINDINGS[code];
  if (!binding) return { accepted: false, reason: "该键位未分配" };
  if (this.held.has(code)) return { accepted: false, reason: "按键已处于按下状态" };

  if (binding.action === "pause") {
    const accepted = this.togglePause("shared");
    this._log("input", {
      actor: "SHARED",
      code,
      action: "pause",
      phase: "down",
      origin,
      accepted,
    }, true);
    return { accepted, reason: accepted ? "" : "当前状态不可暂停或继续" };
  }
  if (binding.action === "replay") return { accepted: false, reason: "回放由界面控制" };

  if (this.mode === "protection") {
    if (binding.action !== "confirm") {
      return this._rejectInput(binding, code, "保护状态下仅允许双方恢复确认");
    }
    return this.acknowledgeRecovery(binding.role, `${origin}:${code}`);
  }
  if (this.mode !== "live") {
    return this._rejectInput(binding, code, "任务尚未运行或已结束");
  }
  if (!this.debug && !this.players[binding.role]?.connected) {
    return this._rejectInput(binding, code, `${ROLE_META[binding.role].name} 链路已断开`);
  }

  this._acceptPlayerActivity(binding.role);
  this._log("input", {
    actor: this.debug ? "DEBUG" : binding.role,
    role: binding.role,
    code,
    action: binding.action,
    phase: "down",
    origin,
    debug: this.debug,
    controls: copyObject(this.controls),
    targetVisible: this.targetVisible,
  }, true);

  if (binding.action === "confirm") {
    return this.handleConfirm(this.debug ? "DEBUG" : binding.role, `${origin}:${code}`);
  }
  this.held.set(code, binding);
  return { accepted: true };
};

SurveySimulation.prototype.inputUp = function inputUp(code, origin = "keyboard") {
  const binding = KEY_BINDINGS[code];
  if (!binding) return false;
  const existed = this.held.delete(code);
  if (existed) {
    this._log("input", {
      actor: this.debug ? "DEBUG" : binding.role,
      role: binding.role,
      code,
      action: binding.action,
      phase: "up",
      origin,
    }, true);
  }
  return existed;
};

SurveySimulation.prototype.releaseAll = function releaseAll(origin = "system") {
  for (const code of [...this.held.keys()]) this.inputUp(code, origin);
};

SurveySimulation.prototype.handleConfirm = function handleConfirm(actor, source) {
  if (this.mode !== "live") {
    return { accepted: false, reason: "当前状态不可记录" };
  }
  if (this.shotsLeft <= 0) {
    return { accepted: false, reason: "共享采样资源已耗尽" };
  }
  if (this.debug) {
    return this._resolveDebugConfirmation(actor, source);
  }
  if (actor !== "P1" && actor !== "P2") {
    return { accepted: false, reason: "未知操作员" };
  }
  if (!this.players[actor].connected) {
    return { accepted: false, reason: "链路未连接" };
  }
  if (this.confirmations[actor]) {
    return { accepted: false, reason: "本侧已确认，等待另一侧" };
  }
  const metrics = this.metrics();
  this.confirmations[actor] = {
    at: round(this.elapsed, 3),
    quality: metrics.quality,
    targetVisible: metrics.visible,
    source,
  };
  this.latestNotice = `${ROLE_META[actor].name} 已确认，等待另一侧`;
  this._log("confirm", {
    actor,
    quality: metrics.quality,
    targetVisible: metrics.visible,
    shotsLeft: this.shotsLeft,
    source,
  }, true);
  if (this.confirmations.P1 && this.confirmations.P2) {
    this._resolveDualConfirmation();
  }
  return { accepted: true };
};

SurveySimulation.prototype._resolveDebugConfirmation = function _resolveDebugConfirmation(actor, source) {
  const metrics = this.metrics();
  if (!metrics.visible) {
    this._finishAttempt({
      status: "missed",
      kind: "target-hidden",
      actor: "DEBUG",
      metrics,
      source,
    });
    return { accepted: true, success: false };
  }
  if (!metrics.aligned) {
    this._finishAttempt({
      status: "missed",
      kind: "alignment",
      actor: "DEBUG",
      metrics,
      source,
    });
    return { accepted: true, success: false };
  }
  if (this.stableFor < STABLE_HOLD) {
    this._finishAttempt({
      status: "missed",
      kind: "unstable",
      actor: "DEBUG",
      metrics,
      source,
    });
    return { accepted: true, success: false };
  }
  this._finishAttempt({
    status: "captured",
    kind: "debug-success",
    actor: "DEBUG",
    metrics,
    source,
  });
  return { accepted: true, success: true };
};

SurveySimulation.prototype._resolveDualConfirmation = function _resolveDualConfirmation() {
  const metrics = this.metrics();
  const pair = copyObject(this.confirmations);
  this.confirmations = { P1: null, P2: null };
  const stableLongEnough = this.stableFor >= STABLE_HOLD;

  if (!metrics.visible) {
    this._finishAttempt({
      status: "missed",
      kind: "target-hidden",
      actor: "BOTH",
      metrics,
      pair,
    });
    return;
  }
  if (!metrics.aligned) {
    this._finishAttempt({
      status: "missed",
      kind: "conflict-alignment",
      actor: "BOTH",
      conflict: true,
      metrics,
      pair,
    });
    return;
  }
  if (!stableLongEnough) {
    this._finishAttempt({
      status: "missed",
      kind: "conflict-unstable",
      actor: "BOTH",
      conflict: true,
      metrics,
      pair,
    });
    return;
  }
  this._finishAttempt({
    status: "captured",
    kind: "dual-success",
    actor: "BOTH",
    metrics,
    pair,
  });
};

SurveySimulation.prototype._finishAttempt = function _finishAttempt(result) {
  if (this.attemptsUsed >= MAX_ATTEMPTS) return;
  this.attemptsUsed += 1;
  const before = this.shotsLeft + 1;
  const serial = String(this.records.length + 1).padStart(2, "0");
  const record = {
    id: result.status === "captured" ? `PT-${serial}` : `TRY-${serial}`,
    status: result.status,
    kind: result.kind,
    actor: result.actor,
    time: round(this.elapsed, 2),
    targetId: this.target.id,
    targetName: this.target.name,
    quality: result.metrics?.quality ?? 0,
    azError: result.metrics?.azError ?? 0,
    elError: result.metrics?.elError ?? 0,
    focusError: result.metrics?.focusError ?? 0,
    shotsLeft: this.shotsLeft,
    debug: this.debug,
    pair: result.pair || null,
  };
  this.records.push(record);

  if (result.status === "missed") {
    const conflict = {
      time: round(this.elapsed, 2),
      kind: result.kind,
      actor: result.actor,
      targetId: this.target.id,
      quality: record.quality,
      pair: result.pair || null,
    };
    this.conflicts.push(conflict);
    this.latestNotice = result.kind === "target-hidden"
      ? "记录失败：目标已离开可见窗口"
      : result.kind === "unstable"
        ? "记录失败：稳定保持时间不足"
        : "记录失败：双侧十字线未同时稳定";
    this._log("attempt_missed", {
      record,
      conflict: result.conflict || result.kind.startsWith("single"),
      conflictMoment: conflict,
      resourceBefore: before,
      resourceAfter: this.shotsLeft,
    }, true);
  } else {
    this.latestNotice = `测点 ${record.id} 已写入共享任务记录`;
    this._log("attempt_captured", {
      record,
      resourceBefore: before,
      resourceAfter: this.shotsLeft,
      successCount: this.successCount,
    }, true);
    this.targetElapsed = 0;
    this.stableFor = 0;
    this.targetIndex = Math.min(this.targetIndex + 1, TARGETS.length - 1);
    if (this.successCount >= REQUIRED_POINTS) {
      this._completeMission("success");
    }
  }

  this._log("resource_change", {
    resource: "shared-attempts",
    before,
    after: this.shotsLeft,
    reason: record.status,
  }, true);
  this._captureSnapshot(`attempt:${record.status}`);
  if (this.shotsLeft <= 0 && this.successCount < REQUIRED_POINTS) {
    this._completeMission("resource-exhausted");
  }
};

SurveySimulation.prototype._completeMission = function _completeMission(outcome) {
  this.mode = "complete";
  this.completedAt = round(this.elapsed, 2);
  this.outcome = outcome;
  this.held.clear();
  this.confirmations = { P1: null, P2: null };
  this.latestNotice = outcome === "success"
    ? "三个测点已完成，报告可导出"
    : "共享采样资源耗尽，任务中止";
  this._log("mission_complete", {
    outcome,
    elapsed: this.completedAt,
    successCount: this.successCount,
    attemptsUsed: this.attemptsUsed,
  }, true);
};

SurveySimulation.prototype._applyHeldControls = function _applyHeldControls(dt) {
  let moved = false;
  for (const binding of this.held.values()) {
    if (binding.action === "azLeft") {
      this.controls.azimuth -= 5.2 * dt;
      moved = true;
    } else if (binding.action === "azRight") {
      this.controls.azimuth += 5.2 * dt;
      moved = true;
    } else if (binding.action === "elUp") {
      this.controls.elevation += 4.4 * dt;
      moved = true;
    } else if (binding.action === "elDown") {
      this.controls.elevation -= 4.4 * dt;
      moved = true;
    } else if (binding.action === "focusFar") {
      this.controls.focus += 0.18 * dt;
      moved = true;
    } else if (binding.action === "focusNear") {
      this.controls.focus -= 0.18 * dt;
      moved = true;
    }
  }
  if (!moved) return;
  this.controls.azimuth = clamp(this.controls.azimuth, -45, 45);
  this.controls.elevation = clamp(this.controls.elevation, -20, 35);
  this.controls.focus = clamp(this.controls.focus, 0.12, 0.92);
};

SurveySimulation.prototype._advanceTargetWindow = function _advanceTargetWindow(dt) {
  this.targetElapsed += dt;
  const visibleNow = this.targetVisible;
  if (visibleNow !== this._lastVisible) {
    this._log("target_visibility", {
      visible: visibleNow,
      target: this.target.id,
      windowRemaining: round(this.targetWindowRemaining, 2),
    }, true);
    this._captureSnapshot(`target:${visibleNow ? "visible" : "hidden"}`);
  }
  this._lastVisible = visibleNow;
};

SurveySimulation.prototype._expirePendingConfirmation = function _expirePendingConfirmation() {
  const pending = Object.entries(this.confirmations)
    .filter(([, value]) => value)
    .map(([role]) => role);
  if (!pending.length) return;
  const oldest = Math.min(...pending.map((role) => this.confirmations[role].at));
  if (this.elapsed - oldest <= CONFIRM_WINDOW) return;

  const pair = copyObject(this.confirmations);
  const actor = pending.length === 1 ? pending[0] : "BOTH";
  this.confirmations = { P1: null, P2: null };
  this._finishAttempt({
    status: "missed",
    kind: "single-side-confirm",
    actor,
    conflict: true,
    metrics: this.metrics(),
    pair,
  });
};

SurveySimulation.prototype._checkIdleProtection = function _checkIdleProtection() {
  if (this.debug || this.mode !== "live") return;
  let culprit = null;
  let worst = 0;
  for (const role of ["P1", "P2"]) {
    const player = this.players[role];
    this._idleWarned ??= { P1: false, P2: false };
    if (!player.connected) continue;
    if (player.idle >= IDLE_WARNING && !this._idleWarned[role]) {
      this._idleWarned[role] = true;
      this.latestNotice = `${ROLE_META[role].name} 已 ${Math.floor(player.idle)} 秒无输入`;
      this._log("idle_warning", { actor: role, idle: round(player.idle, 1) }, true);
    }
    if (player.idle > worst) {
      worst = player.idle;
      culprit = role;
    }
  }
  if (worst >= IDLE_TIMEOUT && culprit) {
    this.enterProtection(culprit, "input-timeout");
  }
};

SurveySimulation.prototype.update = function update(dtRaw) {
  const dt = clamp(Number(dtRaw) || 0, 0, 0.12);
  if (dt <= 0) return this.mode;
  this.sceneTime = (this.sceneTime || 0) + dt;
  if (this.mode !== "live") return this.mode;

  this._applyHeldControls(dt);
  this.elapsed = Math.min(MISSION_DURATION, this.elapsed + dt);
  this._advanceTargetWindow(dt);

  for (const role of ["P1", "P2"]) {
    if (this.players[role].connected) this.players[role].idle += dt;
  }

  const metrics = this.metrics();
  if (metrics.visible && metrics.aligned && this.confirmations.P1 && this.confirmations.P2) {
    this.stableFor += dt;
  } else if (metrics.visible && metrics.aligned) {
    this.stableFor += dt;
  } else {
    this.stableFor = 0;
  }

  this._expirePendingConfirmation();
  this._checkIdleProtection();
  if (this.mode !== "live") return this.mode;

  this.snapshotClock += dt;
  if (this.snapshotClock >= 0.24) {
    this.snapshotClock = 0;
    this._captureSnapshot("tick");
  }

  if (this.elapsed >= MISSION_DURATION && this.mode === "live") {
    this._completeMission(this.canExport ? "success" : "timeout");
  }
  return this.mode;
};

SurveySimulation.prototype.simulateDisconnect = function simulateDisconnect(role) {
  if (!this.players[role]) return false;
  if (this.mode !== "live") {
    this.latestNotice = "仅运行中的任务可触发断线保护";
    return false;
  }
  this.players[role].connected = false;
  this.latestNotice = `${ROLE_META[role].name} 链路中断`;
  this.enterProtection(role, "link-lost");
  return true;
};

SurveySimulation.prototype.simulateTimeout = function simulateTimeout(role) {
  if (!this.players[role]) return false;
  if (this.mode !== "live") {
    this.latestNotice = "仅运行中的任务可触发超时保护";
    return false;
  }
  this.players[role].idle = IDLE_TIMEOUT;
  this.latestNotice = `${ROLE_META[role].name} 输入超时`;
  this.enterProtection(role, "input-timeout");
  return true;
};

SurveySimulation.prototype.enterProtection = function enterProtection(actor, reason) {
  if (this.mode === "protection") return false;
  if (!["live", "paused"].includes(this.mode)) return false;
  this._frozenTargetVisible = this.targetVisible;
  this._frozenTargetWindow = this.targetWindowRemaining;
  this.mode = "protection";
  this.pausedFrom = null;
  this.held.clear();
  this.confirmations = { P1: null, P2: null };
  this.protection = {
    actor,
    reason,
    phase: reason === "link-lost" ? "waiting" : "handshake",
    acks: { P1: false, P2: false },
    since: round(this.elapsed, 2),
  };
  this.latestNotice = reason === "link-lost"
    ? `${ROLE_META[actor].name} 断线，任务冻结`
    : `${ROLE_META[actor].name} 输入超时，任务冻结`;
  this._log("protection_enter", {
    actor,
    reason,
    phase: this.protection.phase,
    remaining: round(this.remaining, 2),
  }, true);
  this._captureSnapshot("protection:enter");
  return true;
};

SurveySimulation.prototype.reconnect = function reconnect(role) {
  if (!this.protection || this.protection.actor !== role) return false;
  this.players[role].connected = true;
  this.players[role].idle = 0;
  this.protection.phase = "handshake";
  this.latestNotice = `${ROLE_META[role].name} 已重连，等待双方恢复确认`;
  this._log("reconnect", {
    actor: role,
    phase: "handshake",
    remaining: round(this.remaining, 2),
  }, true);
  this._captureSnapshot("protection:reconnect");
  return true;
};

SurveySimulation.prototype.acknowledgeRecovery = function acknowledgeRecovery(role, source = "input") {
  if (this.mode !== "protection" || !this.protection) {
    return { accepted: false, reason: "当前不在保护状态" };
  }
  if (this.protection.phase !== "handshake") {
    return { accepted: false, reason: "请先恢复断开的链路" };
  }
  if (!this.players[role]?.connected) {
    return { accepted: false, reason: `${ROLE_META[role].name} 仍未连接` };
  }
  this._acceptPlayerActivity(role);
  this.protection.acks[role] = true;
  this._log("recovery_ack", {
    actor: role,
    acks: copyObject(this.protection.acks),
    source,
  }, true);

  if (this.protection.acks.P1 && this.protection.acks.P2) {
    const actor = this.protection.actor;
    const reason = this.protection.reason;
    this.protection = null;
    this.mode = "live";
    this._frozenTargetVisible = null;
    this._frozenTargetWindow = null;
    this._idleWarned = { P1: false, P2: false };
    for (const side of ["P1", "P2"]) this.players[side].idle = 0;
    this.latestNotice = `双方握手完成，任务从 ${round(this.remaining, 1)} 秒继续`;
    this._log("protection_resume", {
      previousActor: actor,
      reason,
      remaining: round(this.remaining, 2),
      acks: { P1: true, P2: true },
    }, true);
    this._captureSnapshot("protection:resume");
    return { accepted: true, resumed: true };
  }
  this.latestNotice = `${ROLE_META[role].name} 已确认恢复，等待另一侧`;
  this._captureSnapshot("protection:ack");
  return { accepted: true, resumed: false };
};

SurveySimulation.prototype._log = function _log(type, data = {}, snapshot = false) {
  if (!this.replay) return;
  const event = {
    seq: this.replay.events.length + 1,
    wallTime: new Date().toISOString(),
    t: round(this.elapsed, 3),
    type,
    ...copyObject(data),
  };
  this.replay.events.push(event);
  this.revision = (this.revision || 0) + 1;
  if (type.includes("conflict") || data.conflictMoment || data.conflict) {
    this.replay.conflicts.push({
      t: event.t,
      type,
      actor: data.actor || data.record?.actor || "BOTH",
      reason: data.reason || data.record?.kind || type,
      kind: data.record?.kind || data.reason || type,
    });
  }
  if (snapshot) this._captureSnapshot(type);
};

SurveySimulation.prototype._captureSnapshot = function _captureSnapshot(tag = "manual") {
  if (!this.replay) return;
  const snapshot = this.getSnapshot(tag);
  const previous = this.replay.snapshots[this.replay.snapshots.length - 1];
  if (previous && previous.t === snapshot.t && previous.revision === snapshot.revision && tag === "tick") {
    return;
  }
  this.replay.snapshots.push(snapshot);
  if (this.replay.snapshots.length > 1800) this.replay.snapshots.splice(1, 1);
};

SurveySimulation.prototype.getSnapshot = function getSnapshot(tag = "state") {
  const metrics = this.metrics();
  return {
    tag,
    revision: this.revision || 0,
    t: round(this.elapsed, 3),
    remaining: round(this.remaining, 2),
    mode: this.mode,
    outcome: this.outcome || null,
    debug: this.debug,
    controls: copyObject(this.controls),
    targetIndex: this.targetIndex,
    target: copyObject(this.target),
    targetVisible: this.targetVisible,
    targetWindowRemaining: round(this.targetWindowRemaining, 2),
    stableFor: round(this.stableFor, 2),
    quality: metrics.quality,
    errors: {
      azimuth: metrics.azError,
      elevation: metrics.elError,
      focus: metrics.focusError,
    },
    confirmations: copyObject(this.confirmations),
    attemptsUsed: this.attemptsUsed,
    shotsLeft: this.shotsLeft,
    successCount: this.successCount,
    records: copyObject(this.records),
    players: copyObject(this.players),
    protection: copyObject(this.protection),
    latestNotice: this.latestNotice,
    latestNoticeSeq: this.replay?.events?.length || 0,
  };
};

SurveySimulation.prototype.getRoleView = function getRoleView(role) {
  const snapshot = this.getSnapshot(`role:${role}`);
  return {
    role,
    revision: snapshot.revision,
    mode: snapshot.mode,
    remaining: snapshot.remaining,
    shotsLeft: snapshot.shotsLeft,
    records: snapshot.records,
    target: snapshot.target,
    targetVisible: snapshot.targetVisible,
    quality: snapshot.quality,
    connected: snapshot.players[role]?.connected ?? false,
    idle: round(snapshot.players[role]?.idle ?? 0, 1),
    protection: snapshot.protection,
    confirmations: snapshot.confirmations,
  };
};

SurveySimulation.prototype.archiveCurrent = function archiveCurrent() {
  if (!this.replay) return false;
  const meaningful = this.replay.events.some((event) =>
    ["mission_start", "input", "attempt_captured", "attempt_missed", "protection_enter"].includes(event.type),
  );
  if (!meaningful) return false;
  this._captureSnapshot("run:archive");
  this.replay.endedAt = new Date().toISOString();
  this.replay.summary = {
    successCount: this.successCount,
    attemptsUsed: this.attemptsUsed,
    outcome: this.outcome || (this.mode === "complete" ? "incomplete" : "abandoned"),
    elapsed: round(this.elapsed, 2),
    conflicts: this.replay.conflicts.length,
    inputEvents: this.replay.events.filter((event) => event.type === "input").length,
    resourceChanges: this.replay.events.filter((event) => event.type === "resource_change").length,
  };
  this.history.unshift(this.replay);
  this.history = this.history.slice(0, 5);
  return true;
};

SurveySimulation.prototype.restart = function restart(source = "ui") {
  this.releaseAll(source);
  this.archiveCurrent();
  this._beginRun("restart");
  this.debug = false;
  this.mode = "ready";
  this.latestNotice = "仪表、目标与计时已同步复位";
  this._log("restart", {
    source,
    controls: copyObject(this.controls),
    remaining: MISSION_DURATION,
    shotsLeft: MAX_ATTEMPTS,
    target: this.target.id,
    records: 0,
  }, true);
  return this.getSnapshot("restart");
};

SurveySimulation.prototype.setDebug = function setDebug(enabled) {
  if (this.debug === enabled && this.mode === "ready") return false;
  this.releaseAll("debug-toggle");
  this.archiveCurrent();
  this._beginRun("debug-toggle");
  this.debug = Boolean(enabled);
  this.mode = "ready";
  this.latestNotice = this.debug
    ? "单人调试已启用：所有控制器由一人操作"
    : "已退出调试，等待双人任务";
  this._log("debug_toggle", {
    enabled: this.debug,
    controls: copyObject(this.controls),
    target: this.target.id,
  }, true);
  return true;
};

SurveySimulation.prototype.getReport = function getReport() {
  const captured = this.records.filter((record) => record.status === "captured");
  const missed = this.records.filter((record) => record.status === "missed");
  return {
    schema: "field-optics-report/v1",
    runId: this.replay?.id,
    startedAt: this.replay?.startedAt,
    completedAt: new Date().toISOString(),
    outcome: this.outcome || (this.canExport ? "success" : "incomplete"),
    elapsedSeconds: round(this.elapsed, 2),
    requiredPoints: REQUIRED_POINTS,
    capturedPoints: captured,
    missedAttempts: missed,
    sharedResource: {
      name: "共享采样片",
      limit: MAX_ATTEMPTS,
      used: this.attemptsUsed,
      left: this.shotsLeft,
    },
    conflicts: copyObject(this.conflicts),
    operatorInputs: {
      P1: this.players.P1.acceptedInputs,
      P2: this.players.P2.acceptedInputs,
    },
    syncAudit: {
      revision: this.getSnapshot("report").revision,
      P1: this.getRoleView("P1"),
      P2: this.getRoleView("P2"),
      sharedFieldsMatch:
        this.getRoleView("P1").remaining === this.getRoleView("P2").remaining
        && this.getRoleView("P1").shotsLeft === this.getRoleView("P2").shotsLeft
        && JSON.stringify(this.getRoleView("P1").records) === JSON.stringify(this.getRoleView("P2").records),
    },
    replay: this.getReplayBundle(),
  };
};

SurveySimulation.prototype.getReplayBundle = function getReplayBundle() {
  if (!this.replay) return null;
  return {
    id: this.replay.id,
    startedAt: this.replay.startedAt,
    endedAt: this.replay.endedAt || null,
    events: copyObject(this.replay.events),
    snapshots: copyObject(this.replay.snapshots),
    conflicts: copyObject(this.replay.conflicts),
    summary: copyObject(this.replay.summary || {
      successCount: this.successCount,
      attemptsUsed: this.attemptsUsed,
      elapsed: round(this.elapsed, 2),
    }),
  };
};

SurveySimulation.prototype.getReplays = function getReplays() {
  const current = this.getReplayBundle();
  return [current, ...this.history.map((run) => ({
    id: run.id,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    events: copyObject(run.events),
    snapshots: copyObject(run.snapshots),
    conflicts: copyObject(run.conflicts),
    summary: copyObject(run.summary),
  }))].filter(Boolean);
};
