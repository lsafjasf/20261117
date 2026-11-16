import {
  COMPARABLE_WINDOW,
  DURATION,
  ExperimentEngine,
  INTERVENTION_META,
  METRICS,
  PLOTS,
  RECOVERY_DURATION,
  SAMPLE_UNLOCK,
  THRESHOLDS,
  formatTime,
  normalizeSeed,
  round,
} from "./sim.js";
import { CanvasRenderer } from "./canvas.js";
import { LabAudio } from "./audio.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const elements = {
  canvas: $("#fieldCanvas"),
  canvasTipText: $("#canvasTipText"),
  canvasToast: $("#canvasToast"),
  phaseLabel: $("#phaseLabel"),
  phaseDetail: $("#phaseDetail"),
  clock: $("#clock"),
  duration: $("#duration"),
  liveDot: $("#liveDot"),
  runButton: $("#runButton"),
  runLabel: $("#runLabel"),
  resetButton: $("#resetButton"),
  seedInput: $("#seedInput"),
  soundButton: $("#soundButton"),
  sensorState: $("#sensorState"),
  targetCount: $("#targetCount"),
  targetProgress: $("#targetProgress"),
  groupGrid: $("#groupGrid"),
  sampleHint: $("#sampleHint"),
  activeInterventions: $("#activeInterventions"),
  recoveryButton: $("#recoveryButton"),
  recoveryLabel: $("#recoveryLabel"),
  recoveryHint: $("#recoveryHint"),
  successBanner: $("#successBanner"),
  successDetail: $("#successDetail"),
  dismissBanner: $("#dismissBanner"),
  comparisonBadge: $("#comparisonBadge"),
  comparisonBars: $("#comparisonBars"),
  comparisonNote: $("#comparisonNote"),
  eventLog: $("#eventLog"),
  operationLog: $("#operationLog"),
  verificationLog: $("#verificationLog"),
  verificationResult: $("#verificationResult"),
  verifyButton: $("#verifyButton"),
  eventCount: $("#eventCount"),
  operationCount: $("#operationCount"),
  clearLogButton: $("#clearLogButton"),
  samplingLock: $("#samplingLock"),
  lockTime: $("#lockTime"),
  thresholdNote: $("#thresholdNote"),
  saveState: $("#saveState"),
};

const savedSeed = localStorage.getItem("microfield.seed");
const querySeed = new URLSearchParams(window.location.search).get("seed");
let engine = new ExperimentEngine(querySeed || savedSeed || "MF-2407");
elements.seedInput.value = engine.seed;

const renderer = new CanvasRenderer(elements.canvas, engine);
const audio = new LabAudio();
const ui = {
  lastFrame: performance.now(),
  lastUiUpdate: 0,
  lastSoundSecond: -1,
  lastSeenLogId: 0,
  toastLockUntil: 0,
  bannerDismissed: false,
  activeTab: "events",
  hiddenLogsBefore: 0,
  verification: null,
  toastTimer: null,
  lastPhase: engine.phase?.id,
};

function metricSeverityClass(metric, value) {
  if (value >= THRESHOLDS[metric].critical) return "critical";
  if (value >= THRESHOLDS[metric].warning) return "warning";
  return "normal";
}

function showToast(message, tone = "normal", duration = 2600) {
  const toast = elements.canvasToast;
  toast.textContent = message;
  toast.className = `canvas-toast show ${tone === "normal" ? "" : tone}`.trim();
  window.clearTimeout(ui.toastTimer);
  ui.toastTimer = window.setTimeout(() => {
    toast.className = "canvas-toast";
  }, duration);
}

function persistSeed(seed) {
  localStorage.setItem("microfield.seed", seed);
  const url = new URL(window.location.href);
  url.searchParams.set("seed", seed);
  window.history.replaceState({}, "", url);
}

function resetExperiment(seed = elements.seedInput.value) {
  const nextSeed = normalizeSeed(seed);
  engine = new ExperimentEngine(nextSeed);
  renderer.setEngine(engine);
  elements.seedInput.value = nextSeed;
  ui.lastSeenLogId = 0;
  ui.lastSoundSecond = -1;
  ui.bannerDismissed = false;
  ui.hiddenLogsBefore = 0;
  ui.verification = null;
  ui.lastPhase = engine.phase?.id;
  persistSeed(nextSeed);
  updateUi(engine.stateSummary(), true);
  showToast(`SEED ${nextSeed} 已重开 · 天气与靶点已复现`, "normal", 3000);
  audio.clockTick(true);
}

function toggleRun() {
  if (engine.ended) {
    showToast("观测已经结束，请重置实验。", "warning");
    return;
  }
  engine.running = !engine.running;
  audio.ensureContext();
  playLogSound({ type: "system", severity: "normal" });
  updateUi(engine.stateSummary(), true);
}

function handleIntervention(type) {
  audio.ensureContext();
  const result = engine.applyIntervention(type);
  showToast(
    result.message,
    result.failed ? "error" : result.ok ? "normal" : "warning",
    result.failed ? 4200 : 2600,
  );
  if (result.failed) audio.failure();
  else if (result.ok) audio.sample();
  if (result.failed) ui.toastLockUntil = performance.now() + 2800;
  ui.lastSeenLogId = engine.logs.length;
  updateUi(engine.stateSummary(), true);
}

function handleRecovery() {
  audio.ensureContext();
  const result = engine.beginRecovery();
  showToast(result.message, result.ok ? "warning" : "error", 3200);
  if (result.ok) audio.warning();
  ui.lastSeenLogId = engine.logs.length;
  updateUi(engine.stateSummary(), true);
}

function playLogSound(entry) {
  if (!entry) return;
  if (entry.severity === "failure") {
    audio.failure();
    return;
  }
  if (entry.type === "threshold" && entry.severity === "critical") {
    audio.critical();
    return;
  }
  if (entry.type === "threshold") {
    audio.warning();
    return;
  }
  if (entry.type === "success" || entry.severity === "success") {
    audio.success();
    return;
  }
  if (entry.type === "sample") {
    audio.sample();
  }
}

function announceNewLogs() {
  const newLogs = engine.logs.filter((entry) => {
    const id = Number(entry.id.replace("log-", ""));
    return id > ui.lastSeenLogId;
  });
  if (!newLogs.length) return;
  ui.lastSeenLogId = Number(newLogs[newLogs.length - 1].id.replace("log-", ""));
  for (const entry of newLogs) {
    if (!audio.enabled) continue;
    if (entry.severity === "failure" || entry.severity === "critical") {
      playLogSound(entry);
    } else if (entry.type === "sample" || entry.type === "success") {
      playLogSound(entry);
    }
  }
  const latest = newLogs[newLogs.length - 1];
  if (performance.now() < ui.toastLockUntil) return;
  if (latest.severity === "critical" || latest.severity === "failure") {
    showToast(`${formatTime(latest.time)} · ${latest.title}`, "error", 4200);
  } else if (latest.type === "recovery" || latest.type === "steady") {
    showToast(`${formatTime(latest.time)} · ${latest.title}`, "normal", 3400);
  }
}

function handleSampleClick(event) {
  audio.ensureContext();
  const point = renderer.screenToWorld(event.clientX, event.clientY);
  const result = engine.sampleAt(point.x, point.y);
  if (!result.ok) {
    showToast(result.message, "warning", 2600);
    if (result.duplicate) audio.warning();
    return;
  }
  if (result.bias) {
    audio.warning();
    showToast(result.message, "error", 4000);
  } else {
    audio.sample();
    showToast(result.message, "normal", 2200);
  }
  ui.lastSeenLogId = engine.logs.length;
  updateUi(engine.stateSummary(), true);
}

function updateCanvasTip(event) {
  const point = renderer.screenToWorld(event.clientX, event.clientY);
  const hover = renderer.setPointer(point);
  if (!hover) {
    elements.canvasTipText.textContent = "移动指针以检查采样距离";
    elements.canvas.style.cursor = "crosshair";
    return;
  }
  if (hover.target.sampled) {
    elements.canvasTipText.textContent = `${hover.target.id} · 已封存`;
    elements.canvas.style.cursor = "default";
    return;
  }
  elements.canvasTipText.textContent = `${hover.target.id} · 距靶心 ${hover.distance.toFixed(
    1,
  )}u · ${hover.inRange ? "可采样" : "将产生对照偏差"}`;
  elements.canvas.style.cursor = hover.inRange ? "crosshair" : "not-allowed";
}

function sparklinePath(history, metric) {
  const config = METRICS[metric];
  const values = history.map((point) => point[metric]);
  if (!values.length) return { line: "", area: "", thresholdY: 26 };
  const width = 220;
  const height = 32;
  const range = config.max - config.min;
  const points = values.map((value, index) => {
    const x = values.length === 1 ? width : (index / (values.length - 1)) * width;
    const y = height - ((value - config.min) / range) * height;
    return [x, clampNumber(y, 2, height - 2)];
  });
  const line = points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const thresholdY = clampNumber(height - ((config.threshold - config.min) / range) * height, 1, 31);
  return { line, area, thresholdY };
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function renderMetrics(state) {
  $$(".metric-card").forEach((card) => {
    const metric = card.dataset.metric;
    const config = METRICS[metric];
    const actual = state.actual[metric];
    const observed = state.observed[metric];
    const severity = metricSeverityClass(metric, actual);
    const warning = state.warnings.find((item) => item.metric === metric);
    card.classList.toggle("critical", severity === "critical");
    card.classList.toggle("warning", severity === "warning");
    card.querySelector("[data-observed]").textContent =
      metric === "contamination" ? Math.round(observed) : observed.toFixed(1);
    card.querySelector("[data-actual]").textContent =
      metric === "contamination" ? Math.round(actual) : actual.toFixed(1);
    const alert = card.querySelector("[data-alert]");
    alert.textContent =
      severity === "critical"
        ? warning?.observedSeverity !== "critical"
          ? "实际越限"
          : "临界"
        : severity === "warning"
          ? "预警"
          : "";
    const { line, area, thresholdY } = sparklinePath(state.history, metric);
    card.querySelector(".spark-line").setAttribute("d", line);
    card.querySelector(".spark-area").setAttribute("d", area);
    const threshold = card.querySelector(".spark-threshold");
    threshold.setAttribute("y1", thresholdY);
    threshold.setAttribute("y2", thresholdY);
  });

  const criticals = state.criticalWarnings;
  if (criticals.length) {
    const first = criticals[0];
    elements.sensorState.textContent = `临界 ${criticals.length}`;
    elements.sensorState.className = "sensor-state critical";
    elements.thresholdNote.innerHTML = `<span class="threshold-icon">!</span><p>${METRICS[
      first.metric
    ].label}实际值 ${round(first.actual, 1)}${METRICS[first.metric].unit} 已越过 ${
      THRESHOLDS[first.metric].label
    }；传感器观测值存在滤波滞后。</p>`;
  } else if (state.warnings.length) {
    elements.sensorState.textContent = "预警中";
    elements.sensorState.className = "sensor-state warning";
    const first = state.warnings[0];
    elements.thresholdNote.innerHTML = `<span class="threshold-icon">!</span><p>${METRICS[
      first.metric
    ].label}接近临界阈值 ${THRESHOLDS[first.metric].label}，建议在越限前执行干预。</p>`;
  } else {
    elements.sensorState.textContent = "采样中";
    elements.sensorState.className = "sensor-state";
    elements.thresholdNote.innerHTML =
      '<span class="threshold-icon">!</span><p>温度 34°C、污染 55 CFU 为临界阈值。实际值越过阈值立即记录。</p>';
  }
}

function renderHeader(state) {
  elements.clock.textContent = formatTime(state.elapsed);
  elements.duration.textContent = `/ ${formatTime(DURATION)}`;
  elements.phaseLabel.textContent = state.running
    ? state.phase.label
    : state.ended
      ? "观测结束"
      : "实验已暂停";
  elements.phaseDetail.textContent = state.ended
    ? state.success
      ? "三组数据已封存"
      : "数据完整性不足"
    : state.phase.detail;
  elements.liveDot.classList.toggle("paused", !state.running);
  elements.runButton.classList.toggle("paused", !state.running);
  elements.runLabel.textContent = state.ended ? "已结束" : state.running ? "暂停" : "继续";
  elements.runButton.disabled = state.ended;
  elements.saveState.textContent = `SEED ${state.seed} · 自动保存`;

  if (ui.lastPhase !== state.phase.id && state.running) {
    showToast(`${formatTime(state.elapsed)} · ${state.phase.label}：${state.phase.detail}`, "normal", 3000);
    ui.lastPhase = state.phase.id;
  }
}

function renderTargets(state) {
  elements.targetCount.textContent = state.sampledCount;
  elements.targetProgress.style.width = `${(state.sampledCount / 9) * 100}%`;
  elements.groupGrid.innerHTML = state.groups
    .map((group) => {
      const plot = PLOTS.find((item) => item.id === group.id);
      const pips = [0, 1, 2]
        .map((index) => {
          const filled = index < group.count;
          const biased = !filled && index < group.biasCount;
          return `<i class="${filled ? "filled" : biased ? "biased" : ""}"></i>`;
        })
        .join("");
      return `
        <article class="group-card ${group.complete ? "complete" : ""}" title="${plot.fertilizer}">
          <strong>${plot.id} · ${plot.short}</strong>
          <small>${group.count}/3 靶心</small>
          <div class="group-pips">${pips}</div>
        </article>
      `;
    })
    .join("");

  let hint = "";
  if (!state.sampleUnlocked) {
    hint = `培养锁定 ${Math.max(0, SAMPLE_UNLOCK - state.elapsed).toFixed(
      1,
    )} 秒。点击田块脉冲靶点采样，偏离靶心会造成对照偏差。`;
  } else if (state.success) {
    hint = `三组数据已建立，采样跨度 ${state.sampleSpan.toFixed(
      1,
    )} 秒。可继续观察临界事件与恢复过程。`;
  } else if (state.biasCount > 0) {
    hint = `已有 ${state.biasCount} 个偏差样本。偏差样本不计入目标，请点击靶心重新采样。`;
  } else if (state.sampleSpan > COMPARABLE_WINDOW) {
    hint = `采样跨度 ${state.sampleSpan.toFixed(
      1,
    )} 秒，超过 ${COMPARABLE_WINDOW} 秒可比窗口。后续样本可能无法用于对照。`;
  } else {
    hint = `还需 ${9 - state.sampledCount} 个靶心样本；当前跨度 ${state.sampleSpan.toFixed(
      1,
    )} / ${COMPARABLE_WINDOW} 秒。`;
  }
  elements.sampleHint.textContent = hint;
  elements.samplingLock.classList.toggle("hidden", state.sampleUnlocked);
  elements.lockTime.textContent = `还需 ${Math.max(0, SAMPLE_UNLOCK - state.elapsed).toFixed(1)} 秒`;
}

function renderInterventions(state) {
  if (!state.active.length) {
    elements.activeInterventions.innerHTML =
      '<span class="empty-intervention">自动环境控制中</span>';
  } else {
    elements.activeInterventions.innerHTML = state.active
      .map(
        (item) =>
          `<span class="intervention-chip ${item.type}">${item.label} ${item.remaining.toFixed(
            1,
          )}s</span>`,
      )
      .join("");
  }

  $$(".action-button").forEach((button) => {
    const type = button.dataset.action;
    const active = state.active.some((item) => item.type === type);
    button.disabled = active || state.ended;
    const risky =
      type === "irrigation" &&
      (state.actual.humidity >= 78 || state.actual.water >= 76 || state.recovery?.active);
    button.classList.toggle("risky", Boolean(risky) && !state.ended);
    button.title = risky ? "当前高湿/高水位，灌溉可能造成处置失败" : INTERVENTION_META[type].label;
  });

  const recovery = state.recovery;
  elements.recoveryButton.className = "recovery-button";
  if (recovery?.active) {
    elements.recoveryButton.classList.add("observing");
    elements.recoveryButton.disabled = true;
    elements.recoveryLabel.textContent = "恢复观察中";
    elements.recoveryHint.textContent = `固定 8 秒 · 剩余 ${recovery.remaining.toFixed(1)} 秒`;
  } else if (recovery?.completed) {
    elements.recoveryButton.classList.add(recovery.clean ? "complete" : "");
    elements.recoveryButton.disabled = !state.canRecover;
    elements.recoveryLabel.textContent = recovery.clean ? "无隐藏残留" : "残留未清除";
    elements.recoveryHint.textContent = recovery.clean
      ? `已连续确认 ${RECOVERY_DURATION} 秒`
      : "可再次执行通风恢复";
  } else {
    elements.recoveryButton.disabled = !state.canRecover;
    elements.recoveryLabel.textContent = "启动恢复观察";
    elements.recoveryHint.textContent = state.canRecover ? "固定运行 8 秒" : "告警后可用 · 固定 8 秒";
  }

  const showBanner = state.success && !ui.bannerDismissed;
  elements.successBanner.hidden = !showBanner;
  if (showBanner) {
    elements.successDetail.textContent = `A / B / C 各 3 个靶心样本，跨度 ${state.sampleSpan.toFixed(
      1,
    )} 秒；可在观测期末前封存。`;
  }
}

function renderComparison(state) {
  const completeCount = state.groups.filter((group) => group.complete).length;
  const comparable = state.groups.every((group) => group.comparable) && state.success;
  elements.comparisonBadge.textContent = comparable
    ? "可比较"
    : completeCount
      ? `${completeCount}/3 完成`
      : "待采样";
  elements.comparisonBadge.className = `comparison-badge ${comparable ? "" : completeCount ? "warning" : ""}`;
  elements.comparisonBars.innerHTML = state.groups
    .map(
      (group) => `
        <div class="comparison-row">
          <span>${group.id} 组 · ${group.count}/3</span>
          <div class="comparison-track"><i style="width:${group.quality}%"></i></div>
          <b>${group.quality}%</b>
        </div>
      `,
    )
    .join("");

  if (state.success) {
    elements.comparisonNote.textContent = `三组均达到 3 个靶心样本，总跨度 ${state.sampleSpan.toFixed(
      1,
    )} 秒，低于 ${COMPARABLE_WINDOW} 秒可比上限。`;
  } else if (state.biasCount) {
    elements.comparisonNote.textContent = `检测到 ${state.biasCount} 个对照偏差。请回到脉冲靶心 15 单位内采样，偏差数据不会计入可比性。`;
  } else if (state.sampleSpan > COMPARABLE_WINDOW) {
    elements.comparisonNote.textContent = `采样时间跨度 ${state.sampleSpan.toFixed(
      1,
    )} 秒，已超过 ${COMPARABLE_WINDOW} 秒；环境漂移会削弱组间对照。`;
  } else {
    elements.comparisonNote.textContent = `每组需 3 个靶心样本，且采样时间跨度不超过 ${COMPARABLE_WINDOW} 秒。当前跨度 ${state.sampleSpan.toFixed(
      1,
    )} 秒。`;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderEvents(state) {
  const logs = state.logs
    .map((entry, index) => ({ ...entry, index }))
    .filter((entry) => entry.index >= ui.hiddenLogsBefore)
    .reverse();
  elements.eventCount.textContent = logs.length;
  if (!logs.length) {
    elements.eventLog.innerHTML =
      '<div class="empty-log">暂无可见记录。<br>实验计时、阈值与操作会自动写入。</div>';
    return;
  }
  elements.eventLog.innerHTML = logs
    .map(
      (entry) => `
        <article class="log-entry ${entry.severity}">
          <time class="log-time">T+${formatTime(entry.time)}</time>
          <i class="log-node"></i>
          <div class="log-content">
            <strong>${escapeHtml(entry.title)}</strong>
            <p>${escapeHtml(entry.detail)}</p>
            <div class="log-meta">
              <span>${escapeHtml(entry.type.toUpperCase())}</span>
              <span>${Math.floor(entry.time / 60)}m ${(entry.time % 60).toFixed(1)}s</span>
              ${
                entry.data?.triggerTime !== undefined
                  ? `<span class="danger">TRIGGER ${formatTime(entry.data.triggerTime)}</span>`
                  : ""
              }
            </div>
          </div>
        </article>
      `,
    )
    .join("");
}

function operationDelta(before, after, key, mode = "neutral") {
  const valueA = key.startsWith("species.") ? before.species[key.split(".")[1]] : before[key];
  const valueB = key.startsWith("species.") ? after.species[key.split(".")[1]] : after[key];
  const difference = valueB - valueA;
  let tone = "";
  if (Math.abs(difference) > 0.01) {
    if (mode === "good-down") tone = difference < 0 ? "good" : "up";
    if (mode === "good-up") tone = difference > 0 ? "good" : "up";
    if (mode === "neutral") tone = difference > 0 ? "up" : "down";
  }
  return {
    before: Number(valueA).toFixed(key.startsWith("species.") ? 2 : 1),
    after: Number(valueB).toFixed(key.startsWith("species.") ? 2 : 1),
    delta: `${difference > 0 ? "+" : ""}${difference.toFixed(key.startsWith("species.") ? 2 : 1)}`,
    tone,
  };
}

function renderOperations(state) {
  const operations = state.operations
    .map((entry, index) => ({ ...entry, index }))
    .filter((entry) => entry.index >= ui.hiddenLogsBefore)
    .reverse();
  elements.operationCount.textContent = operations.length;
  if (!operations.length) {
    elements.operationLog.innerHTML =
      '<div class="empty-log">执行灌溉、遮阴或通风后，这里会并排显示操作前与操作后的物种、水位与污染指标。</div>';
    return;
  }

  elements.operationLog.innerHTML = operations
    .map((operation) => {
      const rows = [
        ["species.A", "A 区物种", "good-up"],
        ["species.B", "B 区物种", "good-up"],
        ["species.C", "C 区物种", "good-up"],
        ["water", "土壤水位", "neutral"],
        ["contamination", "污染指数", "good-down"],
      ]
        .map(([key, label, mode]) => {
          const delta = operationDelta(operation.before, operation.after, key, mode);
          return `
            <span class="delta-label">${label}</span>
            <span class="delta-before">${delta.before}</span>
            <span class="delta-arrow">→</span>
            <span class="delta-after">${delta.after}</span>
            <span class="delta-value ${delta.tone}">${delta.delta}</span>
          `;
        })
        .join("");
      const failed = operation.failure;
      const statusText = failed
        ? `处置失败 · 隐藏残留 ${operation.after.latent} CFU`
        : operation.status === "pending"
          ? "干预执行中 · 等待后测"
          : `操作后复测完成 · T+${formatTime(operation.after.time)}`;
      return `
        <article class="operation-card ${failed ? "failed" : ""}">
          <div class="operation-head">
            <strong>${escapeHtml(operation.label)}</strong>
            <time>触发 T+${formatTime(operation.time)}</time>
          </div>
          <div class="operation-status ${failed ? "failed" : ""}">${statusText}</div>
          <div class="delta-grid">${rows}</div>
        </article>
      `;
    })
    .join("");
}

function renderVerification() {
  const result = ui.verification;
  if (!result) {
    elements.verificationResult.innerHTML =
      '<div class="empty-log">校验会重新派生同一 seed 的天气曲线与九个目标坐标，并列出本轮阈值触发时刻。</div>';
    return;
  }
  const triggerRows = result.triggerTimes.length
    ? result.triggerTimes
        .slice(0, 8)
        .map(
          (trigger) =>
            `<div class="verify-row"><span>${escapeHtml(
              trigger.title,
            )}</span><code>T+${formatTime(trigger.time)}</code></div>`,
        )
        .join("")
    : '<div class="verify-row"><span>尚无阈值或失败记录</span><code>待触发</code></div>';
  const recoveryText = result.recovery
    ? `${result.recovery.duration.toFixed(1)}s · ${result.recovery.clean ? "无残留" : "有残留"}`
    : "尚未执行";
  elements.verificationResult.innerHTML = `
    <article class="verify-result-card ${result.pass ? "pass" : "fail"}">
      <div class="verify-title">
        <strong>${result.pass ? "SEED 复现校验通过" : "SEED 复现校验失败"}</strong>
        <span>${result.pass ? "PASS" : "FAIL"}</span>
      </div>
      <div class="verify-row">
        <span>天气序列</span>
        <code>${result.weather.replayed}</code>
      </div>
      <div class="verify-row">
        <span>目标分布</span>
        <code>${result.targets.replayed}</code>
      </div>
      <div class="verify-row">
        <span>临界阈值记录</span>
        <code>${result.criticalVerified ? "已捕获" : "待触发"}</code>
      </div>
      <div class="verify-row">
        <span>处置失败记录</span>
        <code>${result.failureVerified ? "已捕获" : "待触发"}</code>
      </div>
      <div class="verify-row">
        <span>恢复固定运行</span>
        <code>${recoveryText}</code>
      </div>
    </article>
    <div class="verify-result-card">
      <div class="verify-title"><strong>触发时刻</strong><span>TRIGGER LOG</span></div>
      ${triggerRows}
    </div>
  `;
}

function setTab(tab) {
  ui.activeTab = tab;
  $$("[data-log-tab]").forEach((button) => {
    const active = button.dataset.logTab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  elements.eventLog.hidden = tab !== "events";
  elements.operationLog.hidden = tab !== "operations";
  elements.verificationLog.hidden = tab !== "verification";
}

function updateUi(state, force = false) {
  renderHeader(state);
  renderMetrics(state);
  renderTargets(state);
  renderInterventions(state);
  renderComparison(state);

  const operationSignature = state.operations
    .map((operation) => `${operation.id}:${operation.status}`)
    .join("|");
  const logSignature = `${state.logs.length}|${operationSignature}|${ui.hiddenLogsBefore}`;
  if (force || logSignature !== ui.logSignature) {
    renderEvents(state);
    renderOperations(state);
    ui.logSignature = logSignature;
  }
  if (force) renderVerification();

  if (force || !state.ended) announceNewLogs();
  const clockSlot = Math.floor(state.elapsed / 5);
  if (
    state.running &&
    state.elapsed > 0.2 &&
    clockSlot !== ui.lastSoundSecond &&
    audio.context &&
    audio.enabled
  ) {
    ui.lastSoundSecond = clockSlot;
    audio.clockTick(clockSlot % 2 === 0);
  }
}

function frame(now) {
  const delta = Math.min(0.25, Math.max(0, (now - ui.lastFrame) / 1000));
  ui.lastFrame = now;
  if (engine.running && !engine.ended) {
    engine.step(delta);
  }
  renderer.render(now);
  if (now - ui.lastUiUpdate > 90) {
    updateUi(engine.stateSummary());
    ui.lastUiUpdate = now;
  }
  requestAnimationFrame(frame);
}

elements.runButton.addEventListener("click", toggleRun);
elements.resetButton.addEventListener("click", () => resetExperiment());
elements.seedInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  resetExperiment(elements.seedInput.value);
  elements.seedInput.blur();
});

elements.soundButton.addEventListener("click", () => {
  audio.setEnabled(!audio.enabled);
  elements.soundButton.classList.toggle("muted", !audio.enabled);
  elements.soundButton.setAttribute("aria-label", audio.enabled ? "关闭声音" : "开启声音");
  showToast(audio.enabled ? "实验计时声音已开启" : "实验计时声音已静音", "normal", 1800);
  if (audio.enabled) audio.clockTick(true);
});

$$(".action-button").forEach((button) => {
  button.addEventListener("click", () => handleIntervention(button.dataset.action));
});
elements.recoveryButton.addEventListener("click", handleRecovery);
elements.dismissBanner.addEventListener("click", () => {
  ui.bannerDismissed = true;
  elements.successBanner.hidden = true;
});

$$("[data-log-tab]").forEach((button) => {
  button.addEventListener("click", () => setTab(button.dataset.logTab));
});
elements.clearLogButton.addEventListener("click", () => {
  ui.hiddenLogsBefore = engine.logs.length;
  ui.logSignature = "";
  updateUi(engine.stateSummary(), true);
  showToast("记录视图已清空；后续事件仍会写入。", "normal", 2000);
});

elements.verifyButton.addEventListener("click", () => {
  audio.ensureContext();
  ui.verification = engine.verificationSummary();
  renderVerification();
  const result = ui.verification;
  if (result.pass) audio.success();
  else audio.warning();
  setTab("verification");
  showToast(
    result.pass
      ? "天气序列与目标分布复现一致，触发时刻已核对。"
      : "复现校验未通过，请检查 seed 与运行状态。",
    result.pass ? "normal" : "error",
    3600,
  );
});

elements.canvas.addEventListener("pointermove", updateCanvasTip);
elements.canvas.addEventListener("pointerleave", () => {
  renderer.setPointer(null);
  elements.canvasTipText.textContent = "移动指针以检查采样距离";
  elements.canvas.style.cursor = "crosshair";
});
elements.canvas.addEventListener("click", handleSampleClick);

document.addEventListener(
  "pointerdown",
  () => {
    audio.ensureContext();
  },
  { once: true },
);

document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }
  if (event.code === "Space") {
    event.preventDefault();
    toggleRun();
  } else if (event.key === "1" || event.key === "2" || event.key === "3") {
    const types = { 1: "irrigation", 2: "shade", 3: "ventilation" };
    handleIntervention(types[event.key]);
  } else if (event.key.toLowerCase() === "r") {
    resetExperiment();
  }
});

window.addEventListener("beforeunload", () => {
  persistSeed(engine.seed);
});

window.__microfield = {
  getState: () => engine.stateSummary(),
  advance(seconds) {
    engine.advanceTo(engine.elapsed + seconds);
    updateUi(engine.stateSummary(), true);
    renderer.render(performance.now());
    return engine.stateSummary();
  },
  sampleAt: (x, y) => engine.sampleAt(x, y),
  intervention: (type) => engine.applyIntervention(type),
  recover: () => engine.beginRecovery(),
  verify: () => engine.verificationSummary(),
  reset: (seed) => resetExperiment(seed),
};

persistSeed(engine.seed);
updateUi(engine.stateSummary(), true);
requestAnimationFrame((now) => {
  ui.lastFrame = now;
  requestAnimationFrame(frame);
});
