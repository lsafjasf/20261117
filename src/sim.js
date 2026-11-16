export const GAME = Object.freeze({
  seedDefault: 20261117,
  startMinute: 6 * 60,
  stepMinutes: 0.05,
  batchCount: 3,
  survivalThreshold: 0.78,
  recoveryWatchMinutes: 3,
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, digits = 2) => Number(value.toFixed(digits));

const METRIC_META = Object.freeze({
  temperature: { label: "温差", unit: "°C" },
  waterLevel: { label: "水位", unit: "m" },
  flow: { label: "流速", unit: "m/s" },
  pollution: { label: "污染指数", unit: "" },
  oxygen: { label: "溶解氧", unit: "mg/L" },
  species: { label: "物种数", unit: "种" },
});

const ALARM_LIMITS = Object.freeze({
  temperature: { warning: 1.8, critical: 3.2, direction: "high" },
  waterLevel: { warning: 0.95, critical: 0.72, direction: "low" },
  flow: { warning: 1.65, critical: 2.3, direction: "high" },
  pollution: { warning: 42, critical: 60, direction: "high" },
  oxygen: { warning: 6.2, critical: 5.2, direction: "low" },
});

function hashString(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function stream(seed, label) {
  return mulberry32(hashString(`${seed}:${label}`));
}

function noise(seed, tick, channel) {
  let value = Math.imul((tick + 1) ^ hashString(channel), 0x45d9f3b);
  value ^= value >>> 16;
  value = Math.imul(value, 0x45d9f3b);
  value ^= value >>> 16;
  return ((value >>> 0) / 4294967296) * 2 - 1;
}

function severityRank(severity) {
  return severity === "critical" ? 2 : severity === "warning" ? 1 : 0;
}

function alarmFor(metric, value) {
  const limit = ALARM_LIMITS[metric];
  if (!limit) return { severity: "normal", label: "正常", threshold: null };
  const criticalCrossed =
    limit.direction === "high" ? value >= limit.critical : value <= limit.critical;
  const warningCrossed =
    limit.direction === "high" ? value >= limit.warning : value <= limit.warning;
  if (criticalCrossed) {
    return {
      severity: "critical",
      label: "临界",
      threshold: limit.critical,
      direction: limit.direction,
    };
  }
  if (warningCrossed) {
    return {
      severity: "warning",
      label: "预警",
      threshold: limit.warning,
      direction: limit.direction,
    };
  }
  return { severity: "normal", label: "正常", threshold: null, direction: limit.direction };
}

function formatClock(totalMinutes) {
  const normalized = ((Math.floor(totalMinutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatElapsed(minutes) {
  const seconds = Math.floor(minutes * 60);
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `T+${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function buildWeather(seed) {
  const random = stream(seed, "weather");
  const templates = [
    { type: "clear", label: "晴间多云", icon: "sun", temp: 0.55, flow: 0.02, turbidity: 0, wind: 2.1 },
    { type: "overcast", label: "低云压境", icon: "cloud", temp: -0.35, flow: 0.12, turbidity: 1.2, wind: 3.2 },
    { type: "rain", label: "短时阵雨", icon: "rain", temp: -1.05, flow: 0.42, turbidity: 7, wind: 5.2 },
    { type: "storm", label: "雷暴过境", icon: "storm", temp: -2.25, flow: 1.38, turbidity: 26, wind: 10.8 },
    { type: "clearing", label: "雨后转晴", icon: "clearing", temp: -0.45, flow: 0.22, turbidity: 5, wind: 4.1 },
    { type: "clear", label: "稳定晴空", icon: "sun", temp: 0.5, flow: 0.02, turbidity: 0, wind: 1.8 },
    { type: "overcast", label: "云量增多", icon: "cloud", temp: -0.25, flow: 0.1, turbidity: 1, wind: 3 },
    { type: "rain", label: "间歇小雨", icon: "rain", temp: -0.9, flow: 0.36, turbidity: 6, wind: 4.7 },
    { type: "storm", label: "强对流", icon: "storm", temp: -2.1, flow: 1.25, turbidity: 23, wind: 9.6 },
    { type: "clearing", label: "云隙透光", icon: "clearing", temp: -0.3, flow: 0.18, turbidity: 4, wind: 3.5 },
    { type: "clear", label: "风弱浪平", icon: "sun", temp: 0.6, flow: 0.03, turbidity: 0, wind: 1.5 },
    { type: "overcast", label: "海雾初起", icon: "cloud", temp: -0.4, flow: 0.08, turbidity: 1.5, wind: 2.6 },
  ];
  const segments = [];
  let start = 0;
  for (let index = 0; index < templates.length; index += 1) {
    const template = templates[index];
    const base = index < 5 ? 5.8 : 6.4;
    const duration = base + random() * 2.8;
    const drift = (random() - 0.5) * 0.16;
    segments.push({
      ...template,
      temp: template.temp + drift,
      duration,
      start,
      end: start + duration,
      sequence: index,
    });
    start += duration;
  }
  return segments;
}

function buildTargets(seed) {
  const random = stream(seed, "targets");
  const preferred = [0.32 + random() * 0.46, 0.28 + random() * 0.54, 0.3 + random() * 0.5];
  return preferred.map((x, index) => {
    const normalizedX = Math.round(x * 100) / 100;
    const fishCount = 3200 + Math.round(random() * 5) * 70;
    return {
      id: index + 1,
      x: normalizedX,
      y: 0.43 + index * 0.12 + random() * 0.035,
      label: normalizedX < 0.4 ? "浅滩外缘" : normalizedX > 0.68 ? "主槽深水" : "过渡水道",
      fishCount,
      status: "pending",
      survival: null,
    };
  });
}

export class EstuarySimulation {
  constructor({ seed = GAME.seedDefault } = {}) {
    this.seed = Number.isFinite(Number(seed)) ? Number(seed) >>> 0 : GAME.seedDefault;
    this.weatherSegments = buildWeather(this.seed);
    this.targets = buildTargets(this.seed);
    this.timeMin = 0;
    this.tick = 0;
    this.controls = {
      mixTemp: 20.2,
      releaseX: 0.5,
      gateSpeed: 1.2,
    };
    this.actual = {
      estuaryTemp: 20.35,
      releaseTemp: 20.15,
      tempDiff: 0.2,
      waterLevel: 1.61,
      flow: 0.87,
      pollution: 14.2,
      oxygen: 7.82,
      speciesCount: 16,
    };
    this.observed = {};
    this.alarms = {};
    this.overallAlarm = "normal";
    this.batches = [];
    this.activeBatch = null;
    this.logs = [];
    this.events = [];
    this.records = [];
    this._logId = 0;
    this._eventId = 0;
    this._lastWeatherSequence = -1;
    this._lastAlarmState = "normal";
    this._steadyRecorded = false;
    this._steadyStartSnapshot = this.captureSnapshot();
    this._initialSnapshot = this._steadyStartSnapshot;
    this._snapshots = [{ timeMin: 0, values: this._initialSnapshot }];
    this._environmentWindow = [];
    this._sensorHistory = {
      temperature: Array(10).fill(this.actual.tempDiff),
      estuaryTemp: Array(10).fill(this.actual.estuaryTemp),
      releaseTemp: Array(10).fill(this.actual.releaseTemp),
      waterLevel: Array(10).fill(this.actual.waterLevel),
      flow: Array(10).fill(this.actual.flow),
      pollution: Array(10).fill(this.actual.pollution),
      oxygen: Array(10).fill(this.actual.oxygen),
      species: Array(10).fill(this.actual.speciesCount),
    };
    this.criticalEvent = null;
    this.criticalTriggered = false;
    this.recoveryWatch = null;
    this.missionComplete = false;
    this.missionSuccess = false;
    this.failureCount = 0;
    this._sampleObservation();
    this._refreshAlarms();
    this._lastAlarmState = this.overallAlarm;
    this._addLog(
      "info",
      "任务开始",
      `seed ${this.seed} · 三批鱼苗待放流 · 存活率目标 ${Math.round(GAME.survivalThreshold * 100)}%`,
    );
  }

  get clockLabel() {
    return formatClock(GAME.startMinute + this.timeMin);
  }

  get elapsedLabel() {
    return formatElapsed(this.timeMin);
  }

  weatherAt(minute) {
    const normalized = ((minute % 1440) + 1440) % 1440;
    for (const segment of this.weatherSegments) {
      if (normalized >= segment.start && normalized < segment.end) return segment;
    }
    const last = this.weatherSegments[this.weatherSegments.length - 1];
    return { ...last, start: normalized, end: normalized + 1 };
  }

  nextWeatherSegments(count = 3) {
    return this.weatherSegments
      .filter((segment) => segment.end > this.timeMin)
      .slice(0, count)
      .map((segment) => ({
        ...segment,
        startsIn: Math.max(0, segment.start - this.timeMin),
        active: segment.start <= this.timeMin && segment.end > this.timeMin,
      }));
  }

  setControl(key, value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    if (key === "mixTemp") this.controls.mixTemp = clamp(numeric, 10, 26);
    if (key === "releaseX") this.controls.releaseX = clamp(numeric, 0.08, 0.92);
    if (key === "gateSpeed") this.controls.gateSpeed = clamp(numeric, 0.3, 2.8);
  }

  setControls(values = {}) {
    for (const [key, value] of Object.entries(values)) this.setControl(key, value);
  }

  startBatch() {
    if (this.activeBatch || this.batches.length >= GAME.batchCount) return null;
    const target = this.targets[this.batches.length];
    const duration = clamp(6.2 * (1.2 / Math.max(0.45, this.controls.gateSpeed)), 3.2, 10);
    const batch = {
      id: this.batches.length + 1,
      status: "releasing",
      targetIndex: this.batches.length,
      fishCount: target.fishCount,
      startedAt: this.timeMin,
      endedAt: null,
      duration,
      progress: 0,
      released: 0,
      qualitySum: 0,
      survival: 1,
      risk: 0,
      startSnapshot: this.captureSnapshot(),
      startControls: { ...this.controls },
    };
    target.status = "active";
    this.batches.push(batch);
    this.activeBatch = batch;
    this._addLog(
      "info",
      `第 ${batch.id} 批开始放流`,
      `目标 ${target.label} ${Math.round(target.x * 100)}% · ${batch.fishCount} 尾 · 预计 ${duration.toFixed(1)} 分钟`,
    );
    return batch;
  }

  advance(minutes) {
    let remaining = Math.max(0, Number(minutes) || 0);
    let guard = 0;
    while (remaining > 1e-8 && guard < 20000) {
      const step = Math.min(GAME.stepMinutes, remaining);
      this.step(step);
      remaining -= step;
      guard += 1;
    }
    return this;
  }

  step(dt = GAME.stepMinutes) {
    this.timeMin += dt;
    this.tick += 1;
    this._updateWeatherLog();
    this._updateEnvironment(dt);
    this._sampleObservation();
    this._refreshAlarms(dt);
    this._updateBatch(dt);
    this._checkSteadyState();
    this._checkCriticalState(dt);
    this._appendTelemetrySnapshot();
    this._checkAlarmTransition();
    return this;
  }

  _updateEnvironment(dt) {
    const weather = this.weatherAt(this.timeMin);
    const tide = Math.sin((this.timeMin + 4.5) / 26.5 * Math.PI * 2);
    const shortWave = Math.sin((this.timeMin + 2) / 7.3 * Math.PI * 2);
    const gateLoad = this.activeBatch ? this.controls.gateSpeed : 0.25;
    const targetTemp =
      20.15 + tide * 0.58 + weather.temp + shortWave * 0.09;
    const targetLevel =
      1.58 + tide * 0.41 + (weather.type === "storm" ? 0.18 : 0) + weather.flow * 0.045;
    const targetFlow = clamp(
      0.78 + tide * 0.2 + weather.flow + (this.activeBatch ? gateLoad * 0.15 : 0),
      0.28,
      3.05,
    );
    const targetPollution = clamp(
      12.8 +
        weather.turbidity * 1.7 +
        (this.activeBatch ? Math.max(0, gateLoad - 1.15) * 7.5 : 0) +
        (this.activeBatch && this.controls.releaseX < 0.25 ? 2.5 : 0),
      8,
      92,
    );

    const tempBlend = 1 - Math.exp(-dt / 1.65);
    const levelBlend = 1 - Math.exp(-dt / 2.8);
    const flowBlend = 1 - Math.exp(-dt / 0.95);
    const pollutionBlend = 1 - Math.exp(-dt / (targetPollution > this.actual.pollution ? 2.5 : 2.0));
    const releaseBlend = 1 - Math.exp(-dt / 1.45);

    this.actual.estuaryTemp += (targetTemp - this.actual.estuaryTemp) * tempBlend;
    this.actual.releaseTemp += (this.controls.mixTemp - this.actual.releaseTemp) * releaseBlend;
    this.actual.waterLevel += (targetLevel - this.actual.waterLevel) * levelBlend;
    this.actual.flow += (targetFlow - this.actual.flow) * flowBlend;
    this.actual.pollution += (targetPollution - this.actual.pollution) * pollutionBlend;
    this.actual.tempDiff = Math.abs(this.actual.releaseTemp - this.actual.estuaryTemp);

    const crowding = this.activeBatch
      ? Math.max(0, this.controls.gateSpeed - 1.55) * 0.36
      : 0;
    const targetOxygen = clamp(
      8.55 -
        this.actual.pollution * 0.027 -
        Math.max(0, this.actual.estuaryTemp - 21.5) * 0.08 -
        crowding,
      3.8,
      9.4,
    );
    this.actual.oxygen += (targetOxygen - this.actual.oxygen) * (1 - Math.exp(-dt / 1.8));

    const targetSpecies = clamp(
      17.2 -
        Math.max(0, this.actual.pollution - 20) * 0.16 +
        (this.actual.waterLevel - 1.45) * 0.8,
      4,
      19,
    );
    this.actual.speciesCount +=
      (targetSpecies - this.actual.speciesCount) * (1 - Math.exp(-dt / 3.5));
  }

  _sampleObservation() {
    const map = {
      temperature: this.actual.tempDiff,
      estuaryTemp: this.actual.estuaryTemp,
      releaseTemp: this.actual.releaseTemp,
      waterLevel: this.actual.waterLevel,
      flow: this.actual.flow,
      pollution: this.actual.pollution,
      oxygen: this.actual.oxygen,
      species: this.actual.speciesCount,
    };
    const noiseScale = {
      temperature: 0.13,
      estuaryTemp: 0.11,
      releaseTemp: 0.11,
      waterLevel: 0.022,
      flow: 0.055,
      pollution: 1.35,
      oxygen: 0.075,
      species: 0,
    };
    for (const [key, history] of Object.entries(this._sensorHistory)) {
      history.push(map[key]);
      if (history.length > 10) history.shift();
    }
    this.observed.temperature = Math.max(
      0,
      this._sensorHistory.temperature[0] +
        noise(this.seed, this.tick, "temp") * noiseScale.temperature,
    );
    this.observed.estuaryTemp =
      this._sensorHistory.estuaryTemp[0] +
      noise(this.seed, this.tick, "estuaryTemp") * noiseScale.estuaryTemp;
    this.observed.releaseTemp =
      this._sensorHistory.releaseTemp[0] +
      noise(this.seed, this.tick, "releaseTemp") * noiseScale.releaseTemp;
    this.observed.temperature = Math.abs(
      this.observed.estuaryTemp - this.observed.releaseTemp,
    );
    this.observed.waterLevel =
      this._sensorHistory.waterLevel[0] +
      noise(this.seed, this.tick, "level") * noiseScale.waterLevel;
    this.observed.flow = Math.max(
      0,
      this._sensorHistory.flow[0] +
        noise(this.seed, this.tick, "flow") * noiseScale.flow,
    );
    this.observed.pollution = Math.max(
      0,
      this._sensorHistory.pollution[0] + noise(this.seed, this.tick, "pollution") * noiseScale.pollution,
    );
    this.observed.oxygen =
      this._sensorHistory.oxygen[0] +
      noise(this.seed, this.tick, "oxygen") * noiseScale.oxygen;
    this.observed.species = this._sensorHistory.species[0];
  }

  _refreshAlarms(dt = 0) {
    this.alarms = {
      temperature: alarmFor("temperature", this.observed.temperature),
      waterLevel: alarmFor("waterLevel", this.observed.waterLevel),
      flow: alarmFor("flow", this.observed.flow),
      pollution: alarmFor("pollution", this.observed.pollution),
      oxygen: alarmFor("oxygen", this.observed.oxygen),
    };
    this.instantAlarm = Object.values(this.alarms).reduce(
      (worst, alarm) => (severityRank(alarm.severity) > severityRank(worst) ? alarm.severity : worst),
      "normal",
    );
    if (severityRank(this.instantAlarm) > severityRank(this.overallAlarm || "normal")) {
      this.overallAlarm = this.instantAlarm;
      this._alarmHold = 0;
    } else if (severityRank(this.instantAlarm) < severityRank(this.overallAlarm || "normal")) {
      this._alarmHold = (this._alarmHold || 0) + dt;
      if (this._alarmHold >= 0.55) {
        this.overallAlarm = this.instantAlarm;
        this._alarmHold = 0;
      }
    } else {
      this._alarmHold = 0;
    }
    const actualValues = {
      temperature: this.actual.tempDiff,
      waterLevel: this.actual.waterLevel,
      flow: this.actual.flow,
      pollution: this.actual.pollution,
      oxygen: this.actual.oxygen,
    };
    this.actualAlarms = Object.fromEntries(
      Object.entries(actualValues).map(([key, value]) => [key, alarmFor(key, value)]),
    );
  }

  _updateBatch(dt) {
    if (!this.activeBatch) return;
    const batch = this.activeBatch;
    const target = this.targets[batch.targetIndex];
    const progressDelta = Math.min(1 - batch.progress, dt / batch.duration);
    const tempStress = Math.max(0, this.actual.tempDiff - 1.5) * 0.075;
    const shallowRisk = Math.max(0, 0.32 - this.controls.releaseX) * 0.55;
    const targetMiss = Math.max(0, Math.abs(this.controls.releaseX - target.x) - 0.18) * 0.35;
    const crowding = Math.max(0, this.controls.gateSpeed - 1.8) * 0.09;
    const pollutionRisk = Math.max(0, this.actual.pollution - 45) * 0.0035;
    const oxygenRisk = Math.max(0, 5.5 - this.actual.oxygen) * 0.025;
    const weatherRisk = this.weatherAt(this.timeMin).type === "storm" ? 0.018 : 0;
    const totalRisk = tempStress + shallowRisk + targetMiss + crowding + pollutionRisk + oxygenRisk + weatherRisk;
    const quality = clamp(0.985 - totalRisk, 0.03, 0.995);

    batch.progress = clamp(batch.progress + progressDelta, 0, 1);
    batch.released = Math.round(batch.fishCount * batch.progress);
    batch.qualitySum += quality * progressDelta;
    batch.survival = clamp(batch.qualitySum / Math.max(batch.progress, 1e-6), 0.03, 0.995);
    batch.risk = totalRisk;

    if (batch.progress >= 1 - 1e-8) this._finishBatch(batch);
  }

  _finishBatch(batch) {
    batch.status = batch.survival >= GAME.survivalThreshold ? "success" : "failed";
    batch.endedAt = this.timeMin;
    batch.progress = 1;
    batch.released = batch.fishCount;
    const target = this.targets[batch.targetIndex];
    target.status = batch.status;
    target.survival = batch.survival;
    const after = this.captureSnapshot();
    if (batch.status === "success") {
      this._addLog(
        "success",
        `第 ${batch.id} 批放流达标`,
        `存活率 ${(batch.survival * 100).toFixed(1)}% · ${target.label} · ${batch.fishCount} 尾`,
      );
    } else {
      this.failureCount += 1;
      this._recordEvent({
        type: "failure",
        severity: "alert",
        title: `第 ${batch.id} 批处置失败`,
        trigger: "batch_survival",
        detail: `存活率 ${(batch.survival * 100).toFixed(1)}%，低于 ${Math.round(GAME.survivalThreshold * 100)}% 阈值`,
        threshold: GAME.survivalThreshold,
        measured: batch.survival,
        before: batch.startSnapshot,
        after,
        meta: {
          batchId: batch.id,
          targetX: target.x,
          gateSpeed: this.controls.gateSpeed,
          tempDiff: this.actual.tempDiff,
        },
      });
      this._addLog(
        "alert",
        `第 ${batch.id} 批处置失败`,
        `存活率 ${(batch.survival * 100).toFixed(1)}% · 温差 ${this.actual.tempDiff.toFixed(2)}°C · 闸门 ${this.controls.gateSpeed.toFixed(1)} m/s`,
      );
    }
    this.activeBatch = null;
    if (this.batches.length >= GAME.batchCount) {
      this.missionComplete = true;
      this.missionSuccess = this.failureCount === 0;
      const avg = this.batches.reduce((sum, item) => sum + item.survival, 0) / this.batches.length;
      this._addLog(
        this.missionSuccess ? "success" : "alert",
        this.missionSuccess ? "三批放流任务完成" : "三批放流结束，存在失败批次",
        `平均存活率 ${(avg * 100).toFixed(1)}% · 失败 ${this.failureCount} 批`,
      );
    }
  }

  captureSnapshot() {
    return {
      timeMin: round(this.timeMin, 3),
      clock: this.clockLabel,
      elapsed: this.elapsedLabel,
      species: round(this.actual.speciesCount, 1),
      waterLevel: round(this.actual.waterLevel, 2),
      pollution: round(this.actual.pollution, 1),
      oxygen: round(this.actual.oxygen, 2),
      tempDiff: round(this.actual.tempDiff, 2),
      flow: round(this.actual.flow, 2),
      intervention: {
        mixTemp: round(this.controls.mixTemp, 1),
        releaseX: round(this.controls.releaseX, 2),
        gateSpeed: round(this.controls.gateSpeed, 1),
      },
    };
  }

  _snapshotNear(targetMinute) {
    let best = this._snapshots[0];
    for (const item of this._snapshots) {
      if (Math.abs(item.timeMin - targetMinute) < Math.abs(best.timeMin - targetMinute)) best = item;
    }
    return { ...best.values };
  }

  _appendTelemetrySnapshot() {
    if (!Array.isArray(this.telemetry)) this.telemetry = [];
    if (this.tick % 10 !== 0) return;
    const point = {
      timeMin: round(this.timeMin, 2),
      observedTemp: round(this.observed.temperature, 2),
      actualTemp: round(this.actual.tempDiff, 2),
      observedLevel: round(this.observed.waterLevel, 2),
      observedFlow: round(this.observed.flow, 2),
      observedPollution: round(this.observed.pollution, 1),
      observedOxygen: round(this.observed.oxygen, 2),
      observedSpecies: round(this.observed.species, 1),
      actualPollution: round(this.actual.pollution, 1),
      species: round(this.actual.speciesCount, 1),
      alarm: this.overallAlarm,
    };
    this.telemetry.push(point);
    if (this.telemetry.length > 260) this.telemetry.shift();
    this._snapshots.push({ timeMin: this.timeMin, values: this.captureSnapshot() });
    if (this._snapshots.length > 120) this._snapshots.shift();
    this._environmentWindow.push({
      timeMin: this.timeMin,
      tempDiff: this.actual.tempDiff,
      waterLevel: this.actual.waterLevel,
      pollution: this.actual.pollution,
    });
    while (
      this._environmentWindow.length > 1 &&
      this._environmentWindow[0].timeMin < this.timeMin - 2
    ) {
      this._environmentWindow.shift();
    }
  }

  _checkSteadyState() {
    if (this._steadyRecorded || this.timeMin < 3.6) return;
    if (this.overallAlarm !== "normal") return;
    const window = this._environmentWindow;
    if (window.length < 4) return;
    const range = (key) => {
      const values = window.map((item) => item[key]);
      return Math.max(...values) - Math.min(...values);
    };
    const stable =
      range("tempDiff") < 0.42 &&
      range("waterLevel") < 0.16 &&
      range("pollution") < 3.8;
    if (!stable) return;
    this._steadyRecorded = true;
    const after = this.captureSnapshot();
    this._recordEvent({
      type: "steady",
      severity: "success",
      title: "稳态窗口确认",
      trigger: "continuous_2min_window",
      detail: "连续 2 分钟内温差、水位与污染指数均处于稳定带",
      before: this._steadyStartSnapshot,
      after,
      meta: {
        tempRange: round(range("tempDiff"), 2),
        levelRange: round(range("waterLevel"), 2),
        pollutionRange: round(range("pollution"), 2),
      },
    });
    this._addLog("success", "稳态窗口确认", "连续 2 分钟环境波动低于稳态阈值");
  }

  _checkCriticalState(dt) {
    if (!this.criticalTriggered) {
      const criticalKey = Object.entries(this.alarms).find(
        ([, alarm]) => alarm.severity === "critical",
      );
      if (criticalKey) {
        this.criticalTriggered = true;
        const [metric, alarm] = criticalKey;
        const observedValue =
          metric === "temperature"
            ? this.observed.temperature
            : metric === "waterLevel"
              ? this.observed.waterLevel
              : metric === "flow"
                ? this.observed.flow
                : metric === "pollution"
                  ? this.observed.pollution
                  : this.observed.oxygen;
        const actualValue =
          metric === "temperature"
            ? this.actual.tempDiff
            : metric === "waterLevel"
              ? this.actual.waterLevel
              : metric === "flow"
                ? this.actual.flow
                : metric === "pollution"
                  ? this.actual.pollution
                  : this.actual.oxygen;
        const event = this._recordEvent({
          type: "critical",
          severity: "alert",
          title: `临界阈值触发 · ${METRIC_META[metric].label}`,
          trigger: metric,
          detail: `${METRIC_META[metric].label}观测 ${observedValue.toFixed(2)}${METRIC_META[metric].unit} 越过临界线 ${alarm.threshold}${METRIC_META[metric].unit}`,
          threshold: alarm.threshold,
          measured: observedValue,
          before: this._snapshotNear(this.timeMin - 2),
          after: null,
          meta: {
            actualValue: round(actualValue, 2),
            weather: this.weatherAt(this.timeMin).label,
          },
        });
        this.criticalEvent = {
          status: "active",
          eventId: event.id,
          metric,
          threshold: alarm.threshold,
          matchedValue: observedValue,
          actualValue,
          triggeredAtMin: this.timeMin,
          calmFor: 0,
          before: event.before,
        };
        this._addLog(
          "alert",
          "临界阈值触发",
          `${METRIC_META[metric].label} ${observedValue.toFixed(2)}${METRIC_META[metric].unit} ≥ 临界线 ${alarm.threshold}${METRIC_META[metric].unit}`,
        );
        return;
      }
    }

    if (!this.criticalEvent || this.criticalEvent.status === "resolved") return;
    if (this.overallAlarm === "critical") {
      this.criticalEvent.calmFor = 0;
      if (this.criticalEvent.status === "watching") {
        this.criticalEvent.status = "active";
        this.recoveryWatch = null;
        this._addLog("warning", "临界状态反复", "恢复观察中断，重新进入处置窗口");
      }
      return;
    }
    if (this.criticalEvent.status === "active") {
      this.criticalEvent.calmFor += dt;
      if (this.criticalEvent.calmFor >= 1.0) {
        this.criticalEvent.status = "watching";
        this.recoveryWatch = {
          duration: GAME.recoveryWatchMinutes,
          remaining: GAME.recoveryWatchMinutes,
          startedAt: this.timeMin,
        };
        this._addLog(
          "success",
          "临界告警解除",
          `环境回到阈值内，进入 ${GAME.recoveryWatchMinutes} 分钟固定恢复观察`,
        );
      }
      return;
    }
    if (this.criticalEvent.status === "watching" && this.recoveryWatch) {
      this.recoveryWatch.remaining = Math.max(0, this.recoveryWatch.remaining - dt);
      if (this.recoveryWatch.remaining <= 1e-8) this._finishRecoveryWatch();
    }
  }

  _finishRecoveryWatch() {
    const after = this.captureSnapshot();
    const before = this.criticalEvent.before;
    const pollutionResidue = Math.max(0, after.pollution - before.pollution);
    const speciesLoss = Math.max(0, before.species - after.species);
    const passed =
      after.pollution < 35 &&
      after.oxygen > 6 &&
      speciesLoss < 1.5 &&
      this.overallAlarm !== "critical";
    this.criticalEvent.status = "resolved";
    this.criticalEvent.resolvedAtMin = this.timeMin;
    this.criticalEvent.after = after;
    this.recoveryWatch = null;
    const criticalRecord = this.events.find(
      (event) => event.id === this.criticalEvent.eventId,
    );
    if (criticalRecord) {
      criticalRecord.after = after;
      criticalRecord.status = "resolved";
      criticalRecord.resolvedAt = this.elapsedLabel;
    }
    this._recordEvent({
      type: "recovery",
      severity: passed ? "success" : "alert",
      title: passed ? "恢复观察通过" : "恢复后检出残留",
      trigger: "post_recovery_watch",
      detail: passed
        ? `固定观察 ${GAME.recoveryWatchMinutes} 分钟完整结束，未发现污染或物种残留`
        : "固定观察结束，污染/物种指标未回到安全带",
      before,
      after,
      meta: {
        watchMinutes: GAME.recoveryWatchMinutes,
        pollutionResidue: round(pollutionResidue, 1),
        speciesLoss: round(speciesLoss, 1),
        hiddenResidue: !passed,
      },
    });
    this._addLog(
      passed ? "success" : "alert",
      passed ? "恢复观察通过" : "恢复后检出残留",
      `固定观察 ${GAME.recoveryWatchMinutes} 分钟 · 污染残留 ${pollutionResidue.toFixed(1)} · 物种损失 ${speciesLoss.toFixed(1)}`,
    );
  }

  _updateWeatherLog() {
    const weather = this.weatherAt(this.timeMin);
    if (this._lastWeatherSequence === weather.sequence) return;
    this._lastWeatherSequence = weather.sequence;
    this._addLog(
      weather.type === "storm" ? "alert" : "info",
      `天气切换 · ${weather.label}`,
      `风 ${weather.wind.toFixed(1)} m/s · 预计持续 ${weather.duration.toFixed(1)} 分钟`,
    );
  }

  _checkAlarmTransition() {
    if (this.overallAlarm === this._lastAlarmState) return;
    const previous = this._lastAlarmState;
    this._lastAlarmState = this.overallAlarm;
    if (this.overallAlarm === "critical") return;
    this._addLog(
      this.overallAlarm === "warning" ? "warning" : "info",
      `综合告警 ${this.overallAlarm === "warning" ? "预警" : "解除"}`,
      `告警状态由 ${previous === "critical" ? "临界" : previous === "warning" ? "预警" : "正常"} 变为 ${this.overallAlarm === "warning" ? "预警" : "正常"}`,
    );
  }

  _recordEvent({ type, severity, title, trigger, detail, before, after, threshold = null, measured = null, meta = {} }) {
    this._eventId += 1;
    const event = {
      id: `evt-${this._eventId}`,
      type,
      severity,
      title,
      trigger,
      detail,
      triggeredAt: this.elapsedLabel,
      gameClock: this.clockLabel,
      timeMin: round(this.timeMin, 2),
      threshold,
      measured: measured === null ? null : round(measured, 3),
      before,
      after,
      status: after ? "resolved" : "active",
      meta,
    };
    this.events.push(event);
    if (this.events.length > 80) this.events.shift();
    return event;
  }

  _addLog(severity, title, detail) {
    this._logId += 1;
    const entry = {
      id: `log-${this._logId}`,
      severity,
      title,
      detail,
      timeMin: round(this.timeMin, 2),
      triggeredAt: this.elapsedLabel,
      gameClock: this.clockLabel,
    };
    this.logs.push(entry);
    if (this.logs.length > 160) this.logs.shift();
    return entry;
  }

  getFingerprint() {
    return {
      seed: this.seed,
      weather: this.weatherSegments.map((segment) => ({
        sequence: segment.sequence,
        type: segment.type,
        label: segment.label,
        start: round(segment.start, 3),
        duration: round(segment.duration, 3),
        temp: round(segment.temp, 3),
        flow: round(segment.flow, 3),
        turbidity: round(segment.turbidity, 3),
      })),
      targets: this.targets.map((target) => ({
        id: target.id,
        x: target.x,
        y: target.y,
        fishCount: target.fishCount,
        label: target.label,
      })),
    };
  }

  getView() {
    const weather = this.weatherAt(this.timeMin);
    const completedTargets = this.targets.filter((target) => target.status !== "pending").length;
    const nextTarget = this.targets.find((target) => target.status === "pending") || null;
    const observationDelta = {
      temperature: round(this.observed.temperature - this.actual.tempDiff, 2),
      waterLevel: round(this.observed.waterLevel - this.actual.waterLevel, 2),
      flow: round(this.observed.flow - this.actual.flow, 2),
      pollution: round(this.observed.pollution - this.actual.pollution, 1),
      oxygen: round(this.observed.oxygen - this.actual.oxygen, 2),
    };
    return {
      seed: this.seed,
      version: 1,
      timeMin: round(this.timeMin, 2),
      clock: this.clockLabel,
      elapsed: this.elapsedLabel,
      weather,
      weatherForecast: this.nextWeatherSegments(4),
      targets: this.targets.map((target) => ({ ...target })),
      targetCount: GAME.batchCount,
      completedTargets,
      nextTarget: nextTarget ? { ...nextTarget } : null,
      actual: {
        estuaryTemp: round(this.actual.estuaryTemp, 2),
        releaseTemp: round(this.actual.releaseTemp, 2),
        tempDiff: round(this.actual.tempDiff, 2),
        waterLevel: round(this.actual.waterLevel, 2),
        flow: round(this.actual.flow, 2),
        pollution: round(this.actual.pollution, 1),
        oxygen: round(this.actual.oxygen, 2),
        speciesCount: round(this.actual.speciesCount, 1),
      },
      observed: {
        temperature: round(this.observed.temperature, 2),
        estuaryTemp: round(this.observed.estuaryTemp, 2),
        releaseTemp: round(this.observed.releaseTemp, 2),
        waterLevel: round(this.observed.waterLevel, 2),
        flow: round(this.observed.flow, 2),
        pollution: round(this.observed.pollution, 1),
        oxygen: round(this.observed.oxygen, 2),
        species: round(this.observed.species, 1),
      },
      observationDelta,
      alarms: { ...this.alarms },
      actualAlarms: { ...this.actualAlarms },
      overallAlarm: this.overallAlarm,
      controls: { ...this.controls },
      batches: this.batches.map((batch) => ({ ...batch })),
      activeBatch: this.activeBatch ? { ...this.activeBatch } : null,
      targetCountRemaining: GAME.batchCount - this.batches.length,
      missionComplete: this.missionComplete,
      missionSuccess: this.missionSuccess,
      failureCount: this.failureCount,
      steadyRecorded: this._steadyRecorded,
      criticalEvent: this.criticalEvent ? { ...this.criticalEvent } : null,
      recoveryWatch: this.recoveryWatch ? { ...this.recoveryWatch } : null,
      events: this.events.map((event) => ({ ...event })),
      logs: this.logs.slice(-80).map((entry) => ({ ...entry })),
      telemetry: (this.telemetry || []).slice(-80).map((point) => ({ ...point })),
      soundModel: {
        temperature: clamp((this.actual.estuaryTemp - 14) / 12, 0, 1),
        flow: clamp((this.actual.flow - 0.4) / 2.6, 0, 1),
        alarm: this.overallAlarm,
        active: Boolean(this.activeBatch),
      },
    };
  }
}

function fingerprintKey(simulation) {
  return JSON.stringify(simulation.getFingerprint());
}

export function runAcceptance(seed = GAME.seedDefault) {
  const checks = [];
  const stableSim = new EstuarySimulation({ seed });
  stableSim.advance(6);
  checks.push({
    id: "steady",
    label: "稳态窗口",
    passed: Boolean(stableSim.events.find((event) => event.type === "steady")),
    detail: stableSim.events.find((event) => event.type === "steady")
      ? `确认于 ${stableSim.events.find((event) => event.type === "steady").triggeredAt}`
      : "6 分钟内未形成稳态",
  });

  const criticalSim = new EstuarySimulation({ seed });
  criticalSim.advance(55);
  const criticalEvent = criticalSim.events.find((event) => event.type === "critical");
  const thresholdCrossed = (() => {
    if (!criticalEvent || criticalEvent.measured === null || criticalEvent.threshold === null) {
      return false;
    }
    const limit = ALARM_LIMITS[criticalEvent.trigger];
    return limit?.direction === "low"
      ? criticalEvent.measured <= criticalEvent.threshold
      : criticalEvent.measured >= criticalEvent.threshold;
  })();
  checks.push({
    id: "threshold",
    label: "临界阈值",
    passed: Boolean(criticalEvent && thresholdCrossed),
    detail: criticalEvent
      ? `${criticalEvent.trigger} 观测 ${criticalEvent.measured} / 阈值 ${criticalEvent.threshold} · ${criticalEvent.triggeredAt}`
      : "未触发临界阈值",
  });

  const recoveryEvent = criticalSim.events.find((event) => event.type === "recovery");
  checks.push({
    id: "recovery",
    label: "固定恢复观察",
    passed: Boolean(
      recoveryEvent &&
        recoveryEvent.meta?.watchMinutes === GAME.recoveryWatchMinutes &&
        recoveryEvent.after,
    ),
    detail: recoveryEvent
      ? `${GAME.recoveryWatchMinutes} 分钟结束 · 污染残留 ${recoveryEvent.meta.pollutionResidue}`
      : "未完成固定恢复观察",
  });

  const failureSim = new EstuarySimulation({ seed });
  let weatherGuard = 0;
  while (failureSim.weatherAt(failureSim.timeMin).type !== "storm" && weatherGuard < 3000) {
    failureSim.step();
    weatherGuard += 1;
  }
  failureSim.setControls({ mixTemp: 26, releaseX: 0.08, gateSpeed: 2.8 });
  const failedBatch = failureSim.startBatch();
  if (failedBatch) {
    failureSim.advance(failedBatch.duration + 0.2);
    while (failureSim.activeBatch && failureSim.timeMin < 80) failureSim.step();
  }
  const failureEvent = failureSim.events.find((event) => event.type === "failure");
  checks.push({
    id: "failure",
    label: "处置失败与对比",
    passed: Boolean(
      failureEvent &&
        failureEvent.measured < GAME.survivalThreshold &&
        failureEvent.before &&
        failureEvent.after,
    ),
    detail: failureEvent
      ? `存活率 ${(failureEvent.measured * 100).toFixed(1)}% · 物种 ${failureEvent.before.species}→${failureEvent.after.species} · ${failureEvent.triggeredAt}`
      : "未产生处置失败记录",
  });

  const replayA = new EstuarySimulation({ seed });
  const replayB = new EstuarySimulation({ seed });
  replayA.advance(12);
  replayB.advance(12);
  const fingerprintA = fingerprintKey(replayA);
  const fingerprintB = fingerprintKey(replayB);
  const stateA = replayA.weatherAt(12);
  const stateB = replayB.weatherAt(12);
  const targetA = JSON.stringify(replayA.targets.map(({ x, y, fishCount }) => ({ x, y, fishCount })));
  const targetB = JSON.stringify(replayB.targets.map(({ x, y, fishCount }) => ({ x, y, fishCount })));
  checks.push({
    id: "replay",
    label: "同 seed 复现",
    passed:
      fingerprintA === fingerprintB &&
      targetA === targetB &&
      stateA.sequence === stateB.sequence &&
      replayA.observed.temperature === replayB.observed.temperature,
    detail: `天气 #${stateA.sequence} ${stateA.label} · 目标 ${replayA.targets.map((target) => `${Math.round(target.x * 100)}%`).join(" / ")}`,
  });

  const allEvents = [...stableSim.events, ...criticalSim.events, ...failureSim.events];
  checks.push({
    id: "timestamps",
    label: "触发时刻完整",
    passed: allEvents.every(
      (event) => Boolean(event.triggeredAt) && Boolean(event.gameClock) && Number.isFinite(event.timeMin),
    ),
    detail: `${allEvents.length} 条事件均包含 T+ 时刻与游戏时钟`,
  });

  return {
    seed,
    passed: checks.every((check) => check.passed),
    checks,
    critical: criticalEvent
      ? {
          metric: criticalEvent.trigger,
          threshold: criticalEvent.threshold,
          measured: criticalEvent.measured,
          triggeredAt: criticalEvent.triggeredAt,
          gameClock: criticalEvent.gameClock,
        }
      : null,
    failure: failureEvent
      ? {
          survival: failureEvent.measured,
          threshold: GAME.survivalThreshold,
          triggeredAt: failureEvent.triggeredAt,
          comparison: {
            before: failureEvent.before,
            after: failureEvent.after,
          },
        }
      : null,
    replay: {
      weather: replayA.weatherSegments.map((segment) => `${segment.label}@${segment.start.toFixed(1)}`),
      targets: replayA.targets.map((target) => ({
        id: target.id,
        x: target.x,
        fishCount: target.fishCount,
      })),
    },
  };
}
