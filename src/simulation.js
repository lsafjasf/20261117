import {
  BATCH_TARGET_KG,
  DEVICE_NAMES,
  FIXED_STEP,
  FLOURS,
  MIX_TIME_DEFAULT,
  MIX_TIME_MAX,
  MIX_TIME_MIN,
  RATIO_TOLERANCE,
  RECIPES,
  WEIGHT_TOLERANCE
} from "./config.js";

const SCREW_FLOW_KG_S = 3.6;
const GATE_FLOW_KG_S = 42;
const PACKAGE_FLOW_KG_S = 38;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, digits = 3) => Number(value.toFixed(digits));

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeScrew(index) {
  return {
    index,
    on: false,
    setpoint: [50, 30, 20][index],
    actual: 0,
    flowKgS: 0,
    deliveredKg: 0,
    fault: null
  };
}

export class FlourSimulation {
  constructor(options = {}) {
    this.seed = options.seed ?? 816;
    this.hardReset({ silent: options.silent ?? false });
  }

  hardReset({ silent = false } = {}) {
    this.clock = 0;
    this.tick = 0;
    this.paused = false;
    this.phase = "ready";
    this.recipeId = "R1";
    this.purgeRequired = false;
    this.purgeInProgress = false;
    this.purgeUntil = 0;
    this.batchNo = 1;
    this.batchStartedAt = null;
    this.batchCutoffAt = null;
    this.settings = {
      speeds: [50, 30, 20],
      mixTime: MIX_TIME_DEFAULT
    };
    this.screws = FLOURS.map((_, index) => makeScrew(index));
    this.weigh = {
      mass: [0, 0, 0],
      trueKg: 0,
      measuredKg: 0,
      oscillationKg: 0,
      stable: true,
      gateOpen: false
    };
    this.mixer = {
      on: false,
      charge: [0, 0, 0],
      totalKg: 0,
      mixElapsed: 0,
      mixComplete: false,
      dischargeOpen: false,
      fault: null
    };
    this.gateFaults = {
      weighGate: null,
      dischargeGate: null
    };
    this.cache = {
      kg: 0,
      batches: 0,
      lastRecipe: null
    };
    this.power = {
      currentKw: 0,
      peakKw: 0,
      energyKwh: 0
    };
    this.goodBatches = 0;
    this.totalBatches = 0;
    this.goodKg = 0;
    this.wasteKg = 0;
    this.success = false;
    this.batches = [];
    this.stops = [];
    this.anomalies = [];
    this.events = [];
    this.resumePhase = null;
    this.currentReason = "";
    this.packagingElapsed = 0;
    this.packagedCharge = [0, 0, 0];
    this.packagedTotalKg = 0;
    this.lastBatchCompleted = false;
    this._eventId = 0;
    this._anomalyId = 0;
    this._loggedStable = false;

    if (!silent) {
      this._log("system", "", "仿真复位，包装仓缓存与全部批次状态已清空", {
        cacheKg: 0,
        goodBatches: 0,
        clock: 0
      });
    }
  }

  get recipe() {
    return RECIPES[this.recipeId];
  }

  get targetMasses() {
    return this.recipe.ratios.map((ratio) => ratio * BATCH_TARGET_KG);
  }

  get activeBatch() {
    return ["dosing", "settling", "weighing", "dumping", "mixing", "mix_done", "packaging"].includes(this.phase);
  }

  get canStart() {
    return !this.success && !this.purgeRequired && !this.purgeInProgress &&
      ["ready", "batch_done"].includes(this.phase);
  }

  _log(type, device, detail, values = {}) {
    this.events.push({
      id: ++this._eventId,
      t: round(this.clock, 2),
      tick: this.tick,
      type,
      device,
      detail,
      values: copy(values)
    });
  }

  _anomaly(kind, location, detail, values = {}, recoverable = true) {
    const item = {
      id: ++this._anomalyId,
      kind,
      location,
      detail,
      at: round(this.clock, 2),
      tick: this.tick,
      values: copy(values),
      recoveredAt: null,
      recovery: null,
      recoverable
    };
    this.anomalies.push(item);
    return item;
  }

  _recoverAnomaly(predicate, recovery) {
    for (let index = this.anomalies.length - 1; index >= 0; index -= 1) {
      const item = this.anomalies[index];
      if (item.recoveredAt === null && predicate(item)) {
        item.recoveredAt = round(this.clock, 2);
        item.recovery = recovery;
        return item;
      }
    }
    return null;
  }

  pause(reason = "操作员检查") {
    if (this.paused) return false;
    this.paused = true;
    this._log("pause", "", `仿真暂停：${reason}`, {
      clock: round(this.clock, 2),
      phase: this.phase,
      batchNo: this.batchNo,
      cacheKg: round(this.cache.kg, 3),
      energyKwh: round(this.power.energyKwh, 5)
    });
    return true;
  }

  resume(reason = "操作员继续") {
    if (!this.paused) return false;
    this.paused = false;
    this._log("resume", "", `仿真恢复：${reason}`, {
      clock: round(this.clock, 2),
      phase: this.phase,
      batchNo: this.batchNo,
      weighKg: round(this.weigh.trueKg, 3),
      mixElapsed: round(this.mixer.mixElapsed, 2)
    });
    return true;
  }

  step(dt = FIXED_STEP) {
    if (!this.paused) this.pause("单步检查");
    this._integrate(dt);
    this._log("step", "", "仿真单步推进", {
      dt,
      clock: round(this.clock, 2),
      phase: this.phase,
      powerKw: round(this.power.currentKw, 3),
      cacheKg: round(this.cache.kg, 3)
    });
    return this.snapshot();
  }

  advance(dt = FIXED_STEP) {
    if (this.paused || this.success && this.phase === "success" && !this.activeBatch && this.power.currentKw === 0) {
      return false;
    }
    this._integrate(dt);
    return true;
  }

  setScrewSpeed(index, value) {
    const screw = this.screws[index];
    if (!screw) {
      this._log("reject", "送料螺旋", "无效螺旋编号", { requested: index });
      return false;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
      const location = `${DEVICE_NAMES[`screw${FLOURS[index].id}`]} / 转速设定`;
      const detail = `螺旋转速越限（允许 0-100%）`;
      this._log("reject", DEVICE_NAMES[`screw${FLOURS[index].id}`], detail, {
        requested: value,
        current: screw.setpoint,
        allowed: [0, 100],
        location
      });
      this._anomaly("parameter_limit", location, detail, {
        requested: value,
        current: screw.setpoint,
        allowed: [0, 100],
        phase: this.phase
      });
      return false;
    }

    const previous = screw.setpoint;
    const next = round(clamp(numeric, 0, 100), 1);
    screw.setpoint = next;
    this.settings.speeds[index] = next;
    if (this.purgeRequired) {
      this._log("reject", DEVICE_NAMES[`screw${FLOURS[index].id}`], "换配料尚未清空余料，参数未用于生产", {
        from: previous,
        to: next
      });
    }
    if (previous !== next) {
      this._log("param", DEVICE_NAMES[`screw${FLOURS[index].id}`], "螺旋转速设定变化", {
        from: previous,
        to: next,
        location: `${DEVICE_NAMES[`screw${FLOURS[index].id}`]} / 转速设定`
      });
    }
    this._recoverAnomaly(
      (item) => item.kind === "parameter_limit" &&
        item.location === `${DEVICE_NAMES[`screw${FLOURS[index].id}`]} / 转速设定`,
      `已恢复为合法转速 ${next}%`
    );
    return true;
  }

  setSpeeds(values) {
    return values.map((value, index) => this.setScrewSpeed(index, value)).every(Boolean);
  }

  setMixTime(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < MIX_TIME_MIN || numeric > MIX_TIME_MAX) {
      const detail = `混合时间越限（允许 ${MIX_TIME_MIN}-${MIX_TIME_MAX} s）`;
      this._log("reject", "混合机", detail, {
        requested: value,
        current: this.settings.mixTime,
        allowed: [MIX_TIME_MIN, MIX_TIME_MAX],
        location: "混合机 / 混合时间"
      });
      this._anomaly("parameter_limit", "混合机 / 混合时间", detail, {
        requested: value,
        current: this.settings.mixTime,
        allowed: [MIX_TIME_MIN, MIX_TIME_MAX],
        phase: this.phase
      });
      return false;
    }
    const previous = this.settings.mixTime;
    const next = round(numeric, 1);
    this.settings.mixTime = next;
    if (previous !== next) {
      this._log("param", "混合机", "混合时间设定变化", {
        from: previous,
        to: next,
        location: "混合机 / 混合时间"
      });
    }
    this._recoverAnomaly(
      (item) => item.kind === "parameter_limit" && item.location === "混合机 / 混合时间",
      `已恢复为合法混合时间 ${next}s`
    );
    return true;
  }

  selectRecipe(recipeId) {
    if (!RECIPES[recipeId]) {
      this._log("reject", "订单", "未知配方", { requested: recipeId });
      return false;
    }
    if (recipeId === this.recipeId) return true;
    if (this.activeBatch || this.phase === "stopped" || this.purgeInProgress) {
      const detail = "当前批次未结束，不能切换配料";
      this._log("reject", "订单", detail, {
        requested: recipeId,
        current: this.recipeId,
        phase: this.phase
      });
      this._anomaly("operation", "订单 / 配方切换", detail, {
        requested: recipeId,
        current: this.recipeId,
        phase: this.phase
      }, false);
      return false;
    }
    const previous = this.recipeId;
    this.recipeId = recipeId;
    this.purgeRequired = true;
    this.phase = this.phase === "batch_done" ? "batch_done" : "ready";
    this._log("param", "订单", "切换配料比例，必须先清空余料", {
      from: previous,
      to: recipeId,
      recipe: this.recipe.name,
      purgeRequired: true
    });
    if (this.weigh.trueKg + this.mixer.totalKg > 0.01) {
      this._log("system", "清空阀", "管路存在余料，生产已联锁", {
        residueKg: round(this.weigh.trueKg + this.mixer.totalKg, 3)
      });
    }
    return true;
  }

  _prepareBatch() {
    if (this.lastBatchCompleted || this.phase === "batch_done") {
      this.batchNo += 1;
    }
    this.lastBatchCompleted = false;
    this.phase = "ready";
    this.batchStartedAt = round(this.clock, 2);
    this.batchCutoffAt = null;
    this.weigh = {
      mass: [0, 0, 0],
      trueKg: 0,
      measuredKg: 0,
      oscillationKg: 0,
      stable: true,
      gateOpen: false
    };
    this.mixer.charge = [0, 0, 0];
    this.mixer.totalKg = 0;
    this.mixer.mixElapsed = 0;
    this.mixer.mixComplete = false;
    this.mixer.dischargeOpen = false;
    this._loggedStable = false;
  }

  startDosing() {
    if (this.success) {
      this._log("reject", "", "三批良品已完成，不能继续投料", { phase: this.phase });
      return false;
    }
    if (!["ready", "batch_done"].includes(this.phase)) {
      this._log("reject", "", "当前阶段不能开始配料", { phase: this.phase });
      return false;
    }
    if (this.purgeInProgress || this.purgeRequired) {
      const detail = "换配料尚未清空余料，送料螺旋联锁";
      this._log("reject", "送料螺旋", detail, {
        phase: this.phase,
        residueKg: round(this.weigh.trueKg + this.mixer.totalKg, 3),
        purgeRequired: this.purgeRequired
      });
      this._anomaly("interlock", "送料螺旋 / 清线联锁", detail, {
        residueKg: round(this.weigh.trueKg + this.mixer.totalKg, 3),
        purgeRequired: this.purgeRequired
      });
      return false;
    }
    if (this.screws.some((screw) => screw.fault)) {
      this._log("reject", "送料螺旋", "螺旋故障未排除，不能启动", {
        faults: this.screws.map((screw) => screw.fault)
      });
      return false;
    }
    if (this.settings.speeds.every((speed) => speed === 0)) {
      this._log("reject", "送料螺旋", "三台螺旋转速均为 0，无法配料", {
        speeds: [...this.settings.speeds]
      });
      return false;
    }

    this._prepareBatch();
    this.phase = "dosing";
    this.screws.forEach((screw, index) => {
      screw.deliveredKg = 0;
      this._setScrewOn(index, this.settings.speeds[index] > 0, this.settings.speeds[index], "批次配料启动");
    });
    this._log("batch_start", "", `批次 #${this.batchNo} 开始配料`, {
      batchNo: this.batchNo,
      recipeId: this.recipeId,
      speeds: [...this.settings.speeds],
      targetKg: BATCH_TARGET_KG
    });
    return true;
  }

  _setScrewOn(index, on, setpoint = this.screws[index].setpoint, reason = "") {
    const screw = this.screws[index];
    const device = DEVICE_NAMES[`screw${FLOURS[index].id}`];
    if (screw.on === on && screw.setpoint === setpoint) return;
    if (!on && screw.on) {
      this._log("device_stop", device, reason || "螺旋停机", {
        setpoint: 0,
        actual: round(screw.actual, 3),
        deliveredKg: round(screw.deliveredKg, 3)
      });
    }
    screw.setpoint = on ? setpoint : 0;
    screw.on = on;
    if (on) {
      this._log("device_start", device, reason || "螺旋启动", {
        setpoint,
        actual: round(screw.actual, 3)
      });
    }
  }

  _stopAllScrews(reason) {
    this.screws.forEach((screw, index) => {
      if (screw.on) this._setScrewOn(index, false, 0, reason);
    });
  }

  openWeighGate() {
    if (!["settling", "weighing"].includes(this.phase)) {
      this._log("reject", "称重门", "当前阶段不能打开称重门", { phase: this.phase });
      return false;
    }
    if (!this.weigh.stable || this.screws.some((screw) => screw.actual > 0.2)) {
      const detail = "称重振荡中，禁止打开称重门";
      this._log("reject", "称重门", detail, {
        measuredKg: round(this.weigh.measuredKg, 3),
        oscillationKg: round(this.weigh.oscillationKg, 3),
        screwActual: this.screws.map((screw) => round(screw.actual, 2))
      });
      this._anomaly("interlock", "称重斗 / 称重门联锁", detail, {
        measuredKg: round(this.weigh.measuredKg, 3),
        oscillationKg: round(this.weigh.oscillationKg, 3),
        thresholdKg: 0.08
      });
      return false;
    }
    if (this.weigh.trueKg <= 0) {
      this._log("reject", "称重门", "称重斗为空", {});
      return false;
    }
    this.weigh.gateOpen = true;
    this.phase = "dumping";
    this._log("device_start", "称重门", "称重门打开，称重斗向混合机卸料", {
      kg: round(this.weigh.trueKg, 3),
      stable: true
    });
    this._recoverAnomaly(
      (item) => item.kind === "interlock" && item.location === "称重斗 / 称重门联锁",
      "称重稳定并完成闸门开启"
    );
    return true;
  }

  startMixing() {
    if (this.phase !== "mix_ready") {
      this._log("reject", "混合机", "称重料尚未卸入混合机", { phase: this.phase });
      return false;
    }
    if (this.mixer.fault) {
      this._log("reject", "混合机", "混合机故障未排除", { fault: this.mixer.fault });
      return false;
    }
    if (this.mixer.totalKg <= 0.01) {
      this._log("reject", "混合机", "混合机内无物料", { chargeKg: 0 });
      return false;
    }
    if (!this.setMixTime(this.settings.mixTime)) return false;

    this.mixer.on = true;
    this.mixer.mixElapsed = 0;
    this.mixer.mixComplete = false;
    this.phase = "mixing";
    this._log("device_start", "混合机", "混合机启动", {
      mixSet: this.settings.mixTime,
      charge: this.mixer.charge.map((kg) => round(kg, 3)),
      totalKg: round(this.mixer.totalKg, 3)
    });
    return true;
  }

  dischargeBatch() {
    if (this.phase !== "mix_done" || !this.mixer.mixComplete) {
      this._log("reject", "混合机出料门", "混合未完成，不能出料", {
        phase: this.phase,
        mixElapsed: round(this.mixer.mixElapsed, 2)
      });
      return false;
    }
    if (this.mixer.fault) {
      this._log("reject", "混合机出料门", "混合机故障未排除", { fault: this.mixer.fault });
      return false;
    }
    this.mixer.dischargeOpen = true;
    this.packagingElapsed = 0;
    this.packagedCharge = [...this.mixer.charge];
    this.packagedTotalKg = this.mixer.totalKg;
    this.phase = "packaging";
    this._log("device_start", "混合机出料门", "出料门打开，向包装仓送料", {
      kg: round(this.mixer.totalKg, 3),
      cacheBeforeKg: round(this.cache.kg, 3)
    });
    return true;
  }

  clearLine() {
    if (this.purgeInProgress) {
      this._log("reject", "清空阀", "清线程序正在进行", { phase: this.phase });
      return false;
    }
    if (this.activeBatch || this.phase === "stopped") {
      const detail = "设备运行或停机故障中，不能清线";
      this._log("reject", "清空阀", detail, {
        phase: this.phase,
        weighKg: round(this.weigh.trueKg, 3),
        mixerKg: round(this.mixer.totalKg, 3)
      });
      return false;
    }
    if (this.purgeRequired || this.weigh.trueKg > 0.01 || this.mixer.totalKg > 0.01) {
      this.purgeInProgress = true;
      this.purgeUntil = this.clock + 1.2;
      this.purgeRequired = false;
      const residueKg = this.weigh.trueKg + this.mixer.totalKg;
      this.wasteKg += residueKg;
      this.weigh.mass = [0, 0, 0];
      this.weigh.trueKg = 0;
      this.weigh.measuredKg = 0;
      this.weigh.oscillationKg = 0;
      this.weigh.stable = true;
      this.mixer.charge = [0, 0, 0];
      this.mixer.totalKg = 0;
      this.mixer.mixElapsed = 0;
      this.mixer.mixComplete = false;
      this._log("device_start", "清空阀", "清空阀打开，清除换配料余料", {
        residueKg: round(residueKg, 3),
        purgeSeconds: 1.2,
        clock: round(this.clock, 2)
      });
      return true;
    }
    this._log("system", "清空阀", "系统无余料，清空标志解除", { residueKg: 0 });
    return true;
  }

  resetBatch() {
    if (this.phase === "success") {
      this._log("reject", "", "成功批次已锁定，请使用重开仿真", { phase: this.phase });
      return false;
    }
    if (this.screws.some((screw) => screw.fault) || this.mixer.fault) {
      this._log("reject", "", "存在未修复设备故障，不能重置批次", {
        faults: [
          ...this.screws.map((screw) => screw.fault),
          this.mixer.fault
        ].filter(Boolean)
      });
      return false;
    }
    if (this.purgeInProgress) {
      this._log("reject", "", "清线进行中，不能重置批次", {});
      return false;
    }

    const residueKg = this.weigh.trueKg + this.mixer.totalKg;
    const wasCompleted = this.phase === "batch_done";
    const previousPhase = this.phase;
    this.wasteKg += residueKg;
    this._stopAllScrews("批次重置，螺旋安全停机");
    if (this.mixer.on) {
      this.mixer.on = false;
      this._log("device_stop", "混合机", "批次重置，混合机停机", {
        mixElapsed: round(this.mixer.mixElapsed, 2)
      });
    }
    if (this.weigh.gateOpen) {
      this.weigh.gateOpen = false;
      this._log("device_stop", "称重门", "批次重置，称重门关闭", {});
    }
    if (this.mixer.dischargeOpen) {
      this.mixer.dischargeOpen = false;
      this._log("device_stop", "混合机出料门", "批次重置，出料门关闭", {});
    }
    this.weigh = {
      mass: [0, 0, 0],
      trueKg: 0,
      measuredKg: 0,
      oscillationKg: 0,
      stable: true,
      gateOpen: false
    };
    this.mixer.charge = [0, 0, 0];
    this.mixer.totalKg = 0;
    this.mixer.mixElapsed = 0;
    this.mixer.mixComplete = false;
    this.mixer.dischargeOpen = false;
    this.phase = "ready";
    this.batchStartedAt = null;
    this.batchCutoffAt = null;
    this.packagingElapsed = 0;
    this._loggedStable = false;
    if (wasCompleted) {
      this.batchNo += 1;
      this.lastBatchCompleted = false;
    }
    this._log("batch_reset", "", "批次重置，旧料已排入废料", {
      previousPhase,
      batchNo: this.batchNo,
      residueKg: round(residueKg, 3),
      goodBatchesPreserved: this.goodBatches,
      cacheKgPreserved: round(this.cache.kg, 3)
    });
    return true;
  }

  _emergencyStop(reason) {
    this._stopAllScrews(`安全联锁：${reason}`);
    if (this.mixer.on) {
      this.mixer.on = false;
      this._log("device_stop", "混合机", `设备停机：${reason}`, {
        mixElapsed: round(this.mixer.mixElapsed, 2),
        mixSet: this.settings.mixTime
      });
    }
    if (this.weigh.gateOpen) {
      this.weigh.gateOpen = false;
      this._log("device_stop", "称重门", `设备停机：${reason}`, {});
    }
    if (this.mixer.dischargeOpen) {
      this.mixer.dischargeOpen = false;
      this._log("device_stop", "混合机出料门", `设备停机：${reason}`, {});
    }
  }

  injectFault(deviceKey, reason = "设备故障") {
    const deviceName = DEVICE_NAMES[deviceKey] || deviceKey;
    if (!["screwA", "screwB", "screwC", "mixer", "weighGate", "dischargeGate"].includes(deviceKey)) {
      this._log("reject", deviceName, "未知故障设备", { deviceKey });
      return false;
    }
    if (this.phase === "stopped") {
      this._log("reject", deviceName, "设备已处于停机流程", { phase: this.phase });
      return false;
    }
    if (deviceKey.startsWith("screw")) {
      const index = ["screwA", "screwB", "screwC"].indexOf(deviceKey);
      if (this.screws[index].fault) {
        this._log("reject", deviceName, "设备已有未修复故障", { fault: this.screws[index].fault });
        return false;
      }
      const triggerValues = {
        setpoint: this.screws[index].setpoint,
        actual: round(this.screws[index].actual, 3),
        deliveredKg: round(this.screws[index].deliveredKg, 3),
        batchKg: round(this.weigh.trueKg, 3),
        resumePhase: this.phase
      };
      this.resumePhase = this.phase;
      this.phase = "stopped";
      this.currentReason = reason;
      this._emergencyStop(`${deviceName}${reason}`);
      this.screws[index].fault = reason;
      this.screws[index].actual = 0;
      const values = triggerValues;
      this._log("device_stop", deviceName, `设备停机：${reason}`, values);
      this._log("fault", deviceName, `设备停机：${reason}`, values);
      const anomaly = this._anomaly("equipment_stop", `${deviceName} / 驱动`, `设备停机：${reason}`, values);
      this.stops.push({
        t: round(this.clock, 2),
        tick: this.tick,
        device: deviceName,
        reason: `${reason}停机`,
        anomalyId: anomaly.id,
        values
      });
      return true;
    }

    if (deviceKey === "mixer" && this.mixer.fault) {
      this._log("reject", deviceName, "设备已有未修复故障", { fault: this.mixer.fault });
      return false;
    }
    this.resumePhase = this.phase;
    this.phase = "stopped";
    this.currentReason = reason;
    this._emergencyStop(`${deviceName}${reason}`);
    if (deviceKey === "mixer") this.mixer.fault = reason;
    if (deviceKey === "weighGate" || deviceKey === "dischargeGate") {
      this.gateFaults[deviceKey] = reason;
    }
    const values = {
      actual: deviceKey === "mixer" ? 0 : undefined,
      setpoint: deviceKey === "mixer" ? this.settings.mixTime : undefined,
      mixElapsed: round(this.mixer.mixElapsed, 2),
      chargeKg: round(this.mixer.totalKg, 3),
      batchKg: round(this.weigh.trueKg, 3),
      resumePhase: this.resumePhase
    };
    this._log("device_stop", deviceName, `设备停机：${reason}`, values);
    this._log("fault", deviceName, `设备停机：${reason}`, values);
    const anomaly = this._anomaly("equipment_stop", `${deviceName} / 驱动`, `设备停机：${reason}`, values);
    this.stops.push({
      t: round(this.clock, 2),
      tick: this.tick,
      device: deviceName,
      reason: `${reason}停机`,
      anomalyId: anomaly.id,
      values
    });
    return true;
  }

  repairDevice(deviceKey) {
    const deviceName = DEVICE_NAMES[deviceKey] || deviceKey;
    let repairTarget = null;
    if (deviceKey.startsWith("screw")) {
      const index = ["screwA", "screwB", "screwC"].indexOf(deviceKey);
      repairTarget = this.screws[index];
    } else if (deviceKey === "mixer") {
      repairTarget = this.mixer;
    } else if (deviceKey === "weighGate" || deviceKey === "dischargeGate") {
      repairTarget = this.gateFaults[deviceKey]
        ? { fault: this.gateFaults[deviceKey] }
        : null;
    }
    if (!repairTarget || !repairTarget.fault) {
      this._log("reject", deviceName, "设备当前无故障", {});
      return false;
    }
    repairTarget.fault = null;
    if (deviceKey === "weighGate" || deviceKey === "dischargeGate") {
      this.gateFaults[deviceKey] = null;
    }
    const recovery = `${deviceName}${this.currentReason || repairTarget.fault || "故障"}已排除；批次 #${this.batchNo} 数据保留，可恢复生产`;
    this._log("repair", deviceName, `设备恢复：${this.currentReason || "故障"}已复位`, {
      clock: round(this.clock, 2),
      batchNo: this.batchNo,
      preservedKg: round(this.weigh.trueKg + this.mixer.totalKg, 3),
      mixElapsed: round(this.mixer.mixElapsed, 2)
    });
    this._recoverAnomaly(
      (item) => item.kind === "equipment_stop" && item.location.startsWith(`${deviceName} /`),
      recovery
    );
    return true;
  }

  resumeProduction() {
    if (this.phase !== "stopped") {
      this._log("reject", "", "没有待恢复的停机批次", { phase: this.phase });
      return false;
    }
    const faults = [
      ...this.screws.map((screw) => screw.fault),
      this.mixer.fault,
      this.gateFaults.weighGate,
      this.gateFaults.dischargeGate
    ].filter(Boolean);
    if (faults.length) {
      this._log("reject", "", "设备故障未排除，不能恢复", { faults });
      return false;
    }
    const phase = this.resumePhase;
    if (phase === "dosing") {
      this.phase = "dosing";
      this.screws.forEach((screw, index) => {
        if (this.settings.speeds[index] > 0) {
          this._setScrewOn(index, true, this.settings.speeds[index], "故障恢复，螺旋继续配料");
        }
      });
    } else if (phase === "mixing") {
      this.phase = "mixing";
      this.mixer.on = true;
      this._log("device_start", "混合机", "故障恢复，混合机继续当前批次", {
        mixElapsed: round(this.mixer.mixElapsed, 2),
        mixSet: this.settings.mixTime
      });
    } else if (phase === "packaging") {
      this.phase = "packaging";
      this.mixer.dischargeOpen = true;
      this._log("device_start", "混合机出料门", "故障恢复，继续向包装仓卸料", {
        remainingKg: round(this.mixer.totalKg, 3)
      });
    } else if (phase === "dumping") {
      this.phase = "dumping";
      this.weigh.gateOpen = true;
      this._log("device_start", "称重门", "故障恢复，继续卸入混合机", {
        remainingKg: round(this.weigh.trueKg, 3)
      });
    } else {
      this.phase = "ready";
    }
    this.resumePhase = null;
    this.currentReason = "";
    this._log("resume_batch", "", `恢复当前批次 #${this.batchNo}`, {
      phase: this.phase,
      weighKg: round(this.weigh.trueKg, 3),
      mixerKg: round(this.mixer.totalKg, 3),
      mixElapsed: round(this.mixer.mixElapsed, 2)
    });
    return true;
  }

  _integrate(dt) {
    const step = Math.max(0, Number(dt) || 0);
    if (step === 0) return;
    this.clock = round(this.clock + step, 4);
    this.tick += 1;

    if (this.purgeInProgress && this.clock >= this.purgeUntil) {
      this.purgeInProgress = false;
      this._log("device_stop", "清空阀", "清线完成，清空阀关闭", {
        residueKg: 0,
        clock: round(this.clock, 2)
      });
    }

    this.screws.forEach((screw) => {
      const target = screw.on && !screw.fault ? screw.setpoint : 0;
      const tau = target > screw.actual ? 0.38 : 0.3;
      screw.actual += (target - screw.actual) * (1 - Math.exp(-step / tau));
      if (screw.actual < 0.01) screw.actual = 0;
      screw.flowKgS = screw.fault ? 0 : (screw.actual / 100) * SCREW_FLOW_KG_S;
      if (screw.flowKgS < 0.0001) screw.flowKgS = 0;
    });

    const flow = this.screws.map((screw) => screw.flowKgS * step);
    if (["dosing", "settling"].includes(this.phase)) {
      this.screws.forEach((screw, index) => {
        this.weigh.mass[index] += flow[index];
        screw.deliveredKg += flow[index];
      });
      this.weigh.trueKg = this.weigh.mass.reduce((sum, kg) => sum + kg, 0);
    }

    const maxActual = Math.max(...this.screws.map((screw) => screw.actual), 0);
    const totalActual = this.screws.reduce((sum, screw) => sum + screw.actual, 0);
    const oscillationTarget = ["dosing", "settling"].includes(this.phase)
      ? Math.max(0, maxActual - 70) * 0.09 + Math.max(0, totalActual - 140) * 0.04
      : 0;
    const oscillationTau = oscillationTarget > this.weigh.oscillationKg ? 0.24 : 0.8;
    this.weigh.oscillationKg +=
      (oscillationTarget - this.weigh.oscillationKg) * (1 - Math.exp(-step / oscillationTau));
    if (this.weigh.oscillationKg < 0.001) this.weigh.oscillationKg = 0;
    this.weigh.measuredKg =
      this.weigh.trueKg +
      this.weigh.oscillationKg * Math.sin(this.clock * 8.6 + 0.7);
    const noScrewMotion = this.screws.every((screw) => screw.actual < 0.2);
    this.weigh.stable = noScrewMotion && this.weigh.oscillationKg < 0.08;

    if (this.phase === "dosing") {
      const totalFlow = this.screws.reduce((sum, screw) => sum + screw.flowKgS, 0);
      const cutoffKg = BATCH_TARGET_KG - totalFlow * 0.31;
      if (this.weigh.trueKg >= cutoffKg) {
        this.batchCutoffAt = round(this.clock, 2);
        this._stopAllScrews("达到称重目标，螺旋自动停机");
        this.phase = "settling";
        this._log("batch_cutoff", "", "称重达到目标，进入稳定判定", {
          batchNo: this.batchNo,
          trueKg: round(this.weigh.trueKg, 3),
          measuredKg: round(this.weigh.measuredKg, 3),
          oscillationKg: round(this.weigh.oscillationKg, 3),
          stopPredictionKg: round(cutoffKg, 3)
        });
      }
    }

    if (this.phase === "settling" && this.weigh.stable) {
      this.phase = "weighing";
      this._loggedStable = true;
      this._log("weigh_stable", "", "称重稳定，可打开称重门", {
        trueKg: round(this.weigh.trueKg, 3),
        measuredKg: round(this.weigh.measuredKg, 3),
        oscillationKg: round(this.weigh.oscillationKg, 4)
      });
    }

    if (this.weigh.gateOpen && this.phase === "dumping") {
      const remaining = this.weigh.trueKg;
      const drain = Math.min(remaining, GATE_FLOW_KG_S * step);
      if (remaining > 0) {
        const fraction = drain / remaining;
        const transfer = this.weigh.mass.map((kg) => kg * fraction);
        this.weigh.mass = this.weigh.mass.map((kg, index) => Math.max(0, kg - transfer[index]));
        this.mixer.charge = this.mixer.charge.map((kg, index) => kg + transfer[index]);
        this.weigh.trueKg = Math.max(0, remaining - drain);
      }
      if (this.weigh.trueKg <= 0.02) {
        this.weigh.trueKg = 0;
        this.weigh.mass = [0, 0, 0];
        this.weigh.gateOpen = false;
        this.mixer.totalKg = this.mixer.charge.reduce((sum, kg) => sum + kg, 0);
        this.phase = "mix_ready";
        this._log("device_stop", "称重门", "称重斗卸空，闸门自动关闭", {
          mixerKg: round(this.mixer.totalKg, 3)
        });
        this._log("weigh_dump", "", "配料进入混合机，等待混合", {
          batchNo: this.batchNo,
          charge: this.mixer.charge.map((kg) => round(kg, 3))
        });
      }
    }

    if (this.phase === "mixing" && this.mixer.on) {
      this.mixer.mixElapsed = round(this.mixer.mixElapsed + step, 4);
      if (this.mixer.mixElapsed >= this.settings.mixTime) {
        this.mixer.mixElapsed = this.settings.mixTime;
        this.mixer.on = false;
        this.mixer.mixComplete = true;
        this.phase = "mix_done";
        this._log("device_stop", "混合机", "混合完成，等待出料", {
          mixElapsed: round(this.mixer.mixElapsed, 2),
          mixSet: this.settings.mixTime
        });
      }
    }

    if (this.mixer.dischargeOpen && this.phase === "packaging") {
      this.packagingElapsed += step;
      const remaining = this.mixer.totalKg;
      const drain = Math.min(remaining, PACKAGE_FLOW_KG_S * step);
      if (remaining > 0) {
        const fraction = drain / remaining;
        this.mixer.charge = this.mixer.charge.map((kg) => Math.max(0, kg * (1 - fraction)));
        this.mixer.totalKg = Math.max(0, remaining - drain);
        this.cache.kg += drain;
      }
      if (this.mixer.totalKg <= 0.01) {
        this.mixer.totalKg = 0;
        this.mixer.charge = [0, 0, 0];
        this.mixer.dischargeOpen = false;
        this._log("device_stop", "混合机出料门", "包装仓进料完成，出料门关闭", {
          cacheKg: round(this.cache.kg, 3),
          packagingSeconds: round(this.packagingElapsed, 2)
        });
        this._finishBatch();
      }
    }

    this._updatePower(step);
  }

  _updatePower(step) {
    let kw = 0;
    this.screws.forEach((screw) => {
      if (screw.actual > 0.01) kw += 0.42 + (screw.actual / 100) * 3.2;
    });
    if (this.mixer.on) kw += 4.6 + Math.min(this.mixer.totalKg, 120) * 0.008;
    if (this.weigh.gateOpen) kw += 0.35;
    if (this.mixer.dischargeOpen) kw += 0.55;
    if (this.purgeInProgress) kw += 1.1;
    if (this.phase === "stopped") kw = Math.min(kw, 0.1);
    this.power.currentKw = round(kw, 3);
    this.power.peakKw = Math.max(this.power.peakKw, this.power.currentKw);
    this.power.energyKwh = round(this.power.energyKwh + (this.power.currentKw * step) / 3600, 7);
  }

  _finishBatch() {
    const totalKg = Math.max(0, this.packagedTotalKg);
    const checks = this.packagedCharge.map((kg, index) => {
      const target = this.recipe.ratios[index];
      const actual = totalKg > 0 ? kg / totalKg : 0;
      return {
        id: FLOURS[index].id,
        target: round(target, 3),
        actual: round(actual, 4),
        errPct: round(Math.abs(actual - target) * 100, 3),
        kg: round(kg, 3)
      };
    });
    const reasons = [];
    const totalErrPct = totalKg > 0 ? Math.abs(totalKg - BATCH_TARGET_KG) / BATCH_TARGET_KG : 1;
    if (totalErrPct > WEIGHT_TOLERANCE) {
      reasons.push(`总重偏差越限（目标 ${BATCH_TARGET_KG}kg，实测 ${round(totalKg, 2)}kg）`);
    }
    checks.forEach((check) => {
      if (check.errPct / 100 > RATIO_TOLERANCE) {
        reasons.push(`${FLOURS.find((flour) => flour.id === check.id).name}比例误差 ${check.errPct.toFixed(2)}% 超过 2%`);
      }
    });
    const result = reasons.length ? "scrap" : "good";
    const record = {
      no: this.batchNo,
      recipeId: this.recipeId,
      result,
      reasons,
      startedAt: this.batchStartedAt,
      finishedAt: round(this.clock, 2),
      totalKg: round(totalKg, 3),
      mixTime: this.settings.mixTime,
      checks
    };

    this.batches.push(record);
    this.totalBatches += 1;
    this.cache.batches += 1;
    this.cache.lastRecipe = this.recipeId;
    if (result === "good") {
      this.goodBatches += 1;
      this.goodKg = round(this.goodKg + totalKg, 3);
    } else {
      this.wasteKg = round(this.wasteKg + totalKg, 3);
      this._anomaly("quality", `批次 #${this.batchNo} / 包装检验`, "整批报废：" + reasons.join("；"), {
        totalKg: round(totalKg, 3),
        totalErrPct: round(totalErrPct * 100, 3),
        checks,
        reasons
      }, false);
    }
    this.lastBatchCompleted = true;
    this.packagedCharge = [0, 0, 0];
    this.packagedTotalKg = 0;

    this._log(result === "good" ? "batch_good" : "batch_scrap", "", result === "good"
      ? `批次合格，已计入良品`
      : `整批报废：${reasons.join("；")}`, {
      batchNo: this.batchNo,
      recipeId: this.recipeId,
      totalKg: round(totalKg, 3),
      checks,
      reasons,
      goodBatches: this.goodBatches,
      goodRate: round(this.totalBatches ? this.goodBatches / this.totalBatches : 0, 3),
      cacheKg: round(this.cache.kg, 3)
    });

    if (this.goodBatches >= 3) {
      this.success = true;
      this.phase = "success";
      this._log("success", "", "已完成 3 批合格混合，生产成功", {
        goodBatches: this.goodBatches,
        totalBatches: this.totalBatches,
        goodRate: round(this.goodBatches / this.totalBatches, 3),
        peakPowerKw: round(this.power.peakKw, 3),
        cacheKg: round(this.cache.kg, 3)
      });
    } else {
      this.phase = "batch_done";
    }
  }

  snapshot() {
    return {
      clock: this.clock,
      tick: this.tick,
      paused: this.paused,
      phase: this.phase,
      recipeId: this.recipeId,
      purgeRequired: this.purgeRequired,
      purgeInProgress: this.purgeInProgress,
      batchNo: this.batchNo,
      batchStartedAt: this.batchStartedAt,
      settings: copy(this.settings),
      screws: copy(this.screws),
      weigh: copy(this.weigh),
      mixer: copy(this.mixer),
      cache: copy(this.cache),
      power: copy(this.power),
      goodBatches: this.goodBatches,
      totalBatches: this.totalBatches,
      goodKg: this.goodKg,
      wasteKg: this.wasteKg,
      success: this.success,
      stops: copy(this.stops),
      anomalies: copy(this.anomalies),
      lastBatch: this.batches.length ? copy(this.batches[this.batches.length - 1]) : null
    };
  }

  exportReport() {
    return {
      generatedAt: new Date().toISOString(),
      simClock: round(this.clock, 2),
      goodBatches: this.goodBatches,
      totalBatches: this.totalBatches,
      goodRate: round(this.totalBatches ? this.goodBatches / this.totalBatches : 0, 3),
      goodKg: round(this.goodKg, 3),
      peakPowerKw: round(this.power.peakKw, 3),
      energyKwh: round(this.power.energyKwh, 5),
      wasteKg: round(this.wasteKg, 3),
      cacheKg: round(this.cache.kg, 3),
      success: this.success,
      stops: copy(this.stops),
      anomalies: copy(this.anomalies),
      batches: copy(this.batches),
      events: copy(this.events)
    };
  }

  exportEventsCsv() {
    const rows = [["t_s", "type", "device", "detail", "values_json"]];
    this.events.forEach((event) => {
      rows.push([
        event.t,
        event.type,
        event.device,
        event.detail,
        JSON.stringify(event.values)
      ]);
    });
    return rows.map((row) => row.map((cell) => this._csvCell(cell)).join(",")).join("\n");
  }

  exportBatchesCsv() {
    const rows = [["batch_no", "recipe", "result", "started_s", "finished_s", "total_kg", "reasons"]];
    this.batches.forEach((batch) => {
      rows.push([
        batch.no,
        batch.recipeId,
        batch.result,
        batch.startedAt ?? "",
        batch.finishedAt,
        batch.totalKg,
        batch.reasons.join("；")
      ]);
    });
    return rows.map((row) => row.map((cell) => this._csvCell(cell)).join(",")).join("\n");
  }

  _csvCell(value) {
    const text = String(value ?? "");
    return `"${text.replaceAll('"', '""')}"`;
  }
}
