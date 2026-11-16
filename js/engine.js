export const RECIPES = {
  S: {
    id: "S",
    name: "小盒",
    dims: "140 × 100 × 45",
    width: 140,
    height: 100,
    depth: 45,
    factor: 0.88,
    glue: { min: 0.92, max: 1.18, ideal: 1.05 },
    press: { min: 0.74, max: 0.98, ideal: 0.86 },
    speed: { min: 77, max: 95, ideal: 86 }
  },
  M: {
    id: "M",
    name: "中盒",
    dims: "200 × 140 × 60",
    width: 200,
    height: 140,
    depth: 60,
    factor: 1,
    glue: { min: 1.28, max: 1.62, ideal: 1.45 },
    press: { min: 1, max: 1.3, ideal: 1.15 },
    speed: { min: 60, max: 76, ideal: 68 }
  },
  L: {
    id: "L",
    name: "大盒",
    dims: "260 × 180 × 80",
    width: 260,
    height: 180,
    depth: 80,
    factor: 1.16,
    glue: { min: 1.68, max: 2.12, ideal: 1.9 },
    press: { min: 1.35, max: 1.68, ideal: 1.5 },
    speed: { min: 46, max: 58, ideal: 52 }
  }
};

export const PARAM_META = {
  glue: { label: "胶量", unit: "g/件", min: 0.2, max: 3, step: 0.01, digits: 2 },
  press: { label: "压合时间", unit: "s", min: 0.2, max: 2.4, step: 0.01, digits: 2 },
  speed: { label: "输送速度", unit: "m/min", min: 25, max: 120, step: 1, digits: 0 }
};

export const DEVICES = {
  conveyor: "输送带",
  glue: "上胶头",
  press: "压轮组",
  stacker: "堆垛机"
};

const SIZE_ORDER = ["S", "M", "L"];
const PHASE_NAMES = { feed: "送料", glue: "上胶", press: "压合", eject: "出料" };
const PER_SIZE_TARGET = 4;
const GOOD_TARGET = 12;
const MAX_ATTEMPTS = 30;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, digits = 2) => Number(value.toFixed(digits));
const copy = (value) => JSON.parse(JSON.stringify(value));

export function recommendedParams(sizeId) {
  const recipe = RECIPES[sizeId] || RECIPES.S;
  return {
    glue: recipe.glue.ideal,
    press: recipe.press.ideal,
    speed: recipe.speed.ideal
  };
}

export class BoxMachine {
  constructor(options = {}) {
    this.options = { silent: false, ...options };
    this.resetCount = 0;
    this.params = recommendedParams("S");
    this.resetBatch({ initial: true, keepParams: true });
  }

  resetBatch({ initial = false, keepParams = true } = {}) {
    this.simTime = 0;
    this.mode = "idle";
    this.paused = false;
    this.batchId = "B-0417";
    this.currentSizeIndex = 0;
    this.currentSize = SIZE_ORDER[0];
    this.goodCount = 0;
    this.goodBySize = { S: 0, M: 0, L: 0 };
    this.attempts = 0;
    this.totalProduced = 0;
    this.defects = 0;
    this.maxAttempts = MAX_ATTEMPTS;
    this.goodTarget = GOOD_TARGET;
    this.perSizeTarget = PER_SIZE_TARGET;
    this.cycleElapsed = 0;
    this.cycleDuration = this.estimateCycleDuration();
    this.phase = "feed";
    this.phaseSerial = 0;
    this.buffer = [];
    this.bufferCapacity = 6;
    this.energyKwh = 0;
    this.powerKw = 0;
    this.peakPowerKw = 0;
    this.peakBuffer = 0;
    this.devices = { conveyor: false, glue: false, press: false, stacker: false };
    this.equipmentActive = false;
    this.stopReason = null;
    this.stopLocation = null;
    this.stopSnapshot = null;
    this.stopCount = 0;
    this.stops = [];
    this.startedAt = null;
    this.completedAt = null;
    this.batchResult = null;
    this.lastQuality = null;
    this.lastDefect = null;
    this.qualityHistory = [];
    this.anomalies = [];
    this.samples = [];
    this.nextSampleAt = 0;
    this.logs = [];
    this.logId = 0;
    this.lastPhase = "feed";
    this.changeoverPending = false;
    this._previousMode = null;
    this._resetTime = this.simTime;
    if (!keepParams) this.params = recommendedParams("S");
    this.buffer = [];
    this.setDevicesSilently(false);
    if (!initial) this.resetCount += 1;
    const message = initial
      ? "空批次初始化，未载入历史缓存"
      : "批次重置，生产、能耗与缓存数据已清空";
    this.log("system", "system", "缓存初始化", message, { tone: "start" });
    this.takeSample();
  }

  setParam(name, value, { log = true } = {}) {
    if (!PARAM_META[name]) return false;
    const meta = PARAM_META[name];
    const next = round(clamp(Number(value) || meta.min, meta.min, meta.max), meta.digits);
    const previous = this.params[name];
    if (next === previous) return false;
    this.params[name] = next;
    this.cycleDuration = this.estimateCycleDuration();
    if (this.mode === "running" && this.cycleElapsed > this.cycleDuration) {
      this.cycleElapsed = Math.max(0, this.cycleDuration - 0.001);
    }
    if (log) {
      const status = this.getParamStatus(name);
      this.log(
        "param",
        "param",
        `${meta.label}调整`,
        `${previous} → ${next} ${meta.unit} · ${status.label}`,
        { tone: status.ok ? "param" : "warn", data: { name, from: previous, to: next, status: status.state } }
      );
    }
    return true;
  }

  applyRecommended(sizeId = this.currentSize, { log = true } = {}) {
    const values = recommendedParams(sizeId);
    for (const [name, value] of Object.entries(values)) this.setParam(name, value, { log });
    if (log) {
      this.log("param", "param", "套用推荐配方", `${sizeId} · ${values.glue}g / ${values.press}s / ${values.speed}m/min`, {
        tone: "param",
        data: { size: sizeId, values }
      });
    }
    return values;
  }

  getParamStatus(name) {
    const recipe = RECIPES[this.currentSize];
    const spec = recipe[name];
    const value = this.params[name];
    if (value < spec.min) {
      return { state: "low", ok: false, label: "低于工艺窗口", spec, value };
    }
    if (value > spec.max) {
      return { state: "high", ok: false, label: "高于工艺窗口", spec, value };
    }
    return { state: "ok", ok: true, label: "工艺窗口内", spec, value };
  }

  get currentRecipe() {
    return RECIPES[this.currentSize];
  }

  get goodTargetForSize() {
    return PER_SIZE_TARGET;
  }

  get yieldRate() {
    return this.attempts > 0 ? (this.goodCount / this.attempts) * 100 : null;
  }

  get bufferCount() {
    return this.buffer.length;
  }

  get cycleProgress() {
    return clamp(this.cycleElapsed / Math.max(this.cycleDuration, 0.01), 0, 1);
  }

  estimateCycleDuration() {
    const recipe = this.currentRecipe || RECIPES.S;
    return round(
      0.92 +
        recipe.factor * 0.18 +
        this.params.press * 0.35 +
        (recipe.speed.ideal / Math.max(25, this.params.speed)) * 0.9,
      3
    );
  }

  phaseWindows() {
    const press = clamp(0.2 + (this.params.press / 2.4) * 0.26, 0.2, 0.46);
    const glue = clamp(0.15 + (this.params.glue / 3) * 0.05, 0.15, 0.2);
    const feed = 0.2;
    return { feed, glue, press, eject: 1 - feed - glue - press };
  }

  log(type, category, event, detail, options = {}) {
    const entry = {
      id: ++this.logId,
      t: round(this.simTime, 2),
      type,
      category,
      event,
      detail,
      tone: options.tone || "system",
      data: options.data || null
    };
    this.logs.push(entry);
    if (this.logs.length > 500) this.logs.splice(0, this.logs.length - 500);
    return entry;
  }

  startBatch({ reason = "操作员启动" } = {}) {
    if (this.mode === "stopped") return false;
    if (this.mode === "running") return false;
    if (this.mode === "paused") return this.resumeBatch(reason);
    if (this.mode === "complete" || this.mode === "failed") return false;
    this.mode = "running";
    this.paused = false;
    this.startedAt = this.simTime;
    this.cycleElapsed = 0;
    this.phase = "feed";
    this.lastPhase = "feed";
    this.phaseSerial += 1;
    this.cycleDuration = this.estimateCycleDuration();
    this.equipmentActive = true;
    this.setDevicesSilently(true);
    for (const [key, label] of Object.entries(DEVICES)) {
      this.log("equipment", "equipment", `${label}启动`, `${reason} · 批次 ${this.batchId}`, {
        tone: "start",
        data: { device: key, state: "on", reason }
      });
    }
    this.log("batch", "batch", "批次开始", `${this.batchId} · 目标 12 件合格 · S→M→L`, {
      tone: "start",
      data: { target: this.goodTarget, route: SIZE_ORDER }
    });
    return true;
  }

  pauseBatch(reason = "操作员暂停") {
    if (this.mode !== "running") return false;
    this._previousMode = this.mode;
    this.mode = "paused";
    this.paused = true;
    this.log("batch", "batch", "批次暂停", `${reason} · T+${this.simTime.toFixed(1)}s · 缓存 ${this.bufferCount}/6`, {
      tone: "warn",
      data: { reason, phase: this.phase, buffer: this.bufferCount }
    });
    return true;
  }

  resumeBatch(reason = "操作员继续") {
    if (this.mode !== "paused") return false;
    this.mode = "running";
    this.paused = false;
    this.changeoverPending = false;
    this.log("batch", "batch", "批次恢复", `${reason} · 从 ${PHASE_NAMES[this.phase]}相继续`, {
      tone: "start",
      data: { reason, phase: this.phase, cycleProgress: round(this.cycleProgress, 3) }
    });
    return true;
  }

  step(delta = 0.25) {
    const amount = clamp(Number(delta) || 0.25, 0.01, 1);
    if (this.mode === "running") this.pauseBatch("单步检查");
    if (!["paused", "stopped"].includes(this.mode)) return false;
    const before = this.simTime;
    this.advance(amount, true);
    this.log("batch", "batch", "单步推进", `+${amount.toFixed(2)}s · T+${this.simTime.toFixed(2)}s · ${PHASE_NAMES[this.phase]}相`, {
      tone: "warn",
      data: { amount, before, after: this.simTime, phase: this.phase }
    });
    return true;
  }

  update(delta) {
    const amount = clamp(Number(delta) || 0, 0, 0.25);
    if (!amount || this.mode === "paused") return;
    if (["idle", "complete", "failed"].includes(this.mode)) return;
    this.advance(amount, false);
  }

  advance(delta, force = false) {
    if (!force && ["idle", "complete", "failed"].includes(this.mode)) return;
    this.simTime = round(this.simTime + delta, 4);
    const stepping = force && this.mode === "paused";
    if (this.mode === "running" || stepping) this.advanceProduction(delta, stepping);
    this.updateEnergy(delta);
    this.updateBuffer(delta, stepping);
    this.takeSample();
  }

  advanceProduction(delta, allowPaused = false) {
    let remaining = delta;
    let safety = 0;
    while (remaining > 0 && (this.mode === "running" || allowPaused) && !this.changeoverPending && safety < 8) {
      const duration = Math.max(0.2, this.cycleDuration);
      const available = Math.max(0.001, duration - this.cycleElapsed);
      const step = Math.min(remaining, available);
      this.cycleElapsed = round(this.cycleElapsed + step, 4);
      remaining = round(remaining - step, 4);
      const nextPhase = this.phaseAtProgress(this.cycleProgress);
      if (nextPhase !== this.phase) {
        this.phase = nextPhase;
        this.phaseSerial += 1;
      }
      if (this.cycleElapsed >= duration - 0.0001) this.completeCycle();
      if (["complete", "failed"].includes(this.mode) || this.changeoverPending) break;
      safety += 1;
    }
  }

  phaseAtProgress(progress) {
    const windows = this.phaseWindows();
    if (progress < windows.feed) return "feed";
    if (progress < windows.feed + windows.glue) return "glue";
    if (progress < windows.feed + windows.glue + windows.press) return "press";
    return "eject";
  }

  updateEnergy(delta) {
    if (this.mode === "idle") {
      this.powerKw = 0;
      return;
    }
    if (this.mode === "stopped") {
      this.powerKw = 1.35;
    } else if (this.mode === "complete" || this.mode === "failed") {
      this.powerKw = 0;
      return;
    } else {
      const phaseFactor = this.phase === "press" ? 1.09 : this.phase === "glue" ? 1.04 : this.phase === "eject" ? 0.94 : 1;
      this.powerKw = round(
        (5.8 +
          this.currentRecipe.factor * 1.35 +
          (this.params.speed / 100) * 2.2 +
          this.params.glue * 1.55 +
          this.params.press * 1.8) *
          phaseFactor,
        2
      );
    }
    this.energyKwh = round(this.energyKwh + (this.powerKw * delta) / 3600, 6);
    this.peakPowerKw = round(Math.max(this.peakPowerKw, this.powerKw), 2);
  }

  updateBuffer(delta, allowPaused = false) {
    if (this.mode !== "running" && !allowPaused) return;
    const lifetime = 1.45 + this.currentRecipe.factor * 0.24;
    const retained = [];
    for (const item of this.buffer) {
      if (this.simTime - item.enteredAt >= lifetime) {
        this.log("quality", "buffer", "缓存出件", `${item.size} · #${item.attempt} · ${item.ok ? "合格" : "隔离"}`, {
          tone: item.ok ? "good" : "bad",
          data: { boxId: item.id, size: item.size, ok: item.ok }
        });
      } else {
        retained.push(item);
      }
    }
    this.buffer = retained;
    this.takeSample();
  }

  takeSample() {
    if (this.simTime + 1e-6 < this.nextSampleAt) return;
    this.samples.push({
      t: round(this.simTime, 2),
      produced: this.totalProduced,
      good: this.goodCount,
      energy: this.energyKwh,
      power: this.powerKw,
      buffer: this.bufferCount
    });
    if (this.samples.length > 240) this.samples.shift();
    this.nextSampleAt = this.simTime + 1;
  }

  setDevicesSilently(state) {
    for (const key of Object.keys(this.devices)) this.devices[key] = state;
    this.equipmentActive = state;
  }

  stopEquipment(reason = "操作员急停", location = "主控台") {
    if (!["running", "paused"].includes(this.mode)) return null;
    this._previousMode = this.mode;
    this.stopReason = reason;
    this.stopLocation = location;
    this.stopCount += 1;
    this.stopSnapshot = {
      time: this.simTime,
      phase: this.phase,
      progress: round(this.cycleProgress, 3),
      values: copy(this.params),
      size: this.currentSize,
      attempt: this.attempts + 1,
      buffer: this.bufferCount,
      power: this.powerKw,
      energy: this.energyKwh
    };
    const stopRecord = {
      time: this.simTime,
      reason,
      location,
      snapshot: copy(this.stopSnapshot),
      restoredAt: null,
      recovery: null
    };
    this.stops.push(stopRecord);
    this.setDevicesSilently(false);
    for (const [key, label] of Object.entries(DEVICES)) {
      this.log("equipment", "equipment", `${label}停止`, `${reason} · ${location}`, {
        tone: "stop",
        data: { device: key, state: "off", reason, location }
      });
    }
    this.mode = "stopped";
    this.paused = false;
    this.powerKw = 1.35;
    this.log("equipment", "stop", "设备停机", `${reason} · ${location} · 批次保持于 ${PHASE_NAMES[this.phase]}相`, {
      tone: "stop",
      data: { reason, location, snapshot: copy(this.stopSnapshot) }
    });
    return copy(this.stopSnapshot);
  }

  restartEquipment({ reason = "复位并恢复" } = {}) {
    if (this.mode !== "stopped") return false;
    const stoppedAt = this.stops[this.stops.length - 1]?.time ?? this.simTime;
    const stoppedFor = round(this.simTime - stoppedAt, 2);
    this.setDevicesSilently(true);
    for (const [key, label] of Object.entries(DEVICES)) {
      this.log("equipment", "equipment", `${label}启动`, `${reason} · 停机 ${stoppedFor}s 后恢复`, {
        tone: "start",
        data: { device: key, state: "on", reason, stoppedFor }
      });
    }
    this.mode = this._previousMode === "paused" ? "paused" : "running";
    this.paused = this.mode === "paused";
    const recovery = {
      restoredAt: this.simTime,
      stoppedFor,
      mode: this.mode,
      phase: this.phase,
      values: copy(this.params)
    };
    const lastStop = this.stops[this.stops.length - 1];
    if (lastStop) {
      lastStop.restoredAt = this.simTime;
      lastStop.recovery = recovery;
    }
    this.log("equipment", "recovery", "设备恢复", `停机 ${stoppedFor}s · 从 ${PHASE_NAMES[this.phase]}相继续 · ${this.mode === "paused" ? "保持暂停" : "恢复生产"}`, {
      tone: "start",
      data: recovery
    });
    this.stopReason = null;
    this.stopLocation = null;
    this.stopSnapshot = null;
    return recovery;
  }

  evaluateQuality(sizeId = this.currentSize, values = this.params) {
    const recipe = RECIPES[sizeId];
    const issues = [];
    const addIssue = (key, code, label, effect, location, value, specification, severity = "critical") => {
      const span = Math.max(specification.max - specification.min, 0.01);
      const distance = value < specification.min
        ? specification.min - value
        : value > specification.max
          ? value - specification.max
          : 0;
      issues.push({
        key,
        code,
        label,
        effect,
        location,
        value,
        range: [specification.min, specification.max],
        severity,
        deviation: round(distance, 3),
        deviationRatio: round(distance / span, 3)
      });
    };

    if (values.glue < recipe.glue.min) {
      addIssue("glue", "GLUE_LOW", "胶量不足", "侧边接缝开口", "侧边接缝", values.glue, recipe.glue);
    } else if (values.glue > recipe.glue.max) {
      addIssue("glue", "GLUE_HIGH", "胶量过量", "内折线拉丝", "喷胶嘴 / 内折线", values.glue, recipe.glue);
    }
    if (values.press < recipe.press.min) {
      addIssue("press", "PRESS_LOW", "压合时间不足", "底角回弹未闭合", "底角压合区", values.press, recipe.press);
    } else if (values.press > recipe.press.max) {
      addIssue("press", "PRESS_HIGH", "压合时间过长", "面纸压痕", "主压轮接触线", values.press, recipe.press);
    }
    if (values.speed < recipe.speed.min) {
      addIssue("speed", "SPEED_LOW", "输送节拍滞后", "折边角堆积错位", "折边角 / 定位挡板", values.speed, recipe.speed);
    } else if (values.speed > recipe.speed.max) {
      addIssue("speed", "SPEED_HIGH", "输送节拍超前", "盒角错位", "折边角 / 导向轮", values.speed, recipe.speed);
    }

    const score = issues.length
      ? round(Math.max(42, 100 - issues.reduce((sum, issue) => sum + 15 + Math.min(32, issue.deviationRatio * 80), 0)), 1)
      : 100;
    return {
      ok: issues.length === 0,
      score,
      issues,
      primary: issues[0] || null,
      size: sizeId,
      values: copy(values),
      evaluatedAt: this.simTime
    };
  }

  completeCycle() {
    const attempt = this.attempts + 1;
    const size = this.currentSize;
    const quality = this.evaluateQuality(size, this.params);
    const boxId = `${size}-${String(attempt).padStart(3, "0")}`;
    this.attempts = attempt;
    this.totalProduced += 1;
    this.cycleElapsed = 0;
    this.cycleDuration = this.estimateCycleDuration();
    this.phase = "feed";
    this.lastPhase = "feed";
    this.phaseSerial += 1;
    this.lastQuality = quality;
    this.qualityHistory.push({
      attempt,
      boxId,
      size,
      ok: quality.ok,
      score: quality.score,
      time: this.simTime,
      issues: copy(quality.issues),
      values: copy(this.params)
    });
    this.buffer.push({
      id: boxId,
      size,
      attempt,
      ok: quality.ok,
      enteredAt: this.simTime
    });
    if (this.buffer.length > this.bufferCapacity) this.buffer.shift();
    this.peakBuffer = Math.max(this.peakBuffer, this.bufferCount);

    if (quality.ok) {
      this.goodCount += 1;
      this.goodBySize[size] += 1;
      this.log("quality", "quality", "盒件合格", `${boxId} · 得分 100 · 良品 ${this.goodCount}/12`, {
        tone: "good",
        data: { boxId, size, score: 100, good: this.goodCount }
      });
    } else {
      this.defects += 1;
      const anomaly = {
        time: this.simTime,
        boxId,
        size,
        attempt,
        code: quality.primary.code,
        label: quality.primary.label,
        effect: quality.primary.effect,
        location: quality.primary.location,
        values: copy(this.params),
        issues: copy(quality.issues),
        score: quality.score
      };
      this.anomalies.push(anomaly);
      this.lastDefect = anomaly;
      const locations = [...new Set(quality.issues.map((issue) => issue.location))].join(" / ");
      this.log(
        "quality",
        "quality",
        `质量异常 · ${quality.primary.effect}`,
        `${boxId} · ${quality.primary.label} · ${locations} · 得分 ${quality.score}`,
        { tone: "bad", data: anomaly }
      );
    }

    if (this.goodCount >= this.goodTarget) {
      this.finishBatch("success", "12 件合格目标达成");
      return;
    }
    if (this.goodBySize[size] >= this.perSizeTarget) {
      if (this.currentSizeIndex >= SIZE_ORDER.length - 1) {
        this.finishBatch("success", "三种盒型目标达成");
      } else {
        this.beginChangeover();
      }
      return;
    }
    if (this.attempts >= this.maxAttempts) {
      this.finishBatch("failed", `达到 ${this.maxAttempts} 次尝试上限`);
    }
  }

  beginChangeover() {
    this.currentSizeIndex += 1;
    this.currentSize = SIZE_ORDER[this.currentSizeIndex];
    this.changeoverPending = true;
    this.mode = "paused";
    this.paused = true;
    this.cycleElapsed = 0;
    this.phase = "feed";
    this.cycleDuration = this.estimateCycleDuration();
    this.log(
      "handoff",
      "handoff",
      `换型 · ${this.currentSize}`,
      `${RECIPES[this.currentSize].name} · 尺寸 ${RECIPES[this.currentSize].dims} mm · 校准参数后继续`,
      {
        tone: "warn",
        data: {
          size: this.currentSize,
          recommended: recommendedParams(this.currentSize),
          reason: "completed_previous_size"
        }
      }
    );
  }

  finishBatch(result, reason) {
    if (["complete", "failed"].includes(this.mode)) return this.batchResult;
    this.completedAt = this.simTime;
    this.mode = result === "success" ? "complete" : "failed";
    this.paused = false;
    this.powerKw = 0;
    this.setDevicesSilently(false);
    for (const [key, label] of Object.entries(DEVICES)) {
      this.log("equipment", "equipment", `${label}停止`, `${reason} · 批次结束`, {
        tone: "stop",
        data: { device: key, state: "off", reason: "batch_end" }
      });
    }
    const sizeResults = Object.fromEntries(
      SIZE_ORDER.map((size) => [
        size,
        {
          good: this.goodBySize[size],
          target: this.perSizeTarget,
          yield: this.goodBySize[size] / Math.max(this.qualityHistory.filter((item) => item.size === size).length, 1) * 100
        }
      ])
    );
    this.batchResult = {
      batchId: this.batchId,
      result,
      reason,
      success: result === "success" && this.goodCount === this.goodTarget,
      goodCount: this.goodCount,
      goodTarget: this.goodTarget,
      attempts: this.attempts,
      defects: this.defects,
      yieldRate: round(this.yieldRate || 0, 1),
      peakPowerKw: this.peakPowerKw,
      peakBuffer: this.peakBuffer,
      energyKwh: this.energyKwh,
      stopReasons: this.stops.map((stop) => stop.reason),
      anomalyLocations: [...new Set(this.anomalies.flatMap((item) => item.issues.map((issue) => issue.location)))],
      sizeResults,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      duration: round((this.completedAt || 0) - (this.startedAt || 0), 2)
    };
    this.log("batch", "batch", result === "success" ? "批次完成" : "批次失败", `${reason} · 良品 ${this.goodCount}/12 · 良率 ${this.batchResult.yieldRate}%`, {
      tone: result === "success" ? "good" : "bad",
      data: copy(this.batchResult)
    });
    this.takeSample();
    return this.batchResult;
  }

  get deviceViewState() {
    if (this.mode === "running") return "on";
    if (this.mode === "paused") return "hold";
    if (this.mode === "idle") return "idle";
    return "off";
  }

  buildReport(validations = null) {
    const equipmentEvents = this.logs.filter((entry) => entry.category === "equipment" || entry.category === "stop" || entry.category === "recovery");
    const parameterChanges = this.logs.filter((entry) => entry.category === "param");
    const batchEvents = this.logs.filter((entry) => ["batch", "handoff", "quality", "buffer"].includes(entry.category));
    const stopReasons = this.stops.map((stop) => ({
      time: stop.time,
      reason: stop.reason,
      location: stop.location,
      restoredAt: stop.restoredAt,
      recovery: stop.recovery
    }));
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      source: "FOLD//LINE 04 in-memory batch",
      persistence: "none; batch state is discarded on reset or reload",
      simulationClock: {
        now: this.simTime,
        unit: "s",
        running: this.mode === "running",
        paused: this.mode === "paused",
        equipmentStopped: this.mode === "stopped"
      },
      summary: {
        batchId: this.batchId,
        result: this.batchResult?.result || (this.mode === "stopped" ? "stopped" : "in_progress"),
        goodCount: this.goodCount,
        target: this.goodTarget,
        attempts: this.attempts,
        yieldRate: this.yieldRate === null ? null : round(this.yieldRate, 1),
        peakPowerKw: this.peakPowerKw,
        peakBuffer: this.peakBuffer,
        energyKwh: this.energyKwh,
        stopReasons: stopReasons.map((stop) => stop.reason),
        anomalyLocations: [...new Set(this.anomalies.flatMap((item) => item.issues.map((issue) => issue.location)))]
      },
      batch: this.batchResult
        ? copy(this.batchResult)
        : {
            batchId: this.batchId,
            result: "in_progress",
            goodCount: this.goodCount,
            goodTarget: this.goodTarget,
            attempts: this.attempts,
            yieldRate: this.yieldRate === null ? null : round(this.yieldRate, 1),
            currentSize: this.currentSize,
            progress: round(this.cycleProgress, 3)
          },
      current: {
        mode: this.mode,
        phase: this.phase,
        size: this.currentSize,
        params: copy(this.params),
        recipe: copy(this.currentRecipe),
        buffer: this.bufferCount,
        powerKw: this.powerKw,
        energyKwh: this.energyKwh,
        devices: copy(this.devices)
      },
      params: copy(this.params),
      qualityHistory: copy(this.qualityHistory),
      anomalies: copy(this.anomalies),
      stops: stopReasons,
      equipmentEvents: copy(equipmentEvents),
      parameterChanges: copy(parameterChanges),
      batchEvents: copy(batchEvents),
      telemetrySamples: copy(this.samples),
      validations: validations ? copy(validations) : null
    };
  }
}
