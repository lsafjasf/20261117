import {
  BATCHES,
  PARAMETER_META,
  QUALITY_LIMITS,
  advance,
  createSimulation,
  currentBatch,
  loadNextBatch,
  pauseSimulation,
  qualityLimits,
  recoverEquipment,
  resetBatch,
  resetSession,
  resumeSimulation,
  setParameter,
  startProduction,
  stepSimulation
} from "./simulation.js";
import { SCENARIOS, buildFullReport, runAllScenarios, runScenario } from "./validation.js";
import { WashRenderer } from "./renderer.js";
import { WashAudio } from "./audio.js";

const $ = (id) => document.getElementById(id);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, digits = 1) => Number(value.toFixed(digits));
const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const STATUS_LABEL = {
  idle: "待生产",
  running: "清洗运行",
  paused: "已暂停",
  fault: "联锁停机",
  inspection: "检查不合格",
  "awaiting-next": "本批合格",
  complete: "三批完成"
};

const STAGE_LABEL = {
  idle: "待机",
  ultrasonic: "超声清洗",
  rinse: "漂洗",
  drying: "热风烘干",
  inspection: "检查判定"
};

const EQUIPMENT_LABEL = {
  ultrasonic: "超声",
  pump: "水泵",
  heater: "加热",
  basket: "篮体",
  fan: "风机"
};

const STAGE_CAPTION = {
  idle: "调整工艺参数后启动清洗",
  ultrasonic: "超声波空化剥离油膜，篮体持续旋转",
  rinse: "漂洗水循环带走松脱油污",
  drying: "热风与篮体旋转去除表面水膜",
  inspection: "检查残留、腐蚀与锈蚀指标"
};

let sim = createSimulation();
let scenarios = [];
const renderer = new WashRenderer($("washCanvas"));
const audio = new WashAudio();
const parameterInputs = {
  duration: $("durationInput"),
  temp: $("tempInput"),
  rpm: $("rpmInput")
};
const parameterValues = {
  duration: $("durationValue"),
  temp: $("tempValue"),
  rpm: $("rpmValue")
};
const safeLabels = {
  duration: $("durationSafe"),
  temp: $("tempSafe"),
  rpm: $("rpmSafe")
};
let lastFrame = performance.now();
let lastUiRender = 0;
let lastReportRender = 0;
let lastEventSignature = "";
let toastTimer = null;

function showToast(message, type = "info") {
  const toast = $("toast");
  toast.textContent = message;
  toast.className = `toast show${type === "error" ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.className = "toast";
  }, 3100);
}

function setRangeVisual(key) {
  const input = parameterInputs[key];
  const meta = PARAMETER_META[key];
  const batch = currentBatch(sim);
  const [safeMin, safeMax] = batch.window[key];
  const start = ((safeMin - meta.min) / (meta.max - meta.min)) * 100;
  const end = ((safeMax - meta.min) / (meta.max - meta.min)) * 100;
  input.style.setProperty("--track-start", `${start}%`);
  input.style.setProperty("--track-end", `${end}%`);
  input.value = sim.parameters[key];
  input.classList.toggle(
    "out-of-range",
    sim.parameters[key] < safeMin || sim.parameters[key] > safeMax
  );
  parameterValues[key].textContent = sim.parameters[key];
  safeLabels[key].textContent = `安全 ${safeMin}–${safeMax}`;
}

function applyParameter(key, value, source = "operator") {
  const result = setParameter(sim, key, value, { source });
  if (result.accepted) {
    const meta = PARAMETER_META[key];
    showToast(`${meta.label}已调整至 ${result.value} ${meta.unit}`);
  }
  renderAll(true);
}

Object.entries(parameterInputs).forEach(([key, input]) => {
  input.addEventListener("input", () => {
    applyParameter(key, Number(input.value));
  });
});

$("startBtn").addEventListener("click", () => {
  const result = startProduction(sim);
  if (result.started) showToast(`已启动 ${currentBatch(sim).id} 超声清洗`);
  else if (result.fault) showToast(result.fault.message, "error");
  renderAll(true);
});

$("pauseBtn").addEventListener("click", () => {
  if (sim.status === "running") {
    pauseSimulation(sim);
    showToast("仿真已暂停，生产、能耗与缓存时钟同步冻结");
  } else if (sim.status === "paused") {
    resumeSimulation(sim);
    showToast("已恢复当前批次，时钟从冻结位置继续");
  }
  renderAll(true);
});

$("stepBtn").addEventListener("click", () => {
  const result = stepSimulation(sim, 0.5);
  if (!result.stepped) showToast("请先暂停，再单步推进", "error");
  renderAll(true);
});

$("batchResetBtn").addEventListener("click", () => {
  const result = resetBatch(sim);
  if (result.reset) showToast(`已重置 ${result.batch}，返工次数 ${result.attempt - 1}`);
  renderAll(true);
});

$("nextBtn").addEventListener("click", () => {
  const result = loadNextBatch(sim);
  if (result.loaded) showToast(`已装载 ${result.batch.id} · ${result.batch.name}`);
  renderAll(true);
});

$("recoverBtn").addEventListener("click", () => {
  const result = recoverEquipment(sim);
  if (result.recovered) showToast("安全联锁已复位，可返工当前批次");
  renderAll(true);
});

$("sessionResetBtn").addEventListener("click", () => {
  if (!window.confirm("重开会话将清空本轮日志与缓存，且不保留旧数据。继续？")) return;
  sim = resetSession(sim);
  scenarios = [];
  lastEventSignature = "";
  showToast("新会话已建立，旧缓存与旧批次数据已清空");
  renderAll(true);
});

$("soundBtn").addEventListener("click", async () => {
  try {
    const enabled = await audio.toggle();
    $("soundBtn").setAttribute("aria-pressed", String(enabled));
    $("soundBtn").lastChild.textContent = enabled ? " 声音开" : " 声音关";
  } catch {
    showToast("当前浏览器无法启用声音", "error");
  }
});

$("eventFilter").addEventListener("change", () => {
  lastEventSignature = "";
  renderEvents();
});

function renderHeader() {
  const status = $("statusPill");
  status.textContent = STATUS_LABEL[sim.status] ?? sim.status;
  status.className = `status-pill ${sim.status}`;
  $("clockValue").textContent = `${sim.clock.toFixed(2)} s`;
  $("stageLabel").textContent = STAGE_LABEL[sim.stage] ?? sim.stage;
  $("stageDot").classList.toggle(
    "active",
    sim.status === "running" || sim.status === "paused"
  );
  $("canvasBatch").textContent = `${currentBatch(sim).id} · ${currentBatch(sim).name}`;
  $("canvasCaption").textContent =
    sim.status === "fault"
      ? `${sim.fault.code} · ${sim.fault.location}`
      : STAGE_CAPTION[sim.stage] ?? "";
  $("canvasTimer").textContent = `${sim.stageElapsed.toFixed(1)} / ${sim.stageDuration.toFixed(1)} s`;
  $("canvasFault").classList.toggle("hidden", sim.status !== "fault");
  $("pausedOverlay").classList.toggle("hidden", sim.status !== "paused");
  $("pausedOverlay").querySelector("small").textContent =
    `冻结于 T+${sim.clock.toFixed(2)}s · 生产 / 能耗 / 缓存一致`;
}

function renderBatchPanel() {
  const batch = currentBatch(sim);
  $("batchName").textContent = batch.name;
  $("batchCounter").textContent = `${String(sim.batchIndex + 1).padStart(2, "0")} / 03`;
  $("batchId").textContent = batch.id;
  $("batchOil").textContent = batch.oil;
  $("batchAttempt").textContent = `第 ${sim.attempt} 次`;
  $("windowNote").textContent = `窗口 ${batch.window.duration[0]}–${batch.window.duration[1]}s`;

  const latestByBatch = new Map();
  sim.production.batchResults.forEach((result) => {
    latestByBatch.set(result.batchId, result);
  });
  $("batchDots").innerHTML = BATCHES.map((item, index) => {
    const result = latestByBatch.get(item.id);
    const classes = ["batch-dot"];
    if (result) classes.push(result.passed ? "passed" : "failed");
    else if (index === sim.batchIndex) classes.push("current");
    return `<span class="${classes.join(" ")}" title="${item.id}"></span>`;
  }).join("");

  const limits = qualityLimits(batch);
  const residuePercent = clamp((sim.quality.residue / batch.oilLoad) * 100, 0, 100);
  const corrosionPercent = clamp(
    (sim.quality.corrosion / limits.corrosion) * 100,
    0,
    100
  );
  const rustPercent = clamp((sim.quality.rust / limits.rust) * 100, 0, 100);
  $("residueValue").textContent = `${round(sim.quality.residue)}%`;
  $("corrosionValue").textContent = `${round(sim.quality.corrosion)}%`;
  $("rustValue").textContent = `${round(sim.quality.rust)}%`;
  $("residueBar").style.width = `${residuePercent}%`;
  $("corrosionBar").style.width = `${corrosionPercent}%`;
  $("rustBar").style.width = `${rustPercent}%`;
  $("residueBar").style.background =
    sim.quality.residue > limits.residue ? "var(--amber)" : "";

  for (const key of Object.keys(parameterInputs)) setRangeVisual(key);
  const issues = [];
  for (const key of ["duration", "temp", "rpm"]) {
    const [min, max] = batch.window[key];
    if (sim.parameters[key] < min) issues.push(`${PARAMETER_META[key].label}低于下限`);
    if (sim.parameters[key] > max) issues.push(`${PARAMETER_META[key].label}高于上限`);
  }
  const hint = $("controlHint");
  hint.classList.toggle("warn", issues.length > 0);
  hint.textContent = issues.length
    ? `${issues.join("；")}。仍可运行，但检查时可能判废。`
    : "参数处于当前批次质量窗口；越限会记录并在检查时反映为腐蚀或残留。";
}

function renderInspection() {
  const card = $("inspectionCard");
  card.className = "inspection-card";
  let title = "等待首批清洗";
  let detail = "清洗结束后自动进入三道指标检查。";
  if (sim.status === "fault") {
    card.classList.add("fail");
    title = `${sim.fault.code} · 联锁停机`;
    detail = `${sim.fault.message}。触发于 T+${sim.fault.at.toFixed(2)}s，位置：${sim.fault.location}。`;
  } else if (sim.inspection) {
    const inspection = sim.inspection;
    card.classList.add(inspection.passed ? "pass" : "fail");
    title = inspection.passed
      ? `${inspection.batchId} 检查合格`
      : `${inspection.batchId} 检查不合格 · ${inspection.reason}`;
    detail = `残留 ${inspection.metrics.residue}% / 腐蚀 ${inspection.metrics.corrosion}% / 锈蚀 ${inspection.metrics.rust}%` +
      (inspection.anomalyLocation ? ` · ${inspection.anomalyLocation}` : "");
  } else if (sim.status === "running" || sim.status === "paused") {
    title = `${STAGE_LABEL[sim.stage]}进行中`;
    detail = sim.status === "paused"
      ? `当前批次冻结在 T+${sim.clock.toFixed(2)}s，可检查数值后恢复。`
      : `当前质量预测：残留 ${round(sim.quality.residue)}% / 腐蚀 ${round(sim.quality.corrosion)}%。`;
  } else if (sim.status === "idle" && sim.attempt > 1) {
    title = `返工准备 · ${currentBatch(sim).id}`;
    detail = "参数已恢复为推荐值，可重新启动当前批次。";
  }
  $("inspectionTitle").textContent = title;
  $("inspectionDetail").textContent = detail;
}

function renderActions() {
  const start = $("startBtn");
  const pause = $("pauseBtn");
  const step = $("stepBtn");
  const reset = $("batchResetBtn");
  const next = $("nextBtn");
  const recover = $("recoverBtn");
  start.disabled = sim.status !== "idle";
  pause.disabled = !["running", "paused"].includes(sim.status);
  pause.textContent = sim.status === "paused" ? "恢复当前批次" : "暂停";
  step.disabled = sim.status !== "paused";
  reset.disabled = sim.status === "complete";
  next.classList.toggle("hidden", sim.status !== "awaiting-next");
  recover.classList.toggle("hidden", sim.status !== "fault");
  const hint = $("sessionHint");
  if (sim.status === "fault") {
    hint.textContent = "设备已联锁停机。复位后将返工当前批次，不跳过检查。";
  } else if (sim.status === "awaiting-next") {
    hint.textContent = `${currentBatch(sim).id} 已合格，装载下一批继续生产。`;
  } else if (sim.status === "complete") {
    hint.textContent = `生产完成：${sim.production.goodUnits}/3 批合格。可导出完整报告。`;
  } else if (sim.status === "inspection") {
    hint.textContent = "本批不合格，可重置本批调整参数后返工。";
  } else {
    hint.textContent = "三批全部检查合格后判定生产成功。";
  }
}

function renderEquipment() {
  $("equipmentList").innerHTML = Object.entries(EQUIPMENT_LABEL).map(([name, label]) => {
    const active = sim.activeEquipment.includes(name);
    const offline = sim.status === "fault" && !active;
    return `<span class="equipment-chip${active ? " active" : ""}${offline ? " offline" : ""}">${label}</span>`;
  }).join("");
}

function renderTelemetry() {
  const inspected = sim.production.inspectedUnits;
  const yieldRate = inspected ? sim.production.goodUnits / inspected : 0;
  $("goodUnits").textContent = `${sim.production.goodUnits}`;
  $("yieldRate").textContent = `${round(yieldRate * 100)}%`;
  $("totalEnergy").textContent = sim.energy.totalKwh.toFixed(4);
  $("peakPower").textContent = sim.energy.peakKw.toFixed(2);
  $("cacheCount").textContent = `${sim.cache.entries.length}`;
  $("cacheHits").textContent = `${sim.cache.hits}`;
  $("productionClock").textContent = `T ${sim.production.lastUpdate.toFixed(2)}`;
  $("energyClock").textContent = `T ${sim.energy.lastUpdate.toFixed(2)}`;
  $("cacheClock").textContent = `T ${sim.cache.lastUpdate.toFixed(2)}`;

  const latestCache = sim.cache.entries.at(-1);
  $("cacheLatest").textContent = latestCache
    ? latestCache.kind === "inspection"
      ? `T ${latestCache.at.toFixed(2)} · 检查 ${latestCache.passed ? "合格" : "判废"}`
      : `T ${latestCache.at.toFixed(2)} · ${STAGE_LABEL[latestCache.stage] ?? latestCache.stage}`
    : "尚无样本";

  const sourceLabels = {
    ultrasonic: "超声",
    heater: "加热",
    pump: "水泵",
    basket: "篮体",
    fan: "风机"
  };
  const maxSource = Math.max(0.000001, ...Object.values(sim.energy.bySource));
  $("energyBars").innerHTML = Object.entries(sim.energy.bySource)
    .map(([source, value]) => {
      const width = (value / maxSource) * 100;
      return `<div class="energy-row">
        <span>${sourceLabels[source]}</span>
        <span class="bar"><i style="width:${width}%"></i></span>
        <strong>${value.toFixed(4)}</strong>
      </div>`;
    })
    .join("");

  const stageOrder = ["ultrasonic", "rinse", "drying", "inspection"];
  const currentIndex = stageOrder.indexOf(sim.stage);
  document.querySelectorAll(".stage-node").forEach((node) => {
    const index = stageOrder.indexOf(node.dataset.stage);
    node.classList.remove("active", "done", "failed");
    if (sim.status === "fault" && index === currentIndex) node.classList.add("failed");
    else if (sim.status === "complete") node.classList.add("done");
    else if (sim.status === "awaiting-next") node.classList.add("done");
    else if (index < currentIndex) node.classList.add("done");
    else if (index === currentIndex && ["running", "paused", "inspection"].includes(sim.status)) {
      node.classList.add("active");
    }
  });

  const stageTime = (stage, duration) => {
    const index = stageOrder.indexOf(stage);
    if (sim.stage === stage) return `${sim.stageElapsed.toFixed(1)} / ${duration}s`;
    if (currentIndex > index || sim.status === "complete" || sim.status === "awaiting-next") {
      return `${duration} / ${duration}s`;
    }
    return `0 / ${duration}s`;
  };
  $("ultrasonicTime").textContent = stageTime("ultrasonic", sim.parameters.duration);
  $("rinseTime").textContent = stageTime("rinse", 6);
  $("dryingTime").textContent = stageTime("drying", 9);

  const recentResults = sim.production.batchResults.slice(-6);
  $("batchResults").innerHTML = recentResults.length
    ? recentResults
        .map(
          (result) =>
            `<span class="result-chip ${result.passed ? "pass" : "fail"}" title="${escapeHtml(result.reason)}">${result.batchId} · ${result.passed ? "OK" : "NG"}</span>`
        )
        .join("")
    : BATCHES.map(
        (batch) => `<span class="result-chip">${batch.id} · 待检</span>`
      ).join("");

  $("reportStamp").textContent =
    sim.production.inspectedUnits || scenarios.length ? "READY" : "LIVE";
  $("reportStamp").classList.toggle(
    "ready",
    sim.production.inspectedUnits > 0 || scenarios.length > 0
  );
}

function eventDescription(event) {
  switch (event.type) {
    case "production-start":
      return `启动工艺 · ${event.values.duration}s / ${event.values.temp}°C / ${event.values.rpm}rpm`;
    case "equipment-start":
      return `${EQUIPMENT_LABEL[event.equipment] ?? event.equipment}启动`;
    case "equipment-stop":
      return `${EQUIPMENT_LABEL[event.equipment] ?? event.equipment}停止 · ${event.reason}`;
    case "parameter-change":
      return `${event.label} ${event.previous} → ${event.value} ${PARAMETER_META[event.parameter]?.unit ?? ""}`;
    case "stage-change":
      return `${STAGE_LABEL[event.from]} → ${STAGE_LABEL[event.to]}`;
    case "quality-limit":
      return `${event.label}越限：${event.value}（窗口 ${event.min}–${event.max}）`;
    case "hard-limit":
      return `${event.label}触发安全上限 ${event.limit}，当前 ${event.value}`;
    case "equipment-fault":
      return `${event.code} · ${event.reason} · ${event.location}`;
    case "batch-result":
      return `${event.passed ? "合格" : "判废"} · ${event.reason} · ${JSON.stringify(event.metrics)}`;
    case "simulation-pause":
      return `暂停于 ${STAGE_LABEL[event.stage]}，共享时钟冻结`;
    case "simulation-resume":
      return `恢复当前批次与 ${STAGE_LABEL[event.stage]}`;
    case "simulation-step":
      return `单步 ${event.from}s → ${event.to}s`;
    case "batch-reset":
      return `重置当前批次 · ${event.reason}`;
    case "equipment-recover":
      return `故障 ${event.faultCode} 复位，返工尝试 ${event.attempt}`;
    case "batch-loaded":
      return "装载下一批并应用推荐参数";
    case "session-complete":
      return `三批完成 · ${event.goodUnits}/${event.inspectedUnits} 合格`;
    case "session-reset":
      return "重开会话，旧缓存与旧批次数据已清空";
    default:
      return event.type;
  }
}

function renderEvents() {
  const filter = $("eventFilter").value;
  const visible = sim.events.filter((event) => {
    if (filter === "equipment") return event.type.startsWith("equipment");
    if (filter === "parameter") {
      return ["parameter-change", "quality-limit", "hard-limit"].includes(event.type);
    }
    if (filter === "batch") {
      return (
        event.type.startsWith("batch") ||
        [
          "session-complete",
          "session-reset",
          "production-start",
          "equipment-fault",
          "equipment-recover",
          "quality-limit",
          "hard-limit"
        ].includes(event.type)
      );
    }
    return true;
  });
  const signature = `${filter}:${visible.length}:${sim.events.length}`;
  $("eventCount").textContent =
    visible.length > 120
      ? `${visible.length} 条记录 · 显示最近 120`
      : `${visible.length} 条记录`;
  if (signature === lastEventSignature) return;
  lastEventSignature = signature;
  const rows = visible.slice(-120).reverse();
  if (!rows.length) {
    $("eventRows").innerHTML =
      '<tr class="empty-row"><td colspan="4">当前筛选条件下暂无事件。</td></tr>';
    return;
  }
  const faultTypes = new Set([
    "equipment-fault",
    "hard-limit",
    "batch-result",
    "simulation-pause"
  ]);
  $("eventRows").innerHTML = rows
    .map((event) => {
      const isFault =
        faultTypes.has(event.type) &&
        (event.type !== "batch-result" || event.passed === false);
      return `<tr class="${isFault ? "event-fault" : ""}">
        <td>T+${event.at.toFixed(2)}s</td>
        <td>${escapeHtml(event.batch ?? "—")}</td>
        <td><span class="event-name">${escapeHtml(eventTypeLabel(event.type))}</span></td>
        <td>${escapeHtml(eventDescription(event))}</td>
      </tr>`;
    })
    .join("");
}

function eventTypeLabel(type) {
  const labels = {
    "production-start": "生产启动",
    "equipment-start": "设备启动",
    "equipment-stop": "设备停止",
    "parameter-change": "参数变化",
    "stage-change": "阶段切换",
    "quality-limit": "参数越限",
    "hard-limit": "安全越限",
    "equipment-fault": "设备故障",
    "batch-result": "批次结果",
    "simulation-pause": "暂停",
    "simulation-resume": "恢复",
    "simulation-step": "单步",
    "batch-reset": "批次重置",
    "equipment-recover": "设备复位",
    "batch-loaded": "批次装载",
    "session-complete": "生产完成",
    "session-reset": "重开会话"
  };
  return labels[type] ?? type;
}

function compactValue(values) {
  if (!values || typeof values !== "object") return "—";
  if ("duration" in values && "temp" in values && "rpm" in values) {
    return `${values.duration}s / ${values.temp}°C / ${values.rpm}rpm`;
  }
  return JSON.stringify(values);
}

function scenarioTriggerText(scenario) {
  if (!scenario.trigger) return "无故障触发 · 连续三批";
  const trigger = scenario.trigger;
  if (trigger.type === "process-upper-boundary") return "三批均取工艺窗口上边界";
  if (trigger.type === "equipment-interlock") {
    return `T+${trigger.at.toFixed(2)}s · ${trigger.code} · ${compactValue(trigger.values)}`;
  }
  const parameterLabel = PARAMETER_META[trigger.parameter]?.label ?? trigger.parameter;
  return `T+${trigger.at.toFixed(2)}s · ${parameterLabel} ${trigger.values[trigger.parameter]} · ${compactValue(trigger.values)}`;
}

function scenarioRecoveryText(scenario) {
  if (!scenario.recovery) return scenario.trigger ? "未执行恢复" : "无需恢复";
  const recovery = scenario.recovery;
  if (!recovery.attempted) return "未执行恢复";
  return `T+${recovery.at.toFixed(2)}s · ${recovery.action} · ${recovery.result === "pass" ? "检查合格" : "恢复失败"}`;
}

function renderScenarios() {
  const container = $("scenarioResults");
  if (!scenarios.length) {
    container.innerHTML =
      '<div class="scenario-empty">运行任一场景后在这里查看引擎结果。</div>';
    return;
  }
  container.innerHTML = scenarios
    .map((scenario) => {
      const anomaly = scenario.anomalies?.[0];
      return `<div class="scenario-result ${scenario.passed ? "" : "fail"}">
        <div class="scenario-head">
          <strong>${escapeHtml(scenario.category)} · ${escapeHtml(scenario.name)}</strong>
          <span>${scenario.passed ? "PASS" : "FAIL"}</span>
        </div>
        <div class="scenario-line"><b>触发</b><span>${escapeHtml(scenarioTriggerText(scenario))}</span></div>
        <div class="scenario-line"><b>恢复</b><span>${escapeHtml(scenarioRecoveryText(scenario))}</span></div>
        <div class="scenario-line"><b>结果</b><span>${escapeHtml(`${scenario.yieldText} · 峰值 ${scenario.peakKw}kW · 停机 ${scenario.stopCount}`)}</span></div>
        <div class="scenario-line"><b>异常</b><span>${escapeHtml(anomaly ? `${anomaly.batch} · ${anomaly.location} · ${anomaly.reason}` : "无异常位置")}</span></div>
        <div class="scenario-checks">${scenario.checks
          .map(
            (check) =>
              `<span class="check-chip ${check.passed ? "" : "fail"}">${check.passed ? "✓" : "×"} ${escapeHtml(check.label)}</span>`
          )
          .join("")}</div>
      </div>`;
    })
    .join("");
}

function updateValidationStatus() {
  const status = $("validationStatus");
  if (!scenarios.length) {
    status.className = "validation-status";
    status.lastElementChild.textContent = "尚未运行验证";
    return;
  }
  const passed = scenarios.filter((scenario) => scenario.passed).length;
  status.className = `validation-status ${passed === scenarios.length ? "pass" : "fail"}`;
  status.lastElementChild.textContent =
    `${passed}/${scenarios.length} 场景通过 · 正常 / 异常 / 极限均来自实际引擎执行`;
}

function runSingleScenario(id) {
  const button = document.querySelector(`[data-scenario="${id}"]`);
  if (button) button.disabled = true;
  try {
    const result = runScenario(id);
    scenarios = scenarios.filter((scenario) => scenario.id !== id);
    scenarios.push(result);
    scenarios.sort(
      (a, b) =>
        SCENARIOS.findIndex((item) => item.id === a.id) -
        SCENARIOS.findIndex((item) => item.id === b.id)
    );
    renderScenarios();
    updateValidationStatus();
    updateReportPreview(true);
    showToast(`${result.name}验证${result.passed ? "通过" : "失败"} · ${result.yieldText}`);
  } catch (error) {
    showToast(`验证执行失败：${error.message}`, "error");
  } finally {
    if (button) button.disabled = false;
  }
}

function buildReportSummary() {
  const report = buildFullReport(sim, scenarios);
  const scenarioStops = scenarios.flatMap((scenario) => scenario.stopReasons ?? []);
  const scenarioAnomalies = scenarios.flatMap((scenario) =>
    (scenario.anomalies ?? []).map((anomaly) => ({
      scenario: scenario.name,
      ...anomaly
    }))
  );
  return {
    schema: report.schema,
    generatedAt: report.generatedAt,
    simClock: report.simClock,
    currentRun: {
      status: report.status,
      success: report.success,
      goodUnits: report.goodUnits,
      inspectedUnits: report.inspectedUnits,
      goodRatePercent: report.goodRatePercent,
      peakKw: report.peakKw
    },
    eventCount: report.events.length,
    stopReasons: [...new Set([...report.stopReasons, ...scenarioStops])],
    anomalies: [...report.anomalies, ...scenarioAnomalies],
    validation: scenarios.map((scenario) => ({
      category: scenario.category,
      name: scenario.name,
      passed: scenario.passed,
      triggerAt: scenario.trigger?.at ?? null,
      triggerValues: scenario.trigger?.values ?? null,
      recovery: scenario.recovery
        ? { at: scenario.recovery.at, result: scenario.recovery.result }
        : null,
      yield: scenario.yieldText,
      peakKw: scenario.peakKw,
      stopReasons: scenario.stopReasons
    }))
  };
}

function updateReportPreview(force = false) {
  const now = performance.now();
  if (!force && now - lastReportRender < 700) return;
  lastReportRender = now;
  const summary = buildReportSummary();
  $("reportPreview").textContent = JSON.stringify(summary, null, 2);
  const ready =
    sim.status === "complete" ||
    scenarios.some((scenario) => scenario.passed);
  $("exportHint").textContent = ready
    ? `当前 ${summary.currentRun.goodUnits} 良品 · 峰值 ${summary.currentRun.peakKw}kW · ${summary.stopReasons.length} 类停机原因。`
    : "包含良品数、良品率、峰值、停机原因与异常位置。";
}

function exportReportFile() {
  const report = buildFullReport(sim, scenarios);
  report.exportedAt = new Date().toISOString();
  report.validationSummary = {
    passed: scenarios.filter((scenario) => scenario.passed).length,
    total: scenarios.length,
    allPassed: scenarios.length > 0 && scenarios.every((scenario) => scenario.passed)
  };
  const blob = new Blob([JSON.stringify(report, null, 2)], {
    type: "application/json;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
  link.href = url;
  link.download = `wash-report-${stamp}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast(
    `报告已导出：良品 ${report.goodUnits}/${report.inspectedUnits} · 峰值 ${report.peakKw}kW · ${report.stopCount} 次停机`
  );
}

function initializeScenarioButtons() {
  $("scenarioButtons").innerHTML = SCENARIOS.map(
    (scenario) => `<button class="scenario-btn" data-scenario="${scenario.id}" type="button" title="${escapeHtml(scenario.description)}">
      <span>${escapeHtml(scenario.name)}</span><small>${escapeHtml(scenario.category)}</small>
    </button>`
  ).join("");
  document.querySelectorAll("[data-scenario]").forEach((button) => {
    button.addEventListener("click", () => runSingleScenario(button.dataset.scenario));
  });
}

$("runAllBtn").addEventListener("click", () => {
  const button = $("runAllBtn");
  button.disabled = true;
  button.textContent = "验证运行中…";
  setTimeout(() => {
    try {
      scenarios = runAllScenarios();
      renderScenarios();
      updateValidationStatus();
      updateReportPreview(true);
      const allPassed = scenarios.every((scenario) => scenario.passed);
      showToast(
        allPassed
          ? "正常、越限、停机与极限场景全部通过"
          : "存在未通过的验证场景，请查看明细",
        allPassed ? "info" : "error"
      );
    } catch (error) {
      showToast(`验证套件异常：${error.message}`, "error");
    } finally {
      button.disabled = false;
      button.textContent = "运行全部验证";
    }
  }, 30);
});

$("exportBtn").addEventListener("click", exportReportFile);

function renderLive() {
  renderHeader();
  renderBatchPanel();
  renderInspection();
  renderActions();
  renderEquipment();
  renderTelemetry();
  renderEvents();
}

function renderAll(forceReport = false) {
  renderLive();
  renderScenarios();
  updateValidationStatus();
  updateReportPreview(forceReport);
}

function animate(now) {
  const delta = Math.min(0.25, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  if (sim.status === "running" && !document.hidden) {
    const speed = Number($("speedSelect").value) || 1;
    advance(sim, delta * speed);
  }
  renderer.draw(sim);
  audio.update(sim);
  if (now - lastUiRender > 90) {
    lastUiRender = now;
    renderLive();
    updateReportPreview();
  }
  requestAnimationFrame(animate);
}

document.addEventListener("visibilitychange", () => {
  lastFrame = performance.now();
});

window.addEventListener("resize", () => renderer.resize());

initializeScenarioButtons();
renderAll(true);
renderer.draw(sim);
requestAnimationFrame(animate);
