export const DAY_HOURS = 24;
export const GROW_DAYS = 20;
export const RECOVERY_HOURS = 8;
export const EVENT_GRACE_HOURS = 6;
export const PLANTS_PER_ROW = 3;

export const ROWS = [
  {
    id: "A",
    species: "罗勒",
    latin: "Ocimum basilicum",
    color: "#77b96b",
    dark: "#3f7a44",
    heightGoal: 16,
    needs: { light: [360, 720], humidity: [52, 72], temperature: [20, 26] }
  },
  {
    id: "B",
    species: "奶油生菜",
    latin: "Lactuca sativa",
    color: "#a8cf72",
    dark: "#60843d",
    heightGoal: 13,
    needs: { light: [240, 600], humidity: [62, 80], temperature: [16, 23] }
  },
  {
    id: "C",
    species: "辣椒",
    latin: "Capsicum annuum",
    color: "#e0a15b",
    dark: "#8b5b30",
    heightGoal: 20,
    needs: { light: [480, 900], humidity: [45, 65], temperature: [22, 29] }
  }
];

export const THRESHOLDS = {
  humidity: { warning: 80, critical: 86, low: 44 },
  temperature: { warning: 28, critical: 30.5, low: 15 },
  light: { low: 220, high: 1050 },
  contamination: { warning: 15, critical: 25 }
};

const WEATHER_KINDS = {
  clear: { label: "晴朗", icon: "sun", light: 1, humidity: -8, temperature: 1.8, rain: 0 },
  cloud: { label: "多云", icon: "cloud", light: 0.68, humidity: 1, temperature: 0, rain: 0.08 },
  rain: { label: "阵雨", icon: "rain", light: 0.38, humidity: 18, temperature: -2.2, rain: 0.8 },
  muggy: { label: "闷热", icon: "heat", light: 0.78, humidity: 22, temperature: 4.2, rain: 0.12 }
};

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a, b, amount) {
  return a + (b - a) * amount;
}

export function hashString(input) {
  let hash = 2166136261;
  for (const char of String(input)) {
    hash ^= char.charCodeAt(0);
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

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function formatSimTime(hours) {
  const total = Math.max(0, Math.floor(hours));
  const day = Math.floor(total / DAY_HOURS) + 1;
  const hour = total % DAY_HOURS;
  return `D${String(day).padStart(2, "0")} · ${String(hour).padStart(2, "0")}:00`;
}

export function growDay(hours, startHour = 8) {
  return clamp(Math.floor((hours - startHour) / DAY_HOURS) + 1, 1, GROW_DAYS);
}

export function dayProgress(hours, startHour = 8) {
  return clamp((hours - startHour) / (GROW_DAYS * DAY_HOURS), 0, 1);
}

export function generateWeather(seed) {
  const seedHash = hashString(seed);
  const random = mulberry32(seedHash ^ 0x9e3779b9);
  const sequence = [];
  let previous = "cloud";
  const kinds = Object.keys(WEATHER_KINDS);

  for (let index = 0; index < GROW_DAYS + 2; index += 1) {
    let kind = previous;
    if (index === 0) {
      kind = random() > 0.48 ? "clear" : "cloud";
    } else if (index === 3 && seedHash % 3 !== 0) {
      kind = "muggy";
    } else if (index === 9 && seedHash % 2 === 0) {
      kind = "rain";
    } else {
      const roll = random();
      if (roll < 0.38) kind = previous;
      else kind = kinds[Math.floor(random() * kinds.length)];
    }

    const profile = WEATHER_KINDS[kind];
    const variance = random();
    sequence.push({
      day: index + 1,
      kind,
      label: profile.label,
      icon: profile.icon,
      temperature: round(21.5 + profile.temperature + variance * 2.8, 1),
      humidity: round(clamp(63 + profile.humidity + (random() - 0.5) * 9, 38, 91), 1),
      light: round(clamp(760 * profile.light + (random() - 0.5) * 120, 190, 980), 0),
      wind: round(0.75 + random() * 1.8 + (kind === "rain" ? 1.1 : 0), 1),
      rain: profile.rain
    });
    previous = kind;
  }
  return sequence;
}

export function weatherDigest(seed) {
  const sequence = generateWeather(seed);
  let hash = hashString(seed);
  for (const day of sequence) {
    hash ^= hashString(`${day.kind}:${day.temperature}:${day.humidity}:${day.light}`);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).toUpperCase().padStart(8, "0").slice(0, 6);
}

export function generateTargets(seed) {
  const random = mulberry32(hashString(seed) ^ 0x85ebca6b);
  return ROWS.map((row) => {
    const index = Math.floor(random() * PLANTS_PER_ROW);
    return {
      row: row.id,
      index,
      position: `${row.id}-${String(index + 1).padStart(2, "0")}`,
      species: row.species
    };
  });
}

export function weatherAt(weather, hours) {
  const currentIndex = clamp(Math.floor(hours / DAY_HOURS), 0, weather.length - 2);
  const current = weather[currentIndex];
  const next = weather[currentIndex + 1];
  const local = hours / DAY_HOURS - currentIndex;
  const blend = clamp((local - 0.68) / 0.32, 0, 1);
  const eased = blend * blend * (3 - 2 * blend);
  const hour = hours % DAY_HOURS;
  const daylight = clamp(Math.sin(((hour - 6) / 12) * Math.PI), 0, 1);
  const cloudFactor = current.kind === "rain" ? 0.42 : current.kind === "cloud" ? 0.74 : 1;
  const light = current.light * daylight * cloudFactor;

  return {
    ...current,
    hour,
    daylight,
    ambientLight: round(light, 0),
    ambientHumidity: round(lerp(current.humidity, next.humidity, eased), 1),
    ambientTemperature: round(lerp(current.temperature, next.temperature, eased), 1),
    wind: round(lerp(current.wind, next.wind, eased), 1)
  };
}

export function sensorOffset(seed, metricIndex, hours) {
  const phase = (hashString(`${seed}:${metricIndex}`) % 1000) / 159;
  return (
    Math.sin(hours * 0.73 + phase) * 0.62 +
    Math.sin(hours * 1.91 + phase * 0.7) * 0.23 +
    Math.sin(hours * 0.17 + phase * 1.7) * 0.15
  );
}

export function rowEnvironment(rowId, actual, weather) {
  const row = ROWS.find((item) => item.id === rowId);
  if (!row) throw new Error(`Unknown row: ${rowId}`);
  const factors = {
    A: { light: 0.98, humidity: 0, temperature: 0.15 },
    B: { light: 0.76, humidity: 7.2, temperature: -1.25 },
    C: { light: 1.1, humidity: -6.3, temperature: 1.35 }
  }[rowId];

  return {
    light: round(clamp(actual.light * factors.light, 0, 1100), 0),
    humidity: round(clamp(actual.humidity + factors.humidity, 20, 100), 1),
    temperature: round(clamp(actual.temperature + factors.temperature, 8, 42), 1),
    draft: weather.wind * (rowId === "C" ? 1.35 : 0.8)
  };
}

export function climateStatus(state) {
  const observed = state.observed;
  const humidity = observed.humidity >= THRESHOLDS.humidity.critical
    ? { level: "critical", label: "临界高湿" }
    : observed.humidity >= THRESHOLDS.humidity.warning
      ? { level: "warning", label: "高湿风险" }
      : observed.humidity < THRESHOLDS.humidity.low
        ? { level: "warning", label: "空气偏干" }
        : { level: "good", label: "稳定" };
  const temperature = observed.temperature >= THRESHOLDS.temperature.critical
    ? { level: "critical", label: "高温临界" }
    : observed.temperature >= THRESHOLDS.temperature.warning
      ? { level: "warning", label: "温度偏高" }
      : observed.temperature < THRESHOLDS.temperature.low
        ? { level: "warning", label: "低温风险" }
        : { level: "good", label: "稳定" };
  const light = observed.light < THRESHOLDS.light.low
    ? { level: "warning", label: "补光不足" }
    : observed.light > THRESHOLDS.light.high
      ? { level: "warning", label: "光照过强" }
      : { level: "good", label: "适宜" };
  const contamination = state.actual.contamination >= THRESHOLDS.contamination.critical
    ? { level: "critical", label: "病害临界" }
    : state.actual.contamination >= THRESHOLDS.contamination.warning
      ? { level: "warning", label: "病害滋生" }
      : { level: "good", label: "清洁" };
  return { humidity, temperature, light, contamination };
}

export function metricComfort(value, range) {
  const [min, max] = range;
  const span = Math.max(1, max - min);
  if (value >= min && value <= max) return 1;
  return clamp(1 - Math.abs(value < min ? min - value : value - max) / span, 0, 1);
}

export function targetMet(state) {
  return state.plants.filter(
    (plant) => plant.height >= plant.heightGoal * 0.94 && plant.health >= 72
  ).length;
}

export function captureSnapshot(state) {
  const metCount = targetMet(state);
  return {
    metCount,
    targetMet: `${metCount}/${state.plants.length}`,
    species: ROWS.map((row) => {
      const plants = state.plants.filter((plant) => plant.row === row.id);
      const averageHealth = Math.round(
        plants.reduce((sum, plant) => sum + plant.health, 0) / plants.length
      );
      return `${row.species} ${averageHealth}%`;
    }).join(" · "),
    water: Math.round(state.actual.water),
    contamination: round(state.actual.contamination, 1)
  };
}

export function addLog(state, kind, title, detail, options = {}) {
  state.logSequence += 1;
  const entry = {
    id: `LOG-${state.logSequence}`,
    kind,
    at: round(state.elapsedHours, 2),
    time: formatSimTime(state.elapsedHours),
    title,
    detail,
    outcome: options.outcome || "",
    before: options.before || null,
    after: options.after || null,
    triggeredAt: options.triggeredAt || formatSimTime(state.elapsedHours)
  };
  state.logs.unshift(entry);
  state.logs = state.logs.slice(0, 80);
  return entry;
}

function initialActual(weather, controls) {
  return {
    light: round(weather.ambientLight + (controls.lights ? 500 : 0), 0),
    humidity: round(
      clamp(weather.ambientHumidity + (controls.mist ? 19 : 0) - (controls.fan ? 21 : 0) + 2, 25, 96),
      1
    ),
    temperature: round(
      clamp(
        weather.ambientTemperature + (controls.lights ? 1.7 : 0) + (controls.mist ? -1 : 0) - (controls.fan ? 2.2 : 0),
        10,
        38
      ),
      1
    ),
    water: 86,
    contamination: 7.2
  };
}

export function createSimulation(seedInput = 47291, options = {}) {
  const seed = String(seedInput).trim() || "47291";
  const seedHash = hashString(seed);
  const weather = generateWeather(seed);
  const targets = generateTargets(seed);
  const random = mulberry32(seedHash ^ 0x27d4eb2d);
  const startHour = options.startHour ?? 8;
  const controls = { lights: true, mist: false, fan: false, ...(options.controls || {}) };
  const startWeather = weatherAt(weather, startHour);
  const actual = initialActual(startWeather, controls);
  const sensorBias = {
    light: round((random() - 0.5) * 22, 1),
    humidity: round((random() - 0.5) * 2.8, 1),
    temperature: round((random() - 0.5) * 0.8, 2)
  };
  const targetPositions = Object.fromEntries(targets.map((target) => [target.row, target.index]));
  const plants = ROWS.flatMap((row) => (
    Array.from({ length: PLANTS_PER_ROW }, (_, index) => ({
      id: `${row.id}-${index + 1}`,
      row: row.id,
      index,
      species: row.species,
      height: round(row.heightGoal * (0.24 + random() * 0.045), 1),
      heightGoal: row.heightGoal,
      health: round(79 + random() * 9, 1),
      isTarget: targetPositions[row.id] === index
    }))
  ));

  const state = {
    seed,
    seedHash,
    seedCode: String(seedHash % 100000).padStart(5, "0"),
    weather,
    weatherDigest: weatherDigest(seed),
    targets,
    targetPositions,
    startHour,
    elapsedHours: startHour,
    controls,
    actual,
    observed: {
      light: round(actual.light + sensorBias.light, 0),
      humidity: round(actual.humidity + sensorBias.humidity, 1),
      temperature: round(actual.temperature + sensorBias.temperature, 2)
    },
    sensorBias,
    plants,
    energyKwh: 0,
    switchCount: 0,
    switchPenaltyKwh: 0,
    lastSwitchAt: -Infinity,
    lastSwitchByDevice: { lights: -Infinity, mist: -Infinity, fan: -Infinity },
    pendingChecks: [],
    logs: [],
    logSequence: 0,
    activeEvent: null,
    lastEvent: null,
    recovery: null,
    eventCooldownUntil: startHour + 8,
    steadySince: 0,
    lastSteadyLogAt: -Infinity,
    finished: false,
    endAt: startHour + GROW_DAYS * DAY_HOURS,
    outcome: null,
    residualChecks: 0,
    lastRecoveryResult: null,
    historyMaxContamination: actual.contamination
  };

  addLog(
    state,
    "system",
    "温室循环启动",
    `种子 ${seed} · 天气指纹 ${state.weatherDigest} · 目标 ${targets.map((item) => item.position).join(" / ")}`
  );
  return state;
}

function eventValue(state, type) {
  if (type === "heat") return state.actual.temperature;
  if (type === "disease") return state.actual.contamination;
  return state.actual.humidity;
}

function eventThreshold(type) {
  if (type === "heat") return THRESHOLDS.temperature.warning;
  if (type === "disease") return THRESHOLDS.contamination.critical;
  return THRESHOLDS.humidity.warning;
}

const EVENT_TITLES = {
  humidity: "高湿临界事件",
  heat: "高温临界事件",
  disease: "病害负荷临界"
};

export function triggerEvent(state, type = "humidity", options = {}) {
  if (state.activeEvent || state.recovery || state.finished) return null;
  const value = options.value ?? eventValue(state, type);
  const event = {
    id: `EV-${Math.floor(state.elapsedHours * 100)}-${type}`,
    type,
    title: EVENT_TITLES[type] || "环境临界事件",
    status: "active",
    startedAt: state.elapsedHours,
    deadlineAt: state.elapsedHours + (options.demo ? 3 : EVENT_GRACE_HOURS),
    threshold: eventThreshold(type),
    triggerValue: round(value, 1),
    before: captureSnapshot(state),
    demoFailure: Boolean(options.demoFailure),
    injected: Boolean(options.injected)
  };
  state.activeEvent = event;
  state.lastEvent = event;
  state.steadySince = 0;
  addLog(
    state,
    "critical",
    event.title,
    `触发值 ${event.triggerValue} · 阈值 ${event.threshold} · 处置窗口 ${Math.round(event.deadlineAt - event.startedAt)} 模拟小时`,
    {
      before: event.before,
      triggeredAt: formatSimTime(event.startedAt),
      outcome: "待处置"
    }
  );
  return event;
}

function startRecovery(state, event) {
  const after = captureSnapshot(state);
  addLog(
    state,
    "action",
    "处置生效 · 进入恢复观察",
    `通风与降湿已生效；继续运行 ${RECOVERY_HOURS} 模拟小时检查隐藏残留`,
    {
      before: event.before,
      after,
      triggeredAt: formatSimTime(event.startedAt),
      outcome: "恢复观察中"
    }
  );
  event.status = "resolved";
  event.resolvedAt = state.elapsedHours;
  state.lastEvent = event;
  state.activeEvent = null;
  state.recovery = {
    eventId: event.id,
    startedAt: state.elapsedHours,
    endsAt: state.elapsedHours + RECOVERY_HOURS,
    nextCheckAt: state.elapsedHours + 1,
    baseline: {
      humidity: state.actual.humidity,
      temperature: state.actual.temperature,
      contamination: state.actual.contamination,
      snapshot: captureSnapshot(state)
    },
    checks: 0,
    anomalies: 0,
    status: "observing"
  };
  state.eventCooldownUntil = state.elapsedHours + RECOVERY_HOURS + 4;
  state.residualChecks = 0;
}

function failEvent(state, event, reason = "超过处置窗口") {
  const before = event.before;
  state.actual.contamination = clamp(
    state.actual.contamination + (event.type === "disease" ? 4 : 7.5),
    0,
    100
  );
  state.actual.water = clamp(state.actual.water - 2, 0, 100);
  const after = captureSnapshot(state);
  event.status = "failed";
  event.failedAt = state.elapsedHours;
  event.failureReason = reason;
  state.lastEvent = event;
  state.activeEvent = null;
  state.eventCooldownUntil = state.elapsedHours + 10;
  state.steadySince = 0;
  addLog(
    state,
    "failure",
    "处置失败 · 环境失守",
    `${reason}；病害负荷升至 ${after.contamination}%`,
    {
      before,
      after,
      triggeredAt: formatSimTime(event.startedAt),
      outcome: "失败"
    }
  );
}

function checkRecovery(state) {
  const recovery = state.recovery;
  if (!recovery) return;
  if (state.elapsedHours + 0.0001 >= recovery.nextCheckAt) {
    recovery.checks += 1;
    recovery.nextCheckAt += 1;
    const humidRebound = state.actual.humidity > Math.max(82, recovery.baseline.humidity + 7);
    const heatRebound = state.actual.temperature > Math.max(29, recovery.baseline.temperature + 3.5);
    const contaminationRose = state.actual.contamination > recovery.baseline.contamination + 4.5;
    if (humidRebound || heatRebound || contaminationRose) {
      recovery.anomalies += 1;
      addLog(
        state,
        "warning",
        "恢复观察异常",
        `第 ${recovery.checks} 次检查：湿度 ${state.observed.humidity}% · 病害 ${round(state.actual.contamination, 1)}%`,
        { triggeredAt: formatSimTime(recovery.startedAt) }
      );
    }
  }
  if (state.elapsedHours + 0.0001 >= recovery.endsAt) {
    const stable = recovery.anomalies === 0 &&
      state.actual.humidity < 84 &&
      state.actual.contamination <= recovery.baseline.contamination + 2;
    addLog(
      state,
      stable ? "recovery" : "warning",
      stable ? "恢复观察完成 · 无隐藏残留" : "恢复观察完成 · 检测到残留",
      `${RECOVERY_HOURS} 模拟小时 · ${recovery.checks} 次检查 · 异常 ${recovery.anomalies} 项 · 病害 ${round(state.actual.contamination, 1)}%`,
      {
        before: recovery.baseline.snapshot,
        after: captureSnapshot(state),
        triggeredAt: formatSimTime(recovery.startedAt),
        outcome: stable ? "通过" : "需复核"
      }
    );
    recovery.status = stable ? "passed" : "residual";
    state.lastRecoveryResult = stable ? "passed" : "residual";
    state.residualChecks = recovery.anomalies;
    state.recovery = null;
  }
}

export function recordSteadySample(state, options = {}) {
  const stable = !state.activeEvent &&
    !state.recovery &&
    state.actual.humidity < 80 &&
    state.actual.temperature > 16 &&
    state.actual.temperature < 29 &&
    state.actual.contamination < THRESHOLDS.contamination.warning;
  if (!stable && !options.force) {
    return addLog(state, "warning", "稳态采样未通过", "当前存在临界事件或指标越界，请先恢复环境", {
      outcome: "未通过"
    });
  }
  const snapshot = captureSnapshot(state);
  const entry = addLog(
    state,
    "steady",
    options.manual ? "稳态人工采样" : "稳态自动采样",
    `湿度 ${round(state.actual.humidity, 1)}% · 温度 ${round(state.actual.temperature, 1)}°C · 病害 ${snapshot.contamination}%`,
    {
      before: snapshot,
      after: snapshot,
      triggeredAt: formatSimTime(state.elapsedHours),
      outcome: "通过"
    }
  );
  state.lastSteadyLogAt = state.elapsedHours;
  return entry;
}

function triggerAutomaticEvent(state) {
  if (
    state.activeEvent ||
    state.recovery ||
    state.elapsedHours < state.eventCooldownUntil ||
    state.finished
  ) return;

  if (state.actual.humidity >= THRESHOLDS.humidity.critical) {
    triggerEvent(state, "humidity");
  } else if (state.actual.temperature >= THRESHOLDS.temperature.critical) {
    triggerEvent(state, "heat");
  } else if (state.actual.contamination >= THRESHOLDS.contamination.critical) {
    triggerEvent(state, "disease");
  }
}

function updateEventLifecycle(state, dtHours) {
  triggerAutomaticEvent(state);
  const event = state.activeEvent;
  if (event) {
    const value = eventValue(state, event.type);
    const hasCorrectiveAction = state.controls.fan &&
      (event.type !== "heat" || state.actual.temperature < event.threshold - 0.5);
    const underControl = event.type === "humidity"
      ? state.actual.humidity < event.threshold - 1
      : event.type === "heat"
        ? state.actual.temperature < event.threshold - 0.5
        : state.actual.contamination < event.threshold - 3;

    if (event.demoFailure && state.elapsedHours >= event.deadlineAt) {
      failEvent(state, event, "操作台失联，未在窗口内启动通风");
    } else if (hasCorrectiveAction && underControl) {
      startRecovery(state, event);
    } else if (state.elapsedHours >= event.deadlineAt) {
      failEvent(state, event, "通风未开启或未降至安全线");
    }
  }
  checkRecovery(state);

  if (
    !state.activeEvent &&
    !state.recovery &&
    state.actual.humidity < 80 &&
    state.actual.temperature < 29 &&
    state.actual.contamination < THRESHOLDS.contamination.warning
  ) {
    state.steadySince += dtHours;
  } else {
    state.steadySince = 0;
  }

  if (
    state.steadySince >= 6 &&
    state.elapsedHours - state.lastSteadyLogAt >= 12
  ) {
    recordSteadySample(state);
  }
}

function processPendingChecks(state) {
  const due = state.pendingChecks.filter((item) => state.elapsedHours >= item.dueAt);
  if (!due.length) return;
  state.pendingChecks = state.pendingChecks.filter((item) => state.elapsedHours < item.dueAt);
  for (const item of due) {
    const after = captureSnapshot(state);
    const deltaWater = after.water - item.before.water;
    const deltaPollution = round(after.contamination - item.before.contamination, 1);
    addLog(
      state,
      "action",
      `干预复盘 · ${item.label}`,
      `目标 ${item.before.metCount}→${after.metCount} · 水位 ${deltaWater >= 0 ? "+" : ""}${deltaWater}% · 病害 ${deltaPollution >= 0 ? "+" : ""}${deltaPollution}%`,
      {
        before: item.before,
        after,
        triggeredAt: item.triggeredAt,
        outcome: after.metCount > item.before.metCount ? "改善" : "待观察"
      }
    );
  }
}

export function toggleControl(state, key, options = {}) {
  if (!(key in state.controls) || state.finished) return false;
  const before = captureSnapshot(state);
  const now = state.elapsedHours;
  const recentlySwitched = Object.values(state.lastSwitchByDevice)
    .some((lastAt) => Math.abs(now - lastAt) < 2);
  const penalty = recentlySwitched ? 0.42 : 0;

  state.controls[key] = !state.controls[key];
  state.switchCount += 1;
  state.lastSwitchAt = now;
  state.lastSwitchByDevice[key] = now;
  if (penalty) {
    state.switchPenaltyKwh += penalty;
    state.energyKwh += penalty;
  }

  const labels = { lights: "补光灯", mist: "喷雾", fan: "通风" };
  const action = state.controls[key] ? "开启" : "关闭";
  const label = `${labels[key]}${action}`;
  const penaltyText = penalty ? ` · 频繁切换损耗 +${penalty.toFixed(2)} kWh` : "";
  addLog(
    state,
    "action",
    `干预 · ${label}`,
    `等待 2 模拟小时后复盘${penaltyText}`,
    {
      before,
      triggeredAt: formatSimTime(now),
      outcome: "执行中"
    }
  );

  if (key === "fan" && state.activeEvent && state.controls.fan) {
    state.activeEvent.correctiveStartedAt = now;
  }

  state.pendingChecks.push({
    dueAt: now + (options.reviewHours ?? 2),
    label,
    before,
    triggeredAt: formatSimTime(now)
  });
  return true;
}

export function refillWater(state) {
  if (state.finished || state.actual.water >= 99) return false;
  const before = captureSnapshot(state);
  const added = Math.min(20, 100 - state.actual.water);
  state.actual.water = clamp(state.actual.water + added, 0, 100);
  state.energyKwh += 0.18;
  const after = captureSnapshot(state);
  addLog(
    state,
    "action",
    "补水 · 蓄水池",
    `补水 +${round(added, 0)}% · 泵送能耗 0.18 kWh`,
    {
      before,
      after,
      triggeredAt: formatSimTime(state.elapsedHours),
      outcome: "完成"
    }
  );
  return true;
}

export function injectCritical(state, options = {}) {
  if (state.activeEvent || state.recovery || state.finished) return null;
  const type = options.type || "humidity";
  if (type === "humidity") {
    state.actual.humidity = options.demoFailure ? 89.2 : 87.6;
    state.observed.humidity = state.actual.humidity + state.sensorBias.humidity;
  } else if (type === "heat") {
    state.actual.temperature = 32.1;
    state.observed.temperature = state.actual.temperature + state.sensorBias.temperature;
  } else {
    state.actual.contamination = 27.4;
  }
  state.eventCooldownUntil = 0;
  return triggerEvent(state, type, {
    injected: true,
    demo: Boolean(options.demoFailure),
    demoFailure: Boolean(options.demoFailure),
    value: eventValue(state, type)
  });
}

export function startFailureDemo(state) {
  state.controls.fan = false;
  state.controls.mist = false;
  const event = injectCritical(state, { type: "humidity", demoFailure: true });
  if (!event) return null;
  event.demoFailure = true;
  event.deadlineAt = state.elapsedHours + 3;
  return event;
}

function updateClimate(state, dtHours) {
  const weather = weatherAt(state.weather, state.elapsedHours);
  const targetLight = weather.ambientLight + (state.controls.lights ? 500 : 0);
  const transpiration = 2.2 + state.actual.light / 500;
  const targetHumidity = clamp(
    weather.ambientHumidity +
      (state.controls.mist ? 18 : 0) -
      (state.controls.fan ? 22 : 0) +
      transpiration,
    22,
    98
  );
  const targetTemperature = clamp(
    weather.ambientTemperature +
      (state.controls.lights ? 1.8 : 0) +
      (state.controls.mist ? -1 : 0) -
      (state.controls.fan ? 2.3 : 0),
    8,
    42
  );

  state.actual.light = lerp(state.actual.light, targetLight, 1 - Math.exp(-dtHours / 0.55));
  state.actual.humidity = lerp(
    state.actual.humidity,
    targetHumidity,
    1 - Math.exp(-dtHours / 1.35)
  );
  state.actual.temperature = lerp(
    state.actual.temperature,
    targetTemperature,
    1 - Math.exp(-dtHours / 1.8)
  );

  if (state.controls.mist) state.actual.water -= dtHours * 0.115;
  state.actual.water -= dtHours * (0.012 + Math.max(0, state.actual.light - 600) / 28000);

  const humidPressure = Math.max(0, state.actual.humidity - 80);
  const heatPressure = Math.max(0, state.actual.temperature - 29);
  const airflow = state.controls.fan ? 0.12 : 0;
  const pollutionDelta = humidPressure * 0.035 + heatPressure * 0.05 - airflow;
  if (pollutionDelta > 0) {
    state.actual.contamination += pollutionDelta * dtHours;
  } else {
    state.actual.contamination -= Math.abs(pollutionDelta + 0.07) * dtHours;
  }

  state.actual.water = clamp(state.actual.water, 0, 100);
  state.actual.contamination = clamp(state.actual.contamination, 0, 100);
  state.historyMaxContamination = Math.max(
    state.historyMaxContamination,
    state.actual.contamination
  );

  const response = 1 - Math.exp(-dtHours / 0.72);
  const sensorNoise = {
    light: sensorOffset(state.seed, 0, state.elapsedHours) * 8,
    humidity: sensorOffset(state.seed, 1, state.elapsedHours) * 0.7,
    temperature: sensorOffset(state.seed, 2, state.elapsedHours) * 0.22
  };
  state.observed.light = lerp(
    state.observed.light,
    state.actual.light + state.sensorBias.light + sensorNoise.light,
    response
  );
  state.observed.humidity = lerp(
    state.observed.humidity,
    state.actual.humidity + state.sensorBias.humidity + sensorNoise.humidity,
    response
  );
  state.observed.temperature = lerp(
    state.observed.temperature,
    state.actual.temperature + state.sensorBias.temperature + sensorNoise.temperature,
    response
  );
  state.observed.light = clamp(state.observed.light, 0, 1300);
  state.observed.humidity = clamp(state.observed.humidity, 15, 100);
  state.observed.temperature = clamp(state.observed.temperature, 6, 45);
  return weather;
}

function updatePlants(state, weather, dtHours) {
  for (const plant of state.plants) {
    const row = ROWS.find((item) => item.id === plant.row);
    const env = rowEnvironment(plant.row, state.actual, weather);
    const lightComfort = metricComfort(env.light, row.needs.light);
    const humidityComfort = metricComfort(env.humidity, row.needs.humidity);
    const temperatureComfort = metricComfort(env.temperature, row.needs.temperature);
    const comfort = (lightComfort * 0.34 + humidityComfort * 0.33 + temperatureComfort * 0.33);
    const diseaseDrag = Math.max(0, state.actual.contamination - 16) * 0.004;
    plant.health = clamp(
      plant.health + (comfort * 100 - plant.health) * dtHours * 0.006 - diseaseDrag * dtHours,
      0,
      100
    );
    const dailyGrowth = (plant.heightGoal * 0.043 / DAY_HOURS) * dtHours;
    const vigor = (0.35 + comfort * 0.65) * clamp(plant.health / 100, 0.2, 1);
    plant.height = clamp(plant.height + dailyGrowth * vigor, 0, plant.heightGoal);
    plant.comfort = round(comfort * 100, 0);
  }
}

export function advanceSimulation(state, dtHours) {
  if (state.finished || !Number.isFinite(dtHours) || dtHours <= 0) return state;
  let remaining = Math.min(dtHours, 2);
  while (remaining > 0.00001 && !state.finished) {
    const step = Math.min(remaining, 0.1);
    state.elapsedHours += step;
    const power =
      (state.controls.lights ? 1.6 : 0) +
      (state.controls.mist ? 0.65 : 0) +
      (state.controls.fan ? 1.1 : 0);
    state.energyKwh += power * step;
    const weather = updateClimate(state, step);
    updatePlants(state, weather, step);
    updateEventLifecycle(state, step);
    processPendingChecks(state);
    remaining -= step;

    if (state.elapsedHours >= state.endAt) {
      state.finished = true;
      const met = targetMet(state);
      state.outcome = met === state.plants.length ? "success" : "incomplete";
      state.recovery = null;
      addLog(
        state,
        state.outcome === "success" ? "recovery" : "warning",
        state.outcome === "success" ? "20 天养护验收通过" : "20 天养护验收未达标",
        `达标 ${met}/${state.plants.length} · 最终病害 ${round(state.actual.contamination, 1)}% · 累计能耗 ${round(state.energyKwh, 1)} kWh`,
        {
          before: state.lastEvent?.before || null,
          after: captureSnapshot(state),
          triggeredAt: formatSimTime(state.endAt),
          outcome: state.outcome === "success" ? "成功" : "未达标"
        }
      );
    }
  }
  return state;
}

export function currentPower(state) {
  return (
    (state.controls.lights ? 1.6 : 0) +
    (state.controls.mist ? 0.65 : 0) +
    (state.controls.fan ? 1.1 : 0)
  );
}

export function forecast(state, count = 4) {
  const currentDay = Math.floor(state.elapsedHours / DAY_HOURS);
  return state.weather.slice(currentDay, currentDay + count).map((day, index) => ({
    ...day,
    offset: index,
    label: index === 0 ? "今日" : index === 1 ? "明日" : `+${index}`
  }));
}
