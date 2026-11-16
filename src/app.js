import { EstuarySimulation, GAME, runAcceptance } from "./sim.js";

const $ = (id) => document.getElementById(id);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const SIGNED = (value, digits = 2) => `${value >= 0 ? "+" : ""}${Number(value).toFixed(digits)}`;
const PERCENT = (value) => `${Math.round(value * 100)}%`;

const METRIC_DEFS = [
  {
    key: "temperature",
    observedKey: "temperature",
    actualKey: "tempDiff",
    deltaKey: "temperature",
    digits: 2,
    telemetryKey: "observedTemp",
    label: "水温差",
  },
  {
    key: "waterLevel",
    observedKey: "waterLevel",
    actualKey: "waterLevel",
    deltaKey: "waterLevel",
    digits: 2,
    telemetryKey: "observedLevel",
    label: "水位",
  },
  {
    key: "flow",
    observedKey: "flow",
    actualKey: "flow",
    deltaKey: "flow",
    digits: 2,
    telemetryKey: "observedFlow",
    label: "流速",
  },
  {
    key: "pollution",
    observedKey: "pollution",
    actualKey: "pollution",
    deltaKey: "pollution",
    digits: 1,
    telemetryKey: "observedPollution",
    label: "污染指数",
  },
  {
    key: "oxygen",
    observedKey: "oxygen",
    actualKey: "oxygen",
    deltaKey: "oxygen",
    digits: 2,
    telemetryKey: "observedOxygen",
    label: "溶解氧",
  },
  {
    key: "species",
    observedKey: "species",
    actualKey: "speciesCount",
    deltaKey: null,
    digits: 1,
    telemetryKey: "species",
    label: "物种数",
  },
];

const WEATHER_GLYPHS = {
  clear: "◒",
  overcast: "☁",
  rain: "☂",
  storm: "ϟ",
  clearing: "◐",
};

class EstuaryAudio {
  constructor() {
    this.context = null;
    this.enabled = false;
    this.nodes = null;
  }

  async enable() {
    if (!this.context) this.create();
    if (this.context.state === "suspended") await this.context.resume();
    this.enabled = true;
    this.nodes.master.gain.setTargetAtTime(0.55, this.context.currentTime, 0.2);
  }

  disable() {
    if (!this.context || !this.nodes) return;
    this.enabled = false;
    this.nodes.master.gain.setTargetAtTime(0.0001, this.context.currentTime, 0.12);
  }

  create() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("当前浏览器不支持 Web Audio");
    this.context = new AudioContextClass();
    const master = this.context.createGain();
    master.gain.value = 0.0001;
    master.connect(this.context.destination);

    const filter = this.context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 720;
    filter.Q.value = 0.75;

    const noiseGain = this.context.createGain();
    noiseGain.gain.value = 0.028;
    filter.connect(noiseGain);
    noiseGain.connect(master);

    const buffer = this.context.createBuffer(1, this.context.sampleRate * 2, this.context.sampleRate);
    const samples = buffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.018 * white) / 1.018;
      samples[index] = last * 3.2;
    }
    const noise = this.context.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    noise.connect(filter);
    noise.start();

    const humGain = this.context.createGain();
    humGain.gain.value = 0.018;
    humGain.connect(master);
    const hum = this.context.createOscillator();
    hum.type = "sine";
    hum.frequency.value = 74;
    hum.connect(humGain);
    hum.start();

    const overtoneGain = this.context.createGain();
    overtoneGain.gain.value = 0.005;
    overtoneGain.connect(master);
    const overtone = this.context.createOscillator();
    overtone.type = "triangle";
    overtone.frequency.value = 148;
    overtone.connect(overtoneGain);
    overtone.start();

    this.nodes = { master, filter, noiseGain, hum, humGain, overtone, overtoneGain };
  }

  update(model) {
    if (!this.context || !this.nodes || !this.enabled) return;
    const now = this.context.currentTime;
    const cutoff = 360 + model.temperature * 900 + model.flow * 1450;
    this.nodes.filter.frequency.setTargetAtTime(cutoff, now, 0.25);
    this.nodes.noiseGain.gain.setTargetAtTime(0.018 + model.flow * 0.035, now, 0.3);
    this.nodes.hum.frequency.setTargetAtTime(58 + model.temperature * 46, now, 0.35);
    this.nodes.overtone.frequency.setTargetAtTime(
      116 + model.temperature * 82 + model.flow * 24,
      now,
      0.35,
    );
    this.nodes.humGain.gain.setTargetAtTime(
      0.012 + (model.alarm === "critical" ? 0.012 : 0),
      now,
      0.4,
    );
  }
}

const state = {
  seed: GAME.seedDefault,
  sim: null,
  latestView: null,
  running: true,
  speed: 1,
  accumulator: 0,
  lastFrame: performance.now(),
  lastUi: 0,
  sceneTime: 0,
  acceptance: null,
  verifying: false,
  audio: new EstuaryAudio(),
  signatures: {},
  lastAlertLogId: null,
  toastTimer: null,
  canvas: null,
  ctx: null,
  viewWidth: 1,
  viewHeight: 1,
  dpr: 1,
  particles: [],
  fishSeeds: [],
  rainSeeds: [],
};

function numericSeed(raw) {
  const value = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(value)) return GAME.seedDefault;
  return Math.abs(value) % 4294967296;
}

function seededValue(seed, index) {
  let value = Math.imul(seed ^ (index + 1), 0x45d9f3b);
  value ^= value >>> 16;
  value = Math.imul(value, 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}

function resetSimulation(seed) {
  state.seed = numericSeed(seed);
  state.sim = new EstuarySimulation({ seed: state.seed });
  state.latestView = state.sim.getView();
  state.accumulator = 0;
  state.running = true;
  state.lastAlertLogId = null;
  state.signatures = {};
  state.fishSeeds = [];
  buildSceneSeeds();
  $("seedInput").value = String(state.seed);
  setRunState(true);
  syncControlInputs(state.latestView);
  updateUI(true);
  showToast(`已载入 seed ${state.seed}，天气与目标分布已重建`);
}

function buildSceneSeeds() {
  state.particles = Array.from({ length: 92 }, (_, index) => ({
    x: seededValue(state.seed + 11, index * 3),
    y: seededValue(state.seed + 29, index * 5),
    length: 0.012 + seededValue(state.seed + 43, index) * 0.03,
    speed: 0.6 + seededValue(state.seed + 71, index) * 0.8,
    drift: (seededValue(state.seed + 97, index) - 0.5) * 0.3,
  }));
  state.fishSeeds = Array.from({ length: 180 }, (_, index) => ({
    phase: seededValue(state.seed + 137, index) * Math.PI * 2,
    wobble: 5 + seededValue(state.seed + 149, index) * 17,
    speed: 0.65 + seededValue(state.seed + 163, index) * 0.9,
    size: 0.55 + seededValue(state.seed + 181, index) * 0.6,
  }));
  state.rainSeeds = Array.from({ length: 110 }, (_, index) => ({
    x: seededValue(state.seed + 211, index),
    y: seededValue(state.seed + 227, index),
    speed: 0.6 + seededValue(state.seed + 239, index) * 0.75,
    length: 0.012 + seededValue(state.seed + 251, index) * 0.035,
  }));
}

function setRunState(running) {
  state.running = running;
  const button = $("runToggleBtn");
  button.classList.toggle("paused", !running);
  $("runToggleText").textContent = running ? "暂停" : "继续";
  button.querySelector(".pause-glyph").textContent = running ? "Ⅱ" : "▶";
}

function showToast(message, alert = false) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.toggle("alert", alert);
  toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function zoneName(x) {
  if (x < 0.34) return "浅滩外缘";
  if (x > 0.68) return "主槽深水";
  return "过渡水道";
}

function alarmLabel(severity) {
  if (severity === "critical") return "临界";
  if (severity === "warning") return "预警";
  return "正常";
}

function updateUI(force = false) {
  const view = state.sim.getView();
  state.latestView = view;

  $("weatherIcon").textContent = WEATHER_GLYPHS[view.weather.type] || "◒";
  $("weatherIcon").dataset.type = view.weather.type;
  setText("weatherLabel", view.weather.label);
  setText("weatherWind", `风 ${view.weather.wind.toFixed(1)} m/s`);
  setText("clockLabel", view.clock);
  setText("elapsedLabel", view.elapsed);

  const alarmSummary = $("alarmSummary");
  alarmSummary.className = `alarm-summary ${view.overallAlarm}`;
  setText(
    "alarmText",
    view.overallAlarm === "critical"
      ? "临界告警"
      : view.overallAlarm === "warning"
        ? "预警"
        : "系统正常",
  );

  const levelTrend = view.actual.waterLevel > 1.75 ? "涨潮" : "落潮";
  setText("sceneWeather", `${view.weather.label} · ${levelTrend}`);
  setText("sceneReleaseX", `${Math.round(view.controls.releaseX * 100)}%`);
  setText("sceneGate", `${view.controls.gateSpeed.toFixed(1)} m/s`);
  $("sceneShell").classList.toggle("alert", view.overallAlarm === "critical");

  const activeCritical = view.criticalEvent && view.criticalEvent.status !== "resolved";
  $("sceneAlert").hidden = !activeCritical && view.overallAlarm !== "critical";
  if (!$("sceneAlert").hidden) {
    const criticalMetric = view.criticalEvent?.metric || "flow";
    const metric = METRIC_DEFS.find((item) => item.key === criticalMetric);
    setText("sceneAlertTitle", `临界事件 · ${metric?.label || "环境阈值"}`);
    setText(
      "sceneAlertDetail",
      view.recoveryWatch
        ? `恢复观察剩余 ${view.recoveryWatch.remaining.toFixed(1)} 分钟`
        : `${view.weather.label} · 调整配水、位置或闸门以解除`,
    );
  }

  const nextTarget = view.activeBatch
    ? view.targets[view.activeBatch.targetIndex]
    : view.nextTarget;
  if (nextTarget) {
    setText(
      "sceneTargetTitle",
      `${view.activeBatch ? "当前" : "下一"}目标 ${nextTarget.id} · ${nextTarget.label}`,
    );
    setText(
      "sceneTargetDetail",
      `${Math.round(nextTarget.x * 100)}% · ${nextTarget.fishCount.toLocaleString("zh-CN")} 尾`,
    );
  } else if (view.missionComplete) {
    setText("sceneTargetTitle", "三批目标已放流");
    setText("sceneTargetDetail", "持续监测恢复窗口");
  }

  METRIC_DEFS.forEach((definition) => updateMetricCard(view, definition));
  updateControls(view, force);
  updateMission(view);
  updateTargets(view, force);
  updateWeatherForecast(view, force);
  updateReleasePanel(view);
  updateEvents(view, force);
  updateLogs(view, force);
  state.audio.update(view.soundModel);
}

function updateMetricCard(view, definition) {
  const observed = view.observed[definition.observedKey];
  const actual = view.actual[definition.actualKey];
  const alarm = view.alarms[definition.key] || {
    severity: "normal",
    label: definition.key === "species" ? "稳定" : "正常",
  };
  const observedElement = $(`observed-${definition.key}`);
  const actualElement = $(`actual-${definition.key}`);
  const deltaElement = $(`delta-${definition.key}`);
  if (observedElement) observedElement.textContent = Number(observed).toFixed(definition.digits);
  if (actualElement) actualElement.textContent = Number(actual).toFixed(definition.digits);
  if (deltaElement && definition.deltaKey) {
    const delta = view.observationDelta[definition.deltaKey] || 0;
    deltaElement.textContent = SIGNED(delta, definition.digits === 1 ? 1 : 2);
  }

  const pill = $(`alarm-${definition.key}`);
  if (pill) {
    pill.className = `alarm-pill ${
      definition.key === "species" ? "neutral" : alarm.severity
    }`;
    pill.textContent = definition.key === "species" ? "稳定" : alarm.label;
  }
  const card = document.querySelector(`.metric-card[data-metric="${definition.key}"]`);
  if (card) {
    card.classList.remove("warning", "critical");
    if (definition.key !== "species" && alarm.severity !== "normal") {
      card.classList.add(alarm.severity);
    }
  }
  const values = view.telemetry
    .map((point) => point[definition.telemetryKey])
    .filter((value) => Number.isFinite(value));
  drawSparkline(`spark-${definition.key}`, values);
}

function drawSparkline(id, values) {
  const path = $(id);
  if (!path) return;
  if (values.length < 2) {
    path.setAttribute("d", "");
    return;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 0.001);
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * 120;
    const y = 21 - ((value - min) / span) * 17;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  path.setAttribute("d", `M${points.join(" L")}`);
}

function syncControlInputs(view) {
  $("mixTempRange").value = String(view.controls.mixTemp);
  $("releaseXRange").value = String(Math.round(view.controls.releaseX * 100));
  $("gateSpeedRange").value = String(view.controls.gateSpeed);
}

function updateControls(view, force) {
  const controls = view.controls;
  if (document.activeElement !== $("mixTempRange") || force) {
    $("mixTempRange").value = String(controls.mixTemp);
  }
  if (document.activeElement !== $("releaseXRange") || force) {
    $("releaseXRange").value = String(Math.round(controls.releaseX * 100));
  }
  if (document.activeElement !== $("gateSpeedRange") || force) {
    $("gateSpeedRange").value = String(controls.gateSpeed);
  }
  setText("mixTempValue", `${controls.mixTemp.toFixed(1)}°C`);
  setText("releaseXValue", `${zoneName(controls.releaseX)} ${Math.round(controls.releaseX * 100)}%`);
  setText("gateSpeedValue", `${controls.gateSpeed.toFixed(1)} m/s`);
  setText("estuaryObserved", `${view.observed.estuaryTemp.toFixed(2)}°C`);
  setText("releaseObserved", `${view.observed.releaseTemp.toFixed(2)}°C`);

  const pills = [
    `配水 <b>${controls.mixTemp.toFixed(1)}°C</b>`,
    `位置 <b>${zoneName(controls.releaseX)} ${Math.round(controls.releaseX * 100)}%</b>`,
    `闸门 <b>${controls.gateSpeed.toFixed(1)} m/s</b>`,
  ];
  $("interventionPills").innerHTML = pills.map((item) => `<span>${item}</span>`).join("");
}

function updateMission(view) {
  const completed = view.batches.filter((batch) => batch.status !== "releasing").length;
  setText("targetCountLabel", `${completed} / ${GAME.batchCount}`);
  const badge = $("missionBadge");
  badge.className = "status-badge";
  if (view.missionComplete) {
    badge.textContent = view.missionSuccess ? "任务成功" : "存在失败";
    if (!view.missionSuccess) badge.classList.add("failed");
  } else if (view.activeBatch) {
    badge.textContent = "放流中";
    badge.classList.add("active");
  } else if (view.batches.length > 0) {
    badge.textContent = "待下一批";
  } else {
    badge.textContent = "待命";
  }

  const steps = document.querySelectorAll(".batch-step");
  steps.forEach((step, index) => {
    const batch = view.batches[index];
    step.classList.remove("active", "success", "failed");
    let label = "待放流";
    if (batch) {
      if (batch.status === "releasing") {
        step.classList.add("active");
        label = `放流 ${Math.round(batch.progress * 100)}%`;
      } else if (batch.status === "success") {
        step.classList.add("success");
        label = `${Math.round(batch.survival * 100)}%`;
      } else {
        step.classList.add("failed");
        label = `${Math.round(batch.survival * 100)}% 失败`;
      }
    }
    step.querySelector("em").textContent = label;
  });

  const recovery = $("recoveryStatus");
  recovery.hidden = !view.recoveryWatch;
  if (view.recoveryWatch) {
    setText("recoveryCountdown", `${view.recoveryWatch.remaining.toFixed(1)} 分钟`);
  }

  const result = $("missionResult");
  result.hidden = !view.missionComplete;
  if (view.missionComplete) {
    const average =
      view.batches.reduce((sum, batch) => sum + batch.survival, 0) / Math.max(1, view.batches.length);
    setText("missionResultTitle", view.missionSuccess ? "三批放流达标" : "任务结束 · 有失败批次");
    setText("missionResultDetail", `平均存活 ${Math.round(average * 100)}%`);
  }
}

function updateTargets(view, force) {
  const signature = view.targets
    .map((target) => `${target.id}:${target.status}:${target.survival}`)
    .join("|");
  if (force || state.signatures.targets !== signature) {
    $("targetList").innerHTML = view.targets
      .map((target) => {
        const statusLabel =
          target.status === "success"
            ? `达标 ${Math.round(target.survival * 100)}%`
            : target.status === "failed"
              ? `失败 ${Math.round(target.survival * 100)}%`
              : target.status === "active"
                ? "放流中"
                : "待放流";
        return `
          <div class="target-row ${target.status}">
            <span class="target-index">${String(target.id).padStart(2, "0")}</span>
            <div>
              <strong>${target.label}</strong>
              <small>${Math.round(target.x * 100)}% · ${target.fishCount.toLocaleString("zh-CN")} 尾</small>
            </div>
            <span class="target-state">${statusLabel}</span>
          </div>`;
      })
      .join("");
    state.signatures.targets = signature;
  }
  const pending = view.targets.filter((target) => target.status === "pending").length;
  setText("targetRemaining", pending > 0 ? `${pending} 个目标` : "目标已放流");
  setText("seedFingerprint", `seed:${view.seed}`);
}

function updateWeatherForecast(view, force) {
  const signature = view.weatherForecast
    .map((segment) => `${segment.sequence}:${segment.active}:${Math.ceil(segment.startsIn)}`)
    .join("|");
  if (!force && state.signatures.forecast === signature) return;
  state.signatures.forecast = signature;
  $("weatherForecast").innerHTML = view.weatherForecast
    .map((segment) => {
      const timing = segment.active ? "进行中" : `+${Math.ceil(segment.startsIn)} 分`;
      return `
        <div class="forecast-item ${segment.type} ${segment.active ? "active" : ""}">
          <span>${timing}</span>
          <strong>${segment.label}</strong>
          <small>${segment.wind.toFixed(1)} m/s</small>
        </div>`;
    })
    .join("");
}

function updateReleasePanel(view) {
  const batch = view.activeBatch;
  const nextNumber = Math.min(view.batches.length + 1, GAME.batchCount);
  const button = $("releaseBtn");
  const progress = batch ? batch.progress : view.missionComplete ? 1 : 0;
  $("releaseProgressBar").style.width = `${progress * 100}%`;

  if (batch) {
    setText("releasePercent", `放流 ${Math.round(batch.progress * 100)}%`);
    setText("releaseBatchLabel", `第 ${batch.id} / ${GAME.batchCount} 批`);
    setText(
      "releaseSurvival",
      `实时存活 ${Math.round(batch.survival * 100)}% ≥ 78%`,
    );
    setText("releaseBtnText", `第 ${batch.id} 批放流中`);
    setText(
      "releaseBtnHint",
      `存活预估 ${Math.round(batch.survival * 100)}% · 完成 ${Math.round(batch.progress * 100)}%`,
    );
  } else if (view.missionComplete) {
    setText("releasePercent", view.missionSuccess ? "全部达标" : "任务结束");
    setText("releaseBatchLabel", "第 3 / 3 批");
    setText("releaseSurvival", `失败 ${view.failureCount} 批`);
    setText("releaseBtnText", "三批放流已完成");
    setText("releaseBtnHint", "重置后可继续验证其他策略");
  } else {
    const target = view.nextTarget;
    setText("releasePercent", "待命");
    setText("releaseBatchLabel", `第 ${nextNumber} / ${GAME.batchCount} 批`);
    setText("releaseSurvival", "目标存活率 ≥ 78%");
    setText("releaseBtnText", `开始第 ${nextNumber} 批放流`);
    setText(
      "releaseBtnHint",
      target
        ? `当前目标 · ${target.label} ${Math.round(target.x * 100)}%`
        : "等待目标生成",
    );
  }
  button.disabled = Boolean(batch) || view.missionComplete;
}

function updateEvents(view, force) {
  const majorEvents = view.events.filter((event) =>
    ["steady", "critical", "recovery", "failure"].includes(event.type),
  );
  const signature = majorEvents
    .map((event) => `${event.id}:${event.after ? event.after.timeMin : "active"}`)
    .join("|");
  if (!force && state.signatures.events === signature) return;
  state.signatures.events = signature;
  if (majorEvents.length === 0) {
    $("eventList").innerHTML = `
      <div class="empty-state">
        <span class="empty-glyph">⌁</span>
        <p>任务开始后自动记录稳态、临界事件与处置失败。</p>
      </div>`;
    return;
  }
  $("eventList").innerHTML = majorEvents
    .slice(-6)
    .reverse()
    .map((event) => {
      const before = event.before || {};
      const after = event.after;
      const species = formatComparison(before.species, after?.species, 1);
      const level = formatComparison(before.waterLevel, after?.waterLevel, 2);
      const pollution = formatComparison(before.pollution, after?.pollution, 1);
      return `
        <div class="event-row ${event.severity}">
          <div class="event-time">
            <b>${event.triggeredAt}</b>
            ${event.gameClock} · ${event.trigger === "batch_survival" ? "批次结算" : "环境阈值"}
          </div>
          <div class="event-main" title="${event.detail}">
            <strong>${event.title}</strong>
            <span>${event.detail}</span>
          </div>
          <div class="event-metric">${species}</div>
          <div class="event-metric">${level}</div>
          <div class="event-metric">${pollution}</div>
        </div>`;
    })
    .join("");
}

function formatComparison(before, after, digits) {
  if (!Number.isFinite(before) && !Number.isFinite(after)) return "<em>--</em>";
  const left = Number.isFinite(before) ? Number(before).toFixed(digits) : "--";
  const right = Number.isFinite(after) ? Number(after).toFixed(digits) : "监测中";
  return `<b>${left}</b> <em>→</em> ${right}`;
}

function updateLogs(view, force) {
  const signature = view.logs.map((entry) => entry.id).join("|");
  const latestAlert = [...view.logs]
    .reverse()
    .find((entry) => entry.severity === "alert" || entry.severity === "warning");
  if (
    latestAlert &&
    state.lastAlertLogId &&
    latestAlert.id !== state.lastAlertLogId &&
    latestAlert.severity === "alert"
  ) {
    showToast(`${latestAlert.triggeredAt} · ${latestAlert.title}`, true);
  }
  if (latestAlert) state.lastAlertLogId = latestAlert.id;

  if (!force && state.signatures.logs === signature) return;
  state.signatures.logs = signature;
  setText("logCount", `${view.logs.length} 条`);
  $("logList").innerHTML = view.logs
    .slice(-14)
    .reverse()
    .map(
      (entry) => `
        <div class="log-entry ${entry.severity}">
          <time>${entry.triggeredAt.replace("T+00:", "T+")}</time>
          <span class="log-severity"></span>
          <div class="log-copy">
            <strong>${entry.title}</strong>
            <span title="${entry.detail}">${entry.detail}</span>
          </div>
        </div>`,
    )
    .join("");
}

function updateVerification(result, error = null) {
  const summary = $("verificationSummary");
  const checks = $("verificationChecks");
  const footnote = $("verificationFootnote");
  if (state.verifying) {
    summary.className = "verification-summary running";
    summary.innerHTML = `
      <span class="verify-spinner"></span>
      <div><strong>正在运行确定性校验</strong><span>稳态 · 临界 · 失败 · 重开</span></div>`;
    checks.innerHTML = "";
    footnote.textContent = "验证使用独立模拟实例，不中断当前任务。";
    return;
  }
  if (error) {
    summary.className = "verification-summary failed";
    summary.innerHTML = `
      <span class="verify-spinner"></span>
      <div><strong>验证执行失败</strong><span>${error.message}</span></div>`;
    return;
  }
  if (!result) return;
  const passedCount = result.checks.filter((check) => check.passed).length;
  summary.className = `verification-summary ${result.passed ? "passed" : "failed"}`;
  summary.innerHTML = `
    <span class="verify-spinner"></span>
    <div>
      <strong>${result.passed ? "全部验证通过" : "存在未通过项目"} · ${passedCount}/${result.checks.length}</strong>
      <span>seed ${result.seed} · 同 seed 重开比对</span>
    </div>`;
  checks.innerHTML = result.checks
    .map(
      (check) => `
        <div class="verify-check ${check.passed ? "passed" : "failed"}" title="${check.detail}">
          <i></i><span>${check.label}</span>
        </div>`,
    )
    .join("");
  if (result.critical && result.failure) {
    footnote.textContent =
      `临界 ${result.critical.triggeredAt} ${result.critical.metric} ${result.critical.measured}/${result.critical.threshold} · ` +
      `失败 ${result.failure.triggeredAt} 存活 ${Math.round(result.failure.survival * 100)}%`;
  } else {
    footnote.textContent = `seed ${result.seed} · 独立实例验证`;
  }
}

function runVerification() {
  if (state.verifying) return;
  state.verifying = true;
  updateVerification(null);
  $("verifyBtn").disabled = true;
  setTimeout(() => {
    try {
      state.acceptance = runAcceptance(state.seed);
      state.verifying = false;
      $("verifyBtn").disabled = false;
      updateVerification(state.acceptance);
    } catch (error) {
      state.verifying = false;
      $("verifyBtn").disabled = false;
      updateVerification(null, error);
    }
  }, 60);
}

function setupCanvas() {
  state.canvas = $("scene");
  state.ctx = state.canvas.getContext("2d");
  const resize = () => {
    const rect = state.canvas.getBoundingClientRect();
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.viewWidth = Math.max(1, rect.width);
    state.viewHeight = Math.max(1, rect.height);
    state.canvas.width = Math.round(state.viewWidth * state.dpr);
    state.canvas.height = Math.round(state.viewHeight * state.dpr);
    state.ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  };
  resize();
  new ResizeObserver(resize).observe($("sceneShell"));
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function mapX(normalizedX, width) {
  return width * (0.075 + normalizedX * 0.85);
}

function drawScene(view) {
  const ctx = state.ctx;
  if (!ctx || !view) return;
  const width = state.viewWidth;
  const height = state.viewHeight;
  const time = state.sceneTime;
  ctx.clearRect(0, 0, width, height);
  drawWaterBase(ctx, width, height, time, view);
  drawBanks(ctx, width, height, time);
  drawCurrents(ctx, width, height, time, view);
  drawSensors(ctx, width, height, time);
  drawTargets(ctx, width, height, time, view);
  drawPredatorZone(ctx, width, height, time, view);
  drawBoatAndPlume(ctx, width, height, time, view);
  drawFish(ctx, width, height, time, view);
  drawWeather(ctx, width, height, time, view);
  drawSceneVignette(ctx, width, height, time, view);
}

function drawWaterBase(ctx, width, height, time, view) {
  const gradient = ctx.createLinearGradient(0, 0, width * 0.75, height);
  gradient.addColorStop(0, "#0b4154");
  gradient.addColorStop(0.42, "#0a5969");
  gradient.addColorStop(0.75, "#084653");
  gradient.addColorStop(1, "#052e3a");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(
    width * 0.56,
    height * 0.4,
    10,
    width * 0.56,
    height * 0.4,
    width * 0.58,
  );
  glow.addColorStop(0, "rgba(76, 179, 171, 0.13)");
  glow.addColorStop(0.6, "rgba(38, 125, 142, 0.02)");
  glow.addColorStop(1, "rgba(2, 18, 24, 0.24)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = "#9adbd5";
  ctx.lineWidth = 1;
  for (let row = 0; row < 8; row += 1) {
    ctx.beginPath();
    const y = height * (0.12 + row * 0.11);
    for (let x = -20; x <= width + 20; x += 22) {
      const waveY = y + Math.sin(x * 0.022 + time * 0.6 + row) * 2.4;
      if (x === -20) ctx.moveTo(x, waveY);
      else ctx.lineTo(x, waveY);
    }
    ctx.stroke();
  }
  ctx.restore();

  const cold = clamp((view.actual.estuaryTemp - 17) / 5, 0, 1);
  const warmth = ctx.createLinearGradient(0, height, width, 0);
  warmth.addColorStop(0, `rgba(34, 138, 150, ${0.11 + cold * 0.07})`);
  warmth.addColorStop(1, "rgba(183, 154, 91, 0.02)");
  ctx.fillStyle = warmth;
  ctx.fillRect(0, 0, width, height);
}

function drawBanks(ctx, width, height, time) {
  ctx.save();
  const leftBank = ctx.createLinearGradient(0, 0, width * 0.24, height);
  leftBank.addColorStop(0, "rgba(93, 92, 64, 0.7)");
  leftBank.addColorStop(0.5, "rgba(55, 65, 52, 0.48)");
  leftBank.addColorStop(1, "rgba(25, 39, 35, 0.32)");
  ctx.fillStyle = leftBank;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(width * 0.105, 0);
  ctx.bezierCurveTo(
    width * 0.14,
    height * 0.2,
    width * 0.075,
    height * 0.42,
    width * 0.135,
    height * 0.58,
  );
  ctx.bezierCurveTo(
    width * 0.17,
    height * 0.72,
    width * 0.08,
    height * 0.86,
    width * 0.135,
    height,
  );
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(184, 171, 116, 0.24)";
  ctx.lineWidth = 1;
  ctx.setLineDash([7, 6]);
  for (let index = 0; index < 5; index += 1) {
    const offset = width * (0.14 + index * 0.027);
    ctx.beginPath();
    ctx.moveTo(offset, height * 0.1);
    ctx.bezierCurveTo(
      offset + width * 0.015,
      height * 0.32,
      offset - width * 0.006,
      height * 0.58,
      offset + width * 0.025,
      height * 0.91,
    );
    ctx.stroke();
  }
  ctx.setLineDash([]);

  const shallowWash = ctx.createLinearGradient(0, 0, width * 0.34, 0);
  shallowWash.addColorStop(0, "rgba(188, 164, 103, 0.22)");
  shallowWash.addColorStop(0.5, "rgba(99, 137, 111, 0.1)");
  shallowWash.addColorStop(1, "rgba(44, 126, 130, 0)");
  ctx.fillStyle = shallowWash;
  ctx.fillRect(0, 0, width * 0.36, height);

  const islandGradient = ctx.createRadialGradient(
    width * 0.83,
    height * 0.09,
    1,
    width * 0.83,
    height * 0.09,
    width * 0.11,
  );
  islandGradient.addColorStop(0, "rgba(92, 105, 68, 0.4)");
  islandGradient.addColorStop(1, "rgba(39, 65, 56, 0.04)");
  ctx.fillStyle = islandGradient;
  ctx.beginPath();
  ctx.ellipse(width * 0.86, height * 0.075, width * 0.12, height * 0.055, -0.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(218, 211, 164, 0.31)";
  ctx.font = '500 9px "PingFang SC", sans-serif';
  ctx.fillText("浅滩 · 低水深", width * 0.026, height * 0.42);
  ctx.fillStyle = "rgba(174, 227, 221, 0.28)";
  ctx.fillText("主槽 · 深水", width * 0.76, height * 0.84);

  ctx.strokeStyle = "rgba(147, 214, 209, 0.12)";
  ctx.lineWidth = 1;
  for (let index = 0; index < 4; index += 1) {
    ctx.beginPath();
    ctx.moveTo(width * (0.39 + index * 0.09), height * 0.11);
    ctx.bezierCurveTo(
      width * (0.35 + index * 0.09),
      height * 0.35,
      width * (0.52 + index * 0.09),
      height * 0.58,
      width * (0.46 + index * 0.1),
      height * 0.94,
    );
    ctx.stroke();
  }
  ctx.restore();
}

function drawCurrents(ctx, width, height, time, view) {
  const flow = view.observed.flow;
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(163, 231, 224, 0.18)";
  ctx.lineWidth = Math.max(0.7, Math.min(1.5, 0.6 + flow * 0.35));
  state.particles.forEach((particle, index) => {
    const travel = (particle.y + time * (0.035 + flow * 0.035) * particle.speed) % 1.08;
    const y = travel * height - height * 0.04;
    const x =
      width * (0.08 + particle.x * 0.84) +
      Math.sin(time * 0.52 + index * 1.7) * width * 0.012 +
      particle.drift * width * 0.02;
    const length = height * particle.length * (0.7 + flow * 0.55);
    ctx.globalAlpha = 0.16 + particle.speed * 0.13;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(
      x + Math.sin(time + index) * 5,
      y + length * 0.5,
      x + Math.sin(time * 0.8 + index) * 2,
      y + length,
    );
    ctx.stroke();
  });

  ctx.globalAlpha = 0.35;
  ctx.setLineDash([8, 20]);
  ctx.lineDashOffset = -time * (12 + flow * 22);
  ctx.strokeStyle = "rgba(88, 211, 202, 0.24)";
  ctx.lineWidth = 1.2;
  for (let index = 0; index < 3; index += 1) {
    ctx.beginPath();
    ctx.moveTo(width * (0.23 + index * 0.23), -10);
    ctx.bezierCurveTo(
      width * (0.18 + index * 0.25),
      height * 0.3,
      width * (0.47 + index * 0.17),
      height * 0.64,
      width * (0.38 + index * 0.2),
      height + 10,
    );
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

function drawSensors(ctx, width, height, time) {
  ctx.save();
  [0.22, 0.5, 0.78].forEach((position, index) => {
    const x = width * position;
    const y = height * 0.9;
    const blink = 0.4 + Math.max(0, Math.sin(time * 2.1 + index * 2)) * 0.6;
    ctx.strokeStyle = "rgba(143, 203, 197, 0.26)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + 8);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y - 2, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(84, 224, 191, ${blink})`;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y - 2, 7 + Math.sin(time * 2 + index) * 2, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(84, 224, 191, ${0.12 * blink})`;
    ctx.stroke();
  });
  ctx.restore();
}

function drawTargets(ctx, width, height, time, view) {
  ctx.save();
  view.targets.forEach((target, index) => {
    const x = mapX(target.x, width);
    const y = height * target.y;
    const isActive = target.status === "active";
    const isPending = target.status === "pending";
    const color =
      target.status === "success"
        ? "84, 224, 191"
        : target.status === "failed"
          ? "255, 125, 105"
          : "240, 189, 104";
    const pulse = 0.5 + Math.sin(time * 2.3 + index) * 0.5;

    ctx.strokeStyle = `rgba(${color}, ${isPending ? 0.28 : 0.5})`;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.arc(x, y, 22 + (isActive ? pulse * 5 : 0), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${color}, 0.65)`;
    ctx.stroke();
    ctx.fillStyle = `rgba(${color}, ${isActive ? 0.2 : 0.1})`;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 2.4, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${color}, 0.9)`;
    ctx.fill();

    ctx.fillStyle = `rgba(${color}, 0.95)`;
    ctx.font = '600 8px "SFMono-Regular", monospace';
    ctx.textAlign = "center";
    ctx.fillText(`T${target.id}`, x, y - 28);
    ctx.textAlign = "left";

    if (isActive) {
      const boatX = mapX(view.controls.releaseX, width);
      const boatY = height * 0.205;
      ctx.strokeStyle = "rgba(240, 189, 104, 0.34)";
      ctx.setLineDash([2, 6]);
      ctx.beginPath();
      ctx.moveTo(boatX, boatY + 28);
      ctx.lineTo(x, y - 15);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });
  ctx.restore();
}

function drawPredatorZone(ctx, width, height, time, view) {
  const shallowDanger = view.activeBatch
    ? clamp((0.39 - view.controls.releaseX) / 0.28, 0, 1)
    : 0;
  if (shallowDanger <= 0.04) return;
  ctx.save();
  const gradient = ctx.createLinearGradient(0, 0, width * 0.35, 0);
  gradient.addColorStop(0, `rgba(255, 125, 105, ${0.07 + shallowDanger * 0.1})`);
  gradient.addColorStop(1, "rgba(255, 125, 105, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, height * 0.2, width * 0.36, height * 0.72);

  const count = 2 + Math.floor(shallowDanger * 3);
  for (let index = 0; index < count; index += 1) {
    const phase = time * (0.22 + index * 0.035) + index * 1.9;
    const x = width * (0.11 + index * 0.035) + Math.sin(phase) * width * 0.022;
    const y = height * (0.4 + index * 0.13) + Math.cos(phase * 0.8) * 8;
    drawPredator(ctx, x, y, 14 + index * 2, phase);
  }
  ctx.fillStyle = `rgba(255, 157, 142, ${0.45 + shallowDanger * 0.35})`;
  ctx.font = '500 8px "PingFang SC", sans-serif';
  ctx.fillText("捕食者活动区", width * 0.035, height * 0.31);
  ctx.restore();
}

function drawPredator(ctx, x, y, size, phase) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(phase * 0.3) * 0.2 - 0.1);
  ctx.fillStyle = "rgba(10, 18, 20, 0.62)";
  ctx.beginPath();
  ctx.moveTo(-size * 0.8, 0);
  ctx.quadraticCurveTo(0, -size * 0.32, size * 0.82, 0);
  ctx.quadraticCurveTo(0, size * 0.32, -size * 0.8, 0);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-size * 0.64, 0);
  ctx.lineTo(-size * 1.13, -size * 0.35);
  ctx.lineTo(-size * 1.03, size * 0.28);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255, 125, 105, 0.4)";
  ctx.beginPath();
  ctx.arc(size * 0.48, -size * 0.09, 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBoatAndPlume(ctx, width, height, time, view) {
  const boatX = mapX(view.controls.releaseX, width);
  const boatY = height * 0.195 + Math.sin(time * 1.1) * 1.2;
  const boatWidth = clamp(width * 0.052, 38, 62);
  const boatHeight = boatWidth * 1.58;
  const tempDelta = view.actual.tempDiff;
  const plumeColor = tempDelta > 3.2 ? "255, 125, 105" : "107, 232, 208";

  ctx.save();
  const plume = ctx.createLinearGradient(boatX, boatY, boatX, height * 0.42);
  plume.addColorStop(0, `rgba(${plumeColor}, 0.24)`);
  plume.addColorStop(1, `rgba(${plumeColor}, 0)`);
  ctx.fillStyle = plume;
  ctx.beginPath();
  ctx.moveTo(boatX - boatWidth * 0.18, boatY + boatHeight * 0.48);
  ctx.quadraticCurveTo(
    boatX - boatWidth * 0.95,
    boatY + boatHeight * 1.1,
    boatX - boatWidth * 0.5,
    height * 0.41,
  );
  ctx.lineTo(boatX + boatWidth * 0.5, height * 0.41);
  ctx.quadraticCurveTo(
    boatX + boatWidth * 0.95,
    boatY + boatHeight * 1.1,
    boatX + boatWidth * 0.18,
    boatY + boatHeight * 0.48,
  );
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(181, 231, 227, 0.2)";
  ctx.lineWidth = 1;
  for (let index = 0; index < 3; index += 1) {
    const wakeOffset = (index - 1) * boatWidth * 0.24;
    ctx.beginPath();
    ctx.moveTo(boatX + wakeOffset, boatY - boatHeight * 0.45);
    ctx.quadraticCurveTo(
      boatX + wakeOffset + Math.sin(time * 2 + index) * 5,
      boatY - boatHeight * 0.68,
      boatX + wakeOffset * 1.35,
      boatY - boatHeight * 0.84,
    );
    ctx.stroke();
  }

  ctx.translate(boatX, boatY);
  ctx.fillStyle = "rgba(0, 10, 13, 0.28)";
  ctx.beginPath();
  ctx.ellipse(4, boatHeight * 0.12, boatWidth * 0.65, boatHeight * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();

  const hull = ctx.createLinearGradient(-boatWidth / 2, 0, boatWidth / 2, 0);
  hull.addColorStop(0, "#607e81");
  hull.addColorStop(0.28, "#d9e8e3");
  hull.addColorStop(0.7, "#acc7c3");
  hull.addColorStop(1, "#4f7075");
  ctx.fillStyle = hull;
  ctx.strokeStyle = "rgba(216, 246, 240, 0.42)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -boatHeight * 0.52);
  ctx.lineTo(boatWidth * 0.42, -boatHeight * 0.34);
  ctx.lineTo(boatWidth * 0.49, boatHeight * 0.18);
  ctx.quadraticCurveTo(boatWidth * 0.35, boatHeight * 0.48, 0, boatHeight * 0.55);
  ctx.quadraticCurveTo(-boatWidth * 0.35, boatHeight * 0.48, -boatWidth * 0.49, boatHeight * 0.18);
  ctx.lineTo(-boatWidth * 0.42, -boatHeight * 0.34);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = "rgba(17, 60, 67, 0.44)";
  ctx.beginPath();
  ctx.moveTo(0, -boatHeight * 0.42);
  ctx.lineTo(0, boatHeight * 0.45);
  ctx.stroke();
  ctx.fillStyle = "rgba(27, 87, 92, 0.9)";
  roundedRect(
    ctx,
    -boatWidth * 0.25,
    -boatHeight * 0.2,
    boatWidth * 0.5,
    boatHeight * 0.29,
    3,
  );
  ctx.fill();
  ctx.fillStyle = "rgba(130, 220, 218, 0.7)";
  roundedRect(
    ctx,
    -boatWidth * 0.18,
    -boatHeight * 0.14,
    boatWidth * 0.36,
    boatHeight * 0.08,
    2,
  );
  ctx.fill();
  ctx.fillStyle = "rgba(8, 40, 46, 0.75)";
  roundedRect(
    ctx,
    -boatWidth * 0.31,
    boatHeight * 0.13,
    boatWidth * 0.62,
    boatHeight * 0.18,
    2,
  );
  ctx.fill();

  ctx.strokeStyle = "rgba(226, 205, 151, 0.7)";
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(-boatWidth * 0.14, -boatHeight * 0.06);
  ctx.lineTo(-boatWidth * 0.42, -boatHeight * 0.26);
  ctx.lineTo(-boatWidth * 0.56, -boatHeight * 0.12);
  ctx.stroke();
  ctx.fillStyle = "rgba(240, 189, 104, 0.9)";
  ctx.beginPath();
  ctx.arc(-boatWidth * 0.56, -boatHeight * 0.12, 1.7, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(5, 38, 43, 0.8)";
  ctx.font = '600 5px "SFMono-Regular", monospace';
  ctx.textAlign = "center";
  ctx.fillText("FRY 07", 0, boatHeight * 0.08);
  ctx.textAlign = "left";

  if (view.activeBatch) {
    const pulse = 0.45 + Math.sin(time * 5.5) * 0.4;
    ctx.fillStyle = `rgba(84, 224, 191, ${pulse})`;
    ctx.beginPath();
    ctx.arc(boatWidth * 0.36, boatHeight * 0.4, 2.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawFish(ctx, width, height, time, view) {
  ctx.save();
  view.batches.forEach((batch, batchIndex) => {
    const target = view.targets[batch.targetIndex];
    if (!target) return;
    const startX = mapX(batch.startControls?.releaseX ?? 0.5, width);
    const startY = height * 0.235;
    const endX = mapX(target.x, width);
    const endY = height * target.y;
    const progress = clamp(batch.progress || (batch.status === "releasing" ? 0 : 1), 0, 1);
    const fishCount = 13;
    const failed = batch.status === "failed";

    for (let index = 0; index < fishCount; index += 1) {
      const seedIndex = (batchIndex * fishCount + index) % state.fishSeeds.length;
      const fish = state.fishSeeds[seedIndex];
      const delay = (index % 4) * 0.018;
      const localProgress = clamp(progress * 1.12 - delay, 0, 1);
      const settle = batch.status === "success" ? 1 : 0;
      const sway = Math.sin(time * fish.speed * 1.25 + fish.phase) * fish.wobble;
      const swayY = Math.cos(time * fish.speed + fish.phase * 0.8) * fish.wobble * 0.55;
      const drift = 1 - localProgress;
      const x =
        startX +
        (endX - startX) * localProgress +
        sway * (0.45 + drift * 0.7) +
        Math.sin(fish.phase + time * 0.3) * settle * 10;
      const y =
        startY +
        (endY - startY) * localProgress +
        swayY * (0.5 + drift * 0.5) +
        Math.cos(fish.phase + time * 0.32) * settle * 7;
      const directionX = endX - startX + Math.sin(fish.phase) * 20;
      const directionY = endY - startY;
      const angle = Math.atan2(directionY, directionX) + Math.sin(time + fish.phase) * 0.18;
      drawFishBody(
        ctx,
        x,
        y,
        angle,
        fish.size * (failed ? 0.82 : 1),
        failed ? "rgba(255, 155, 139, 0.72)" : "rgba(116, 239, 208, 0.8)",
      );
    }

    if (batch.status === "success" || batch.status === "failed") {
      const color = failed ? "255, 125, 105" : "84, 224, 191";
      ctx.fillStyle = `rgba(${color}, 0.72)`;
      ctx.font = '500 7px "PingFang SC", sans-serif';
      ctx.textAlign = "center";
      ctx.fillText(
        `${batch.status === "success" ? "B" : "×"}${batch.id} ${Math.round(batch.survival * 100)}%`,
        endX,
        endY + 30,
      );
      ctx.textAlign = "left";
    }
  });
  ctx.restore();
}

function drawFishBody(ctx, x, y, angle, scale, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, 0, 3.4, 1.25, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-2.8, 0);
  ctx.lineTo(-5.5, -2.1);
  ctx.lineTo(-4.8, 0);
  ctx.lineTo(-5.5, 2.1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(4, 38, 38, 0.7)";
  ctx.beginPath();
  ctx.arc(2.1, -0.32, 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawWeather(ctx, width, height, time, view) {
  const weather = view.weather;
  const rainy = weather.type === "rain" || weather.type === "storm";
  if (!rainy && weather.type !== "overcast") {
    drawHeatShimmer(ctx, width, height, time, view);
    return;
  }

  ctx.save();
  if (weather.type === "overcast") {
    ctx.fillStyle = "rgba(7, 20, 25, 0.17)";
    ctx.fillRect(0, 0, width, height);
  }
  if (rainy) {
    ctx.fillStyle = `rgba(4, 17, 23, ${weather.type === "storm" ? 0.3 : 0.15})`;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle =
      weather.type === "storm" ? "rgba(165, 216, 224, 0.34)" : "rgba(174, 222, 225, 0.2)";
    ctx.lineWidth = weather.type === "storm" ? 1 : 0.7;
    const count = weather.type === "storm" ? state.rainSeeds.length : 64;
    for (let index = 0; index < count; index += 1) {
      const drop = state.rainSeeds[index];
      const y = ((drop.y + time * drop.speed * 0.34) % 1.1) * height;
      const x =
        ((drop.x + time * 0.012 + y / height * 0.11) % 1.1) * width -
        width * 0.05;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - height * drop.length * 0.38, y + height * drop.length);
      ctx.stroke();
    }
    const flash = weather.type === "storm" ? Math.max(0, Math.sin(time * 0.9) - 0.992) : 0;
    if (flash > 0) {
      ctx.fillStyle = `rgba(185, 230, 229, ${flash * 0.28})`;
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = `rgba(221, 248, 244, ${flash * 0.9})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(width * 0.72, 0);
      ctx.lineTo(width * 0.68, height * 0.11);
      ctx.lineTo(width * 0.73, height * 0.12);
      ctx.lineTo(width * 0.66, height * 0.23);
      ctx.stroke();
    }
  }
  ctx.restore();
  drawHeatShimmer(ctx, width, height, time, view);
}

function drawHeatShimmer(ctx, width, height, time, view) {
  if (!view.activeBatch || view.actual.tempDiff < 2.3) return;
  ctx.save();
  ctx.globalAlpha = clamp((view.actual.tempDiff - 2.3) / 3.5, 0.05, 0.24);
  ctx.strokeStyle = "#ffb29f";
  ctx.lineWidth = 1;
  for (let index = 0; index < 6; index += 1) {
    const x = mapX(view.controls.releaseX, width) + (index - 2.5) * 7;
    ctx.beginPath();
    for (let step = 0; step < 6; step += 1) {
      const y = height * 0.31 + step * 7;
      const waveX = x + Math.sin(time * 3 + step * 0.9 + index) * 3;
      if (step === 0) ctx.moveTo(waveX, y);
      else ctx.lineTo(waveX, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawSceneVignette(ctx, width, height, time, view) {
  ctx.save();
  const vignette = ctx.createRadialGradient(
    width * 0.5,
    height * 0.48,
    width * 0.25,
    width * 0.5,
    height * 0.48,
    width * 0.72,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,9,13,0.34)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  if (view.overallAlarm === "critical") {
    const pulse = 0.45 + Math.sin(time * 2.8) * 0.15;
    const alarm = ctx.createRadialGradient(
      width * 0.5,
      height * 0.5,
      width * 0.32,
      width * 0.5,
      height * 0.5,
      width * 0.7,
    );
    alarm.addColorStop(0, "rgba(255, 125, 105, 0)");
    alarm.addColorStop(1, `rgba(255, 91, 76, ${0.12 * pulse})`);
    ctx.fillStyle = alarm;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
}

function bindControls() {
  $("mixTempRange").addEventListener("input", (event) => {
    state.sim.setControl("mixTemp", Number(event.target.value));
    updateUI();
  });
  $("releaseXRange").addEventListener("input", (event) => {
    state.sim.setControl("releaseX", Number(event.target.value) / 100);
    updateUI();
  });
  $("gateSpeedRange").addEventListener("input", (event) => {
    state.sim.setControl("gateSpeed", Number(event.target.value));
    updateUI();
  });

  $("alignTempBtn").addEventListener("click", () => {
    const temperature = Number(state.latestView.observed.estuaryTemp.toFixed(1));
    state.sim.setControl("mixTemp", temperature);
    $("mixTempRange").value = String(temperature);
    updateUI(true);
    showToast(`配水温度已跟随河口观测 ${temperature.toFixed(1)}°C`);
  });

  $("alignTargetBtn").addEventListener("click", () => {
    const target = state.latestView.nextTarget;
    if (!target) {
      showToast("三批目标已全部放流");
      return;
    }
    state.sim.setControl("releaseX", target.x);
    $("releaseXRange").value = String(Math.round(target.x * 100));
    updateUI(true);
    showToast(`放流位置已对准目标 ${target.id} · ${Math.round(target.x * 100)}%`);
  });

  $("releaseBtn").addEventListener("click", () => {
    const batch = state.sim.startBatch();
    if (!batch) return;
    updateUI(true);
    showToast(`第 ${batch.id} 批开始放流 · ${batch.fishCount.toLocaleString("zh-CN")} 尾`);
  });

  $("runToggleBtn").addEventListener("click", () => {
    setRunState(!state.running);
    showToast(state.running ? "模拟继续运行" : "模拟已暂停，环境不再推进");
  });

  document.querySelectorAll("[data-speed]").forEach((button) => {
    button.addEventListener("click", () => {
      state.speed = Number(button.dataset.speed);
      document.querySelectorAll("[data-speed]").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
      showToast(`运行速度 ${state.speed}×`);
    });
  });

  $("resetBtn").addEventListener("click", () => {
    resetSimulation(state.seed);
    scheduleVerification();
  });

  $("applySeedBtn").addEventListener("click", () => {
    resetSimulation($("seedInput").value);
    scheduleVerification();
  });
  $("seedInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      resetSimulation($("seedInput").value);
      scheduleVerification();
    }
  });

  $("soundBtn").addEventListener("click", async () => {
    const button = $("soundBtn");
    try {
      if (state.audio.enabled) {
        state.audio.disable();
        button.setAttribute("aria-pressed", "false");
        button.title = "开启环境声音";
        showToast("环境声音已关闭");
      } else {
        await state.audio.enable();
        button.setAttribute("aria-pressed", "true");
        button.title = "关闭环境声音";
        showToast("环境声音已开启：音色随水温与流速变化");
      }
    } catch (error) {
      showToast(`声音不可用：${error.message}`, true);
    }
  });

  $("verifyBtn").addEventListener("click", runVerification);

  document.addEventListener("keydown", (event) => {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (event.code === "Space") {
      event.preventDefault();
      setRunState(!state.running);
    }
    if (event.key.toLowerCase() === "r") {
      resetSimulation(state.seed);
      scheduleVerification();
    }
  });
}

let verificationTimer = null;
function scheduleVerification(delay = 220) {
  clearTimeout(verificationTimer);
  verificationTimer = setTimeout(runVerification, delay);
}

function loop(now) {
  const dt = Math.min(0.12, Math.max(0, (now - state.lastFrame) / 1000));
  state.lastFrame = now;
  state.sceneTime += dt;

  if (state.running) {
    state.accumulator += dt * state.speed;
    let steps = 0;
    while (state.accumulator >= GAME.stepMinutes && steps < 140) {
      state.sim.step(GAME.stepMinutes);
      state.accumulator -= GAME.stepMinutes;
      steps += 1;
    }
  }

  if (now - state.lastUi >= 80) {
    updateUI();
    state.lastUi = now;
  }
  drawScene(state.latestView);
  requestAnimationFrame(loop);
}

function init() {
  const querySeed = new URLSearchParams(window.location.search).get("seed");
  state.seed = numericSeed(querySeed ?? GAME.seedDefault);
  state.sim = new EstuarySimulation({ seed: state.seed });
  state.latestView = state.sim.getView();
  $("seedInput").value = String(state.seed);
  buildSceneSeeds();
  setupCanvas();
  bindControls();
  syncControlInputs(state.latestView);
  updateUI(true);
  setRunState(true);
  scheduleVerification(320);
  requestAnimationFrame((now) => {
    state.lastFrame = now;
    state.lastUi = now;
    requestAnimationFrame(loop);
  });
}

init();
