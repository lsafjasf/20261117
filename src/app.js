import { PlantAudio } from "./audio.js";
import { FIXED_STEP, PHASE_LABELS, RECIPES } from "./config.js";
import { PlantRenderer } from "./renderer.js";
import { runAllScenarios } from "./scenarios.js";
import { FlourSimulation } from "./simulation.js";

let sim = new FlourSimulation();
const renderer = new PlantRenderer(document.getElementById("plantCanvas"));
const audio = new PlantAudio();

const $ = (id) => document.getElementById(id);
const refs = {
  clock: $("clockValue"),
  runState: $("runState"),
  phase: $("phaseValue"),
  successLamp: $("successLamp"),
  successText: $("successText"),
  soundButton: $("soundButton"),
  batchChip: $("batchChip"),
  purgeBadge: $("purgeBadge"),
  recipeHint: $("recipeHint"),
  speedInputs: [$("speedA"), $("speedB"), $("speedC")],
  speedOutputs: [$("speedAValue"), $("speedBValue"), $("speedCValue")],
  mixTime: $("mixTime"),
  mixTimeValue: $("mixTimeValue"),
  startDosing: $("startDosing"),
  openGate: $("openGate"),
  startMixing: $("startMixing"),
  dischargeBatch: $("dischargeBatch"),
  clearLine: $("clearLine"),
  resumeProduction: $("resumeProduction"),
  pauseButton: $("pauseButton"),
  stepButton: $("stepButton"),
  resetBatch: $("resetBatch"),
  hardReset: $("hardReset"),
  faultScrew: $("faultScrew"),
  faultMixer: $("faultMixer"),
  repairScrew: $("repairScrew"),
  repairMixer: $("repairMixer"),
  powerValue: $("powerValue"),
  peakValue: $("peakValue"),
  energyValue: $("energyValue"),
  cacheValue: $("cacheValue"),
  cacheBatches: $("cacheBatches"),
  yieldValue: $("yieldValue"),
  batchCounts: $("batchCounts"),
  weighReadout: $("weighReadout"),
  weighState: $("weighState"),
  ratioBars: $("ratioBars"),
  eventLog: $("eventLog"),
  eventCount: $("eventCount"),
  batchList: $("batchList"),
  runValidation: $("runValidation"),
  validationGrid: $("validationGrid"),
  exportReport: $("exportReport"),
  exportEvents: $("exportEvents"),
  exportBatches: $("exportBatches"),
  exportStatus: $("exportStatus"),
  toast: $("toast")
};

let renderedEventCount = 0;
let renderedBatchCount = -1;
let latestValidation = null;
let lastFrame = performance.now();
let accumulator = 0;
let toastTimer = 0;

const ratioBarElements = ["高筋", "中筋", "低筋"].map((name) => {
  const row = document.createElement("div");
  row.className = "ratio-bar";
  const title = document.createElement("span");
  title.textContent = name;
  const track = document.createElement("div");
  track.className = "track";
  const fill = document.createElement("i");
  fill.className = "fill";
  track.append(fill);
  const value = document.createElement("b");
  value.textContent = "—";
  row.append(title, track, value);
  refs.ratioBars.append(row);
  return { fill, value };
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toast(message, isError = false) {
  window.clearTimeout(toastTimer);
  refs.toast.textContent = message;
  refs.toast.className = `toast show${isError ? " error" : ""}`;
  toastTimer = window.setTimeout(() => {
    refs.toast.className = "toast";
  }, 3600);
}

function action(method, successMessage, ...args) {
  try {
    const result = sim[method](...args);
    if (result === false) {
      toast("操作被联锁拒绝，详情见事件日志", true);
    } else if (successMessage) {
      toast(successMessage);
    }
    syncUi(true);
  } catch (error) {
    toast(error.message, true);
  }
}

function syncRecipe() {
  document.querySelectorAll("[data-recipe]").forEach((button) => {
    button.classList.toggle("active", button.dataset.recipe === sim.recipeId);
  });
  const recipe = RECIPES[sim.recipeId];
  refs.recipeHint.textContent =
    `目标比例 ${recipe.ratios.map((value) => `${(value * 100).toFixed(1).replace(".0", "")}%`).join(" / ")}；换配料后必须清空余料。`;
  refs.purgeBadge.textContent = sim.purgeInProgress
    ? "清线动作中"
    : (sim.purgeRequired ? "待清空余料" : "管路已清空");
  refs.purgeBadge.className = `mini-badge ${sim.purgeRequired || sim.purgeInProgress ? "warn" : "ok"}`;
}

function syncControls() {
  refs.speedInputs.forEach((input, index) => {
    input.value = String(Math.round(sim.settings.speeds[index]));
    refs.speedOutputs[index].textContent = `${Math.round(sim.settings.speeds[index])}%`;
  });
  refs.mixTime.value = String(Math.round(sim.settings.mixTime));
  refs.mixTimeValue.textContent = `${Math.round(sim.settings.mixTime)} s`;
  syncRecipe();

  const stopped = sim.phase === "stopped";
  refs.startDosing.disabled = !sim.canStart || stopped;
  refs.openGate.disabled = !["settling", "weighing"].includes(sim.phase) || !sim.weigh.stable;
  refs.startMixing.disabled = sim.phase !== "mix_ready";
  refs.dischargeBatch.disabled = sim.phase !== "mix_done";
  refs.clearLine.disabled = sim.activeBatch || stopped || sim.purgeInProgress;
  refs.resumeProduction.disabled = !stopped || Boolean(sim.mixer.fault) ||
    sim.screws.some((screw) => screw.fault);
  refs.pauseButton.textContent = sim.paused ? "继续运行" : "暂停检查";
  refs.faultScrew.disabled = Boolean(sim.screws[1].fault) || sim.phase === "stopped";
  refs.faultMixer.disabled = Boolean(sim.mixer.fault) || sim.phase === "stopped";
  refs.repairScrew.disabled = !sim.screws[1].fault;
  refs.repairMixer.disabled = !sim.mixer.fault;
}

function syncStatus() {
  refs.clock.textContent = `${sim.clock.toFixed(1).padStart(5, "0")} s`;
  refs.runState.textContent = sim.paused ? "已暂停" : (sim.phase === "stopped" ? "已停机" : "运行");
  refs.runState.style.color = sim.paused ? "#e8bb63" : (sim.phase === "stopped" ? "#f06d6d" : "#57d5d1");
  refs.phase.textContent = PHASE_LABELS[sim.phase] || sim.phase;
  refs.batchChip.textContent = `批次 #${sim.batchNo}`;
  refs.successText.textContent = `良品 ${sim.goodBatches} / 3`;
  refs.successLamp.classList.toggle("ready", sim.success);
}

function syncMetrics() {
  refs.powerValue.textContent = `${sim.power.currentKw.toFixed(2)} kW`;
  refs.peakValue.textContent = `峰值 ${sim.power.peakKw.toFixed(2)} kW`;
  refs.energyValue.textContent = `${sim.power.energyKwh.toFixed(4)} kWh`;
  refs.cacheValue.textContent = `${sim.cache.kg.toFixed(1)} kg`;
  refs.cacheBatches.textContent = `${sim.cache.batches} 批`;
  refs.yieldValue.textContent = sim.totalBatches
    ? `${((sim.goodBatches / sim.totalBatches) * 100).toFixed(1)}%`
    : "—";
  refs.batchCounts.textContent = `${sim.goodBatches} / ${sim.totalBatches} 批`;
  refs.weighReadout.textContent = `${sim.weigh.measuredKg.toFixed(3)} kg`;
  refs.weighState.textContent = sim.weigh.stable
    ? (sim.weigh.gateOpen ? "秤门打开 · 卸料中" : "秤台稳定")
    : `称重振荡 ±${sim.weigh.oscillationKg.toFixed(2)} kg`;
  refs.weighState.classList.toggle("warn", !sim.weigh.stable);

  const source = sim.mixer.totalKg > 0.01 && ["mixing", "mix_done", "packaging"].includes(sim.phase)
    ? sim.mixer.charge
    : sim.weigh.mass;
  const total = source.reduce((sum, kg) => sum + kg, 0);
  const targets = sim.recipe.ratios;
  source.forEach((kg, index) => {
    const share = total > 0 ? kg / total : 0;
    ratioBarElements[index].fill.style.width = `${Math.min(100, share * 100)}%`;
    ratioBarElements[index].fill.style.background = ["#e8c879", "#d6a95f", "#bf8651"][index];
    ratioBarElements[index].value.textContent = total > 0
      ? `${(share * 100).toFixed(1)} / ${(targets[index] * 100).toFixed(1)}%`
      : `目标 ${(targets[index] * 100).toFixed(1)}%`;
  });
}

function formatValue(value) {
  if (Array.isArray(value)) return value.map(formatValue).join(" / ");
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value ?? "");
}

function formatEventValues(values) {
  const labelMap = {
    from: "原值",
    to: "新值",
    requested: "请求",
    current: "当前",
    allowed: "允许",
    setpoint: "设定",
    actual: "实际",
    deliveredKg: "已送",
    batchKg: "批次",
    mixElapsed: "已混合",
    mixSet: "混合设定",
    chargeKg: "装载",
    trueKg: "真值",
    measuredKg: "读数",
    oscillationKg: "振幅",
    thresholdKg: "阈值",
    cacheKg: "缓存",
    peakPowerKw: "峰值",
    goodBatches: "良品数",
    totalBatches: "总批次",
    goodRate: "良品率",
    batchNo: "批次",
    clock: "时刻",
    phase: "阶段"
  };
  return Object.entries(values || {})
    .filter(([, value]) => value !== undefined && value !== null)
    .slice(0, 8)
    .map(([key, value]) => `${labelMap[key] || key}=${formatValue(value)}`)
    .join(" · ");
}

function syncEventLog() {
  if (sim.events.length === renderedEventCount) return;
  const nearBottom = refs.eventLog.scrollHeight - refs.eventLog.scrollTop - refs.eventLog.clientHeight < 55;
  const fragment = document.createDocumentFragment();
  for (let index = renderedEventCount; index < sim.events.length; index += 1) {
    const event = sim.events[index];
    const row = document.createElement("div");
    row.className = `event-row ${event.type}`;
    const time = document.createElement("time");
    time.textContent = `${event.t.toFixed(1)}s`;
    const device = document.createElement("span");
    device.className = "device";
    device.textContent = event.device || "—";
    const detail = document.createElement("span");
    detail.className = "detail";
    const values = formatEventValues(event.values);
    detail.textContent = values ? `${event.detail} · ${values}` : event.detail;
    row.append(time, device, detail);
    fragment.append(row);
  }
  refs.eventLog.append(fragment);
  renderedEventCount = sim.events.length;
  refs.eventCount.textContent = `${sim.events.length} 条`;
  if (nearBottom) refs.eventLog.scrollTop = refs.eventLog.scrollHeight;
}

function syncBatchList() {
  if (sim.batches.length === renderedBatchCount) return;
  renderedBatchCount = sim.batches.length;
  if (!sim.batches.length) {
    refs.batchList.innerHTML = '<div class="batch-empty">尚无完成批次；每批结果由实际称重与配比计算。</div>';
    return;
  }
  refs.batchList.innerHTML = sim.batches.slice().reverse().map((batch) => {
    const checks = batch.checks
      .map((check) => `${check.id} ${(check.actual * 100).toFixed(1)}%/${(check.target * 100).toFixed(1)}%`)
      .join(" · ");
    const reasons = batch.reasons.length
      ? `<div class="batch-meta">异常：${escapeHtml(batch.reasons.join("；"))}</div>`
      : "";
    return `
      <article class="batch-item ${batch.result}">
        <div class="batch-head">
          <span>#${batch.no} · ${escapeHtml(batch.recipeId)} · ${batch.totalKg.toFixed(2)}kg</span>
          <b>${batch.result === "good" ? "合格" : "报废"}</b>
        </div>
        <div class="batch-meta">${escapeHtml(checks)}</div>
        <div class="batch-meta">${batch.startedAt?.toFixed(1) ?? "?"}s → ${batch.finishedAt.toFixed(1)}s</div>
        ${reasons}
      </article>
    `;
  }).join("");
}

function syncUi(forceControls = false) {
  syncStatus();
  syncControls();
  syncMetrics();
  syncEventLog();
  syncBatchList();
  void forceControls;
}

function renderValidation(result) {
  refs.validationGrid.innerHTML = result.scenarios.map((scenario) => {
    const checks = scenario.checks.map((check) =>
      `<li class="${check.passed ? "" : "bad"}">${escapeHtml(check.name)}</li>`
    ).join("");
    const triggers = scenario.triggers.length
      ? scenario.triggers.map((trigger) => {
        const values = formatEventValues(trigger.values);
        const recovery = trigger.recoveredAt === null
          ? "未恢复 / 已隔离"
          : `恢复于 ${trigger.recoveredAt.toFixed(1)}s：${trigger.recovery}`;
        return `<li><b>t=${trigger.at.toFixed(1)}s</b> ${escapeHtml(trigger.location)} · ${escapeHtml(values || trigger.detail)}<br>${escapeHtml(recovery)}</li>`;
      }).join("")
      : "<li>无异常触发</li>";
    const stopReasons = scenario.stops.length
      ? scenario.stops.map((stop) => `${stop.device}：${stop.reason}`).join("；")
      : "无停机";
    return `
      <article class="validation-card ${scenario.passed ? "pass" : "fail"}">
        <div class="validation-head">
          <b>${escapeHtml(scenario.scenario)}</b>
          <span>${scenario.passed ? "通过" : "未通过"}</span>
        </div>
        <div class="validation-kpis">
          <div>良品<strong>${scenario.goodBatches}/${scenario.totalBatches}</strong></div>
          <div>良品率<strong>${(scenario.goodRate * 100).toFixed(1)}%</strong></div>
          <div>峰值<strong>${scenario.peakPowerKw.toFixed(2)}kW</strong></div>
        </div>
        <ul class="validation-checks">${checks}</ul>
        <ul class="trigger-list">
          <li><b>停机原因</b>：${escapeHtml(stopReasons)}</li>
          <li><b>异常位置</b>：${escapeHtml(scenario.exceptionLocations.join("、") || "无")}</li>
          ${triggers}
        </ul>
      </article>
    `;
  }).join("");
}

async function runValidation() {
  refs.runValidation.disabled = true;
  refs.runValidation.textContent = "验收运行中…";
  await new Promise((resolve) => window.setTimeout(resolve, 30));
  try {
    latestValidation = runAllScenarios();
    renderValidation(latestValidation);
    refs.exportStatus.textContent = latestValidation.passed
      ? "三类验收全部通过；报告导出将附带触发与恢复记录。"
      : "验收存在失败项，请查看异常记录。";
    toast(latestValidation.passed ? "正常、越限、停机三类验收全部通过" : "验收存在失败项", !latestValidation.passed);
  } catch (error) {
    refs.validationGrid.innerHTML = `<article class="validation-card fail"><b>验收执行失败</b><span>${escapeHtml(error.message)}</span></article>`;
    toast(`验收执行失败：${error.message}`, true);
  } finally {
    refs.runValidation.disabled = false;
    refs.runValidation.textContent = "运行三类验收";
  }
}

function downloadText(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportLiveReport() {
  const report = sim.exportReport();
  report.validation = latestValidation;
  const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\..+/, "");
  downloadText(`flour-report-${stamp}.json`, JSON.stringify(report, null, 2), "application/json");
  refs.exportStatus.textContent =
    `已导出：良品 ${report.goodBatches}，良品率 ${(report.goodRate * 100).toFixed(1)}%，峰值 ${report.peakPowerKw.toFixed(2)} kW，停机 ${report.stops.length} 次。`;
}

function resetSimulation(showToast = true) {
  sim = new FlourSimulation();
  renderedEventCount = 0;
  renderedBatchCount = -1;
  accumulator = 0;
  refs.eventLog.replaceChildren();
  syncControls();
  syncUi(true);
  if (showToast) toast("仿真已重开，包装仓缓存、批次和能耗全部清零");
}

refs.speedInputs.forEach((input, index) => {
  input.addEventListener("input", () => {
    if (!sim.setScrewSpeed(index, input.value)) {
      toast("螺旋转速设定越限，已拒绝", true);
    }
    syncControls();
    syncStatus();
  });
});

refs.mixTime.addEventListener("input", () => {
  if (!sim.setMixTime(refs.mixTime.value)) toast("混合时间越限，已拒绝", true);
  syncControls();
  syncStatus();
});

document.querySelectorAll("[data-recipe]").forEach((button) => {
  button.addEventListener("click", () => {
    const changed = sim.selectRecipe(button.dataset.recipe);
    if (!changed) {
      toast("当前批次或清线状态不允许切换配方", true);
    } else if (sim.purgeRequired) {
      toast("已切换订单；请先清空余料再开始配料");
    }
    syncControls();
    syncStatus();
  });
});

refs.startDosing.addEventListener("click", () => action("startDosing", "批次配料已启动"));
refs.openGate.addEventListener("click", () => action("openWeighGate", "称重门已打开"));
refs.startMixing.addEventListener("click", () => action("startMixing", "混合机已启动"));
refs.dischargeBatch.addEventListener("click", () => action("dischargeBatch", "批次开始进入包装仓"));
refs.clearLine.addEventListener("click", () => action("clearLine", "清线程序已启动"));
refs.resumeProduction.addEventListener("click", () => action("resumeProduction", "当前批次已恢复"));

refs.pauseButton.addEventListener("click", () => {
  if (sim.paused) {
    sim.resume();
    toast("已继续当前批次");
  } else {
    sim.pause();
    toast("已暂停；称重、能耗和粉流均已冻结");
  }
  syncControls();
  syncStatus();
});

refs.stepButton.addEventListener("click", () => {
  sim.step(FIXED_STEP);
  syncControls();
  syncStatus();
});

refs.resetBatch.addEventListener("click", () => {
  const reset = sim.resetBatch();
  toast(reset ? "当前批次已重置，历史记录与已入仓批次保留" : "当前状态不能重置批次", !reset);
  syncControls();
  syncUi(true);
});

refs.hardReset.addEventListener("click", () => resetSimulation(true));
refs.faultScrew.addEventListener("click", () => action("injectFault", "中筋螺旋卡料停机已触发", "screwB", "卡料"));
refs.faultMixer.addEventListener("click", () => action("injectFault", "混合机过载停机已触发", "mixer", "过载"));
refs.repairScrew.addEventListener("click", () => action("repairDevice", "中筋螺旋故障已修复；可恢复当前批次", "screwB"));
refs.repairMixer.addEventListener("click", () => action("repairDevice", "混合机故障已修复；可恢复当前批次", "mixer"));

refs.soundButton.addEventListener("click", async () => {
  try {
    const enabled = await audio.toggle();
    refs.soundButton.textContent = enabled ? "声音：开" : "声音：关";
    refs.soundButton.setAttribute("aria-pressed", String(enabled));
  } catch (error) {
    toast(error.message, true);
  }
});

refs.runValidation.addEventListener("click", runValidation);
refs.exportReport.addEventListener("click", exportLiveReport);
refs.exportEvents.addEventListener("click", () => {
  downloadText("flour-events.csv", sim.exportEventsCsv(), "text/csv;charset=utf-8");
  refs.exportStatus.textContent = `已导出 ${sim.events.length} 条设备、参数与批次事件。`;
});
refs.exportBatches.addEventListener("click", () => {
  downloadText("flour-batches.csv", sim.exportBatchesCsv(), "text/csv;charset=utf-8");
  refs.exportStatus.textContent = `已导出 ${sim.batches.length} 条批次结果。`;
});

window.addEventListener("resize", () => renderer.resize());
window.addEventListener("pageshow", (event) => {
  if (event.persisted) resetSimulation(false);
});

function frame(now) {
  const delta = Math.min(0.35, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  if (!sim.paused) {
    accumulator += delta;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 6) {
      sim.advance(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
  } else {
    accumulator = 0;
  }
  renderer.draw(sim);
  audio.update(sim);
  syncUi();
  requestAnimationFrame(frame);
}

syncControls();
syncUi(true);
renderer.draw(sim);
requestAnimationFrame(frame);
