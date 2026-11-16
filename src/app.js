import { CONFIG, TOTAL_SECONDS, WetlandSim } from "./sim.js";
import { WetlandScene } from "./scene.js";
import { WetlandAudio } from "./audio.js";

const $ = (id) => document.getElementById(id);
const sim = new WetlandSim({ seed: 82417, running: true });
const scene = new WetlandScene($("wetlandCanvas"));
const audio = new WetlandAudio();
const chart = $("historyChart");
const chartContext = chart.getContext("2d");

const ui = {
  speed: 1,
  paused: false,
  draft: { spillway: CONFIG.initialSpillway, stakes: CONFIG.initialStakes },
  lastLogId: 0,
  toastTimer: 0,
  knownCompletion: false,
  selfCheck: null,
  reproduction: {
    state: "pending",
    detail: "同 seed 重开后自动核对",
    time: "—"
  }
};

const formatTime = (seconds) => `T+${Math.max(0, seconds).toFixed(1)}s`;
const formatSigned = (value, digits = 2) => `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
const roundPercent = (value) => `${Math.round(value * 100)}%`;

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(ui.toastTimer);
  ui.toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2800);
}

function syncDraftFromSim() {
  ui.draft.spillway = sim.controls.spillway;
  ui.draft.stakes = sim.controls.stakes;
  $("spillwaySlider").value = Math.round(ui.draft.spillway * 100);
  $("stakeSlider").value = Math.round(ui.draft.stakes * 100);
  renderDraft();
}

function renderDraft() {
  setText("spillwayValue", roundPercent(ui.draft.spillway));
  setText("stakeValue", roundPercent(ui.draft.stakes));
  const dirty = Math.abs(ui.draft.spillway - sim.desiredControls.spillway) > 0.002
    || Math.abs(ui.draft.stakes - sim.desiredControls.stakes) > 0.002;
  const state = $("draftState");
  state.textContent = dirty ? "待应用" : "已同步";
  state.classList.toggle("dirty", dirty);
  $("applyButton").disabled = !dirty || sim.completed;
  $("applyHint").textContent = dirty ? "有未应用调整" : "调整后生效";
}

function setPaused(paused) {
  if (sim.completed && !paused) return;
  ui.paused = paused;
  sim.setRunning(!paused);
  $("pauseButton").classList.toggle("paused", paused);
  setText("pauseLabel", paused ? "继续" : "暂停");
}

function frame(now) {
  const elapsedReal = Math.min(0.25, Math.max(0, (now - (ui.lastFrame || now)) / 1000));
  ui.lastFrame = now;
  if (!ui.paused) sim.advance(elapsedReal * ui.speed);

  if (sim.completed && !ui.knownCompletion) {
    ui.knownCompletion = true;
    ui.paused = true;
    setPaused(true);
    showToast(sim.result?.success ? "十日验收通过：两类生境保持稳定。" : "十日验收未通过，请查看事件记录。");
  }

  scene.draw(sim, now / 1000);
  audio.update(sim.inflow, sim.storm);
  if (!ui.lastUiRender || now - ui.lastUiRender > 75) {
    renderInterface();
    ui.lastUiRender = now;
  }
  requestAnimationFrame(frame);
}

function renderInterface() {
  renderContext();
  renderAlert();
  renderMetrics();
  renderHabitats();
  renderControls();
  renderAudit();
  renderLogs();
  renderComparison();
  drawHistoryChart();
}

function renderContext() {
  const weather = sim.weather;
  setText("weatherIcon", weather.icon);
  setText("weatherLabel", weather.label);
  setText("weatherDetail", `${weather.detail} · ${(sim.rain * 31).toFixed(1)} mm/h`);
  $("weatherChip").classList.toggle("storm", sim.storm > 0.18);
  setText("dayClock", sim.clockLabel());
  const remaining = Math.max(0, CONFIG.totalDays - sim.day);
  setText("remainingTime", remaining > 0 ? `距验收 ${remaining.toFixed(1)} 天` : "验收已结束");
  setText("sensorNote", `传感器时滞 ${CONFIG.sensorDelay.toFixed(1)} 秒 · 读数 ${sim.observed.age.toFixed(1)} 秒前`);
  setText("interventionSummary", `溢流口 ${roundPercent(sim.controls.spillway)} · 木桩 ${roundPercent(sim.controls.stakes)}`);
  setText("targetSummary", `${sim.aliveTargets} / 6 在位 · ${sim.safeTargets} 安全`);
  setText("targetCount", `${sim.aliveTargets} / 6`);

  const alertBox = $("sceneAlert");
  const danger = sim.alerts.combined !== "normal";
  alertBox.classList.toggle("visible", danger);
  alertBox.classList.toggle("critical", sim.alerts.combined === "critical");
  if (danger) {
    setText("sceneAlertTitle", sim.alerts.combined === "critical" ? "高水位临界告警" : "水位注意告警");
    setText("sceneAlertDetail", `实际 ${sim.level.toFixed(2)} m · ${sim.safeTargets} / 6 目标安全`);
  }
}

function renderAlert() {
  const panel = $("alertPanel");
  panel.classList.remove("warning", "critical");
  if (sim.alerts.actual !== "normal") panel.classList.add(sim.alerts.actual);
  const badge = $("alertBadge");
  badge.classList.remove("warning", "critical");
  if (sim.alerts.actual !== "normal") badge.classList.add(sim.alerts.actual);
  badge.textContent = sim.actualAlertLabel;
  $("actualLevel").innerHTML = `${sim.level.toFixed(2)} <small>m</small>`;
  setText("levelTrend", `${sim.levelRate >= 0 ? "↗" : "↘"} ${formatSigned(sim.levelRate, 3)} m/s`);
  setText("observedAlert", sim.observedAlertLabel);
  setText("observedLevel", `${sim.observed.level.toFixed(2)} m · −${sim.observed.age.toFixed(1)}s`);
  const margin = sim.level - CONFIG.criticalLevel;
  setText("thresholdMargin", `${formatSigned(margin)} m`);

  const toGauge = (level) => `${(Math.min(1, Math.max(0, (level - 3.9) / 0.85)) * 100).toFixed(1)}%`;
  $("actualMarker").style.left = toGauge(sim.level);
  $("observedMarker").style.left = toGauge(sim.observed.level);
}

function renderMetrics() {
  const observed = sim.observed;
  setText("flowObserved", observed.flow.toFixed(1));
  setText("turbidityObserved", observed.turbidity.toFixed(1));
  setText("oxygenObserved", observed.dissolvedOxygen.toFixed(1));
  setText("rainObserved", (observed.rain * 31).toFixed(1));
  $("flowActual").innerHTML = `${sim.inflow.toFixed(1)} <small>m³/s</small>`;
  $("turbidityActual").innerHTML = `${sim.turbidity.toFixed(1)} <small>NTU</small>`;
  $("oxygenActual").innerHTML = `${sim.dissolvedOxygen.toFixed(1)} <small>mg/L</small>`;
  $("rainActual").innerHTML = `${(sim.rain * 31).toFixed(1)} <small>mm/h</small>`;
}

function applyHabitatState(id, state, detail, statusText) {
  const element = $(id);
  element.classList.remove("warning", "danger");
  if (state === "warning") element.classList.add("warning");
  if (state === "danger") element.classList.add("danger");
  element.querySelector(".habitat-copy span").textContent = detail;
  element.querySelector(".mini-status").textContent = statusText;
}

function renderHabitats() {
  const birdState = sim.habitats.bird.safe ? "safe" : sim.alerts.actual === "critical" ? "danger" : "warning";
  const lodgeState = sim.habitats.beaver.safe ? "safe" : sim.lodgesAlive === 0 ? "danger" : "warning";
  const roadState = sim.habitats.road.safe ? "safe" : sim.roadClearance < 0 ? "danger" : "warning";
  applyHabitatState(
    "birdHabitat",
    birdState,
    `${sim.habitats.bird.label} · 浊度 ${sim.turbidity.toFixed(0)} NTU`,
    birdState === "safe" ? "安全" : birdState === "danger" ? "淹水" : "注意"
  );
  applyHabitatState(
    "beaverHabitat",
    lodgeState,
    sim.habitats.beaver.label,
    lodgeState === "safe" ? "安全" : lodgeState === "danger" ? "失稳" : "注意"
  );
  applyHabitatState(
    "roadHabitat",
    roadState,
    sim.habitats.road.label,
    roadState === "safe" ? "安全" : roadState === "danger" ? "中断" : "预警"
  );
}

function renderControls() {
  renderDraft();
  const active = sim.beaver.active;
  const footnote = $("beaverActivity");
  footnote.classList.toggle("active", active);
  if (active) {
    footnote.lastChild.textContent = " 河狸正在修补坝体，溢流效率下降";
  } else {
    const next = sim.getNextBeaverEvent();
    const delay = next ? Math.max(0, next.start - sim.day) : 0;
    footnote.lastChild.textContent = next
      ? ` 河狸活动平稳，预计 ${delay.toFixed(1)} 天后修补坝体`
      : " 河狸活动平稳，本日无修补事件";
  }
}

function setAudit(id, state, detail, time) {
  const element = $(id);
  element.classList.remove("pass", "fail");
  if (state === "pass") element.classList.add("pass");
  if (state === "fail") element.classList.add("fail");
  element.querySelector(".audit-check").textContent = state === "pass" ? "✓" : state === "fail" ? "!" : "○";
  element.querySelector("small").textContent = detail;
  element.querySelector("time").textContent = time;
}

function renderAudit() {
  const evidence = ui.selfCheck?.evidence;
  const steady = sim.stats.steadyAt ?? evidence?.steadyAt ?? null;
  setAudit(
    "auditSteady",
    steady !== null ? "pass" : "pending",
    steady !== null
      ? `${CONFIG.steadyWindow.toFixed(0)} 秒连续稳态窗口${sim.stats.steadyAt === null ? " · 自检" : ""}`
      : `监测中 · ${sim.steadySeconds.toFixed(1)} / ${CONFIG.steadyWindow} 秒`,
    steady !== null ? formatTime(steady) : "—"
  );

  const critical = sim.stats.criticalAt ?? evidence?.criticalAt ?? null;
  setAudit(
    "auditCritical",
    critical !== null ? "pass" : "pending",
    critical !== null
      ? `实际水位越过 ${CONFIG.criticalLevel} m${sim.stats.criticalAt === null ? " · 自检" : ""}`
      : "等待越限事件",
    critical !== null ? formatTime(critical) : "—"
  );

  const failure = sim.stats.failureAt ?? evidence?.failureAt ?? null;
  setAudit(
    "auditFailure",
    failure !== null ? "fail" : "pending",
    failure !== null
      ? `已记录处置无效与前后指标${sim.stats.failureAt === null ? " · 自检" : ""}`
      : sim.incident ? "等待处置评估窗口" : "等待处置评估",
    failure !== null ? formatTime(failure) : "—"
  );

  setAudit(
    "auditRepro",
    ui.reproduction.state,
    ui.reproduction.detail,
    ui.reproduction.time
  );

  const recoveryPass = sim.stats.recoveryPassAt ?? evidence?.recoveryPassAt ?? null;
  if (sim.recovery) {
    setAudit(
      "auditRecovery",
      "pending",
      `固定观察中 · 剩余 ${sim.recovery.remaining.toFixed(1)} 秒`,
      formatTime(sim.recovery.startedAt)
    );
  } else if (sim.stats.recoveryFailAt !== null) {
    setAudit("auditRecovery", "fail", "观察期内出现残留反弹", formatTime(sim.stats.recoveryFailAt));
  } else if (recoveryPass !== null) {
    setAudit(
      "auditRecovery",
      "pass",
      `连续 ${CONFIG.recoveryWatch} 秒水位与目标均安全${sim.stats.recoveryPassAt === null ? " · 自检" : ""}`,
      formatTime(recoveryPass)
    );
  } else {
    setAudit("auditRecovery", "pending", `恢复后固定观察 ${CONFIG.recoveryWatch} 秒`, "—");
  }
}

function renderLogs() {
  const newestId = sim.logs.at(-1)?.id ?? 0;
  if (newestId === ui.lastLogId) return;
  ui.lastLogId = newestId;
  const list = $("logList");
  list.replaceChildren();
  if (!sim.logs.length) {
    const empty = document.createElement("div");
    empty.className = "empty-log";
    empty.textContent = "等待环境事件";
    list.append(empty);
    return;
  }
  for (const entry of [...sim.logs].reverse()) {
    const row = document.createElement("div");
    row.className = `log-entry ${entry.severity}`;
    const time = document.createElement("div");
    time.className = "log-time";
    const trigger = document.createElement("b");
    trigger.textContent = formatTime(entry.simTime);
    time.append(trigger, `D${Math.max(1, Math.floor(entry.day) + 1)}`);
    const dot = document.createElement("span");
    dot.className = "log-dot";
    const copy = document.createElement("div");
    copy.className = "log-copy";
    const title = document.createElement("strong");
    title.textContent = entry.title;
    const detail = document.createElement("small");
    detail.textContent = entry.detail;
    detail.title = entry.detail;
    copy.append(title, detail);
    row.append(time, dot, copy);
    list.append(row);
  }
}

function renderComparison() {
  const comparison = sim.lastComparison;
  if (!comparison) {
    setText("comparisonTime", "尚未执行");
    setText("compareLevel", "— → —");
    setText("compareTargets", "— → —");
    setText("compareTurbidity", "— → —");
    return;
  }
  setText("comparisonTime", comparison.clock);
  setText(
    "compareLevel",
    `${comparison.before.level.toFixed(2)} → ${comparison.after.level.toFixed(2)} m`
  );
  setText(
    "compareTargets",
    `${comparison.before.safeTargets} → ${comparison.after.safeTargets}`
  );
  setText(
    "compareTurbidity",
    `${comparison.before.turbidity.toFixed(1)} → ${comparison.after.turbidity.toFixed(1)}`
  );
}

function drawHistoryChart() {
  const rect = chart.getBoundingClientRect();
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(280, rect.width);
  const height = Math.max(120, rect.height);
  if (chart.width !== Math.round(width * ratio) || chart.height !== Math.round(height * ratio)) {
    chart.width = Math.round(width * ratio);
    chart.height = Math.round(height * ratio);
  }
  const ctx = chartContext;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const padding = { top: 9, right: 8, bottom: 13, left: 7 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const minLevel = 3.85;
  const maxLevel = 4.78;
  const mapY = (level) => padding.top + ((maxLevel - level) / (maxLevel - minLevel)) * plotHeight;
  const mapX = (time) => {
    const start = Math.max(0, sim.elapsed - 48);
    const end = Math.max(48, sim.elapsed);
    return padding.left + ((time - start) / Math.max(1, end - start)) * plotWidth;
  };

  ctx.strokeStyle = "rgba(198, 219, 191, 0.08)";
  ctx.lineWidth = 1;
  for (let index = 0; index < 4; index += 1) {
    const y = padding.top + (plotHeight / 3) * index;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }

  const guides = [
    [CONFIG.roadLevel, "rgba(239, 181, 93, 0.26)"],
    [CONFIG.criticalLevel, "rgba(224, 106, 88, 0.28)"],
    [CONFIG.warningLevel, "rgba(239, 181, 93, 0.17)"]
  ];
  ctx.setLineDash([3, 5]);
  for (const [level, color] of guides) {
    const y = mapY(level);
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  const start = Math.max(0, sim.elapsed - 48);
  const points = sim.history.filter((point) => point.t >= start);
  if (points.length < 2) return;

  ctx.fillStyle = "rgba(203, 220, 113, 0.08)";
  ctx.beginPath();
  ctx.moveTo(mapX(points[0].t), mapY(points[0].level));
  for (const point of points) ctx.lineTo(mapX(point.t), mapY(point.level));
  ctx.lineTo(mapX(points.at(-1).t), height - padding.bottom);
  ctx.lineTo(mapX(points[0].t), height - padding.bottom);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "#cbdc71";
  ctx.lineWidth = 1.45;
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = mapX(point.t);
    const y = mapY(point.level);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.strokeStyle = "rgba(123, 201, 187, 0.74)";
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = mapX(point.t);
    const y = mapY(point.observed);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);

  const last = points.at(-1);
  ctx.fillStyle = "#cbdc71";
  ctx.beginPath();
  ctx.arc(mapX(last.t), mapY(last.level), 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#7bc9bb";
  ctx.beginPath();
  ctx.arc(mapX(last.t), mapY(last.observed), 1.8, 0, Math.PI * 2);
  ctx.fill();
}

function resetBookkeeping() {
  ui.lastLogId = 0;
  ui.knownCompletion = false;
  ui.paused = false;
  setPaused(false);
  syncDraftFromSim();
  sim.setRunning(true);
}

function resetSameSeed() {
  const beforePayload = sim.getReproductionPayload();
  const beforeSignature = sim.getSignature();
  sim.reset(sim.seed, { running: true });
  const afterPayload = sim.getReproductionPayload();
  const afterSignature = sim.getSignature();
  const weatherMatches = JSON.stringify(beforePayload.weather) === JSON.stringify(afterPayload.weather);
  const targetsMatch = JSON.stringify(beforePayload.targets) === JSON.stringify(afterPayload.targets);
  const matches = weatherMatches && targetsMatch;
  ui.reproduction = {
    state: matches ? "pass" : "fail",
    detail: `天气 ${beforeSignature.weather} → ${afterSignature.weather} · 目标分布${targetsMatch ? "一致" : "变化"}`,
    time: formatTime(0)
  };
  ui.selfCheck = null;
  sim.addLog(
    "reproduce",
    matches ? "同 seed 复现校验通过" : "同 seed 复现校验失败",
    `seed ${sim.seed} · 天气序列${weatherMatches ? "一致" : "不一致"} · 目标分布${targetsMatch ? "一致" : "不一致"}`,
    matches ? "success" : "critical",
    {
      reproduction: {
        seed: sim.seed,
        weatherMatches,
        targetsMatch,
        before: beforeSignature,
        after: afterSignature
      }
    }
  );
  $("seedInput").value = sim.seed;
  resetBookkeeping();
  showToast(matches ? "同 seed 重开：天气序列与目标分布一致。" : "复现校验失败，请检查 seed。");
}

function resetWithSeed(rawSeed) {
  const parsed = Number.parseInt(String(rawSeed), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    showToast("请输入大于 0 的整数 seed。");
    return;
  }
  if (String(parsed) === String(sim.seed)) {
    resetSameSeed();
    return;
  }
  const previous = sim.seed;
  sim.reset(parsed, { running: true });
  ui.selfCheck = null;
  ui.reproduction = {
    state: "pending",
    detail: "新 seed，重开后自动核对",
    time: "—"
  };
  sim.addLog("system", "切换随机种子", `${previous} → ${parsed} · 天气 ${sim.weatherDigest} · 目标 ${sim.targetDigest}`);
  $("seedInput").value = parsed;
  resetBookkeeping();
  showToast(`已载入 seed ${parsed}。点击“同 seed 重开”可核对复现性。`);
}

function runSelfCheck() {
  const seed = sim.seed;
  const baseline = new WetlandSim({ seed, running: true });
  baseline.advance(100);
  const reopened = new WetlandSim({ seed, running: true });
  const baselinePayload = baseline.getReproductionPayload();
  const reopenedPayload = reopened.getReproductionPayload();
  const reproducible = JSON.stringify(baselinePayload) === JSON.stringify(reopenedPayload);

  const actionRun = new WetlandSim({ seed, running: true });
  actionRun.advance(60);
  actionRun.applyControls({ spillway: 0.95, stakes: 0.8 });
  actionRun.advance(25);

  const recoveryRun = new WetlandSim({ seed, running: true });
  while (recoveryRun.elapsed < TOTAL_SECONDS) {
    if (recoveryRun.alerts.actual !== "normal") {
      recoveryRun.applyControls({ spillway: 0.95, stakes: 0.8 });
    }
    if (recoveryRun.recovery && recoveryRun.recovery.remaining <= 6.2) {
      recoveryRun.applyControls({ spillway: 0.45, stakes: 0.8 });
    }
    recoveryRun.advance(0.05);
  }

  const checks = {
    steady: baseline.stats.steadyAt !== null,
    critical: baseline.stats.criticalAt !== null
      && baseline.stats.maxLevel >= CONFIG.criticalLevel - 0.001,
    failure: baseline.stats.failureAt !== null,
    recovery: recoveryRun.stats.recoveryPassAt !== null,
    reproducible,
    comparison: actionRun.lastComparison !== null,
    tenDaySuccess: recoveryRun.result?.success === true
  };
  const passed = Object.values(checks).every(Boolean);
  ui.selfCheck = {
    passed,
    evidence: {
      steadyAt: baseline.stats.steadyAt,
      criticalAt: baseline.stats.criticalAt,
      failureAt: baseline.stats.failureAt,
      recoveryPassAt: recoveryRun.stats.recoveryPassAt,
      comparisonAt: actionRun.lastComparison?.at ?? null
    }
  };
  if (reproducible) {
    ui.reproduction = {
      state: "pass",
      detail: `自检天气 ${baseline.weatherDigest} · 目标分布一致`,
      time: formatTime(sim.elapsed)
    };
  }
  sim.addLog(
    "validation",
    passed ? "确定性验收自检通过" : "确定性验收自检未通过",
    `稳态 ${checks.steady ? "✓" : "×"} · 临界 ${checks.critical ? "✓" : "×"} · 失败 ${checks.failure ? "✓" : "×"} · 恢复 ${checks.recovery ? "✓" : "×"} · 十日 ${checks.tenDaySuccess ? "✓" : "×"} · seed ${checks.reproducible ? "✓" : "×"}`,
    passed ? "success" : "critical",
    {
      trigger: "self-check",
      checks,
      evidence: {
        steadyAt: baseline.stats.steadyAt,
        criticalAt: baseline.stats.criticalAt,
        failureAt: baseline.stats.failureAt,
        recoveryPassAt: recoveryRun.stats.recoveryPassAt,
        tenDaySuccess: recoveryRun.result?.success === true,
        comparisonAt: actionRun.lastComparison?.at ?? null
      }
    }
  );
  showToast(
    passed
      ? "自检通过：稳态、临界、处置失败、恢复观察、十日成功与同 seed 复现均有效。"
      : "自检未通过，请查看触发记录。"
  );
}

function exportReport() {
  const report = {
    generatedAt: new Date().toISOString(),
    seed: sim.seed,
    signature: sim.getSignature(),
    thresholds: {
      warning: CONFIG.warningLevel,
      critical: CONFIG.criticalLevel,
      road: CONFIG.roadLevel,
      recoveryWatchSeconds: CONFIG.recoveryWatch
    },
    current: sim._snapshot(),
    controls: {
      actual: { ...sim.controls },
      desired: { ...sim.desiredControls }
    },
    stats: { ...sim.stats },
    weatherSequence: sim.weatherLayout,
    targetLayout: sim.targetBlueprint,
    lastComparison: sim.lastComparison,
    reproduction: ui.reproduction,
    result: sim.result ?? null,
    logs: sim.logs
  };
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `beaver-wetland-seed-${sim.seed}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
  showToast("已导出包含触发时刻的完整运行记录。");
}

function bindEvents() {
  $("pauseButton").addEventListener("click", () => setPaused(!ui.paused));
  document.querySelectorAll("[data-speed]").forEach((button) => {
    button.addEventListener("click", () => {
      ui.speed = Number(button.dataset.speed);
      document.querySelectorAll("[data-speed]").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
      showToast(`模拟速度 ${ui.speed}×`);
    });
  });

  $("spillwaySlider").addEventListener("input", (event) => {
    ui.draft.spillway = Number(event.target.value) / 100;
    renderDraft();
  });
  $("stakeSlider").addEventListener("input", (event) => {
    ui.draft.stakes = Number(event.target.value) / 100;
    renderDraft();
  });
  $("applyButton").addEventListener("click", () => {
    if (sim.applyControls(ui.draft)) {
      showToast("调度已应用，5 秒后记录前后指标对比。");
      renderDraft();
    }
  });

  $("soundButton").addEventListener("click", async () => {
    try {
      const enabled = await audio.toggle();
      $("soundButton").classList.toggle("active", enabled);
      $("soundButton").title = enabled ? "关闭环境声" : "开启环境声";
      $("soundButton").setAttribute("aria-label", enabled ? "关闭环境声" : "开启环境声");
      showToast(enabled ? "环境声已开启，音色随流量变化。" : "环境声已关闭。");
    } catch {
      showToast("当前浏览器无法启动声音。");
    }
  });

  $("resetButton").addEventListener("click", resetSameSeed);
  $("topResetButton").addEventListener("click", resetSameSeed);
  $("newSeedButton").addEventListener("click", () => {
    let next = sim.seed;
    while (String(next) === String(sim.seed)) {
      next = Math.floor(10000 + Math.random() * 98999999);
    }
    resetWithSeed(next);
  });
  $("auditButton").addEventListener("click", runSelfCheck);
  $("exportButton").addEventListener("click", exportReport);
  $("seedInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") resetWithSeed(event.currentTarget.value);
  });
  document.addEventListener("keydown", (event) => {
    if (event.code === "Space" && !["INPUT", "BUTTON"].includes(document.activeElement?.tagName)) {
      event.preventDefault();
      setPaused(!ui.paused);
    }
  });
}

bindEvents();
syncDraftFromSim();
renderInterface();
requestAnimationFrame(frame);
