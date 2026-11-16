export const CONFIG = Object.freeze({
  daySeconds: 18,
  totalDays: 10,
  fixedStep: 0.05,
  sensorDelay: 1.8,
  sensorInterval: 0.4,
  warningLevel: 4.3,
  criticalLevel: 4.43,
  roadLevel: 4.58,
  shallowBed: 3.82,
  shallowMin: 0.15,
  shallowMax: 0.58,
  initialLevel: 4.12,
  initialSpillway: 0.34,
  initialStakes: 0.36,
  handlingWindow: 7,
  recoveryWatch: 12,
  targetStressLimit: 9,
  steadyWindow: 8,
  recoveryMinLevel: 3.95
});

export const TOTAL_SECONDS = CONFIG.daySeconds * CONFIG.totalDays;

const LEVEL_MIN = 3.76;
const LEVEL_MAX = 5.08;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, digits = 3) => Number(value.toFixed(digits));

export function hashSeed(input) {
  const text = String(input);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothstep(value) {
  const clamped = clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function bump(day, storm) {
  if (day <= storm.start || day >= storm.end) return 0;
  if (day <= storm.peak) {
    return smoothstep((day - storm.start) / (storm.peak - storm.start));
  }
  return smoothstep((storm.end - day) / (storm.end - storm.peak));
}

function shortHash(value) {
  return hashSeed(value).toString(16).toUpperCase().padStart(8, "0");
}

function makeWeather(seed) {
  const random = mulberry32(hashSeed(`${seed}:weather`));
  const days = Array.from({ length: CONFIG.totalDays }, (_, index) => ({
    index,
    rain: round(0.025 + random() * 0.13),
    temperature: round(15.5 + random() * 6.5, 1),
    wind: round(1.2 + random() * 3.8, 1),
    cloud: round(0.3 + random() * 0.55)
  }));
  const storms = [
    {
      id: "storm-a",
      start: 2.72 + random() * 0.16,
      peak: 3.3 + random() * 0.2,
      end: 4.08 + random() * 0.22,
      intensity: 1.08 + random() * 0.14
    },
    {
      id: "storm-b",
      start: 6.52 + random() * 0.14,
      peak: 7.12 + random() * 0.18,
      end: 7.86 + random() * 0.18,
      intensity: 1.02 + random() * 0.2
    }
  ];
  const beaverEvents = [
    { id: "repair-a", start: 1.55 + random() * 0.18, end: 1.92 + random() * 0.2, strength: 1 },
    { id: "repair-b", start: 5.18 + random() * 0.22, end: 5.62 + random() * 0.2, strength: 0.92 },
    { id: "repair-c", start: 8.55 + random() * 0.2, end: 8.96 + random() * 0.18, strength: 1 }
  ];
  return { days, storms, beaverEvents };
}

function makeTargets(seed) {
  const random = mulberry32(hashSeed(`${seed}:targets`));
  const birds = Array.from({ length: 4 }, (_, index) => ({
    id: `bird-${index + 1}`,
    type: "bird",
    label: `鸟巢 ${index + 1}`,
    x: round(0.57 + index * 0.095 + (random() - 0.5) * 0.026, 4),
    depthOffset: round((random() - 0.5) * 0.025, 4),
    threshold: round(4.338 + random() * 0.099, 3)
  }));
  const lodges = Array.from({ length: 2 }, (_, index) => ({
    id: `lodge-${index + 1}`,
    type: "lodge",
    label: `河狸巢 ${index + 1}`,
    x: round(0.15 + index * 0.13 + (random() - 0.5) * 0.035, 4),
    minLevel: round(3.92 + random() * 0.07, 3)
  }));
  return { birds, lodges };
}

function digestWeather(weather) {
  return shortHash(JSON.stringify(weather));
}

function digestTargets(targets) {
  return shortHash(JSON.stringify(targets));
}

function classifyLevel(level) {
  if (level >= CONFIG.criticalLevel) return "critical";
  if (level >= CONFIG.warningLevel) return "warning";
  return "normal";
}

function alertRank(value) {
  return value === "critical" ? 2 : value === "warning" ? 1 : 0;
}

function weatherLabel(rain, storm) {
  if (storm > 0.52) return { icon: "☔", label: "强降雨", detail: "来水快速增加" };
  if (storm > 0.18 || rain > 0.54) return { icon: "☂", label: "阵雨", detail: "来水偏高" };
  if (rain > 0.3) return { icon: "☁", label: "阴有小雨", detail: "来水轻微上升" };
  if (rain > 0.14) return { icon: "☁", label: "多云", detail: "来水基本平稳" };
  return { icon: "◐", label: "晴间多云", detail: "来水偏低" };
}

export class WetlandSim {
  constructor({ seed = 82417, running = true } = {}) {
    this.reset(seed, { running });
  }

  reset(seed = this.seed, { running = true } = {}) {
    this.seed = String(seed);
    this.weatherLayout = makeWeather(this.seed);
    this.targetLayout = makeTargets(this.seed);
    this.targetBlueprint = JSON.parse(JSON.stringify(this.targetLayout));
    this.weatherDigest = digestWeather(this.weatherLayout);
    this.targetDigest = digestTargets(this.targetLayout);
    this.signature = shortHash(`${this.weatherDigest}:${this.targetDigest}:${this.seed}`);

    this.elapsed = 0;
    this.day = 0;
    this.running = running;
    this.completed = false;
    this.level = CONFIG.initialLevel;
    this.previousLevel = this.level;
    this.levelRate = 0;
    this.inflow = 6.25;
    this.outflow = 6.25;
    this.turbidity = 8.2;
    this.temperature = this.weatherLayout.days[0].temperature;
    this.dissolvedOxygen = 9;
    this.rain = 0;
    this.storm = 0;
    this.stormIntensity = 0;
    this.controls = {
      spillway: CONFIG.initialSpillway,
      stakes: CONFIG.initialStakes
    };
    this.desiredControls = { ...this.controls };
    this.targets = JSON.parse(JSON.stringify(this.targetLayout));
    this.targets.birds = this.targets.birds.map((target) => ({
      ...target,
      alive: true,
      safe: true,
      stress: 0,
      status: "safe"
    }));
    this.targets.lodges = this.targets.lodges.map((target) => ({
      ...target,
      alive: true,
      safe: true,
      stress: 0,
      status: "safe"
    }));

    this.beaver = { activity: 0, active: false, event: null };
    this.observed = {
      level: this.level,
      flow: this.inflow,
      turbidity: this.turbidity,
      dissolvedOxygen: this.dissolvedOxygen,
      rain: 0,
      at: 0,
      age: 0
    };
    this.sensorRandom = mulberry32(hashSeed(`${this.seed}:sensor`));
    this.sensorQueue = [];
    this.sensorClock = 0;
    this._pushSensorSample(0);

    this.history = [];
    this.historyClock = 0;
    this._recordHistory();
    this.logs = [];
    this.logSequence = 0;
    this.incident = null;
    this.recovery = null;
    this.pendingComparisons = [];
    this.lastComparison = null;
    this.steadySeconds = 0;
    this.lastStormActive = false;
    this.lastBeaverActive = false;
    this.lastRoadFlooded = false;
    this.stats = {
      steadyAt: null,
      stormAt: null,
      criticalAt: null,
      failureAt: null,
      recoveryPassAt: null,
      recoveryFailAt: null,
      lastInterventionAt: null,
      completedAt: null,
      maxLevel: this.level,
      minLevel: this.level,
      maxTurbidity: this.turbidity,
      roadFloodSeconds: 0,
      roadCriticalAt: null,
      interventions: 0,
      failures: 0,
      successes: 0,
      failure: false
    };
    this._updateTargets(0);
    this._updateWeather();
    this._updateAlerts();
    this.addLog("system", "调度会话启动", `seed ${this.seed} · 天气 ${this.weatherDigest} · 目标 ${this.targetDigest}`);
    return this;
  }

  setRunning(running) {
    if (this.completed) return;
    this.running = Boolean(running);
  }

  advance(seconds) {
    let remaining = Math.max(0, Number(seconds) || 0);
    while (remaining > 1e-9 && !this.completed) {
      if (!this.running) break;
      const dt = Math.min(CONFIG.fixedStep, remaining);
      this._tick(dt);
      remaining -= dt;
    }
    return this;
  }

  _tick(dt) {
    this.elapsed = Math.min(TOTAL_SECONDS, this.elapsed + dt);
    this.day = this.elapsed / CONFIG.daySeconds;
    this.previousLevel = this.level;
    this._updateWeather();
    this._updateControls(dt);
    this._updateBeaver(dt);
    this._updateWater(dt);
    this._updateTargets(dt);
    this._updateSensors(dt);
    this._updateAlerts();
    this._evaluateEvents(dt);
    this._processComparisons();
    this.historyClock += dt;
    if (this.historyClock >= 0.2) {
      this.historyClock %= 0.2;
      this._recordHistory();
    }
    this.stats.maxLevel = Math.max(this.stats.maxLevel, this.level);
    this.stats.minLevel = Math.min(this.stats.minLevel, this.level);
    this.stats.maxTurbidity = Math.max(this.stats.maxTurbidity, this.turbidity);
    if (this.elapsed >= TOTAL_SECONDS - 1e-9) this._finish();
  }

  _updateWeather() {
    const weather = this.weatherLayout;
    const index = Math.min(CONFIG.totalDays - 1, Math.floor(this.day));
    const nextIndex = Math.min(CONFIG.totalDays - 1, index + 1);
    const fraction = smoothstep(this.day - index);
    const baseRain = weather.days[index].rain
      + (weather.days[nextIndex].rain - weather.days[index].rain) * fraction;
    let storm = 0;
    let intensity = 0;
    for (const item of weather.storms) {
      const amount = bump(this.day, item);
      if (amount > storm) {
        storm = amount;
        intensity = item.intensity;
      }
    }
    this.rain = round(clamp(baseRain * 0.7 + storm * 0.96, 0, 1), 3);
    this.storm = round(storm, 3);
    this.stormIntensity = intensity;
    this.weather = {
      ...weatherLabel(this.rain, this.storm),
      rain: this.rain,
      storm: this.storm,
      intensity,
      day: this.day
    };
  }

  _updateControls(dt) {
    for (const key of ["spillway", "stakes"]) {
      const current = this.controls[key];
      const desired = this.desiredControls[key];
      const rate = key === "spillway" ? 0.55 : 0.8;
      const step = rate * dt;
      this.controls[key] = clamp(
        current + clamp(desired - current, -step, step),
        0,
        1
      );
    }
  }

  _updateBeaver(dt) {
    let activity = 0;
    let activeEvent = null;
    for (const event of this.weatherLayout.beaverEvents) {
      if (this.day >= event.start && this.day <= event.end) {
        const span = Math.max(0.001, event.end - event.start);
        const phase = (this.day - event.start) / span;
        const value = Math.sin(Math.PI * clamp(phase, 0, 1)) * event.strength;
        if (value > activity) {
          activity = value;
          activeEvent = event;
        }
      }
    }
    const target = smoothstep(activity);
    this.beaver.activity += (target - this.beaver.activity) * Math.min(1, dt * 2.6);
    this.beaver.active = this.beaver.activity > 0.12;
    this.beaver.event = activeEvent;
  }

  _updateWater(dt) {
    const stakeEffect = this.controls.stakes;
    const beaverFactor = 1 - 0.31 * this.beaver.activity * (1 - 0.72 * stakeEffect);
    const stormFlow = this.storm * this.stormIntensity * 7.6;
    this.inflow = 6.22 + this.rain * 1.05 + stormFlow;
    const gate = this.controls.spillway * beaverFactor;
    const rawOutflow = 2.9 + gate * 9.8 + (this.level - 4.08) * 16 + (1 - stakeEffect) * 0.18;
    this.outflow = clamp(rawOutflow, 1.1, 19);
    const net = this.inflow - this.outflow;
    const nextLevel = clamp(this.level + (net / 170) * dt, LEVEL_MIN, LEVEL_MAX);
    this.levelRate = 0.72 * this.levelRate + 0.28 * ((nextLevel - this.level) / dt);
    this.level = nextLevel;

    const turbidityTarget = 7.2
      + this.storm * this.stormIntensity * 18
      + Math.max(0, this.inflow - 8) * 1.35
      + (1 - stakeEffect) * 4.8
      + this.beaver.activity * 2.1;
    this.turbidity += (turbidityTarget - this.turbidity) * Math.min(1, dt / 6.5);
    const temperatureTarget = this.weatherLayout.days[
      Math.min(CONFIG.totalDays - 1, Math.floor(this.day))
    ].temperature + this.storm * 1.4;
    this.temperature += (temperatureTarget - this.temperature) * Math.min(1, dt / 18);
    const oxygenTarget = 10.15
      - this.temperature * 0.075
      - this.turbidity * 0.034
      + Math.max(-0.2, this.level - 4.08) * 0.18;
    this.dissolvedOxygen += (oxygenTarget - this.dissolvedOxygen) * Math.min(1, dt / 7);
  }

  _updateTargets(dt) {
    for (const target of [...this.targets.birds, ...this.targets.lodges]) {
      if (!target.alive) {
        target.safe = false;
        target.status = "lost";
        continue;
      }
      if (target.type === "bird") {
        target.safe = this.level <= target.threshold && this.turbidity < 52;
        target.status = target.safe ? "safe" : this.level > target.threshold ? "flooded" : "polluted";
      } else {
        target.safe = this.level >= target.minLevel && this.turbidity < 52;
        target.status = target.safe ? "safe" : this.level < target.minLevel ? "dry" : "polluted";
      }
      if (target.safe) {
        target.stress = Math.max(0, target.stress - dt * 1.5);
      } else {
        target.stress += dt;
        if (target.stress >= CONFIG.targetStressLimit) target.alive = false;
      }
    }

    this.birdsAlive = this.targets.birds.filter((target) => target.alive).length;
    this.lodgesAlive = this.targets.lodges.filter((target) => target.alive).length;
    this.birdsSafe = this.targets.birds.filter((target) => target.safe).length;
    this.lodgesSafe = this.targets.lodges.filter((target) => target.safe).length;
    this.safeTargets = this.birdsSafe + this.lodgesSafe;
    this.aliveTargets = this.birdsAlive + this.lodgesAlive;

    this.depth = this.level - CONFIG.shallowBed;
    const depthSafe = this.depth >= CONFIG.shallowMin && this.depth <= CONFIG.shallowMax;
    const birdHabitatSafe = depthSafe && this.turbidity < 45 && this.birdsAlive > 0;
    const beaverHabitatSafe = this.lodgesAlive > 0
      && this.lodgesSafe > 0
      && this.dissolvedOxygen > 4.5;
    this.effectiveRoadLevel = CONFIG.roadLevel + this.controls.stakes * 0.07;
    this.roadClearance = this.effectiveRoadLevel - this.level;
    if (this.roadClearance < 0) this.stats.roadFloodSeconds += dt;
    const roadFlooded = this.roadClearance < 0;
    if (roadFlooded && !this.lastRoadFlooded) {
      this.stats.roadCriticalAt = this.elapsed;
      this.addLog(
        "critical",
        "道路淹没临界阈值",
        `实际 ${this.level.toFixed(3)} m ≥ 道路阈值 ${this.effectiveRoadLevel.toFixed(3)} m · 木桩防护 +${(this.controls.stakes * 0.07).toFixed(2)} m`,
        "critical",
        {
          threshold: round(this.effectiveRoadLevel),
          trigger: "road-flood"
        }
      );
    }
    this.lastRoadFlooded = roadFlooded;

    const shallowStatus = !depthSafe
      ? this.depth < CONFIG.shallowMin ? "dry" : "deep"
      : this.turbidity >= 45 ? "polluted" : birdHabitatSafe ? "safe" : "warning";
    this.habitats = {
      bird: {
        safe: birdHabitatSafe,
        status: shallowStatus,
        depth: this.depth,
        label: `水深 ${round(this.depth, 2)} m · ${this.birdsSafe} 巢安全`
      },
      beaver: {
        safe: beaverHabitatSafe,
        status: beaverHabitatSafe ? "safe" : this.lodgesSafe === 0 ? "dry" : "warning",
        label: `池塘连通 · ${this.lodgesSafe} 巢安全`
      },
      road: {
        safe: this.roadClearance >= 0.04,
        status: this.roadClearance < 0 ? "flooded" : this.roadClearance < 0.1 ? "warning" : "safe",
        label: `净空 ${Math.abs(this.roadClearance).toFixed(2)} m · ${this.roadClearance < 0 ? "已淹没" : "可通行"}`
      }
    };
  }

  _pushSensorSample(at) {
    const noise = () => this.sensorRandom() - 0.5;
    this.sensorQueue.push({
      at,
      level: this.level + noise() * 0.024,
      flow: this.inflow + noise() * 0.42,
      turbidity: Math.max(0, this.turbidity + noise() * 0.85),
      dissolvedOxygen: this.dissolvedOxygen + noise() * 0.16,
      rain: Math.max(0, this.rain + noise() * 0.025)
    });
  }

  _updateSensors(dt) {
    this.sensorClock += dt;
    if (this.sensorClock >= CONFIG.sensorInterval - 1e-9) {
      this.sensorClock %= CONFIG.sensorInterval;
      this._pushSensorSample(this.elapsed);
    }
    const cutoff = this.elapsed - CONFIG.sensorDelay;
    while (this.sensorQueue.length > 1 && this.sensorQueue[1].at <= cutoff) {
      this.sensorQueue.shift();
    }
    const sample = this.sensorQueue[0];
    const age = Math.max(0, this.elapsed - sample.at);
    this.observed = {
      level: sample.level,
      flow: sample.flow,
      turbidity: sample.turbidity,
      dissolvedOxygen: sample.dissolvedOxygen,
      rain: sample.rain,
      at: sample.at,
      age
    };
  }

  _updateAlerts() {
    const actual = classifyLevel(this.level);
    const observed = classifyLevel(this.observed.level);
    const combined = alertRank(actual) >= alertRank(observed) ? actual : observed;
    this.alerts = { actual, observed, combined };
    this.actualAlertLabel = actual === "critical" ? "临界" : actual === "warning" ? "注意" : "正常";
    this.observedAlertLabel = observed === "critical" ? "临界" : observed === "warning" ? "注意" : "正常";
  }

  _evaluateEvents(dt) {
    const stormActive = this.storm > 0.12;
    if (stormActive && !this.lastStormActive) {
      const storm = this.weatherLayout.storms.find((item) => bump(this.day, item) === this.storm);
      this.stats.stormAt = this.elapsed;
      this.addLog(
        "weather",
        "暴雨锋面到达",
        `预计来水 +${round((storm?.intensity || 1) * 7.6 * 0.7, 1)} m³/s · 溢流口当前 ${Math.round(this.controls.spillway * 100)}%`,
        "warning",
        { stormStart: storm?.start, stormPeak: storm?.peak }
      );
    } else if (!stormActive && this.lastStormActive) {
      this.addLog("weather", "暴雨减弱", "来水开始回落，进入恢复观察窗口", "info");
    }
    this.lastStormActive = stormActive;

    const beaverActive = this.beaver.active;
    if (beaverActive && !this.lastBeaverActive) {
      this.addLog(
        "beaver",
        "河狸开始修补坝体",
        `木桩护岸 ${Math.round(this.controls.stakes * 100)}% · 溢流效率暂时下降`,
        "info"
      );
    } else if (!beaverActive && this.lastBeaverActive) {
      this.addLog("beaver", "河狸修补暂歇", "坝体缺口已重新蓄水", "info");
    }
    this.lastBeaverActive = beaverActive;

    const allSafe = this.aliveTargets === 6 && this.safeTargets === 6;
    const steady = this.alerts.actual === "normal"
      && this.level >= 4.03
      && this.level <= 4.28
      && Math.abs(this.levelRate) < 0.004
      && this.turbidity < 25
      && allSafe
      && !this.incident;
    this.steadySeconds = steady ? this.steadySeconds + dt : 0;
    if (this.steadySeconds >= CONFIG.steadyWindow && !this.stats.steadyAt) {
      this.stats.steadyAt = this.elapsed;
      this.addLog(
        "steady",
        "稳态窗口确认",
        `${CONFIG.steadyWindow.toFixed(0)} 秒内水位波动 < 0.004 m/s · 6 个目标安全`,
        "success",
        { windowSeconds: CONFIG.steadyWindow }
      );
    }

    if (!this.incident && this.alerts.actual !== "normal") {
      this.incident = {
        startedAt: this.elapsed,
        startLevel: this.level,
        startTurbidity: this.turbidity,
        startSafeTargets: this.safeTargets,
        startAliveTargets: this.aliveTargets,
        startControls: { ...this.controls },
        evaluationAt: this.elapsed + CONFIG.handlingWindow,
        evaluated: false,
        criticalLogged: false
      };
      this.addLog(
        "threshold",
        this.alerts.actual === "critical" ? "巢穴临界阈值触发" : "水位注意阈值触发",
        `实际 ${this.level.toFixed(3)} m · 注意阈值 ${CONFIG.warningLevel} m · 观测 ${this.observed.level.toFixed(3)} m`,
        "warning",
        { threshold: CONFIG.warningLevel }
      );
    }

    if (this.incident && this.alerts.actual === "critical" && !this.incident.criticalLogged) {
      this.incident.criticalLogged = true;
      this.stats.criticalAt = this.elapsed;
      const affected = [...this.targets.birds, ...this.targets.lodges].filter((target) => !target.safe);
      this.addLog(
        "critical",
        "越过高水位临界阈值",
        `实际 ${this.level.toFixed(3)} m ≥ ${CONFIG.criticalLevel} m · ${affected.length} 个目标受威胁`,
        "critical",
        {
          threshold: CONFIG.criticalLevel,
          affectedTargets: affected.map((target) => target.id)
        }
      );
    }

    if (this.incident && !this.incident.evaluated && this.elapsed >= this.incident.evaluationAt) {
      this.incident.evaluated = true;
      const stillElevated = this.alerts.actual !== "normal";
      const targetLoss = this.incident.startSafeTargets - this.safeTargets;
      const failed = stillElevated || targetLoss > 0 || this.aliveTargets < this.incident.startAliveTargets;
      if (failed) {
        this.stats.failureAt = this.elapsed;
        this.stats.failure = true;
        this.stats.failures += 1;
        this.addLog(
          "failure",
          "处置失败：水位仍超阈值",
          `实际 ${this.incident.startLevel.toFixed(2)} → ${this.level.toFixed(2)} m · 安全目标 ${this.incident.startSafeTargets} → ${this.safeTargets}`,
          "failure",
          {
            reason: stillElevated ? "elevated-level" : "target-loss",
            elapsedAfterIncident: round(this.elapsed - this.incident.startedAt, 2),
            before: {
              level: round(this.incident.startLevel),
              safeTargets: this.incident.startSafeTargets,
              turbidity: round(this.incident.startTurbidity, 2)
            }
          }
        );
      } else {
        this.stats.successes += 1;
        this.addLog(
          "action",
          "处置评估通过",
          `水位回落至 ${this.level.toFixed(2)} m · ${this.safeTargets} / 6 目标安全`,
          "success",
          { elapsedAfterIncident: round(this.elapsed - this.incident.startedAt, 2) }
        );
      }
    }

    if (this.incident?.evaluated && !this.recovery
      && this.alerts.actual === "normal" && this.level <= CONFIG.warningLevel - 0.045) {
      this.recovery = {
        startedAt: this.elapsed,
        remaining: CONFIG.recoveryWatch,
        levelAtStart: this.level,
        peakLevel: this.level
      };
      this.addLog(
        "recovery",
        "进入恢复观察",
        `水位 ${this.level.toFixed(2)} m · 固定观察 ${CONFIG.recoveryWatch} 秒，检查水位与目标是否残留越界`,
        "info",
        { watchSeconds: CONFIG.recoveryWatch }
      );
    }

    if (this.recovery) {
      this.recovery.remaining = Math.max(0, this.recovery.remaining - dt);
      this.recovery.peakLevel = Math.max(this.recovery.peakLevel, this.level);
      if (this.alerts.actual !== "normal") {
        this.stats.recoveryFailAt = this.elapsed;
        this.stats.recoveryPassAt = null;
        this.addLog(
          "failure",
          "恢复观察发现高水位残留反弹",
          `观察 ${(CONFIG.recoveryWatch - this.recovery.remaining).toFixed(1)} 秒后水位回升至 ${this.level.toFixed(2)} m`,
          "failure",
          {
            reason: "residual-rebound",
            watchElapsed: round(CONFIG.recoveryWatch - this.recovery.remaining, 2)
          }
        );
        this.recovery = null;
        this.incident = null;
      } else if (this.level < CONFIG.recoveryMinLevel) {
        this.stats.recoveryFailAt = this.elapsed;
        this.stats.recoveryPassAt = null;
        this.addLog(
          "failure",
          "恢复观察发现浅水生境抽干",
          `观察 ${(CONFIG.recoveryWatch - this.recovery.remaining).toFixed(1)} 秒后水位降至 ${this.level.toFixed(3)} m · 下限 ${CONFIG.recoveryMinLevel} m`,
          "failure",
          {
            reason: "shallow-drawdown",
            watchElapsed: round(CONFIG.recoveryWatch - this.recovery.remaining, 2),
            threshold: CONFIG.recoveryMinLevel
          }
        );
        this.recovery = null;
        this.incident = null;
      } else if (this.safeTargets < 6) {
        this.stats.recoveryFailAt = this.elapsed;
        this.stats.recoveryPassAt = null;
        this.addLog(
          "failure",
          "恢复观察发现目标持续受威胁",
          `观察 ${(CONFIG.recoveryWatch - this.recovery.remaining).toFixed(1)} 秒后仍有 ${6 - this.safeTargets} 个目标不安全`,
          "failure",
          {
            reason: "target-residual",
            watchElapsed: round(CONFIG.recoveryWatch - this.recovery.remaining, 2)
          }
        );
        this.recovery = null;
        this.incident = null;
      } else if (this.recovery.remaining <= 1e-9) {
        this.stats.recoveryPassAt = this.elapsed;
        this.addLog(
          "recovery",
          "恢复观察通过",
          `连续 ${CONFIG.recoveryWatch} 秒水位处于安全带且 6 个目标安全 · 峰值 ${this.recovery.peakLevel.toFixed(2)} m`,
          "success",
          {
            watchSeconds: CONFIG.recoveryWatch,
            peakLevel: round(this.recovery.peakLevel)
          }
        );
        this.recovery = null;
        this.incident = null;
      }
    }
  }

  addLog(type, title, detail, severity = "info", extra = {}) {
    const entry = {
      id: ++this.logSequence,
      type,
      severity,
      title,
      detail,
      simTime: round(this.elapsed, 2),
      day: round(this.day, 2),
      clock: this.clockLabel(),
      recordedAt: new Date().toISOString(),
      snapshot: this._snapshot(),
      ...extra
    };
    this.logs.push(entry);
    if (this.logs.length > 160) this.logs.splice(0, this.logs.length - 160);
    return entry;
  }

  clockLabel() {
    const dayFraction = this.day - Math.floor(this.day);
    const totalMinutes = Math.floor(dayFraction * 24 * 60);
    const hour = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
    const minute = String(totalMinutes % 60).padStart(2, "0");
    return `第 ${Math.min(CONFIG.totalDays, Math.floor(this.day) + 1)} 天 · ${hour}:${minute}`;
  }

  _snapshot() {
    return {
      level: round(this.level),
      observedLevel: round(this.observed?.level ?? this.level),
      turbidity: round(this.turbidity, 2),
      inflow: round(this.inflow, 2),
      safeTargets: this.safeTargets ?? 6,
      aliveTargets: this.aliveTargets ?? 6,
      birdsAlive: this.birdsAlive ?? 4,
      lodgesAlive: this.lodgesAlive ?? 2,
      spillway: round(this.controls.spillway),
      stakes: round(this.controls.stakes),
      alert: this.alerts?.actual ?? "normal"
    };
  }

  applyControls({ spillway, stakes }) {
    const nextSpillway = clamp(Number(spillway), 0, 1);
    const nextStakes = clamp(Number(stakes), 0, 1);
    if (!Number.isFinite(nextSpillway) || !Number.isFinite(nextStakes)) {
      throw new TypeError("Controls must be finite numbers between 0 and 1");
    }
    const changed = Math.abs(nextSpillway - this.desiredControls.spillway) > 0.002
      || Math.abs(nextStakes - this.desiredControls.stakes) > 0.002;
    if (!changed) return false;

    const before = this._snapshot();
    const previous = { ...this.desiredControls };
    this.desiredControls = { spillway: nextSpillway, stakes: nextStakes };
    this.stats.interventions += 1;
    this.stats.lastInterventionAt = this.elapsed;
    this.addLog(
      "action",
      "应用人工干预",
      `溢流口 ${Math.round(previous.spillway * 100)}% → ${Math.round(nextSpillway * 100)}% · 木桩 ${Math.round(previous.stakes * 100)}% → ${Math.round(nextStakes * 100)}%`,
      "info",
      {
        trigger: "operator",
        before,
        requested: { spillway: nextSpillway, stakes: nextStakes }
      }
    );
    this.pendingComparisons.push({
      dueAt: this.elapsed + 5,
      before,
      controls: { spillway: nextSpillway, stakes: nextStakes }
    });
    return true;
  }

  _processComparisons() {
    if (!this.pendingComparisons.length) return;
    const due = this.pendingComparisons.filter((item) => this.elapsed >= item.dueAt);
    if (!due.length) return;
    this.pendingComparisons = this.pendingComparisons.filter((item) => this.elapsed < item.dueAt);
    for (const item of due) {
      this.lastComparison = {
        at: round(this.elapsed, 2),
        day: round(this.day, 2),
        clock: this.clockLabel(),
        before: item.before,
        after: this._snapshot(),
        controls: item.controls
      };
    }
  }

  _recordHistory() {
    this.history.push({
      t: round(this.elapsed, 2),
      level: this.level,
      observed: this.observed?.level ?? this.level,
      warning: CONFIG.warningLevel,
      critical: CONFIG.criticalLevel,
      road: CONFIG.roadLevel
    });
    if (this.history.length > 280) this.history.shift();
  }

  _finish() {
    if (this.completed) return;
    this.completed = true;
    this.running = false;
    const birdHabitat = this.birdsAlive === this.targets.birds.length
      && this.birdsSafe === this.targets.birds.length
      && this.depth >= CONFIG.shallowMin - 0.03
      && this.depth <= CONFIG.shallowMax + 0.03
      && this.turbidity < 45;
    const beaverHabitat = this.lodgesAlive === this.targets.lodges.length
      && this.lodgesSafe === this.targets.lodges.length;
    const roadIntact = this.stats.roadFloodSeconds <= 1.5;
    const success = birdHabitat && beaverHabitat && roadIntact;
    this.result = {
      success,
      birdHabitat,
      beaverHabitat,
      roadIntact,
      birdsAlive: this.birdsAlive,
      lodgesAlive: this.lodgesAlive,
      roadFloodSeconds: round(this.stats.roadFloodSeconds, 2),
      level: round(this.level),
      turbidity: round(this.turbidity, 2)
    };
    this.stats.completedAt = this.elapsed;
    this.addLog(
      "result",
      success ? "十日验收通过" : "十日验收未通过",
      success
        ? `两类生境共存 · 道路累计淹没 ${this.result.roadFloodSeconds} 秒`
        : `鸟巢 ${this.birdsAlive}/4 · 河狸巢 ${this.lodgesAlive}/2 · 道路淹没 ${this.result.roadFloodSeconds} 秒`,
      success ? "success" : "critical",
      { result: this.result }
    );
  }

  getSignature() {
    return {
      seed: this.seed,
      weather: this.weatherDigest,
      targets: this.targetDigest,
      combined: this.signature
    };
  }

  getReproductionPayload() {
    return {
      seed: this.seed,
      weather: JSON.parse(JSON.stringify(this.weatherLayout)),
      targets: JSON.parse(JSON.stringify(this.targetBlueprint))
    };
  }

  getNextBeaverEvent() {
    return this.weatherLayout.beaverEvents.find((event) => event.start > this.day) ?? null;
  }

  getForecast() {
    const current = Math.floor(this.day);
    return this.weatherLayout.days
      .filter((day) => day.index >= current && day.index < current + 3)
      .map((day) => ({
        day: day.index + 1,
        rain: day.rain,
        temperature: day.temperature,
        label: day.rain > 0.34 ? "有雨" : day.rain > 0.17 ? "多云" : "晴"
      }));
  }
}
