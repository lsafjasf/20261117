import { BoxMachine, RECIPES, PARAM_META } from "./engine.js";
import { MachineRenderer, TelemetryRenderer } from "./render.js";
import { MachineAudio } from "./audio.js";
import { VALIDATION_RUNNERS } from "./validation.js";

const $ = (id) => document.getElementById(id);
const refs = {
  liveDot: $("liveDot"),
  machineState: $("machineState"),
  batchCode: $("batchCode"),
  clock: $("clock"),
  soundButton: $("soundButton"),
  goodCount: $("goodCount"),
  goodProgress: $("goodProgress"),
  yieldRate: $("yieldRate"),
  attemptNote: $("attemptNote"),
  energy: $("energy"),
  power: $("power"),
  peakPower: $("peakPower"),
  bufferCount: $("bufferCount"),
  bufferNote: $("bufferNote"),
  beatRate: $("beatRate"),
  beatNote: $("beatNote"),
  phaseRail: $("phaseRail"),
  sizeBadge: $("sizeBadge"),
  cycleReadout: $("cycleReadout"),
  phaseReadout: $("phaseReadout"),
  startOverlay: $("startOverlay"),
  overlayStart: $("overlayStart"),
  deviceConveyor: $("deviceConveyor"),
  deviceGlue: $("deviceGlue"),
  devicePress: $("devicePress"),
  deviceStacker: $("deviceStacker"),
  logCount: $("logCount"),
  clearFilter: $("clearFilter"),
  logList: $("logList"),
  sampleClock: $("sampleClock"),
  sampleProduced: $("sampleProduced"),
  sampleBuffer: $("sampleBuffer"),
  sampleEnergy: $("sampleEnergy"),
  recipeIndex: $("recipeIndex"),
  sizeRoute: $("sizeRoute"),
  recipeDims: $("recipeDims"),
  recipeTarget: $("recipeTarget"),
  applyRecipe: $("applyRecipe"),
  startButton: $("startButton"),
  pauseButton: $("pauseButton"),
  stepButton: $("stepButton"),
  stopButton: $("stopButton"),
  resetButton: $("resetButton"),
  faultBanner: $("faultBanner"),
  faultReason: $("faultReason"),
  restartButton: $("restartButton"),
  validationState: $("validationState"),
  validationResults: $("validationResults"),
  runValidations: $("runValidations"),
  exportSummary: $("exportSummary"),
  exportButton: $("exportButton"),
  toastRegion: $("toastRegion")
};

const params = ["glue", "press", "speed"];
const controlRefs = Object.fromEntries(
  params.map((name) => [
    name,
    {
      range: $(`${name}Range`),
      input: $(`${name}Input`),
      window: $(`${name}Window`),
      hint: $(`${name}Hint`),
      group: document.querySelector(`[data-control="${name}"]`)
    }
  ])
);

const machine = new BoxMachine();
const renderer = new MachineRenderer($("machineCanvas"));
const telemetry = new TelemetryRenderer($("telemetryCanvas"));
const audio = new MachineAudio();
const state = {
  lastUi: 0,
  lastFrame: performance.now(),
  lastPhaseSerial: machine.phaseSerial,
  lastDefectId: null,
  lastMode: machine.mode,
  lastSize: machine.currentSize,
  lastLogSignature: "",
  logFilter: "all",
  dragStart: {},
  validationResults: null,
  validationRunning: false,
  validationCurrent: null,
  validationToken: 0,
  sound: false
};

const PHASE_LABELS = { feed: "送料", glue: "上胶", press: "压合", eject: "出料" };
const MODE_LABELS = {
  idle: "待机",
  running: "生产中",
  paused: "暂停检查",
  stopped: "设备停机",
  complete: "批次完成",
  failed: "批次失败"
};
const CATEGORY_LABELS = {
  system: "系统",
  equipment: "设备",
  stop: "停机",
  recovery: "恢复",
  param: "参数",
  quality: "质量",
  buffer: "缓存",
  batch: "批次",
  handoff: "换型",
  validation: "验证"
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatClock(time) {
  const safe = Math.max(0, Number(time) || 0);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `T+ ${String(minutes).padStart(2, "0")}:${seconds.toFixed(1).padStart(4, "0")}`;
}

function toast(title, message, tone = "") {
  const node = document.createElement("div");
  node.className = `toast ${tone}`;
  node.innerHTML = `<strong>${escapeHtml(title)}</strong>${escapeHtml(message)}`;
  refs.toastRegion.append(node);
  window.setTimeout(() => node.remove(), 3600);
}

function valuesText(values) {
  if (!values) return "—";
  return `胶 ${Number(values.glue).toFixed(2)}g / 压 ${Number(values.press).toFixed(2)}s / 速 ${Math.round(values.speed)}m/min`;
}

function hintFor(name, status) {
  if (name === "glue") {
    if (status.state === "low") return "胶量不足：侧边接缝会开口";
    if (status.state === "high") return "胶量过量：内折线会拉丝";
    return "胶线连续，折边接缝闭合";
  }
  if (name === "press") {
    if (status.state === "low") return "压合不足：底角会回弹";
    if (status.state === "high") return "压合过深：面纸出现压痕";
    return "底角压合稳定，面纸无压痕";
  }
  if (status.state === "low") return "输送滞后：折边角堆积错位";
  if (status.state === "high") return "输送超前：盒角错位";
  return "来料节拍与折边同步";
}

function updateMetrics() {
  const recipe = machine.currentRecipe;
  refs.clock.textContent = formatClock(machine.simTime);
  refs.batchCode.textContent = machine.batchId;
  refs.machineState.textContent = MODE_LABELS[machine.mode] || machine.mode;
  refs.liveDot.className = `live-dot ${machine.mode === "complete" ? "running" : machine.mode === "failed" ? "stopped" : machine.mode}`;
  refs.goodCount.textContent = machine.goodCount;
  refs.goodProgress.style.width = `${(machine.goodCount / machine.goodTarget) * 100}%`;
  refs.yieldRate.textContent = machine.yieldRate === null ? "—" : `${machine.yieldRate.toFixed(1)}%`;
  refs.attemptNote.textContent = machine.attempts ? `已尝试 ${machine.attempts} 件 · 不良 ${machine.defects}` : "等待生产";
  refs.energy.innerHTML = `${machine.energyKwh.toFixed(3)} <small>kWh</small>`;
  refs.power.textContent = machine.powerKw.toFixed(1);
  refs.peakPower.innerHTML = `${machine.peakPowerKw.toFixed(1)} <small>kW</small>`;
  refs.bufferCount.innerHTML = `${machine.bufferCount} <small>/ ${machine.bufferCapacity}</small>`;
  refs.bufferNote.textContent = machine.bufferCount
    ? machine.mode === "stopped"
      ? "停机保持，缓存锁存"
      : `堆垛缓存 ${machine.bufferCount} 件`
    : "进料缓存空闲";
  refs.beatRate.innerHTML = `${Math.round(machine.params.speed)} <small>SPM</small>`;
  refs.beatNote.textContent =
    machine.mode === "running"
      ? `${machine.params.glue.toFixed(2)}g · ${machine.params.press.toFixed(2)}s`
      : machine.mode === "paused"
        ? "时钟冻结 · 节拍保持"
        : machine.mode === "stopped"
          ? "安全回路断开"
          : machine.mode === "complete"
            ? "批次节拍结束"
            : "输送同步";
  refs.batchCode.textContent = machine.batchId;
  refs.phaseReadout.textContent = PHASE_LABELS[machine.phase] || machine.phase;
  refs.cycleReadout.textContent = `CY ${machine.cycleElapsed.toFixed(1)} / ${machine.cycleDuration.toFixed(1)}s`;
  refs.sampleClock.textContent = `${machine.simTime.toFixed(1)}s`;
  refs.sampleProduced.textContent = machine.totalProduced;
  refs.sampleBuffer.textContent = machine.bufferCount;
  refs.sampleEnergy.textContent = machine.energyKwh.toFixed(3);
  refs.phaseRail.querySelectorAll("[data-phase]").forEach((node) => {
    const order = ["feed", "glue", "press", "eject"];
    const activeIndex = order.indexOf(machine.phase);
    const index = order.indexOf(node.dataset.phase);
    node.classList.toggle("active", index === activeIndex && ["running", "paused", "stopped"].includes(machine.mode));
    node.classList.toggle("done", machine.mode === "running" && index < activeIndex);
  });
  refs.sizeBadge.innerHTML = `<span>当前盒型</span><strong>${recipe.id} · ${recipe.name}</strong><small>${recipe.dims} mm</small>`;
}

function updateRecipe() {
  const recipe = machine.currentRecipe;
  refs.recipeIndex.textContent = `${String(machine.currentSizeIndex + 1).padStart(2, "0")} / 03`;
  refs.recipeDims.textContent = recipe.dims;
  refs.recipeTarget.textContent = `${machine.perSizeTarget} 件`;
  refs.sizeRoute.querySelectorAll("[data-size]").forEach((node) => {
    const size = node.dataset.size;
    node.classList.toggle("active", size === machine.currentSize);
    node.classList.toggle("complete", machine.goodBySize[size] >= machine.perSizeTarget);
    node.querySelector("i").textContent = `${machine.goodBySize[size]}/${machine.perSizeTarget}`;
  });

  params.forEach((name) => {
    const meta = PARAM_META[name];
    const spec = recipe[name];
    const control = controlRefs[name];
    const status = machine.getParamStatus(name);
    const range = meta.max - meta.min;
    control.range.style.setProperty("--zone-start", `${((spec.min - meta.min) / range) * 100}%`);
    control.range.style.setProperty("--zone-end", `${((spec.max - meta.min) / range) * 100}%`);
    control.group.classList.toggle("outside", !status.ok);
    control.window.textContent = `窗口 ${spec.min}–${spec.max}`;
    control.hint.textContent = hintFor(name, status);
    if (document.activeElement !== control.range) control.range.value = machine.params[name];
    if (document.activeElement !== control.input) control.input.value = machine.params[name];
  });
}

function updateDevices() {
  const devices = {
    conveyor: refs.deviceConveyor,
    glue: refs.deviceGlue,
    press: refs.devicePress,
    stacker: refs.deviceStacker
  };
  const view = machine.deviceViewState;
  const labels = { on: "运行", hold: "保持", idle: "待机", off: "停止" };
  Object.entries(devices).forEach(([key, node]) => {
    const parent = node.closest(".device");
    parent.classList.remove("on", "hold", "idle", "off");
    parent.classList.add(view);
    node.textContent = labels[view];
  });
}

function updateLogs() {
  const signature = `${state.logFilter}:${machine.logs.length}:${machine.logs[machine.logs.length - 1]?.id || 0}`;
  if (signature === state.lastLogSignature) return;
  state.lastLogSignature = signature;
  const alertTones = new Set(["warn", "stop", "bad"]);
  let logs = machine.logs;
  if (state.logFilter === "alert") {
    logs = logs.filter((entry) => alertTones.has(entry.tone) || ["quality", "stop", "recovery"].includes(entry.category));
  }
  const visible = logs.slice(-90).reverse();
  refs.logCount.textContent = `${logs.length} 条`;
  if (!visible.length) {
    refs.logList.innerHTML = `<div class="log-empty">该筛选下暂无记录</div>`;
    return;
  }
  refs.logList.innerHTML = visible
    .map(
      (entry) => `<div class="log-row" data-tone="${escapeHtml(entry.tone)}">
        <span class="log-time">T+${Number(entry.t).toFixed(1)}</span>
        <span class="log-type">${escapeHtml(CATEGORY_LABELS[entry.category] || entry.category)}</span>
        <span class="log-event">${escapeHtml(entry.event)}</span>
        <span class="log-detail" title="${escapeHtml(entry.detail)}">${escapeHtml(entry.detail)}</span>
      </div>`
    )
    .join("");
}

function updateButtons() {
  refs.startButton.disabled = machine.mode !== "idle";
  refs.pauseButton.disabled = !["running", "paused"].includes(machine.mode);
  refs.pauseButton.innerHTML =
    machine.mode === "paused"
      ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7V5Z"/></svg>继续`
      : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z"/></svg>暂停`;
  refs.stepButton.disabled = !["paused", "stopped"].includes(machine.mode);
  refs.stopButton.disabled = !["running", "paused"].includes(machine.mode);
  refs.startOverlay.classList.toggle("hidden", machine.mode !== "idle");
  refs.faultBanner.hidden = machine.mode !== "stopped";
  if (machine.mode === "stopped") {
    refs.faultReason.textContent = `${machine.stopReason || "设备停机"} · ${machine.stopLocation || "主控台"}`;
  }
}

function updateExport() {
  const reasons = machine.stops.length ? machine.stops.map((stop) => stop.reason).join(" / ") : "—";
  refs.exportSummary.textContent = `良品 ${machine.goodCount} / 峰值 ${machine.peakPowerKw.toFixed(1)} kW / 停机 ${reasons}`;
  refs.exportButton.disabled = machine.attempts === 0;
}

function renderValidation() {
  const buttons = document.querySelectorAll("[data-validation]");
  buttons.forEach((button) => {
    const id = button.dataset.validation;
    const result = state.validationResults?.results?.[id];
    button.classList.toggle("running", state.validationRunning && state.validationCurrent === id);
    button.classList.toggle("done", Boolean(result));
    const badge = button.querySelector("b");
    if (result) badge.textContent = result.passed ? `${result.yieldRate}% 通过` : "未通过";
    else if (state.validationRunning && state.validationCurrent === id) badge.textContent = "运行中…";
    else {
      const defaults = { normal: "12 / 12", extreme: "质量 + 恢复", fault: "停机 + 恢复" };
      badge.textContent = defaults[id];
    }
  });

  if (!state.validationResults) {
    refs.validationState.className = state.validationRunning ? "validation-state running" : "validation-state";
    refs.validationState.textContent = state.validationRunning ? "验证运行中" : "未运行";
    refs.validationResults.innerHTML = `<div class="validation-empty">尚未验证。运行后输出良品率、触发时刻与异常位置。</div>`;
    return;
  }

  const { results, passed, total } = state.validationResults;
  const allPassed = passed === total;
  refs.validationState.className = `validation-state ${allPassed ? "pass" : passed ? "running" : "fail"}`;
  refs.validationState.textContent = state.validationRunning
    ? `运行中 ${passed}/${total}`
    : `${passed}/${total} ${allPassed ? "通过" : "需检查"}`;

  const order = ["normal", "extreme", "fault"];
  refs.validationResults.innerHTML = order
    .map((id) => {
      const result = results?.[id];
      if (!result) return "";
      const values = valuesText(result.valuesAtTrigger);
      const location = result.anomalyLocation || "无";
      const recovery = result.recovery
        ? `${result.recovery.result}${result.recovery.at !== null && result.recovery.at !== undefined ? ` @ T+${Number(result.recovery.at).toFixed(2)}s` : ""}`
        : "—";
      return `<div class="validation-result">
        <div class="validation-result-head"><b>${escapeHtml(result.name)}</b><span class="${result.passed ? "" : "fail"}">${result.passed ? "PASS" : "CHECK"} · ${result.yieldRate}%</span></div>
        <p>触发 <em>T+${Number(result.triggeredAt || 0).toFixed(2)}s</em> · ${escapeHtml(values)}<br>
        异常 <em>${escapeHtml(location)}</em> · 恢复：${escapeHtml(recovery)}<br>
        ${escapeHtml(result.detail)}</p>
      </div>`;
    })
    .join("");
}

function updateUI(force = false) {
  updateMetrics();
  updateRecipe();
  updateDevices();
  updateLogs();
  updateButtons();
  updateExport();
  renderValidation();
  if (force) state.lastUi = performance.now();
}

function mergeValidationResult(id, result) {
  const previous = state.validationResults?.results || {};
  const results = { ...previous, [id]: result };
  const passed = Object.values(results).filter((item) => item.passed).length;
  state.validationResults = {
    runAt: new Date().toISOString(),
    passed,
    total: 3,
    results
  };
}

const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

async function runOneValidation(id) {
  if (state.validationRunning || !VALIDATION_RUNNERS[id]) return null;
  const token = ++state.validationToken;
  state.validationRunning = true;
  state.validationCurrent = id;
  renderValidation();
  await wait(160);
  try {
    const result = VALIDATION_RUNNERS[id]();
    if (token !== state.validationToken) return null;
    mergeValidationResult(id, result);
    machine.log(
      "validation",
      "validation",
      `验证 · ${result.name}`,
      `${result.passed ? "通过" : "失败"} · 良率 ${result.yieldRate}% · 异常 ${result.anomalyLocation}`,
      { tone: result.passed ? "validate" : "bad", data: result }
    );
    toast(`验证：${result.name}`, result.passed ? `通过 · 良率 ${result.yieldRate}%` : "未通过，请检查记录", result.passed ? "good" : "bad");
    return result;
  } catch (error) {
    if (token === state.validationToken) toast("验证失败", error.message, "bad");
    return null;
  } finally {
    if (token === state.validationToken) {
      state.validationRunning = false;
      state.validationCurrent = null;
      updateUI();
    }
  }
}

async function runAllValidations() {
  if (state.validationRunning) return state.validationResults;
  const token = ++state.validationToken;
  state.validationRunning = true;
  state.validationResults = { runAt: new Date().toISOString(), passed: 0, total: 3, results: {} };
  const order = ["normal", "extreme", "fault"];
  for (const id of order) {
    if (token !== state.validationToken) return null;
    state.validationCurrent = id;
    renderValidation();
    await wait(210);
    const result = VALIDATION_RUNNERS[id]();
    if (token !== state.validationToken) return null;
    mergeValidationResult(id, result);
    renderValidation();
    await wait(150);
  }
  const passed = state.validationResults.passed;
  machine.log(
    "validation",
    "validation",
    "三流程验证完成",
    `正常 / 参数越限 / 设备停机 · ${passed}/3 通过 · 结果已写入导出报告`,
    { tone: passed === 3 ? "validate" : "bad", data: state.validationResults }
  );
  state.validationRunning = false;
  state.validationCurrent = null;
  updateUI();
  toast("三流程验证完成", `${passed}/3 通过 · 结果可导出`, passed === 3 ? "good" : "bad");
  return state.validationResults;
}

function downloadReport() {
  const report = machine.buildReport(state.validationResults);
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\..+/, "");
  link.href = url;
  link.download = `foldline-${machine.batchId}-${stamp}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("报告已导出", `良品 ${machine.goodCount} · 峰值 ${machine.peakPowerKw.toFixed(1)} kW · 停机 ${machine.stops.length} 次`, "good");
}

function commitParam(name, previous) {
  const current = machine.params[name];
  if (Number(previous) === Number(current)) return;
  machine.setParam(name, previous, { log: false });
  machine.setParam(name, current, { log: true });
}

function bindControls() {
  params.forEach((name) => {
    const control = controlRefs[name];
    const remember = () => {
      if (state.dragStart[name] === undefined) state.dragStart[name] = machine.params[name];
    };
    control.range.addEventListener("pointerdown", remember);
    control.range.addEventListener("focus", remember);
    control.range.addEventListener("input", (event) => {
      machine.setParam(name, event.target.value, { log: false });
      updateUI();
    });
    control.range.addEventListener("change", () => {
      const previous = state.dragStart[name] ?? machine.params[name];
      commitParam(name, previous);
      delete state.dragStart[name];
      updateUI();
    });
    control.input.addEventListener("focus", remember);
    control.input.addEventListener("input", (event) => {
      if (event.target.value === "") return;
      machine.setParam(name, event.target.value, { log: false });
      updateUI();
    });
    control.input.addEventListener("change", () => {
      const previous = state.dragStart[name] ?? machine.params[name];
      commitParam(name, previous);
      delete state.dragStart[name];
      machine.setParam(name, control.input.value, { log: false });
      updateUI();
    });
  });

  refs.overlayStart.addEventListener("click", () => {
    if (machine.startBatch()) {
      toast("批次启动", "S 小盒 · 4 件合格后自动换型", "good");
      audio.setMachine(machine.mode, machine.params.speed);
    }
    updateUI(true);
  });
  refs.startButton.addEventListener("click", () => {
    if (machine.startBatch()) toast("批次启动", "统一时钟开始采样", "good");
    updateUI(true);
  });
  refs.pauseButton.addEventListener("click", () => {
    if (machine.mode === "running") {
      machine.pauseBatch("操作员暂停检查");
      toast("批次已暂停", "时钟冻结，可单步检查后继续", "");
    } else if (machine.mode === "paused") {
      machine.resumeBatch("操作员继续");
      if (machine.changeoverPending) toast("提示", "当前盒型参数可能尚未校准", "");
    }
    updateUI(true);
  });
  refs.stepButton.addEventListener("click", () => {
    if (machine.mode === "running") machine.pauseBatch("进入单步模式");
    if (machine.step(0.25)) toast("单步 +0.25s", `${PHASE_LABELS[machine.phase]} · 时钟 ${machine.simTime.toFixed(2)}s`, "");
    updateUI(true);
  });
  refs.stopButton.addEventListener("click", () => {
    const snapshot = machine.stopEquipment("操作员急停", `${PHASE_LABELS[machine.phase]}工位`);
    if (snapshot) {
      audio.fault();
      toast("设备已停机", `${snapshot.phase}相 · 缓存保持 ${snapshot.buffer}/6`, "bad");
    }
    updateUI(true);
  });
  refs.restartButton.addEventListener("click", () => {
    const recovery = machine.restartEquipment();
    if (recovery) toast("设备已复位", `停机 ${recovery.stoppedFor}s · 从${PHASE_LABELS[recovery.phase]}继续`, "good");
    updateUI(true);
  });
  refs.resetButton.addEventListener("click", () => {
    state.validationToken += 1;
    state.validationRunning = false;
    state.validationCurrent = null;
    state.validationResults = null;
    state.logFilter = "all";
    state.lastLogSignature = "";
    state.lastDefectId = null;
    state.lastMode = "idle";
    refs.clearFilter.textContent = "全部记录";
    machine.resetBatch({ keepParams: true });
    audio.setMachine(machine.mode, machine.params.speed);
    toast("批次已重置", "旧批次缓存、事件和验证结果已清空");
    updateUI(true);
  });
  refs.applyRecipe.addEventListener("click", () => {
    const values = machine.applyRecommended(machine.currentSize);
    toast("已套用推荐值", `${machine.currentSize} · ${values.glue}g / ${values.press}s / ${values.speed}m/min`, "good");
    updateUI(true);
  });
  refs.clearFilter.addEventListener("click", () => {
    state.logFilter = state.logFilter === "all" ? "alert" : "all";
    refs.clearFilter.textContent = state.logFilter === "all" ? "全部记录" : "仅异常";
    state.lastLogSignature = "";
    updateUI();
  });
  refs.soundButton.addEventListener("click", async () => {
    const enabled = await audio.toggle();
    state.sound = enabled;
    refs.soundButton.setAttribute("aria-pressed", String(enabled));
    refs.soundButton.querySelector("span").textContent = enabled ? "声音开" : "声音";
    if (enabled) {
      audio.setMachine(machine.mode, machine.params.speed);
      toast("机械节拍已开启", "送料、上胶、压合使用不同节拍音", "good");
    }
  });
  refs.exportButton.addEventListener("click", downloadReport);
  refs.runValidations.addEventListener("click", runAllValidations);
  document.querySelectorAll("[data-validation]").forEach((button) => {
    button.addEventListener("click", () => runOneValidation(button.dataset.validation));
  });

  window.addEventListener("keydown", (event) => {
    if (event.target.matches("input, textarea, select, button")) return;
    if (event.code === "Space") {
      event.preventDefault();
      if (machine.mode === "running") machine.pauseBatch("快捷键暂停");
      else if (machine.mode === "paused") machine.resumeBatch("快捷键继续");
      updateUI(true);
    }
    if (event.code === "ArrowRight") {
      event.preventDefault();
      if (machine.mode === "running") machine.pauseBatch("快捷键单步");
      machine.step(0.25);
      updateUI(true);
    }
    if (event.key.toLowerCase() === "r") {
      refs.resetButton.click();
    }
    if (event.key === "Enter" && machine.mode === "idle") {
      refs.overlayStart.click();
    }
  });
}

function detectTransitions() {
  if (machine.phaseSerial !== state.lastPhaseSerial) {
    audio.beat(machine.phase, machine.params.speed, machine.lastQuality?.ok === false ? "bad" : "ok");
    state.lastPhaseSerial = machine.phaseSerial;
  }
  if (machine.lastDefect) {
    const id = `${machine.lastDefect.boxId}:${machine.lastDefect.time}`;
    if (id !== state.lastDefectId) {
      state.lastDefectId = id;
      toast(`质量异常 · ${machine.lastDefect.label}`, `${machine.lastDefect.effect} @ ${machine.lastDefect.location}`, "bad");
    }
  }
  if (machine.currentSize !== state.lastSize) {
    state.lastSize = machine.currentSize;
    toast(`换型 ${machine.currentSize}`, `推荐 ${RECIPES[machine.currentSize].glue.ideal}g / ${RECIPES[machine.currentSize].press.ideal}s / ${RECIPES[machine.currentSize].speed.ideal}m/min`, "");
  }
  if (machine.mode !== state.lastMode) {
    if (machine.mode === "complete") {
      audio.success();
      toast("批次通过", "12 / 12 合格 · 可导出完整报告", "good");
    }
    if (machine.mode === "failed") toast("批次未通过", "查看异常位置后重置批次", "bad");
    if (machine.mode === "stopped") audio.fault();
    state.lastMode = machine.mode;
  }
  audio.setMachine(machine.mode, machine.params.speed);
}

function frame(now) {
  const delta = Math.min(0.1, Math.max(0, (now - state.lastFrame) / 1000));
  state.lastFrame = now;
  machine.update(delta);
  detectTransitions();
  renderer.draw(machine, now);
  telemetry.draw(machine);
  if (now - state.lastUi > 90) {
    updateUI();
    state.lastUi = now;
  }
  requestAnimationFrame(frame);
}

bindControls();
updateUI(true);
requestAnimationFrame(frame);

window.addEventListener("pageshow", (event) => {
  if (event.persisted) window.location.reload();
});

window.__foldline = {
  machine,
  state,
  runAllValidations,
  runOneValidation,
  downloadReport,
  updateUI
};
