export const DURATION = 120;
export const SAMPLE_UNLOCK = 12;
export const COMPARABLE_WINDOW = 32;
export const RECOVERY_DURATION = 8;
export const CANVAS_WIDTH = 1000;
export const CANVAS_HEIGHT = 900;

export const PLOTS = [
  { id: "A", name: "A 区", fertilizer: "腐熟牛粪", short: "牛粪", color: "#9ddc79" },
  { id: "B", name: "B 区", fertilizer: "蚯蚓堆肥", short: "蚯蚓", color: "#c6d779" },
  { id: "C", name: "C 区", fertilizer: "植物绿肥", short: "绿肥", color: "#e5bd72" },
];

export const PLOT_RECTS = {
  A: { x: 28, y: 76, w: 300, h: 320 },
  B: { x: 350, y: 76, w: 300, h: 320 },
  C: { x: 672, y: 76, w: 300, h: 320 },
};

export const THRESHOLDS = {
  temp: { warning: 30, critical: 34, direction: "high", label: "34°C" },
  humidity: { warning: 80, critical: 87, direction: "high", label: "87%" },
  water: { warning: 78, critical: 84, direction: "high", label: "84%" },
  contamination: { warning: 40, critical: 55, direction: "high", label: "55 CFU" },
};

export const METRICS = {
  temp: { label: "温度", unit: "°C", min: 16, max: 40, threshold: 34 },
  humidity: { label: "空气湿度", unit: "%", min: 40, max: 95, threshold: 87 },
  water: { label: "土壤水位", unit: "%", min: 28, max: 92, threshold: 84 },
  contamination: { label: "污染指数", unit: "CFU", min: 0, max: 85, threshold: 55 },
};

const WEATHER_KEYS = [
  { at: 0, temp: 22.8, humidity: 63, water: 58, contamination: 9 },
  { at: 16, temp: 23.7, humidity: 65, water: 56, contamination: 8 },
  { at: 28, temp: 26.2, humidity: 61, water: 51, contamination: 11 },
  { at: 36, temp: 33.8, humidity: 52, water: 44, contamination: 16 },
  { at: 42, temp: 36.8, humidity: 46, water: 39, contamination: 21 },
  { at: 50, temp: 32.4, humidity: 66, water: 55, contamination: 31 },
  { at: 60, temp: 30.7, humidity: 82, water: 73, contamination: 48 },
  { at: 68, temp: 29.9, humidity: 88, water: 84, contamination: 61 },
  { at: 78, temp: 27.2, humidity: 75, water: 72, contamination: 43 },
  { at: 90, temp: 25.6, humidity: 69, water: 61, contamination: 27 },
  { at: 105, temp: 24.9, humidity: 66, water: 57, contamination: 17 },
  { at: 120, temp: 24.5, humidity: 64, water: 55, contamination: 11 },
];

export const INTERVENTION_META = {
  irrigation: {
    label: "灌溉",
    duration: 10,
    effects: { temp: -1.4, humidity: 5, water: 14, contamination: 3 },
  },
  shade: {
    label: "遮阴",
    duration: 12,
    effects: { temp: -4.1, humidity: 2.5, water: 1, contamination: -1.5 },
  },
  ventilation: {
    label: "通风",
    duration: 8,
    effects: { temp: -0.8, humidity: -10, water: -2.5, contamination: -9 },
  },
};

export function normalizeSeed(seed) {
  const value = String(seed || "").trim().toUpperCase();
  return value || "MF-2407";
}

export function seedHash(seed) {
  const value = normalizeSeed(seed);
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed) {
  let state = typeof seed === "number" ? seed >>> 0 : seedHash(seed);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothNoise(seed, index, channel) {
  const random = mulberry32((seedHash(seed) ^ Math.imul(index + 1, 2654435761) ^ channel) >>> 0);
  return random() * 2 - 1;
}

function interpolate(a, b, t) {
  const amount = Math.max(0, Math.min(1, t));
  const eased = amount * amount * (3 - 2 * amount);
  return a + (b - a) * eased;
}

export function weatherAt(seed, time) {
  const safeTime = Math.max(0, Math.min(DURATION, time));
  let rightIndex = WEATHER_KEYS.findIndex((key) => key.at >= safeTime);
  if (rightIndex <= 0) rightIndex = 1;
  const left = WEATHER_KEYS[rightIndex - 1];
  const right = WEATHER_KEYS[rightIndex];
  const local = (safeTime - left.at) / (right.at - left.at);
  const noiseIndex = Math.floor(safeTime * 4);
  const drift = smoothNoise(seed, noiseIndex, 17);
  const pulse = Math.sin(safeTime * 0.31 + (seedHash(seed) % 29) * 0.17);
  return {
    temp: interpolate(left.temp, right.temp, local) + drift * 0.16 + pulse * 0.05,
    humidity: interpolate(left.humidity, right.humidity, local) + drift * 0.55,
    water: interpolate(left.water, right.water, local) + drift * 0.32,
    contamination: Math.max(
      0,
      interpolate(left.contamination, right.contamination, local) + drift * 0.48,
    ),
  };
}

export function weatherFingerprint(seed) {
  const samples = [];
  for (let second = 0; second <= DURATION; second += 1) {
    const value = weatherAt(seed, second);
    samples.push(
      `${second}:${value.temp.toFixed(3)},${value.humidity.toFixed(3)},${value.water.toFixed(
        3,
      )},${value.contamination.toFixed(3)}`,
    );
  }
  return hashText(samples.join("|"));
}

export function generateTargets(seed) {
  const random = mulberry32((seedHash(seed) ^ 0x5f3759df) >>> 0);
  const anchors = [
    [0.2, 0.55],
    [0.5, 0.39],
    [0.8, 0.6],
  ];
  const targets = [];
  for (const plot of PLOTS) {
    const rect = PLOT_RECTS[plot.id];
    anchors.forEach(([ax, ay], targetIndex) => {
      const jitterX = (random() - 0.5) * 0.13;
      const jitterY = (random() - 0.5) * 0.12;
      targets.push({
        id: `${plot.id}${targetIndex + 1}`,
        plot: plot.id,
        x: rect.x + rect.w * (ax + jitterX),
        y: rect.y + rect.h * (ay + jitterY),
        radius: 15,
        sampled: false,
        sampleId: null,
      });
    });
  }
  return targets;
}

export function targetFingerprint(targets) {
  return hashText(
    targets
      .map((target) => `${target.id}:${target.x.toFixed(2)},${target.y.toFixed(2)}`)
      .join("|"),
  );
}

export function hashText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function formatTime(seconds) {
  const safe = Math.max(0, Math.min(DURATION, Math.floor(seconds)));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(
    2,
    "0",
  )}`;
}

export function metricSeverity(metric, value) {
  const threshold = THRESHOLDS[metric];
  if (!threshold) return "normal";
  if (value >= threshold.critical) return "critical";
  if (value >= threshold.warning) return "warning";
  return "normal";
}

export function phaseAt(time) {
  if (time < 24) {
    return { id: "stable", label: "稳定培养", detail: "环境基线建立中" };
  }
  if (time < 48) {
    return { id: "heat", label: "热浪输入", detail: "蒸发加快 · 温度上行" };
  }
  if (time < 76) {
    return { id: "humid", label: "高湿胁迫", detail: "污染扩散风险升高" };
  }
  if (time < 100) {
    return { id: "recovery", label: "环境回落", detail: "恢复观察窗口" };
  }
  return { id: "closing", label: "观测收尾", detail: "样本数据即将封存" };
}

export function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export class ExperimentEngine {
  constructor(seed = "MF-2407") {
    this.seed = normalizeSeed(seed);
    this.elapsed = 0;
    this.running = true;
    this.ended = false;
    this.targets = generateTargets(this.seed);
    this.initialWeatherHash = weatherFingerprint(this.seed);
    this.initialTargetHash = targetFingerprint(this.targets);
    this.actual = weatherAt(this.seed, 0);
    this.observed = { ...this.actual };
    this.interventions = { irrigation: null, shade: null, ventilation: null };
    this.latent = 0;
    this.dishes = [];
    this.biasCount = 0;
    this.logs = [];
    this.operations = [];
    this.alertLevels = {
      temp: "normal",
      humidity: "normal",
      water: "normal",
      contamination: "normal",
    };
    this.events = { sampleUnlocked: false, samplingLocked: true };
    this.success = false;
    this.failureCount = 0;
    this.criticalCount = 0;
    this.steadyLogged = false;
    this.recovery = null;
    this.recoveryRuns = [];
    this.eventSequence = 0;
    this.operationSequence = 0;
    this.dishSequence = 0;
    this.lastUnlockNotice = false;
    this.history = [];
    this.historyClock = -1;
    this.addLog({
      type: "system",
      title: "实验开始 · 稳定培养",
      detail: `SEED ${this.seed} · 天气指纹 ${this.initialWeatherHash}`,
      severity: "normal",
    });
    this.recordHistory();
  }

  addLog({ type, title, detail, severity = "normal", key = null, data = null }) {
    if (key && this.logs.some((entry) => entry.key === key)) return null;
    const entry = {
      id: `log-${++this.eventSequence}`,
      time: round(this.elapsed, 1),
      type,
      title,
      detail,
      severity,
      key,
      data,
    };
    this.logs.push(entry);
    return entry;
  }

  activeIntervention(type, time = this.elapsed) {
    const active = this.interventions[type];
    if (!active || active.end <= time) return null;
    return active;
  }

  currentEnvironment() {
    const base = weatherAt(this.seed, this.elapsed);
    const environment = { ...base };
    for (const type of Object.keys(INTERVENTION_META)) {
      const active = this.activeIntervention(type);
      if (!active) continue;
      const effects = INTERVENTION_META[type].effects;
      for (const metric of ["temp", "humidity", "water", "contamination"]) {
        environment[metric] += effects[metric] ?? 0;
      }
    }
    environment.contamination = Math.max(0, environment.contamination + this.latent);
    environment.humidity = Math.max(20, Math.min(99, environment.humidity));
    environment.water = Math.max(10, Math.min(99, environment.water));
    environment.temp = Math.max(10, Math.min(45, environment.temp));
    return environment;
  }

  get activeInterventions() {
    return Object.keys(INTERVENTION_META)
      .map((type) => {
        const active = this.activeIntervention(type);
        if (!active) return null;
        return {
          type,
          label: INTERVENTION_META[type].label,
          start: active.start,
          end: active.end,
          remaining: Math.max(0, active.end - this.elapsed),
        };
      })
      .filter(Boolean);
  }

  get currentWarnings() {
    return Object.keys(THRESHOLDS)
      .map((metric) => {
        const observed = this.observed[metric];
        const actual = this.actual[metric];
        return {
          metric,
          severity: metricSeverity(metric, actual),
          observedSeverity: metricSeverity(metric, observed),
          actual,
          observed,
          threshold: THRESHOLDS[metric].critical,
        };
      })
      .filter((warning) => warning.severity !== "normal");
  }

  get criticalWarnings() {
    return this.currentWarnings.filter((warning) => warning.severity === "critical");
  }

  get hasAlert() {
    return this.currentWarnings.length > 0;
  }

  get sampledCount() {
    return this.targets.filter((target) => target.sampled).length;
  }

  get validDishes() {
    return this.dishes.filter((dish) => !dish.bias);
  }

  get sampleSpan() {
    if (!this.validDishes.length) return 0;
    const times = this.validDishes.map((dish) => dish.time);
    return Math.max(...times) - Math.min(...times);
  }

  get sampleUnlocked() {
    return this.elapsed >= SAMPLE_UNLOCK;
  }

  plotAt(x, y) {
    return (
      PLOTS.find((plot) => {
        const rect = PLOT_RECTS[plot.id];
        return (
          x >= rect.x - 10 &&
          x <= rect.x + rect.w + 10 &&
          y >= rect.y - 10 &&
          y <= rect.y + rect.h + 10
        );
      })?.id ?? null
    );
  }

  nearestTarget(plotId, x, y) {
    return this.targets
      .filter((target) => target.plot === plotId)
      .map((target) => ({
        target,
        distance: Math.hypot(x - target.x, y - target.y),
      }))
      .sort((a, b) => a.distance - b.distance)[0] ?? null;
  }

  speciesAt(plotId, environment = this.actual) {
    const bases = { A: 6.35, B: 7.2, C: 5.75 };
    const phase = { A: 0.2, B: 1.15, C: 2.05 }[plotId];
    const moistureEffect = (environment.water - 56) * 0.028;
    const temperatureEffect = -Math.max(0, environment.temp - 29) * 0.075;
    const contaminationEffect = environment.contamination * 0.025;
    const seedWave = Math.sin(this.elapsed * 0.045 + phase + (seedHash(this.seed) % 19) * 0.1) * 0.18;
    return Math.max(
      0.4,
      bases[plotId] + moistureEffect + temperatureEffect - contaminationEffect + seedWave,
    );
  }

  snapshot(environment = this.actual) {
    return {
      time: round(this.elapsed, 1),
      species: {
        A: round(this.speciesAt("A", environment), 2),
        B: round(this.speciesAt("B", environment), 2),
        C: round(this.speciesAt("C", environment), 2),
      },
      temp: round(environment.temp, 1),
      humidity: round(environment.humidity, 1),
      water: round(environment.water, 1),
      contamination: round(environment.contamination, 1),
      latent: round(this.latent, 1),
    };
  }

  recordHistory() {
    if (Math.floor(this.elapsed * 2) === this.historyClock) return;
    this.historyClock = Math.floor(this.elapsed * 2);
    this.history.push({
      time: this.elapsed,
      temp: this.actual.temp,
      humidity: this.actual.humidity,
      water: this.actual.water,
      contamination: this.actual.contamination,
    });
    if (this.history.length > 90) this.history.shift();
  }

  step(deltaSeconds) {
    if (!this.running || this.ended) return;
    const delta = Math.max(0, Math.min(0.5, deltaSeconds));
    if (!delta) return;
    const previousTime = this.elapsed;
    this.elapsed = Math.min(DURATION, this.elapsed + delta);
    this.actual = this.currentEnvironment();

    const sensorAlpha = 1 - Math.exp(-delta / 2.7);
    for (const metric of ["temp", "humidity", "water", "contamination"]) {
      this.observed[metric] += (this.actual[metric] - this.observed[metric]) * sensorAlpha;
    }

    const ventilation = this.activeIntervention("ventilation");
    this.latent = Math.max(0, this.latent - delta * (ventilation ? 3.6 : 0.22));
    this.updateWarnings(previousTime);

    if (previousTime < SAMPLE_UNLOCK && this.elapsed >= SAMPLE_UNLOCK) {
      this.events.sampleUnlocked = true;
      this.events.samplingLocked = false;
      this.addLog({
        type: "sample",
        title: "培养完成 · 采样窗口开放",
        detail: "点击脉冲靶点采样；偏离靶心 15 单位以上会形成对照偏差。",
        severity: "normal",
        key: "sample-unlocked",
      });
    }

    if (!this.steadyLogged && this.elapsed >= 18) {
      this.steadyLogged = true;
      const stable = this.history.filter((point) => point.time <= this.elapsed);
      const temps = stable.map((point) => point.temp);
      const spread = temps.length ? Math.max(...temps) - Math.min(...temps) : 0;
      this.addLog({
        type: "steady",
        title: "稳态确认 · 基线窗口",
        detail: `0–${Math.floor(this.elapsed)} 秒温度波动 ${round(
          spread,
          2,
        )}°C，传感器与真实值同步，可作为对照基线。`,
        severity: "success",
        key: "steady-baseline",
        data: { triggerTime: round(this.elapsed, 1), temperatureSpread: round(spread, 2) },
      });
    }

    this.updateRecovery();
    this.updateOperationComparisons();
    this.recordHistory();

    if (this.elapsed >= DURATION) {
      this.ended = true;
      this.running = false;
      this.addLog({
        type: "system",
        title: this.success ? "观测结束 · 数据已封存" : "观测结束 · 数据不完整",
        detail: this.success
          ? "三组可比较样本已在窗口内完成。"
          : `有效靶心样本 ${this.sampledCount}/9，偏差样本 ${this.biasCount}。`,
        severity: this.success ? "success" : "critical",
        key: "observation-ended",
      });
    }
  }

  updateWarnings(previousTime) {
    for (const metric of Object.keys(THRESHOLDS)) {
      const newLevel = metricSeverity(metric, this.actual[metric]);
      const oldLevel = this.alertLevels[metric];
      if (newLevel === oldLevel) continue;
      if (newLevel === "critical") {
        this.criticalCount += 1;
        this.addLog({
          type: "threshold",
          title: `临界阈值触发 · ${METRICS[metric].label}`,
          detail: `实际 ${round(this.actual[metric], 1)}${METRICS[metric].unit}，观测 ${round(
            this.observed[metric],
            1,
          )}${METRICS[metric].unit}；阈值 ${THRESHOLDS[metric].label}。`,
          severity: "critical",
          key: `critical-${metric}-${Math.floor(this.elapsed)}`,
          data: {
            metric,
            actual: round(this.actual[metric], 1),
            observed: round(this.observed[metric], 1),
            threshold: THRESHOLDS[metric].critical,
            crossedBetween: [round(previousTime, 2), round(this.elapsed, 2)],
          },
        });
      } else if (newLevel === "warning" && oldLevel === "normal") {
        this.addLog({
          type: "threshold",
          title: `预警 · ${METRICS[metric].label}接近临界`,
          detail: `实际 ${round(this.actual[metric], 1)}${METRICS[metric].unit}，阈值 ${
            THRESHOLDS[metric].label
          }。`,
          severity: "warning",
          key: `warning-${metric}-${Math.floor(this.elapsed)}`,
        });
      } else if (newLevel === "normal" && oldLevel === "critical") {
        this.addLog({
          type: "threshold",
          title: `${METRICS[metric].label}回落至临界以下`,
          detail: `实际 ${round(this.actual[metric], 1)}${METRICS[metric].unit}。仍需确认无隐藏残留。`,
          severity: "success",
          key: `cleared-${metric}-${Math.floor(this.elapsed)}`,
        });
      }
      this.alertLevels[metric] = newLevel;
    }
  }

  applyIntervention(type) {
    if (this.ended) {
      return { ok: false, message: "观测已结束，请重置实验。" };
    }
    const meta = INTERVENTION_META[type];
    if (!meta) return { ok: false, message: "未知干预措施。" };

    const before = this.snapshot(this.currentEnvironment());
    const alreadyActive = this.activeIntervention(type);
    if (alreadyActive) {
      return {
        ok: false,
        message: `${meta.label}仍在执行，剩余 ${round(alreadyActive.end - this.elapsed, 1)} 秒。`,
      };
    }

    const failed =
      type === "irrigation" &&
      (this.actual.humidity >= 78 || this.actual.water >= 76 || this.recovery?.active);
    this.interventions[type] = {
      start: this.elapsed,
      end: this.elapsed + meta.duration,
      failed,
    };
    if (failed) {
      this.failureCount += 1;
      this.latent += 24;
    }
    this.actual = this.currentEnvironment();
    const after = this.snapshot(this.actual);
    const operation = {
      id: `operation-${++this.operationSequence}`,
      time: round(this.elapsed, 1),
      type,
      label: meta.label,
      status: failed ? "failed" : "pending",
      failure: failed,
      before,
      after,
      afterAt: this.elapsed + 3,
    };
    this.operations.push(operation);

    if (failed) {
      this.addLog({
        type: "failure",
        title: "处置失败 · 高湿条件灌溉",
        detail: `在 ${round(before.humidity, 1)}% 湿度下继续灌溉，水位与污染扩散叠加；已保留隐藏残留 ${round(
          this.latent,
          1,
        )} CFU。`,
        severity: "failure",
        key: `failure-irrigation-${Math.floor(this.elapsed)}`,
        data: { operationId: operation.id, triggerTime: round(this.elapsed, 1) },
      });
    } else {
      this.addLog({
        type: "operation",
        title: `执行干预 · ${meta.label}`,
        detail: `作用于 A/B/C 全区，持续 ${meta.duration} 秒。`,
        severity: "normal",
        key: `operation-${operation.id}`,
      });
    }
    return {
      ok: true,
      failed,
      operation,
      message: failed
        ? "处置失败：高湿灌溉造成污染叠加，请启动恢复观察。"
        : `${meta.label}已启动，持续 ${meta.duration} 秒。`,
    };
  }

  updateOperationComparisons() {
    for (const operation of this.operations) {
      if (operation.status === "pending" && this.elapsed >= operation.afterAt) {
        operation.after = this.snapshot(this.actual);
        operation.status = "complete";
      }
    }
  }

  sampleAt(x, y) {
    if (this.ended) {
      return { ok: false, message: "观测期已经结束。" };
    }
    if (!this.sampleUnlocked) {
      return {
        ok: false,
        message: `培养尚未完成，还需 ${round(SAMPLE_UNLOCK - this.elapsed, 1)} 秒。`,
      };
    }
    const plotId = this.plotAt(x, y);
    if (!plotId) {
      return { ok: false, message: "采样点不在实验田范围内。" };
    }
    const nearest = this.nearestTarget(plotId, x, y);
    if (!nearest) return { ok: false, message: "该田块没有可用采样靶点。" };
    if (nearest.target.sampled) {
      return {
        ok: false,
        duplicate: true,
        message: `${nearest.target.id} 已采样；请选择同组其他脉冲靶点。`,
      };
    }

    const bias = nearest.distance > nearest.target.radius;
    const snapshot = this.snapshot();
    const dish = {
      id: `dish-${++this.dishSequence}`,
      plot: plotId,
      targetId: nearest.target.id,
      bias,
      distance: round(nearest.distance, 1),
      time: round(this.elapsed, 1),
      species: snapshot.species[plotId],
      water: snapshot.water,
      contamination: snapshot.contamination,
      temp: snapshot.temp,
      humidity: snapshot.humidity,
      x,
      y,
      targetX: nearest.target.x,
      targetY: nearest.target.y,
    };
    this.dishes.push(dish);

    if (bias) {
      this.biasCount += 1;
      this.addLog({
        type: "sample",
        title: `对照偏差 · ${plotId} 区`,
        detail: `采样点偏离 ${nearest.target.id} 靶心 ${round(
          nearest.distance,
          1,
        )} 单位（允许 15）；该培养皿不计入目标。`,
        severity: "warning",
        key: `bias-${dish.id}`,
        data: { dishId: dish.id, distance: dish.distance },
      });
      return {
        ok: true,
        bias: true,
        dish,
        message: `偏差 ${round(nearest.distance, 1)} 单位：样本已标记，目标未计入。`,
      };
    }

    this.targets = this.targets.map((target) =>
      target.id === nearest.target.id
        ? { ...target, sampled: true, sampleId: dish.id }
        : target,
    );
    this.addLog({
      type: "sample",
      title: `有效采样 · ${nearest.target.id}`,
      detail: `距靶心 ${round(nearest.distance, 1)} 单位；物种指数 ${dish.species.toFixed(
        2,
      )}，污染 ${dish.contamination} CFU。`,
      severity: "success",
      key: `sample-${dish.id}`,
      data: { dishId: dish.id, plot: plotId },
    });
    this.checkSuccess();
    return {
      ok: true,
      bias: false,
      dish,
      message: `${nearest.target.id} 已封存 · 目标 ${this.sampledCount}/9`,
    };
  }

  groupState(plotId) {
    const valid = this.validDishes.filter((dish) => dish.plot === plotId);
    const biased = this.dishes.filter((dish) => dish.plot === plotId && dish.bias);
    const times = valid.map((dish) => dish.time);
    const span = times.length ? Math.max(...times) - Math.min(...times) : 0;
    const complete = valid.length >= 3;
    const comparable = complete && span <= COMPARABLE_WINDOW;
    const quality = Math.min(
      100,
      Math.round((valid.length / 3) * 70 + (complete ? 30 - Math.min(30, span * 0.7) : 0)),
    );
    return {
      id: plotId,
      count: valid.length,
      biasCount: biased.length,
      span: round(span, 1),
      complete,
      comparable,
      quality: Math.max(0, quality),
      dishes: valid,
    };
  }

  checkSuccess() {
    if (this.success || this.ended) return false;
    const groups = PLOTS.map((plot) => this.groupState(plot.id));
    const allComplete = groups.every((group) => group.complete);
    const withinWindow = this.sampleSpan <= COMPARABLE_WINDOW;
    if (!allComplete || !withinWindow) return false;
    this.success = true;
    this.addLog({
      type: "success",
      title: "三组可比较数据已建立",
      detail: `A/B/C 各 3 个靶心样本，总跨度 ${round(
        this.sampleSpan,
        1,
      )} 秒（≤ ${COMPARABLE_WINDOW} 秒）。`,
      severity: "success",
      key: "experiment-success",
      data: { completedAt: round(this.elapsed, 1) },
    });
    return true;
  }

  canStartRecovery() {
    if (this.ended || this.recovery?.active) return false;
    if (
      this.recovery?.completed &&
      this.failureCount <= this.recovery.failureAtStart &&
      this.criticalCount <= this.recovery.criticalAtStart &&
      !this.criticalWarnings.length
    ) {
      return false;
    }
    return this.criticalCount > 0 || this.failureCount > 0 || this.hasAlert;
  }

  beginRecovery() {
    if (!this.canStartRecovery()) {
      return {
        ok: false,
        message: this.recovery?.completed
          ? "本轮恢复观察已完成。"
          : "当前没有需要处置的告警。",
      };
    }
    const startSnapshot = this.snapshot();
    this.recovery = {
      active: true,
      completed: false,
      start: this.elapsed,
      end: this.elapsed + RECOVERY_DURATION,
      startSnapshot,
      failureAtStart: this.failureCount,
      criticalAtStart: this.criticalCount,
      clean: null,
      warningDuringRecovery: false,
    };
    if (this.interventions.irrigation?.failed) {
      this.interventions.irrigation.end = this.elapsed;
    }
    const existingVentilation = this.activeIntervention("ventilation");
    this.interventions.ventilation = {
      start: this.elapsed,
      end: Math.max(existingVentilation?.end ?? 0, this.elapsed + RECOVERY_DURATION + 6),
      recovery: true,
    };
    this.addLog({
      type: "recovery",
      title: "启动恢复观察 · 固定 8 秒",
      detail: "通风除湿生效；系统将持续比对实际值、观测值与隐藏残留。",
      severity: "warning",
      key: `recovery-start-${Math.floor(this.elapsed * 10)}`,
      data: { triggerTime: round(this.elapsed, 1), duration: RECOVERY_DURATION },
    });
    return { ok: true, message: "恢复观察已启动，固定运行 8 秒。" };
  }

  updateRecovery() {
    if (!this.recovery?.active) return;
    if (this.actual.contamination >= THRESHOLDS.contamination.critical) {
      if (!this.recovery.warningDuringRecovery) {
        this.recovery.warningDuringRecovery = true;
        this.addLog({
          type: "recovery",
          title: "恢复中检测到异常",
          detail: `污染实际值仍为 ${round(this.actual.contamination, 1)} CFU，继续观察。`,
          severity: "warning",
          key: `recovery-warning-${Math.floor(this.elapsed)}`,
        });
      }
    }
    if (this.elapsed < this.recovery.end) return;

    const finalSnapshot = this.snapshot();
    const clean =
      this.latent < 4.5 &&
      finalSnapshot.contamination < THRESHOLDS.contamination.critical &&
      finalSnapshot.temp < THRESHOLDS.temp.critical;
    this.recovery.active = false;
    this.recovery.completed = true;
    this.recovery.clean = clean;
    this.recovery.endSnapshot = finalSnapshot;
    this.recoveryRuns.push({
      start: round(this.recovery.start, 1),
      ended: round(this.elapsed, 1),
      duration: round(this.elapsed - this.recovery.start, 1),
      clean,
      final: finalSnapshot,
    });
    this.addLog({
      type: "recovery",
      title: clean ? "恢复观察完成 · 无隐藏残留" : "恢复观察完成 · 残留未清除",
      detail: clean
        ? `连续运行 ${RECOVERY_DURATION} 秒，隐藏残留降至 ${round(
            this.latent,
            1,
          )} CFU，污染 ${finalSnapshot.contamination} CFU。`
        : `固定观察 ${RECOVERY_DURATION} 秒后仍有 ${round(
            this.latent,
            1,
          )} CFU 隐藏残留，需再次通风。`,
      severity: clean ? "success" : "failure",
      key: `recovery-end-${Math.floor(this.elapsed)}`,
      data: { triggerTime: round(this.elapsed, 1), clean },
    });
  }

  advanceTo(targetTime, stepSize = 0.2) {
    const destination = Math.max(0, Math.min(DURATION, targetTime));
    const wasRunning = this.running;
    this.running = true;
    while (this.elapsed < destination && !this.ended) {
      this.step(Math.min(stepSize, destination - this.elapsed));
    }
    if (!this.ended) this.running = wasRunning;
    return this;
  }

  verificationSummary() {
    const freshTargets = generateTargets(this.seed);
    const currentWeatherHash = weatherFingerprint(this.seed);
    const currentTargetHash = targetFingerprint(freshTargets);
    const triggerTimes = this.logs
      .filter((entry) => entry.type === "threshold" || entry.type === "failure")
      .map((entry) => ({ time: entry.time, title: entry.title }));
    const recovery = this.recoveryRuns[this.recoveryRuns.length - 1] ?? null;
    return {
      weather: {
        pass: currentWeatherHash === this.initialWeatherHash,
        expected: this.initialWeatherHash,
        replayed: currentWeatherHash,
      },
      targets: {
        pass: currentTargetHash === this.initialTargetHash,
        expected: this.initialTargetHash,
        replayed: currentTargetHash,
      },
      triggerTimes,
      criticalVerified: this.criticalCount > 0 && triggerTimes.length > 0,
      failureVerified: this.failureCount > 0,
      recovery,
      recoveryVerified: Boolean(recovery && recovery.duration >= RECOVERY_DURATION - 0.1),
      pass:
        currentWeatherHash === this.initialWeatherHash &&
        currentTargetHash === this.initialTargetHash,
    };
  }

  stateSummary() {
    const groups = PLOTS.map((plot) => this.groupState(plot.id));
    const recovery = this.recovery
      ? {
          ...this.recovery,
          remaining: this.recovery.active
            ? Math.max(0, this.recovery.end - this.elapsed)
            : 0,
        }
      : null;
    return {
      seed: this.seed,
      elapsed: this.elapsed,
      running: this.running,
      ended: this.ended,
      phase: phaseAt(this.elapsed),
      actual: this.actual,
      observed: this.observed,
      warnings: this.currentWarnings,
      criticalWarnings: this.criticalWarnings,
      active: this.activeInterventions,
      groups,
      targets: this.targets,
      dishes: this.dishes,
      sampledCount: this.sampledCount,
      biasCount: this.biasCount,
      sampleSpan: this.sampleSpan,
      sampleUnlocked: this.sampleUnlocked,
      success: this.success,
      failureCount: this.failureCount,
      criticalCount: this.criticalCount,
      recovery,
      canRecover: this.canStartRecovery(),
      logs: this.logs,
      operations: this.operations,
      history: this.history,
    };
  }
}
