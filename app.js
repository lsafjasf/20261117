import {
  DATASETS,
  DEVICES,
  FLOORS,
  METERS,
  WINDOWS,
  getRawDataset,
  getWindow,
} from "./energy-data.js";
import {
  buildCsv,
  buildExportManifest,
  buildSnapshot,
  cleanDataset,
  filterSummary,
} from "./energy-core.js";
import {
  drawCurve,
  drawExportReport,
  drawMap,
  drawSankey,
  formatPercent,
  formatPower,
} from "./renderers.js";

const $ = (id) => document.getElementById(id);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const cleanedCache = new Map();

function defaultLoadFactors() {
  return Object.fromEntries(DEVICES.map((device) => [device.id, 1]));
}

function createWindowState() {
  return {
    dataset: "normal",
    search: "",
    floor: "all",
    source: "all",
    rangeMode: "window",
    loadFactors: defaultLoadFactors(),
    selectedNode: "bus",
  };
}

const state = {
  activeWindow: "morning",
  windows: Object.fromEntries(WINDOWS.map((window) => [window.id, createWindowState()])),
  exports: [],
};

let snapshot = null;
let sankeyLayout = null;
let curveLayout = null;
let mapLayout = null;
let curveHoverSlot = null;
let toastTimer = null;
let renderQueued = false;
let animationTime = performance.now();

function cleanFor(datasetId) {
  if (!cleanedCache.has(datasetId)) {
    cleanedCache.set(datasetId, cleanDataset(getRawDataset(datasetId)));
  }
  return cleanedCache.get(datasetId);
}

function currentWindowState() {
  return state.windows[state.activeWindow];
}

function currentSnapshot() {
  const controls = currentWindowState();
  const clean = cleanFor(controls.dataset);
  return buildSnapshot(clean, {
    windowId: state.activeWindow,
    filter: {
      floor: controls.floor,
      source: controls.source,
      search: controls.search,
    },
    loadFactors: { ...controls.loadFactors },
    rangeMode: controls.rangeMode,
    selectedNode: controls.selectedNode,
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message, type = "ok") {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.toggle("error", type === "error");
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function renderDatasetTabs() {
  const controls = currentWindowState();
  $("datasetTabs").innerHTML = DATASETS.map((dataset) => `
    <button type="button" role="tab" data-dataset="${dataset.id}" aria-selected="${dataset.id === controls.dataset}"
      class="${dataset.id === controls.dataset ? "active" : ""}" style="--dot:${dataset.color}"
      title="${escapeHtml(dataset.description)}">${escapeHtml(dataset.label)}</button>
  `).join("");
}

function renderWindowTabs() {
  $("windowTabs").innerHTML = WINDOWS.map((window) => `
    <button type="button" role="tab" data-window="${window.id}" aria-selected="${window.id === state.activeWindow}"
      class="${window.id === state.activeWindow ? "active" : ""}">
      <span>${window.label}</span><small>${window.range}</small>
    </button>
  `).join("");
}

function renderFilterChips() {
  const controls = currentWindowState();
  const floors = [{ id: "all", label: "全部" }, ...FLOORS.map((floor) => ({ id: floor.id, label: floor.label }))];
  $("floorFilters").innerHTML = floors.map((floor) => `
    <button type="button" class="filter-chip ${controls.floor === floor.id ? "active" : ""}"
      data-floor="${floor.id}" aria-pressed="${controls.floor === floor.id}">${floor.label}</button>
  `).join("");
  const sources = [
    { id: "all", label: "全部" },
    { id: METERS.grid.id, label: METERS.grid.label },
    { id: METERS.pv.id, label: METERS.pv.label },
  ];
  $("sourceFilters").className = "chip-grid two";
  $("sourceFilters").innerHTML = sources.map((source) => `
    <button type="button" class="filter-chip ${controls.source === source.id ? "active" : ""}"
      data-source="${source.id}" aria-pressed="${controls.source === source.id}">${source.label}</button>
  `).join("");
  $("floorNote").textContent = controls.floor === "all" ? "全部" : controls.floor;
  $("sourceNote").textContent = controls.source === "all" ? "全部" : METERS[controls.source].label;
}

function buildLoadControls() {
  $("loadControls").innerHTML = DEVICES.map((device) => `
    <div class="load-item" style="--load-color:${device.color}">
      <label for="load-${device.id}"><i></i>${escapeHtml(device.label)}</label>
      <output id="load-value-${device.id}" for="load-${device.id}">—</output>
      <input id="load-${device.id}" data-load="${device.id}" type="range" min="20" max="140" step="1" value="100"
        aria-label="${escapeHtml(device.label)}负载百分比" />
      <div class="load-meter"><span>20%</span><span id="load-meter-${device.id}">基线 — kW</span><span>140%</span></div>
    </div>
  `).join("");
  $("loadControls").addEventListener("input", (event) => {
    const input = event.target.closest("[data-load]");
    if (!input) return;
    const controls = currentWindowState();
    controls.loadFactors[input.dataset.load] = Number(input.value) / 100;
    renderAll();
  });
}

function renderCondition() {
  const controls = currentWindowState();
  const { window, aggregate, clean, filterText, scope, dataVersion, scenarioVersion } = snapshot;
  const hasData = aggregate.hasData;
  const rangeText = controls.rangeMode === "day" ? "全天 00:00–22:00" : `${window.range} · 16 区间`;
  $("conditionText").textContent = `${filterText} / ${window.label} ${window.range}`;
  $("topDatasetName").textContent = clean.label;
  $("topDataVersion").textContent = dataVersion;
  $("railDataVersion").textContent = dataVersion;
  $("flowDataVersion").textContent = dataVersion;
  $("tableDataVersion").textContent = dataVersion;
  $("curveDataVersion").textContent = dataVersion;
  $("mapDataVersion").textContent = dataVersion;
  $("scopeDataVersion").textContent = dataVersion;
  $("scenarioVersion").textContent = scenarioVersion;
  $("activeFilterText").textContent = filterText;
  $("activeWindowText").textContent = `${window.label} ${window.range}`;
  $("activeRecordCount").textContent = `${aggregate.recordCount} 条 · ${aggregate.zones.length} 区`;
  $("activeRangeText").textContent = rangeText;
  $("scopeNote").textContent = scope;
  $("filterStatusLight").textContent = hasData ? "有效" : "空结果";
  $("filterStatusLight").classList.toggle("empty", !hasData);
  $("datasetSummaryBadge").textContent = clean.short;
  $("summaryRaw").textContent = clean.stats.rawCount;
  $("summaryClean").textContent = clean.stats.cleanCount;
  $("summaryDedup").textContent = clean.stats.duplicates;
  $("summaryFilled").textContent = clean.stats.missingFilled;
  $("summaryAnomaly").textContent = clean.stats.anomaliesCorrected;
  $("summaryHit").textContent = aggregate.recordCount;
  $("scopeSampleCount").textContent = `${aggregate.recordCount} 条 / ${aggregate.intervals.length} 区间`;
  $("scopeQuality").textContent = `${aggregate.quality.filled} / ${aggregate.quality.corrected}`;
  $("scopeBalance").textContent = `${snapshot.flow.conservation.balanceError.toExponential(1)} kW`;
  $("footerVersion").textContent = `${clean.label} · ${dataVersion}`;
  $("curveRangeLabel").textContent = controls.rangeMode === "day"
    ? "全天 · 00:00–22:00"
    : `当前窗口 · ${window.range}`;
  $("mapRangeLabel").textContent = controls.floor === "all"
    ? "全部楼层"
    : `${FLOORS.find((floor) => floor.id === controls.floor)?.name || controls.floor} · 单层`;
}

function renderKpis() {
  const { flow, aggregate } = snapshot;
  const totals = flow.totals;
  const measured = aggregate.gridAvg + aggregate.pvAvg;
  const delta = measured > 0 ? totals.input / measured - 1 : 0;
  const usefulShare = totals.input > 0 ? totals.useful / totals.input : 0;
  const lossShare = totals.input > 0 ? totals.loss / totals.input : 0;
  const sourceNames = snapshot.config.filter.source === "all"
    ? `市电 ${formatPower(totals.grid)} · 光伏 ${formatPower(totals.pv)}`
    : snapshot.config.filter.source === "grid" ? "仅市电" : "仅光伏";
  $("kpiInput").textContent = formatPower(totals.input);
  $("kpiInputSource").textContent = sourceNames;
  $("kpiInputDelta").textContent = Math.abs(delta) < 0.0005 ? "基线场景" : `较基线 ${delta > 0 ? "+" : ""}${(delta * 100).toFixed(1)}%`;
  $("kpiUseful").textContent = formatPower(totals.useful);
  $("kpiUsefulNote").textContent = "设备有效输出";
  $("kpiUsefulRatio").textContent = `占输入 ${formatPercent(usefulShare)}`;
  $("kpiLoss").textContent = formatPower(totals.loss);
  $("kpiLossNote").textContent = "配电 + 设备";
  $("kpiLossRatio").textContent = `占输入 ${formatPercent(lossShare)}`;
  $("kpiEfficiency").textContent = formatPercent(totals.efficiency).replace("%", "");
  $("efficiencyBar").style.width = `${Math.max(0, Math.min(100, totals.efficiency * 100))}%`;
  $("kpiConservation").textContent = flow.conservation.ok ? "守恒通过" : "守恒异常";
  $("kpiBalance").textContent = flow.conservation.ok ? "PASS" : "CHECK";
  $("kpiConservation").style.color = flow.conservation.ok ? "" : "var(--coral)";
  $("balanceBadge").classList.toggle("fail", !flow.conservation.ok);
  $("balanceEquation").textContent = `${formatPower(totals.input)} = ${formatPower(totals.useful)} + ${formatPower(totals.loss)} kW`;
  $("distributionLossValue").textContent = `${formatPower(totals.distributionLoss)} kW`;
  $("equipmentLossValue").textContent = `${formatPower(totals.equipmentLoss)} kW`;
}

function renderLoadControls() {
  const controls = currentWindowState();
  const hasData = snapshot.flow.hasData;
  for (const device of snapshot.flow.devices) {
    const input = $(`load-${device.id}`);
    const valueOutput = $(`load-value-${device.id}`);
    const meter = $(`load-meter-${device.id}`);
    const percent = Math.round((controls.loadFactors[device.id] ?? 1) * 100);
    input.value = String(percent);
    input.disabled = !hasData;
    input.style.setProperty("--fill", `${((percent - 20) / 120) * 100}%`);
    valueOutput.textContent = hasData ? `${formatPower(device.useful)} kW` : "—";
    meter.textContent = hasData
      ? `基线 ${formatPower(device.baselineUseful)} kW · 设备输入 ${formatPower(device.input)} kW`
      : "当前筛选无数据";
  }
}

function renderInspector() {
  const { flow, config } = snapshot;
  const node = flow.nodes.find((item) => item.id === config.selectedNode) || flow.nodes.find((item) => item.id === "bus");
  if (!node) return;
  const incoming = flow.links
    .filter((link) => link.target === node.id)
    .reduce((sum, link) => sum + link.value, 0);
  const outgoing = flow.links
    .filter((link) => link.source === node.id)
    .reduce((sum, link) => sum + link.value, 0);
  const loss = node.loss ? node.value : Math.max(0, incoming - outgoing);
  const share = flow.totals.input > 0 ? node.value / flow.totals.input : 0;
  $("nodeStatus").textContent = "已选择";
  $("nodeStatus").classList.add("selected");
  $("nodeSwatch").style.background = node.color;
  $("nodeName").textContent = node.label;
  $("nodeDetail").textContent = node.detail;
  $("nodePower").textContent = formatPower(node.value);
  $("nodeInput").textContent = `${formatPower(incoming)} kW`;
  $("nodeOutput").textContent = `${formatPower(outgoing)} kW`;
  $("nodeLoss").textContent = `${formatPower(loss)} kW`;
  $("nodeShare").textContent = formatPercent(share);

  let formula = "P输出 = P输入 − P损失";
  if (node.column === 0) formula = "P输入 = 筛选范围内的能源输入";
  if (node.column === 1) formula = "P母线输入 = P市电 + P光伏";
  if (node.column === 2) formula = "P设备输入 = P有效服务 + P设备热损";
  if (node.service) formula = "P有效服务 = P设备输入 − P设备热损";
  if (node.loss) formula = "P损失 = P输入 − P有效输出";
  $("nodeFormula").textContent = formula;
}

function qualityForInterval(interval) {
  if (interval.corrected > 0) {
    return { className: "corrected", label: `异常修正 ${interval.corrected}` };
  }
  if (interval.filled > 0) {
    return { className: "filled", label: `插值补缺 ${interval.filled}` };
  }
  return { className: "", label: "完整" };
}

function renderTable() {
  const { aggregate, config } = snapshot;
  const body = $("intervalTable");
  const empty = $("tableEmpty");
  $("tableSummary").textContent = `${aggregate.intervals.length} 个区间 · ${aggregate.recordCount} 条样本`;
  if (!aggregate.hasData) {
    body.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  const showGrid = config.filter.source !== "pv";
  const showPv = config.filter.source !== "grid";
  body.innerHTML = aggregate.intervals.map((interval) => {
    const quality = qualityForInterval(interval);
    return `
      <tr>
        <td>${interval.time}</td>
        <td>${showGrid ? formatPower(interval.gridPower) : "—"}</td>
        <td>${showPv ? formatPower(interval.pvPower) : "—"}</td>
        <td>${formatPower(interval.totalPower)}</td>
        <td>${formatPower(interval.kwh, 2)}</td>
        <td><span class="quality-pill ${quality.className}">${quality.label}</span></td>
      </tr>
    `;
  }).join("");
}

function renderExports() {
  $("exportLogCount").textContent = state.exports.length;
  const log = $("exportLog");
  if (!state.exports.length) {
    log.innerHTML = '<div class="log-placeholder">尚未导出。日志会记录当时的窗口、筛选与两个版本号。</div>';
    return;
  }
  log.innerHTML = state.exports.map((entry) => `
    <article class="log-entry ${entry.status === "failed" ? "failed" : ""}">
      <div class="log-top">
        <span class="log-type">${escapeHtml(entry.type)} ${entry.status === "failed" ? "FAILED" : "OK"}</span>
        <span class="log-time">${escapeHtml(entry.time)}</span>
      </div>
      <strong title="${escapeHtml(entry.filename)}">${escapeHtml(entry.filename)}</strong>
      <div class="log-detail">
        ${escapeHtml(entry.window)} · ${escapeHtml(entry.filter)}<br />
        ${escapeHtml(entry.dataVersion)} / ${escapeHtml(entry.scenarioVersion)}<br />
        输入 ${entry.input} kW · 损失 ${entry.loss} kW · 守恒 ${escapeHtml(entry.conservation)}
      </div>
    </article>
  `).join("");
}

function syncFilterUi() {
  const controls = currentWindowState();
  $("searchInput").value = controls.search;
  $("searchInput").closest(".search-field").classList.toggle("has-value", Boolean(controls.search));
  $("clearSearch").hidden = !controls.search;
  document.querySelectorAll("#rangeToggle button").forEach((button) => {
    button.classList.toggle("active", button.dataset.range === controls.rangeMode);
  });
}

function renderAll() {
  snapshot = currentSnapshot();
  const controls = currentWindowState();
  renderDatasetTabs();
  renderWindowTabs();
  renderFilterChips();
  syncFilterUi();
  renderCondition();
  renderKpis();
  renderLoadControls();
  renderInspector();
  renderTable();
  renderExports();
  $("flowEmpty").hidden = snapshot.aggregate.hasData;
  $("curveEmpty").hidden = snapshot.aggregate.hasData;
  $("mapEmpty").hidden = snapshot.aggregate.hasData;
  $("tableEmpty").hidden = snapshot.aggregate.hasData;
  $("flowCanvas").setAttribute(
    "aria-label",
    `建筑能量流，${filterSummary(controls)}，${snapshot.window.range}，总输入 ${formatPower(snapshot.flow.totals.input)} 千瓦`,
  );
  drawAll();
}

function prepareCanvas(canvas) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height, dpr };
}

function drawSankeyStage(time = animationTime) {
  if (!snapshot) return;
  const prepared = prepareCanvas($("flowCanvas"));
  if (!prepared) return;
  sankeyLayout = drawSankey(prepared.ctx, snapshot, prepared.width, prepared.height, {
    selectedNode: snapshot.config.selectedNode,
    time,
    animate: !reducedMotion && !document.hidden,
  });
}

function drawCurveStage() {
  if (!snapshot) return;
  const prepared = prepareCanvas($("curveCanvas"));
  if (!prepared) return;
  curveLayout = drawCurve(prepared.ctx, snapshot, prepared.width, prepared.height, {
    rangeMode: snapshot.config.rangeMode,
    hoverSlot: curveHoverSlot,
    animate: true,
    time: animationTime,
  });
}

function drawMapStage() {
  if (!snapshot) return;
  const prepared = prepareCanvas($("mapCanvas"));
  if (!prepared) return;
  mapLayout = drawMap(prepared.ctx, snapshot, prepared.width, prepared.height);
}

function drawAll() {
  drawSankeyStage();
  drawCurveStage();
  drawMapStage();
}

function animate(time) {
  animationTime = time;
  if (snapshot && !document.hidden && !reducedMotion) drawSankeyStage(time);
  window.requestAnimationFrame(animate);
}

function canvasPoint(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top, width: rect.width, height: rect.height };
}

function bindCanvasInteractions() {
  const flowCanvas = $("flowCanvas");
  flowCanvas.addEventListener("mousemove", (event) => {
    if (!sankeyLayout) return;
    const point = canvasPoint(event, flowCanvas);
    const hit = sankeyLayout.nodes.find((node) => (
      point.x >= node.x - 3 && point.x <= node.x + node.width + 3
      && point.y >= node.y - 3 && point.y <= node.y + node.height + 3
    ));
    flowCanvas.classList.toggle("pointer", Boolean(hit));
    $("flowHint").textContent = hit
      ? `${hit.label} · ${formatPower(hit.value)} kW · 点击查看`
      : "点击节点查看功率";
  });
  flowCanvas.addEventListener("mouseleave", () => {
    flowCanvas.classList.remove("pointer");
    $("flowHint").textContent = "点击节点查看功率";
  });
  flowCanvas.addEventListener("click", (event) => {
    if (!sankeyLayout) return;
    const point = canvasPoint(event, flowCanvas);
    const hit = sankeyLayout.nodes.find((node) => (
      point.x >= node.x - 3 && point.x <= node.x + node.width + 3
      && point.y >= node.y - 3 && point.y <= node.y + node.height + 3
    ));
    if (!hit) return;
    currentWindowState().selectedNode = hit.id;
    renderAll();
    showToast(`已选择${hit.label}：${formatPower(hit.value)} kW`);
  });

  const curveCanvas = $("curveCanvas");
  curveCanvas.addEventListener("mousemove", (event) => {
    if (!curveLayout || !snapshot?.aggregate.hasData) return;
    const point = canvasPoint(event, curveCanvas);
    const plotWidth = point.width - curveLayout.margin.left - curveLayout.margin.right;
    if (point.x < curveLayout.margin.left || point.x > point.width - curveLayout.margin.right) return;
    const ratio = Math.max(0, Math.min(1, (point.x - curveLayout.margin.left) / plotWidth));
    const slot = Math.round(curveLayout.startSlot + ratio * (curveLayout.endSlot - curveLayout.startSlot));
    if (slot !== curveHoverSlot) {
      curveHoverSlot = slot;
      drawCurveStage();
    }
  });
  curveCanvas.addEventListener("mouseleave", () => {
    if (curveHoverSlot !== null) {
      curveHoverSlot = null;
      drawCurveStage();
    }
  });

  const mapCanvas = $("mapCanvas");
  mapCanvas.addEventListener("click", (event) => {
    if (!mapLayout?.hitZones?.length) return;
    const point = canvasPoint(event, mapCanvas);
    const hit = mapLayout.hitZones.find((zone) => (
      point.x >= zone.x && point.x <= zone.x + zone.width
      && point.y >= zone.y && point.y <= zone.y + zone.height
    ));
    if (!hit) return;
    currentWindowState().search = hit.zoneName;
    renderAll();
    showToast(`地图已筛选：${hit.zoneName}`);
  });
  mapCanvas.addEventListener("mousemove", (event) => {
    if (!mapLayout?.hitZones?.length) return;
    const point = canvasPoint(event, mapCanvas);
    const hit = mapLayout.hitZones.find((zone) => (
      point.x >= zone.x && point.x <= zone.x + zone.width
      && point.y >= zone.y && point.y <= zone.y + zone.height
    ));
    mapCanvas.style.cursor = hit ? "pointer" : "default";
  });
}

function exportFilename(snapshotValue, extension) {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
  ].join("");
  const floor = snapshotValue.config.filter.floor === "all" ? "all-floors" : snapshotValue.config.filter.floor;
  return `energy-atlas_${snapshotValue.clean.id}_${snapshotValue.window.id}_${floor}_${stamp}.${extension}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function appendExportLog(exportSnapshot, type, filename, status = "ok", error = "") {
  const manifest = buildExportManifest(exportSnapshot);
  const now = new Date().toLocaleString("zh-CN", { hour12: false });
  state.exports.unshift({
    type,
    status,
    time: now,
    filename,
    window: `${manifest.dataset.label} · ${manifest.window.label} ${manifest.window.range}`,
    filter: manifest.filter.text,
    dataVersion: manifest.dataVersion,
    scenarioVersion: manifest.scenarioVersion,
    input: formatPower(manifest.kpis.input),
    loss: formatPower(manifest.kpis.loss),
    conservation: manifest.conservation.ok ? "PASS" : "FAIL",
    error,
  });
  renderExports();
}

function exportPng() {
  const exportSnapshot = snapshot;
  if (!exportSnapshot) return;
  const filename = exportFilename(exportSnapshot, "png");
  try {
    const canvas = drawExportReport(exportSnapshot);
    canvas.toBlob((blob) => {
      if (!blob) {
        appendExportLog(exportSnapshot, "PNG", filename, "failed", "无法生成图像");
        showToast("导出失败：无法生成 PNG", "error");
        return;
      }
      downloadBlob(blob, filename);
      appendExportLog(exportSnapshot, "PNG", filename);
      showToast(`图表已导出 · ${filename}`);
    }, "image/png");
  } catch (error) {
    appendExportLog(exportSnapshot, "PNG", filename, "failed", error.message);
    showToast(`导出失败：${error.message}`, "error");
  }
}

function exportCsv() {
  const exportSnapshot = snapshot;
  if (!exportSnapshot) return;
  const filename = exportFilename(exportSnapshot, "csv");
  try {
    const csv = `\uFEFF${buildCsv(exportSnapshot)}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, filename);
    appendExportLog(exportSnapshot, "CSV", filename);
    showToast(`区间数据已导出 · ${filename}`);
  } catch (error) {
    appendExportLog(exportSnapshot, "CSV", filename, "failed", error.message);
    showToast(`导出失败：${error.message}`, "error");
  }
}

function bindControls() {
  $("datasetTabs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-dataset]");
    if (!button) return;
    currentWindowState().dataset = button.dataset.dataset;
    renderAll();
    showToast(`已切换数据版本：${button.textContent.trim()}`);
  });

  $("windowTabs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-window]");
    if (!button) return;
    const next = button.dataset.window;
    if (next === state.activeWindow) return;
    state.activeWindow = next;
    curveHoverSlot = null;
    renderAll();
    const controls = currentWindowState();
    showToast(`已切换至${getWindow(next).label}，保留筛选：${filterSummary(controls)}`);
  });

  $("floorFilters").addEventListener("click", (event) => {
    const button = event.target.closest("[data-floor]");
    if (!button) return;
    currentWindowState().floor = button.dataset.floor;
    renderAll();
  });

  $("sourceFilters").addEventListener("click", (event) => {
    const button = event.target.closest("[data-source]");
    if (!button) return;
    currentWindowState().source = button.dataset.source;
    renderAll();
  });

  $("searchInput").addEventListener("input", (event) => {
    currentWindowState().search = event.target.value;
    renderAll();
  });

  $("clearSearch").addEventListener("click", () => {
    currentWindowState().search = "";
    renderAll();
    $("searchInput").focus();
  });

  $("resetFilters").addEventListener("click", () => {
    const controls = currentWindowState();
    controls.search = "";
    controls.floor = "all";
    controls.source = "all";
    renderAll();
    showToast("当前窗口筛选已重置");
  });

  $("resetLoads").addEventListener("click", () => {
    currentWindowState().loadFactors = defaultLoadFactors();
    renderAll();
    showToast("设备负载已恢复到数据基线");
  });

  $("rangeToggle").addEventListener("click", (event) => {
    const button = event.target.closest("[data-range]");
    if (!button) return;
    currentWindowState().rangeMode = button.dataset.range;
    curveHoverSlot = null;
    renderAll();
  });

  $("exportPng").addEventListener("click", exportPng);
  $("exportCsv").addEventListener("click", exportCsv);

  const queueDraw = () => {
    if (renderQueued) return;
    renderQueued = true;
    window.requestAnimationFrame(() => {
      renderQueued = false;
      if (snapshot) drawAll();
    });
  };
  const observer = new ResizeObserver(queueDraw);
  [$("flowWrap"), $("curveWrap"), $("mapWrap")].forEach((element) => observer.observe(element));
  window.addEventListener("resize", queueDraw);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && snapshot) drawAll();
  });
}

function initialize() {
  buildLoadControls();
  bindControls();
  bindCanvasInteractions();
  renderAll();
  window.requestAnimationFrame(animate);
}

initialize();
