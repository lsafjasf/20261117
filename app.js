import {
  ROWS,
  addLog,
  advanceSimulation,
  captureSnapshot,
  climateStatus,
  createSimulation,
  currentPower,
  formatSimTime,
  forecast,
  growDay,
  injectCritical,
  recordSteadySample,
  refillWater,
  rowEnvironment,
  startFailureDemo,
  targetMet,
  toggleControl,
  weatherAt
} from "./sim.js";
import { drawGreenhouse } from "./draw.js";
import { GreenhouseSound } from "./sound.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  canvas: $("#greenhouseCanvas"),
  seedInput: $("#seedInput"),
  seedApply: $("#seedApply"),
  resetBtn: $("#resetBtn"),
  pauseBtn: $("#pauseBtn"),
  runState: $("#runState"),
  runLabel: $("#runLabel"),
  simClock: $("#simClock"),
  speedButtons: $$(".speed-switch button"),
  weatherIcon: $("#weatherIcon"),
  weatherNow: $("#weatherNow"),
  nextWeather: $("#nextWeather"),
  sceneTargets: $("#sceneTargets"),
  sceneAlert: $("#sceneAlert"),
  sceneAlertText: $("#sceneAlertText"),
  growDay: $("#growDay"),
  dayCountdown: $("#dayCountdown"),
  weatherDigest: $("#weatherDigest"),
  goalMet: $("#goalMet"),
  goalDay: $("#goalDay"),
  goalProgress: $("#goalProgress"),
  targetList: $("#targetList"),
  seedCode: $("#seedCode"),
  powerNow: $("#powerNow"),
  energyKwh: $("#energyKwh"),
  switchEnergy: $("#switchEnergy"),
  switchCount: $("#switchCount"),
  switchWarning: $("#switchWarning"),
  waterLevel: $("#waterLevel"),
  waterFill: $("#waterFill"),
  contaminationValue: $("#contaminationValue"),
  contaminationState: $("#contaminationState"),
  eventCard: $("#eventCard"),
  eventKicker: $("#eventKicker"),
  eventTitle: $("#eventTitle"),
  eventBadge: $("#eventBadge"),
  eventDetail: $("#eventDetail"),
  eventValue: $("#eventValue"),
  eventAction: $("#eventAction"),
  eventTrigger: $("#eventTrigger"),
  residualChip: $("#residualChip"),
  recoveryPanel: $("#recoveryPanel"),
  recoveryText: $("#recoveryText"),
  recoveryPercent: $("#recoveryPercent"),
  recoveryFill: $("#recoveryFill"),
  residualStatus: $("#residualStatus"),
  logList: $("#logList"),
  logCount: $("#logCount"),
  forecastList: $("#forecastList"),
  toast: $("#toast"),
  endOverlay: $("#endOverlay"),
  endTitle: $("#endTitle"),
  endText: $("#endText"),
  endReset: $("#endReset"),
  refillBtn: $("#refillBtn"),
  steadyBtn: $("#steadyBtn"),
  criticalBtn: $("#criticalBtn"),
  failureBtn: $("#failureBtn"),
  soundBtn: $("#soundBtn"),
  soundLabel: $("#soundLabel")
};

let sim = createSimulation(elements.seedInput.value);
const sound = new GreenhouseSound();
let speed = 4;
let paused = false;
let lastFrame = performance.now();
let lastUiPaint = 0;
let lastLogSignature = "";
let lastToastAt = 0;
let toastTimer = 0;
let lastActiveEventId = null;
let lastRecoveryEventId = null;

const histories = {
  light: [],
  humidity: [],
  temperature: []
};

const HISTORY_LENGTH = 34;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function precision(value, digits = 1) {
  return Number(value).toFixed(digits);
}

function statusClass(level) {
  return level === "good" ? "good" : level;
}

function showToast(message, kind = "normal") {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.className = `toast show${kind === "alert" ? " alert" : ""}`;
  toastTimer = window.setTimeout(() => {
    elements.toast.className = "toast";
  }, 3200);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function pushHistory(metric, observed, actual) {
  const list = histories[metric];
  list.push({ observed, actual });
  if (list.length > HISTORY_LENGTH) list.shift();
}

function drawSpark(id, values, color) {
  const svg = $(id);
  if (!svg || values.length < 2) return;
  const width = 180;
  const height = 30;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(0.001, max - min);
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - 3 - ((value - min) / range) * (height - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  svg.innerHTML = `<path d="M${points.join(" L")}" stroke="${color}"/>`;
}

function initialPaint() {
  elements.sceneTargets.textContent = sim.targets.map((target) => target.position).join(" · ");
  elements.targetList.textContent = sim.targets.map((target) => target.position).join(" / ");
  elements.weatherDigest.textContent = sim.weatherDigest;
  elements.seedCode.textContent = sim.seedCode;
  elements.seedInput.value = sim.seed;
  for (const metric of Object.keys(histories)) {
    histories[metric] = [{ observed: sim.observed[metric], actual: sim.actual[metric] }];
  }
  paintUi(true);
}

function resetSimulation(seed, message) {
  const previous = {
    seed: sim.seed,
    digest: sim.weatherDigest,
    targets: sim.targets.map((target) => target.position).join(",")
  };
  sim = createSimulation(seed);
  paused = false;
  lastActiveEventId = null;
  lastRecoveryEventId = null;
  lastLogSignature = "";
  histories.light = [{ observed: sim.observed.light, actual: sim.actual.light }];
  histories.humidity = [{ observed: sim.observed.humidity, actual: sim.actual.humidity }];
  histories.temperature = [{ observed: sim.observed.temperature, actual: sim.actual.temperature }];
  elements.endOverlay.hidden = true;
  elements.seedInput.value = sim.seed;
  const digestMatches = previous.digest === sim.weatherDigest;
  const targetsMatch = previous.targets === sim.targets.map((target) => target.position).join(",");
  if (String(seed) === previous.seed) {
    addLog(
      sim,
      "system",
      "同种子重开校验",
      `天气 ${sim.weatherDigest} · 目标 ${sim.targets.map((target) => target.position).join(" / ")}`,
      {
        outcome: digestMatches && targetsMatch ? "一致" : "不一致",
        triggeredAt: formatSimTime(sim.elapsedHours)
      }
    );
  }
  initialPaint();
  updatePauseButton();
  showToast(message);
}

function paintMetric(metric, status) {
  const observed = sim.observed[metric];
  const actual = sim.actual[metric];
  const digits = metric === "temperature" ? 1 : 0;
  $(`#${metric}Observed`).textContent = precision(observed, digits);
  $(`#${metric}Actual`).textContent = precision(actual, digits);
  const chip = $(`#${metric}Status`);
  chip.textContent = status.label;
  chip.className = `status-chip ${statusClass(status.level)}`;
  const percent = metric === "light"
    ? clamp(observed / 1100 * 100, 4, 100)
    : metric === "humidity"
      ? clamp(observed, 4, 100)
      : clamp((observed - 8) / 34 * 100, 4, 100);
  const track = $(`#${metric}Track`);
  track.style.width = `${percent}%`;
  track.style.background = status.level === "critical"
    ? "var(--red)"
    : status.level === "warning"
      ? "var(--orange)"
      : "var(--lime)";
  drawSpark(
    `#${metric}Spark`,
    histories[metric].map((point) => point.observed),
    status.level === "critical" ? "#c65a47" : status.level === "warning" ? "#dd8547" : "#657f45"
  );
}

function renderLogs(force = false) {
  const signature = `${sim.logs.length}:${sim.logs[0]?.id || "none"}`;
  if (!force && signature === lastLogSignature) return;
  lastLogSignature = signature;
  elements.logCount.textContent = `${sim.logs.length} 条记录`;
  elements.logList.innerHTML = sim.logs.map((entry) => {
    const before = entry.before;
    const after = entry.after;
    const pills = [];
    if (before && after) {
      pills.push(`<span class="compare-pill">目标 <b>${before.metCount}→${after.metCount}</b></span>`);
      pills.push(`<span class="compare-pill">水位 <b>${before.water}→${after.water}</b></span>`);
      pills.push(`<span class="compare-pill">病害 <b>${before.contamination}→${after.contamination}</b></span>`);
    }
    if (entry.triggeredAt) {
      pills.push(`<span class="compare-pill">触发 <b>${escapeHtml(entry.triggeredAt)}</b></span>`);
    }
    return `
      <article class="log-entry" data-kind="${escapeHtml(entry.kind)}">
        <div class="log-primary">
          <span class="log-time">${escapeHtml(entry.time)}</span>
          <span class="log-title"><i class="log-dot"></i>${escapeHtml(entry.title)}</span>
          <span class="log-detail">${escapeHtml(entry.detail)}</span>
        </div>
        <div class="log-compare">${pills.join("")}</div>
        <span class="log-outcome">${escapeHtml(entry.outcome || "记录")}</span>
      </article>`;
  }).join("");
}

function renderForecast() {
  const days = forecast(sim, 4);
  elements.forecastList.innerHTML = days.map((day) => `
    <div class="forecast-day${day.offset === 0 ? " today" : ""}">
      <span>${escapeHtml(day.label)}</span>
      <i class="weather-icon ${escapeHtml(day.icon)}" aria-hidden="true"></i>
      <b>${day.temperature.toFixed(0)}°</b>
      <small>${day.humidity.toFixed(0)}% / ${escapeHtml(day.label)}</small>
    </div>`).join("");
}

function renderSpecies(weather) {
  for (const row of ROWS) {
    const plants = sim.plants.filter((plant) => plant.row === row.id);
    const averageHealth = plants.reduce((sum, plant) => sum + plant.health, 0) / plants.length;
    const averageHeight = plants.reduce((sum, plant) => sum + plant.height, 0) / plants.length;
    const env = rowEnvironment(row.id, sim.actual, weather);
    const fits = env.light >= row.needs.light[0] && env.light <= row.needs.light[1] &&
      env.humidity >= row.needs.humidity[0] && env.humidity <= row.needs.humidity[1] &&
      env.temperature >= row.needs.temperature[0] && env.temperature <= row.needs.temperature[1];
    $(`#row${row.id}-height`).textContent = averageHeight.toFixed(1);
    $(`#row${row.id}-health`).textContent = averageHealth.toFixed(0);
    $(`#row${row.id}-env`).textContent =
      `${env.light} lx · ${env.humidity.toFixed(0)}% · ${env.temperature.toFixed(1)}°`;
    const status = $(`#row${row.id}-status`);
    status.textContent = fits ? "适生" : "偏差";
    status.className = `row-state${fits ? "" : " warning"}`;
  }
}

function renderEvent() {
  const event = sim.activeEvent;
  const recovery = sim.recovery;
  const last = sim.lastEvent;
  elements.eventCard.classList.remove("alerting", "recovering");
  elements.eventAction.hidden = true;
  elements.recoveryPanel.hidden = true;

  if (event) {
    elements.eventCard.classList.add("alerting");
    elements.eventKicker.textContent = "CRITICAL EVENT";
    elements.eventTitle.textContent = event.title;
    elements.eventBadge.textContent = event.demoFailure ? "失联" : "临界";
    elements.eventBadge.className = "event-badge critical";
    const currentValue = event.type === "heat"
      ? `${sim.actual.temperature.toFixed(1)} °C`
      : event.type === "disease"
        ? `${sim.actual.contamination.toFixed(1)}%`
        : `${sim.actual.humidity.toFixed(1)}% RH`;
    elements.eventValue.textContent = `${event.triggerValue} → ${currentValue}`;
    if (event.demoFailure) {
      elements.eventDetail.textContent = "操作台失联演练：无法人工干预，窗口结束后自动记录处置失败。";
    } else {
      elements.eventDetail.textContent =
        `触发于 ${formatSimTime(event.startedAt)}。开启通风可将${event.type === "heat" ? "温度" : "湿度"}降至安全线；窗口 ${Math.max(0, event.deadlineAt - sim.elapsedHours).toFixed(1)} 模拟小时。`;
      elements.eventAction.hidden = false;
      elements.eventAction.disabled = sim.controls.fan;
      elements.eventAction.textContent = sim.controls.fan
        ? "通风已开启 · 等待降湿"
        : sim.controls.mist
          ? "关闭喷雾并启动通风"
          : "启动通风并记录";
    }
  } else if (recovery) {
    elements.eventCard.classList.add("recovering");
    elements.eventKicker.textContent = "RESIDUAL WATCH";
    elements.eventTitle.textContent = "恢复观察中";
    elements.eventBadge.textContent = "观察";
    elements.eventBadge.className = "event-badge";
    elements.eventDetail.textContent = "处置已完成。系统继续运行固定观察窗，检查病害与水汽是否出现隐藏残留。";
    elements.eventValue.textContent = `检查 ${recovery.checks} 次 · 异常 ${recovery.anomalies}`;
    elements.recoveryPanel.hidden = false;
    const progress = clamp(
      (sim.elapsedHours - recovery.startedAt) / (recovery.endsAt - recovery.startedAt),
      0,
      1
    );
    const remaining = Math.max(0, recovery.endsAt - sim.elapsedHours);
    elements.recoveryText.textContent = `恢复观察 ${remaining.toFixed(1)} h`;
    elements.recoveryPercent.textContent = `${Math.round(progress * 100)}%`;
    elements.recoveryFill.style.width = `${progress * 100}%`;
    elements.residualStatus.textContent = recovery.anomalies
      ? `检测到 ${recovery.anomalies} 次残留反弹`
      : "湿度与病害未出现反弹";
  } else if (last?.status === "failed") {
    elements.eventCard.classList.add("alerting");
    elements.eventKicker.textContent = "INTERVENTION FAILED";
    elements.eventTitle.textContent = "处置失败记录";
    elements.eventBadge.textContent = "失败";
    elements.eventBadge.className = "event-badge critical";
    elements.eventDetail.textContent = `${last.failureReason}。触发时刻 ${formatSimTime(last.startedAt)}，病害与水位的操作前后差值已写入运行记录。`;
    elements.eventValue.textContent = `病害负荷 ${sim.actual.contamination.toFixed(1)}%`;
  } else {
    elements.eventKicker.textContent = "SYSTEM NOMINAL";
    elements.eventTitle.textContent = "环境稳态";
    elements.eventBadge.textContent = "正常";
    elements.eventBadge.className = "event-badge good";
    elements.eventDetail.textContent = "传感器与执行器无异常，系统正在连续采样。恢复完成的事件会保留固定观察窗记录。";
    elements.eventValue.textContent = `稳态 ${sim.steadySince.toFixed(1)} h`;
  }

  const lastTrigger = event?.startedAt ?? last?.startedAt;
  elements.eventTrigger.textContent = lastTrigger
    ? `最近触发 ${formatSimTime(lastTrigger)}`
    : "最近触发 —";
  const recoveryLog = sim.logs.find((entry) => entry.title.includes("恢复观察完成"));
  elements.residualChip.textContent = recoveryLog
    ? `残留自检 ${recoveryLog.outcome}`
    : "残留自检 —";
}

function paintUi(force = false) {
  const now = performance.now();
  if (!force && now - lastUiPaint < 90) return;
  lastUiPaint = now;
  const weather = weatherAt(sim.weather, sim.elapsedHours);
  const status = climateStatus(sim);
  const met = targetMet(sim);

  elements.simClock.textContent = formatSimTime(sim.elapsedHours);
  elements.growDay.textContent = `第 ${String(growDay(sim.elapsedHours, sim.startHour)).padStart(2, "0")} 天 / 20`;
  elements.dayCountdown.textContent = `${(24 - (sim.elapsedHours % 24)).toFixed(1)} h`;
  elements.weatherNow.textContent = `${weather.label} · 室外 ${weather.ambientTemperature.toFixed(1)}°C`;
  const next = forecast(sim, 2)[1];
  elements.nextWeather.textContent = next ? `明日 ${next.label} · ${next.temperature.toFixed(0)}°` : "";
  elements.weatherIcon.className = `weather-icon ${weather.icon}`;
  elements.weatherDigest.textContent = sim.weatherDigest;
  elements.seedCode.textContent = sim.seedCode;

  paintMetric("light", status.light);
  paintMetric("humidity", status.humidity);
  paintMetric("temperature", status.temperature);

  elements.goalMet.textContent = met;
  elements.goalDay.textContent = `第 ${growDay(sim.elapsedHours, sim.startHour)} 天`;
  elements.goalProgress.style.width = `${(growDay(sim.elapsedHours, sim.startHour) / 20) * 100}%`;
  renderSpecies(weather);

  elements.powerNow.textContent = currentPower(sim).toFixed(2);
  elements.energyKwh.textContent = sim.energyKwh.toFixed(1);
  elements.switchEnergy.textContent = `切换损耗 ${sim.switchPenaltyKwh.toFixed(2)} kWh`;
  elements.switchCount.textContent = sim.switchCount;
  elements.switchWarning.textContent = sim.switchPenaltyKwh > 0
    ? `频繁切换 +${sim.switchPenaltyKwh.toFixed(2)} kWh`
    : "稳定运行";
  elements.switchWarning.className = sim.switchPenaltyKwh > 0 ? "warning" : "";
  elements.waterLevel.textContent = Math.round(sim.actual.water);
  elements.waterFill.style.width = `${sim.actual.water}%`;
  elements.waterFill.style.background = sim.actual.water < 25 ? "var(--orange)" : "var(--blue)";
  elements.contaminationValue.textContent = `${sim.actual.contamination.toFixed(1)}%`;
  elements.contaminationState.textContent = status.contamination.label;
  elements.contaminationState.className = `status-chip ${statusClass(status.contamination.level)}`;

  const controlMap = { lights: "Lights", mist: "Mist", fan: "Fan" };
  for (const [key, suffix] of Object.entries(controlMap)) {
    const on = sim.controls[key];
    $(`#intervention${suffix}`).className = `intervention-tag${on ? " on" : ""}`;
    $(`#intervention${suffix} small`).textContent = on ? "运行" : "关闭";
    const button = $(`.device-control[data-control="${key}"]`);
    button.classList.toggle("is-on", on);
    button.querySelector(".toggle-state").textContent = on ? "ON" : "OFF";
  }

  const critical = [
    status.humidity.level === "critical" ? status.humidity.label : "",
    status.temperature.level === "critical" ? status.temperature.label : "",
    status.contamination.level === "critical" ? status.contamination.label : ""
  ].filter(Boolean);
  elements.sceneAlert.hidden = critical.length === 0;
  if (critical.length) elements.sceneAlertText.textContent = critical.join(" / ");

  renderEvent();
  renderLogs(force);
  renderForecast();
  elements.runState.classList.toggle("paused", paused);
  elements.runLabel.textContent = paused ? "已暂停" : "连续运行";

  if (sim.finished) {
    elements.endOverlay.hidden = false;
    elements.endTitle.textContent = sim.outcome === "success" ? "20 天养护达标" : "周期结束 · 仍有目标未达标";
    elements.endText.textContent =
      `达标 ${met}/${sim.plants.length} · 累计能耗 ${sim.energyKwh.toFixed(1)} kWh · 天气指纹 ${sim.weatherDigest}`;
  }

  if (sim.activeEvent && sim.activeEvent.id !== lastActiveEventId) {
    lastActiveEventId = sim.activeEvent.id;
    sound.alert();
    showToast(`${sim.activeEvent.title} · 触发于 ${formatSimTime(sim.activeEvent.startedAt)}`, "alert");
  }
  if (!sim.activeEvent) lastActiveEventId = null;
  if (sim.recovery && sim.recovery.eventId !== lastRecoveryEventId) {
    lastRecoveryEventId = sim.recovery.eventId;
    showToast("处置生效，开始 8 小时恢复观察");
  }
  if (!sim.recovery) lastRecoveryEventId = null;
}

function updatePauseButton() {
  elements.pauseBtn.textContent = paused ? "继续" : "暂停";
  elements.runState.classList.toggle("paused", paused);
  elements.runLabel.textContent = paused ? "已暂停" : "连续运行";
}

function setSpeed(nextSpeed) {
  speed = nextSpeed;
  for (const button of elements.speedButtons) {
    button.classList.toggle("active", Number(button.dataset.speed) === speed);
  }
}

function bindControls() {
  for (const button of elements.speedButtons) {
    button.addEventListener("click", () => {
      setSpeed(Number(button.dataset.speed));
      showToast(`模拟速度 ${speed}× · 1 秒 = ${speed} 模拟小时`);
    });
  }

  elements.pauseBtn.addEventListener("click", () => {
    paused = !paused;
    updatePauseButton();
    showToast(paused ? "模拟已暂停，可检查当前状态" : "已恢复连续运行");
  });

  elements.resetBtn.addEventListener("click", () => {
    resetSimulation(sim.seed, `已用种子 ${sim.seed} 重开 · 天气与目标分布一致`);
  });
  elements.endReset.addEventListener("click", () => {
    resetSimulation(sim.seed, `已用种子 ${sim.seed} 重开 · 天气与目标分布一致`);
  });

  elements.seedApply.addEventListener("click", () => {
    const nextSeed = elements.seedInput.value.trim() || sim.seed;
    if (nextSeed === sim.seed) {
      resetSimulation(nextSeed, `种子 ${nextSeed} 重开 · 序列校验已记录`);
    } else {
      resetSimulation(nextSeed, `已载入新种子 ${nextSeed}`);
    }
  });
  elements.seedInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") elements.seedApply.click();
  });

  for (const button of $$(".device-control")) {
    button.addEventListener("click", () => {
      if (sim.activeEvent?.demoFailure) {
        showToast("失联演练中，设备控制不可用", "alert");
        return;
      }
      const key = button.dataset.control;
      toggleControl(sim, key);
      const labels = { lights: "补光灯", mist: "喷雾", fan: "通风" };
      showToast(`${labels[key]}已${sim.controls[key] ? "开启" : "关闭"}`);
      paintUi(true);
    });
  }

  elements.eventAction.addEventListener("click", () => {
    if (!sim.activeEvent || sim.activeEvent.demoFailure) return;
    if (sim.controls.mist) toggleControl(sim, "mist");
    if (!sim.controls.fan) {
      toggleControl(sim, "fan");
      showToast("通风已开启，正在等待环境降至安全线", "alert");
    } else {
      showToast("通风已处于运行状态");
    }
    paintUi(true);
  });

  elements.refillBtn.addEventListener("click", () => {
    if (refillWater(sim)) {
      showToast(`蓄水池补水完成 · 当前 ${Math.round(sim.actual.water)}%`);
      paintUi(true);
    } else {
      showToast("当前无需补水或周期已经结束");
    }
  });

  elements.steadyBtn.addEventListener("click", () => {
    const entry = recordSteadySample(sim, { manual: true });
    const passed = entry.outcome === "通过";
    showToast(passed ? `稳态采样通过 · ${entry.time}` : "稳态采样未通过：先处理临界或越界指标", passed ? "normal" : "alert");
    paintUi(true);
  });

  elements.criticalBtn.addEventListener("click", () => {
    const event = injectCritical(sim, { type: "humidity" });
    if (!event) {
      showToast("已有事件或恢复观察正在进行", "alert");
      return;
    }
    showToast(`临界事件已注入 · 触发于 ${formatSimTime(event.startedAt)}`, "alert");
    paintUi(true);
  });

  elements.failureBtn.addEventListener("click", () => {
    setSpeed(1);
    paused = false;
    updatePauseButton();
    const event = startFailureDemo(sim);
    if (!event) {
      showToast("已有事件或恢复观察正在进行", "alert");
      return;
    }
    showToast("失联演练开始：保持通风关闭，失败结果将写入记录", "alert");
    paintUi(true);
  });

  elements.soundBtn.addEventListener("click", async () => {
    const enabled = await sound.toggle();
    elements.soundBtn.setAttribute("aria-pressed", String(enabled));
    elements.soundLabel.textContent = enabled ? "声音开" : "声音";
    showToast(enabled ? "环境声已开启 · 风机与喷雾会改变声场" : "环境声已关闭");
  });
}

function sampleHistories() {
  pushHistory("light", sim.observed.light, sim.actual.light);
  pushHistory("humidity", sim.observed.humidity, sim.actual.humidity);
  pushHistory("temperature", sim.observed.temperature, sim.actual.temperature);
}

let lastSampleAt = 0;

function frame(timestamp) {
  const elapsed = Math.min(0.12, Math.max(0, (timestamp - lastFrame) / 1000));
  lastFrame = timestamp;
  if (!paused && !sim.finished) {
    advanceSimulation(sim, elapsed * speed);
  }
  drawGreenhouse(elements.canvas, sim, timestamp / 1000);
  if (timestamp - lastSampleAt > 360) {
    sampleHistories();
    lastSampleAt = timestamp;
  }
  sound.update(sim.controls);
  paintUi();
  requestAnimationFrame(frame);
}

bindControls();
initialPaint();
updatePauseButton();
requestAnimationFrame(frame);
