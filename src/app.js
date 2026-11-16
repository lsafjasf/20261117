import {
  DATASETS,
  DIRECTIONS,
  GRADES,
  ROADS,
  ROAD_BY_ID,
  WINDOWS,
} from "./data.js";
import {
  buildView,
  computeRoute,
  getPreparedDataset,
  runSelfChecks,
} from "./engine.js";
import {
  drawChart,
  drawExport,
  drawMap,
  findRoadAt,
  fmt,
  mapTransform,
} from "./draw.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const ALL_GRADES = GRADES.map((grade) => grade.id);

const elements = {
  headerVersion: $("#headerVersion"),
  sideVersion: $("#sideVersion"),
  contextVersion: $("#contextVersion"),
  contextTime: $("#contextTime"),
  contextWindowName: $("#contextWindowName"),
  contextFilters: $("#contextFilters"),
  restoreFlag: $("#restoreFlag"),
  sampleHint: $("#sampleHint"),
  windowOptions: $("#windowOptions"),
  directionOptions: $("#directionOptions"),
  gradeOptions: $("#gradeOptions"),
  datasetOptions: $("#datasetOptions"),
  activeFilterCount: $("#activeFilterCount"),
  activeChips: $("#activeChips"),
  dataSummary: $("#dataSummary"),
  qcBadge: $("#qcBadge"),
  kpiSpeed: $("#kpiSpeed"),
  kpiSpeedFoot: $("#kpiSpeedFoot"),
  kpiQueue: $("#kpiQueue"),
  kpiQueueFoot: $("#kpiQueueFoot"),
  kpiHotspots: $("#kpiHotspots"),
  kpiHotspotFoot: $("#kpiHotspotFoot"),
  kpiSamples: $("#kpiSamples"),
  kpiSampleFoot: $("#kpiSampleFoot"),
  mapSubtitle: $("#mapSubtitle"),
  zoomLabel: $("#zoomLabel"),
  mapWrap: $("#mapWrap"),
  mapCanvas: $("#mapCanvas"),
  mapTooltip: $("#mapTooltip"),
  mapModeHint: $("#mapModeHint"),
  routeBanner: $("#routeBanner"),
  routeInstruction: $("#routeInstruction"),
  emptyMap: $("#emptyMap"),
  mapLegend: $("#mapLegend"),
  legendItems: $("#legendItems"),
  legendTotal: $("#legendTotal"),
  chartCanvas: $("#chartCanvas"),
  chartSummary: $("#chartSummary"),
  chartEmpty: $("#chartEmpty"),
  detailStatus: $("#detailStatus"),
  detailName: $("#detailName"),
  detailMeta: $("#detailMeta"),
  detailIndex: $("#detailIndex"),
  detailSpeed: $("#detailSpeed"),
  detailQueue: $("#detailQueue"),
  detailIndexBar: $("#detailIndexBar"),
  detailSamples: $("#detailSamples"),
  detailUpdated: $("#detailUpdated"),
  routeStart: $("#routeStart"),
  routeEnd: $("#routeEnd"),
  closureText: $("#closureText"),
  routeStatus: $("#routeStatus"),
  clearRouteBtn: $("#clearRouteBtn"),
  routePanelBtn: $("#routePanelBtn"),
  routeToggleBtn: $("#routeToggleBtn"),
  hotspotList: $("#hotspotList"),
  listEmpty: $("#listEmpty"),
  listFoot: $("#listFoot"),
  showAllBtn: $("#showAllBtn"),
  lastExport: $("#lastExport"),
  logEntries: $("#logEntries"),
  selfcheckSummary: $("#selfcheckSummary"),
  selfcheckList: $("#selfcheckList"),
  toast: $("#toast"),
  exportCanvas: $("#exportCanvas"),
};

const state = {
  datasetId: "normal",
  windowId: "w0809",
  direction: "all",
  grades: [...ALL_GRADES],
  selectedRoadId: "r03",
  mapView: { zoom: 1, centerX: 500, centerY: 310 },
  routeStart: null,
  routeEnd: null,
  routeMode: false,
  hoverRoadId: null,
  hoverChartIndex: null,
  ranking: "index",
  listExpanded: false,
};

const windowStateCache = new Map();
const filterStateCache = new Map();
let currentView = null;
let currentRoute = null;
let selfChecks = null;
let toastTimer = null;
let restoreTimer = null;
let mapFrame = 0;
let chartFrame = 0;
let dragging = null;
let exportLogs = loadExportLogs();

function gradesKey(grades = state.grades) {
  return [...grades].sort().join(",");
}

function windowCacheKey(datasetId = state.datasetId, windowId = state.windowId) {
  return `${datasetId}|${windowId}`;
}

function filterCacheKey() {
  return `${state.datasetId}|${state.windowId}|${state.direction}|${gradesKey()}`;
}

function cloneView(view = state.mapView) {
  return { zoom: view.zoom, centerX: view.centerX, centerY: view.centerY };
}

function saveCurrentSnapshot() {
  windowStateCache.set(windowCacheKey(), {
    direction: state.direction,
    grades: [...state.grades],
  });
  filterStateCache.set(filterCacheKey(), {
    selectedRoadId: state.selectedRoadId,
    mapView: cloneView(),
    routeStart: state.routeStart,
    routeEnd: state.routeEnd,
    listExpanded: state.listExpanded,
  });
}

function restoreSnapshotForFilter() {
  const cached = filterStateCache.get(filterCacheKey());
  if (!cached) return false;
  state.selectedRoadId = cached.selectedRoadId;
  state.mapView = cloneView(cached.mapView);
  state.routeStart = cached.routeStart;
  state.routeEnd = cached.routeEnd;
  state.listExpanded = Boolean(cached.listExpanded);
  return true;
}

function defaultSelectedRoad() {
  if (!currentView) return null;
  const selected = currentView.roads.find((road) => road.id === state.selectedRoadId);
  return selected?.id ?? currentView.roads[0]?.id ?? null;
}

function selectedRoad() {
  return currentView?.roads.find((road) => road.id === state.selectedRoadId) ?? null;
}

function datasetMeta(datasetId = state.datasetId) {
  return DATASETS.find((dataset) => dataset.id === datasetId) ?? DATASETS[0];
}

function directionMeta() {
  return DIRECTIONS.find((direction) => direction.id === state.direction) ?? DIRECTIONS[0];
}

function computeCurrent() {
  currentView = buildView(state.datasetId, state.windowId, {
    direction: state.direction,
    grades: state.grades,
  });
  const fallback = defaultSelectedRoad();
  state.selectedRoadId = fallback;
  if (state.routeStart && state.routeEnd) {
    currentRoute = computeRoute(state.routeStart, state.routeEnd, [...currentView.closedIds]);
    if (currentRoute.status !== "ok") {
      state.routeStart = null;
      state.routeEnd = null;
      currentRoute = null;
    }
  } else {
    currentRoute = null;
  }
  return currentView;
}

function loadExportLogs() {
  try {
    const saved = sessionStorage.getItem("traffic-export-logs");
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function persistExportLogs() {
  try {
    sessionStorage.setItem("traffic-export-logs", JSON.stringify(exportLogs.slice(0, 30)));
  } catch {
    // Session storage is optional in restricted previews.
  }
}

function showToast(message, tone = "default") {
  clearTimeout(toastTimer);
  elements.toast.innerHTML = message;
  elements.toast.dataset.tone = tone;
  elements.toast.hidden = false;
  toastTimer = setTimeout(() => {
    elements.toast.hidden = true;
  }, 3200);
}

function markRestore(message) {
  clearTimeout(restoreTimer);
  elements.restoreFlag.hidden = false;
  elements.restoreFlag.textContent = message;
  restoreTimer = setTimeout(() => {
    elements.restoreFlag.hidden = true;
    elements.restoreFlag.textContent = "已恢复上次状态";
  }, 2600);
}

function renderStaticControls() {
  elements.windowOptions.innerHTML = WINDOWS.map(
    (window) => `
      <button class="window-option" type="button" role="tab" data-window="${window.id}">
        <strong>${window.label}</strong>
        <span>${window.name}</span>
      </button>`,
  ).join("");

  elements.directionOptions.innerHTML = DIRECTIONS.map(
    (direction) => `
      <button class="direction-option" type="button" data-direction="${direction.id}">
        <span class="dir-arrow">${direction.arrow}</span>
        <span>${direction.label}</span>
      </button>`,
  ).join("");

  elements.gradeOptions.innerHTML = GRADES.map((grade) => {
    const count = ROADS.filter((road) => road.grade === grade.id).length;
    return `
      <button class="grade-option" type="button" data-grade="${grade.id}">
        <span class="check-box">✓</span>
        <span>${grade.label}</span>
        <span class="grade-line"></span>
        <span class="grade-count">${count} 条</span>
      </button>`;
  }).join("");

  elements.datasetOptions.innerHTML = DATASETS.map(
    (dataset) => `
      <button type="button" role="tab" data-dataset="${dataset.id}" title="${dataset.description}">
        ${dataset.label}
      </button>`,
  ).join("");
}

function renderFilterControls() {
  $$("[data-window]").forEach((button) => {
    const active = button.dataset.window === state.windowId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $$("[data-direction]").forEach((button) => {
    const active = button.dataset.direction === state.direction;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $$("[data-grade]").forEach((button) => {
    const active = state.grades.includes(button.dataset.grade);
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $$("[data-dataset]").forEach((button) => {
    const active = button.dataset.dataset === state.datasetId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelector("#routeToggleBtn")?.classList.toggle("active", state.routeMode);
}

function gradeLabels() {
  if (state.grades.length === ALL_GRADES.length) return "全部等级";
  if (!state.grades.length) return "未选等级";
  return state.grades.map((id) => GRADES.find((grade) => grade.id === id)?.label).join(" + ");
}

function renderContext() {
  const view = currentView;
  const direction = directionMeta();
  elements.contextTime.textContent = view.window.label;
  elements.contextWindowName.textContent = view.window.name;
  elements.mapSubtitle.textContent = `${view.window.compact} · 12 个采样点`;
  const versionLabel = `${view.dataVersion} · ${view.dataHash}`;
  elements.contextVersion.textContent = versionLabel;
  elements.sideVersion.textContent = versionLabel;
  elements.headerVersion.textContent = versionLabel;
  elements.sampleHint.textContent = "12 × 5min";

  const chips = [
    `<span class="context-chip"><i></i>${direction.label}</span>`,
    `<span class="context-chip"><i></i>${gradeLabels()}</span>`,
    `<span class="context-chip"><i></i>${datasetMeta().label}样本</span>`,
    `<span class="context-chip"><i></i>5min · 量加权</span>`,
  ];
  if (view.closures.length) {
    chips.push(`<span class="context-chip hot"><i></i>${view.closures.length} 条封闭</span>`);
  }
  elements.contextFilters.innerHTML = chips.join("");
  elements.activeFilterCount.textContent = `${view.stats.roadCount} 条路段`;
  elements.activeChips.innerHTML = [
    `<span class="active-chip">${direction.label}</span>`,
    `<span class="active-chip">${gradeLabels()}</span>`,
    `<span class="active-chip">${view.window.start}–${view.window.end}</span>`,
    `<span class="active-chip">${datasetMeta().label}</span>`,
  ].join("");
}

function renderKpis() {
  const stats = currentView.stats;
  const empty = stats.roadCount === 0;
  elements.kpiSpeed.textContent = fmt.speed(stats.speed);
  elements.kpiQueue.textContent = fmt.queue(stats.queue);
  elements.kpiHotspots.textContent = String(stats.hotspotCount);
  elements.kpiSamples.textContent = String(stats.samples);
  elements.kpiSpeedFoot.innerHTML = empty
    ? "无匹配路段"
    : `自由流 ${fmt.speed(stats.freeFlow)} · <strong>${fmt.pct(stats.speed / stats.freeFlow)}</strong> 速度比`;
  elements.kpiQueueFoot.textContent = empty
    ? "无有效排队样本"
    : `${stats.roadCount} 条路段算术均值`;
  elements.kpiHotspotFoot.textContent = empty
    ? "指数 ≥ 50 的路段"
    : `占显示路段 ${stats.roadCount ? Math.round((stats.hotspotCount / stats.roadCount) * 100) : 0}%`;
  elements.kpiSampleFoot.textContent = `覆盖率 ${fmt.pct(stats.coverage)} · 窗口内`;
}

function renderDataSummary() {
  const summary = currentView.quality;
  const rows = [
    ["本窗原始", summary.raw, false],
    ["本窗可用", summary.final, false],
    ["唯一键去重", summary.duplicates, summary.duplicates > 0],
    ["补缺字段", summary.filled, summary.filled > 0],
    ["异常修复", summary.anomaly, summary.anomaly > 0],
    ["坏记录剔除", summary.invalid, summary.invalid > 0],
  ];
  elements.dataSummary.innerHTML = rows
    .map(
      ([label, value, warn]) =>
        `<div class="summary-item"><span>${label}</span><strong class="${warn ? "warn" : ""}">${value}</strong></div>`,
    )
    .join("");
  elements.qcBadge.textContent = `QC ${selfChecks.passed}/${selfChecks.total}`;
  elements.qcBadge.style.background = selfChecks.passed === selfChecks.total ? "" : "#f8e8df";
}

function renderLegend() {
  elements.legendItems.innerHTML = currentView.legend
    .map(
      (bin) => `
        <div class="legend-item">
          <span class="legend-swatch" style="background:${bin.color}"></span>
          <span>${bin.label}</span>
          <small>${bin.min}–${bin.max === 100 ? "100" : bin.max}</small>
          <strong>${String(bin.count).padStart(2, "0")}</strong>
        </div>`,
    )
    .join("");
  elements.legendTotal.textContent = `${currentView.roads.length} 条显示 · ${currentView.stats.hotspotCount} 处热点`;
  elements.emptyMap.hidden = currentView.roads.length > 0;
  elements.mapModeHint.hidden = currentView.roads.length === 0 || state.routeMode;
  elements.mapModeHint.textContent = "单击路段查看速度与排队长度 · 滚轮缩放，拖动地图";
  elements.zoomLabel.textContent = `${Math.round(state.mapView.zoom * 100)}%`;
}

function renderChartSummary() {
  const view = currentView;
  if (!view.series.length) {
    elements.chartSummary.innerHTML = "<span>无有效采样</span>";
    elements.chartEmpty.hidden = false;
    return;
  }
  elements.chartSummary.innerHTML =
    `均值 <strong>${fmt.index(view.stats.index)}</strong> · ` +
    `峰值 <strong>${fmt.index(view.stats.peakIndex)}</strong> · ${view.series.length} 点`;
  elements.chartEmpty.hidden = true;
}

function bandMeta(road) {
  return currentView.legend.find((bin) => bin.id === road?.band) ?? currentView.legend[0];
}

function renderDetail() {
  const road = selectedRoad();
  if (!road) {
    elements.detailStatus.textContent = "无匹配";
    elements.detailStatus.className = "status-badge";
    elements.detailName.textContent = "未选择路段";
    elements.detailMeta.textContent = "当前筛选没有可展示的路段";
    elements.detailIndex.textContent = "—";
    elements.detailSpeed.textContent = "—";
    elements.detailQueue.textContent = "—";
    elements.detailIndexBar.style.width = "0%";
    elements.detailSamples.textContent = "0 个采样";
    elements.detailUpdated.textContent = "—";
    return;
  }
  const band = bandMeta(road);
  elements.detailStatus.textContent = currentView.closedIds.has(road.id) ? "封闭路段" : band.label;
  elements.detailStatus.className =
    "status-badge " + (band.id === "smooth" ? "good" : band.id === "slow" ? "medium" : "");
  elements.detailName.textContent = road.name;
  elements.detailMeta.textContent =
    `${GRADES.find((grade) => grade.id === road.grade)?.label} · ` +
    `${DIRECTIONS.find((direction) => direction.id === road.direction)?.label}` +
    (currentView.closedIds.has(road.id) ? " · 当前窗口封闭" : "");
  elements.detailIndex.textContent = fmt.index(road.index);
  elements.detailSpeed.textContent = fmt.speed(road.speed);
  elements.detailQueue.textContent = fmt.queue(road.queue);
  elements.detailIndexBar.style.width = `${road.index}%`;
  elements.detailSamples.textContent = `${road.samples} 个采样 · 流量 ${Math.round(road.volume)}/h`;
  elements.detailUpdated.textContent = `${road.lastTime.slice(11)} 更新`;
}

function renderRoute() {
  const view = currentView;
  const start = state.routeStart ? ROAD_BY_ID[state.routeStart] : null;
  const end = state.routeEnd ? ROAD_BY_ID[state.routeEnd] : null;
  elements.routeStart.textContent = start?.name ?? "未选择";
  elements.routeEnd.textContent = end?.name ?? "未选择";
  elements.closureText.textContent = view.closures.length
    ? `当前窗口 ${view.closures.length} 条封闭路段`
    : "当前窗口无封闭路段";
  let status = "规划将自动绕行";
  if (state.routeMode && !start) status = "点击地图选择起点";
  else if (state.routeMode && start && !end) status = "继续选择终点";
  else if (currentRoute?.status === "ok") {
    status = `${currentRoute.lengthKm.toFixed(1)} km · 已避开 ${currentRoute.avoidedClosed ?? view.closures.length} 条`;
  } else if (currentRoute?.status === "no-path") status = "无可行路径";
  elements.routeStatus.textContent = status;
  elements.routePanelBtn.textContent = state.routeMode ? "选择中…" : currentRoute ? "重新选择" : "开始选择";
  elements.routeToggleBtn.classList.toggle("active", state.routeMode);
  elements.routeBanner.hidden = !state.routeMode;
  elements.clearRouteBtn.hidden = !start && !end;
  elements.routeInstruction.textContent = !start
    ? "请在地图上点击起点路段"
    : "请在地图上点击终点路段，封闭道路不可选";
  elements.mapModeHint.hidden = state.routeMode || !view.roads.length;
}

function renderHotspotList() {
  const view = currentView;
  const ordered =
    state.ranking === "speed"
      ? [...view.roads].sort((left, right) => left.speed - right.speed || right.index - left.index)
      : [...view.roads];
  const limit = state.listExpanded ? ordered.length : Math.min(ordered.length, 7);
  elements.hotspotList.innerHTML = ordered
    .slice(0, limit)
    .map((road, index) => {
      const grade = GRADES.find((item) => item.id === road.grade)?.label;
      const direction = DIRECTIONS.find((item) => item.id === road.direction)?.short;
      const selected = road.id === state.selectedRoadId ? " selected" : "";
      return `
        <button class="hotspot-row${selected}" type="button" data-road-id="${road.id}">
          <span class="rank-no">${String(index + 1).padStart(2, "0")}</span>
          <span class="hotspot-name">
            <strong>${road.name}</strong>
            <span>${grade} · ${direction}${view.closedIds.has(road.id) ? " · 封闭" : ""}</span>
          </span>
          <span class="hotspot-value">${fmt.speed(road.speed)}<small>km/h</small></span>
          <span class="hotspot-value">${fmt.queue(road.queue)}<small>m</small></span>
        </button>`;
    })
    .join("");
  elements.listEmpty.hidden = ordered.length > 0;
  elements.listFoot.textContent = ordered.length
    ? `${ordered.length} 条 · ${view.stats.hotspotCount} 处 ≥ 50`
    : "当前筛选无路段";
  elements.showAllBtn.textContent = state.listExpanded ? "收起" : "查看全部";
  elements.showAllBtn.hidden = ordered.length <= 7;
  $$("[data-rank]").forEach((button) => {
    button.classList.toggle("active", button.dataset.rank === state.ranking);
  });
}

function renderLastExport() {
  if (!exportLogs.length) {
    elements.lastExport.innerHTML = `
      <div class="export-empty-icon">↧</div>
      <div><strong>尚无导出记录</strong><span>导出时将写入当前筛选与数值快照</span></div>`;
    return;
  }
  const log = exportLogs[0];
  elements.lastExport.innerHTML = `
    <div class="export-empty-icon">PNG</div>
    <div>
      <strong>${log.filename}</strong>
      <span>${log.window.label} · ${log.values.speed} km/h · ${log.values.queue} m · ${log.values.hotspots} 热点</span>
    </div>`;
}

function renderLogsModal() {
  if (!exportLogs.length) {
    elements.logEntries.innerHTML = '<div class="log-empty">还没有导出记录。点击右上角“导出当前视图”生成第一份快照。</div>';
    return;
  }
  elements.logEntries.innerHTML = exportLogs
    .map(
      (log) => `
        <div class="log-entry">
          <div class="log-entry-top">
            <strong>${log.exportId}</strong>
            <span>${log.capturedAt}</span>
          </div>
          <p>
            <code>${log.filename}</code><br>
            ${log.window.label} / ${log.filters.direction} / ${log.filters.grades} / ${log.datasetLabel}<br>
            屏幕同源值：速度 ${log.values.speed} km/h · 排队 ${log.values.queue} m · 热点 ${log.values.hotspots} · 样本 ${log.values.samples}<br>
            数据版本 ${log.dataVersion} · 哈希 ${log.dataHash} · 视图 ${log.viewRevision.slice(-12)}
          </p>
        </div>`,
    )
    .join("");
}

function renderSelfChecks() {
  elements.selfcheckSummary.textContent = `${selfChecks.passed}/${selfChecks.total} 通过 · 空结果已覆盖`;
  elements.selfcheckList.innerHTML = selfChecks.items
    .map(
      (item) => `
        <div class="selfcheck-item" title="${item.detail}">
          <i>${item.ok ? "✓" : "!"}</i>
          <span>${item.label} · ${item.detail}</span>
        </div>`,
    )
    .join("");
}

function prepareCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width, height, ratio };
}

function renderMapCanvas() {
  const { ctx, width, height } = prepareCanvas(elements.mapCanvas);
  drawMap(ctx, {
    width,
    height,
    view: currentView,
    mapView: state.mapView,
    selectedRoadId: state.selectedRoadId,
    hoverRoadId: state.hoverRoadId,
    route: currentRoute,
  });
}

function renderChartCanvas() {
  const { ctx, width, height } = prepareCanvas(elements.chartCanvas);
  drawChart(ctx, {
    width,
    height,
    view: currentView,
    hoverIndex: state.hoverChartIndex,
  });
}

function scheduleMap() {
  if (mapFrame) return;
  mapFrame = requestAnimationFrame(() => {
    mapFrame = 0;
    renderMapCanvas();
  });
}

function scheduleChart() {
  if (chartFrame) return;
  chartFrame = requestAnimationFrame(() => {
    chartFrame = 0;
    renderChartCanvas();
  });
}

function renderAll() {
  currentView = currentView ?? computeCurrent();
  elements.mapCanvas.dataset.viewRevision = currentView.viewRevision;
  elements.chartCanvas.dataset.viewRevision = currentView.viewRevision;
  document.querySelector(".kpi-grid").dataset.viewRevision = currentView.viewRevision;
  renderFilterControls();
  renderContext();
  renderKpis();
  renderDataSummary();
  renderLegend();
  renderChartSummary();
  renderDetail();
  renderRoute();
  renderHotspotList();
  renderLastExport();
  scheduleMap();
  scheduleChart();
}

function refresh({ save = false } = {}) {
  if (save) saveCurrentSnapshot();
  computeCurrent();
  renderAll();
}

function toggleRouteMode(force) {
  state.routeMode = typeof force === "boolean" ? force : !state.routeMode;
  if (state.routeMode) {
    state.hoverRoadId = null;
    elements.mapTooltip.hidden = true;
    showToast(state.routeStart ? "继续点击终点路段；若重新选择，将覆盖当前路线" : "路线避障：先点击起点路段");
  }
  renderRoute();
  scheduleMap();
}

function clearRoute() {
  state.routeStart = null;
  state.routeEnd = null;
  currentRoute = null;
  state.routeMode = false;
  renderRoute();
  scheduleMap();
  showToast("已清除路线");
}

function changeWindow(windowId) {
  if (windowId === state.windowId) return;
  saveCurrentSnapshot();
  const targetWindow = WINDOWS.find((window) => window.id === windowId);
  state.windowId = windowId;
  const cachedWindow = windowStateCache.get(windowCacheKey());
  const hadWindowState = Boolean(cachedWindow);
  if (cachedWindow) {
    state.direction = cachedWindow.direction;
    state.grades = [...cachedWindow.grades];
  } else {
    state.direction = "all";
    state.grades = [...ALL_GRADES];
    state.mapView = { zoom: 1, centerX: 500, centerY: 310 };
    state.routeStart = null;
    state.routeEnd = null;
    state.listExpanded = false;
  }
  const restoredFilter = restoreSnapshotForFilter();
  refresh();
  if (hadWindowState || restoredFilter) {
    markRestore(`已恢复 ${targetWindow.compact} 状态`);
    showToast(`已切回 <strong>${targetWindow.label}</strong>，筛选、选段与地图范围已恢复`);
  } else {
    showToast(`已切换至 <strong>${targetWindow.label}</strong> · ${targetWindow.name}`);
  }
}

function changeFilter(patch) {
  saveCurrentSnapshot();
  if (patch.direction != null) state.direction = patch.direction;
  if (patch.grades != null) state.grades = [...patch.grades];
  const restored = restoreSnapshotForFilter();
  refresh();
  if (restored) markRestore("已恢复该筛选的选段与范围");
  if (!currentView.roads.length) {
    showToast("当前筛选为空：地图、曲线、列表与导出均使用零值快照");
  }
}

function changeDataset(datasetId) {
  if (datasetId === state.datasetId) return;
  saveCurrentSnapshot();
  const target = datasetMeta(datasetId);
  state.datasetId = datasetId;
  const cachedWindow = windowStateCache.get(windowCacheKey());
  if (cachedWindow) {
    state.direction = cachedWindow.direction;
    state.grades = [...cachedWindow.grades];
  } else {
    state.direction = "all";
    state.grades = [...ALL_GRADES];
    state.mapView = { zoom: 1, centerX: 500, centerY: 310 };
    state.routeStart = null;
    state.routeEnd = null;
  }
  const restored = restoreSnapshotForFilter();
  refresh();
  if (restored) markRestore("已恢复该样本状态");
  showToast(`已切换至 <strong>${target.label}样本</strong> · ${target.description}`);
}

function resetCurrentFilters() {
  saveCurrentSnapshot();
  state.direction = "all";
  state.grades = [...ALL_GRADES];
  state.mapView = { zoom: 1, centerX: 500, centerY: 310 };
  state.selectedRoadId = null;
  state.routeStart = null;
  state.routeEnd = null;
  state.routeMode = false;
  state.listExpanded = false;
  refresh();
  showToast("已重置当前窗口的筛选与地图范围");
}

function clampMapCenter() {
  state.mapView.centerX = Math.min(880, Math.max(120, state.mapView.centerX));
  state.mapView.centerY = Math.min(520, Math.max(100, state.mapView.centerY));
}

function zoomMap(nextZoom, anchor) {
  const rect = elements.mapCanvas.getBoundingClientRect();
  const point = anchor ?? { x: rect.width / 2, y: rect.height / 2 };
  const before = mapTransform(rect.width, rect.height, state.mapView);
  const world = before.unproject(point);
  state.mapView.zoom = Math.min(2.6, Math.max(0.75, nextZoom));
  const nextScale =
    Math.min(rect.width / 1000, rect.height / 620) * state.mapView.zoom;
  state.mapView.centerX = world.x - (point.x - rect.width / 2) / nextScale;
  state.mapView.centerY = world.y - (point.y - rect.height / 2) / nextScale;
  clampMapCenter();
  elements.zoomLabel.textContent = `${Math.round(state.mapView.zoom * 100)}%`;
  scheduleMap();
}

function resetMapView() {
  state.mapView = { zoom: 1, centerX: 500, centerY: 310 };
  elements.zoomLabel.textContent = "100%";
  scheduleMap();
  showToast("地图范围已重置为全路网");
}

function eventPoint(event) {
  const rect = elements.mapCanvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top, rect };
}

function roadAtEvent(event, includeHidden = false) {
  const { x, y, rect } = eventPoint(event);
  const transform = mapTransform(rect.width, rect.height, state.mapView);
  const world = transform.unproject({ x, y });
  return findRoadAt(currentView, world, 14 / state.mapView.zoom, includeHidden);
}

function showRoadTooltip(road, event) {
  if (!road) {
    elements.mapTooltip.hidden = true;
    return;
  }
  const metrics = currentView.roads.find((item) => item.id === road.id);
  if (!metrics) {
    elements.mapTooltip.hidden = true;
    return;
  }
  const { x, y, rect } = eventPoint(event);
  elements.mapTooltip.innerHTML = `
    <div class="tooltip-title">${road.name} · 指数 ${fmt.index(metrics.index)}</div>
    <div class="tooltip-row"><span>平均速度</span><strong>${fmt.speed(metrics.speed)} km/h</strong></div>
    <div class="tooltip-row"><span>排队长度</span><strong>${fmt.queue(metrics.queue)} m</strong></div>
    <div class="tooltip-row"><span>方向 / 采样</span><strong>${directionShort(road.direction)} / ${metrics.samples}</strong></div>`;
  elements.mapTooltip.style.left = `${Math.min(rect.width - 150, x + 13)}px`;
  elements.mapTooltip.style.top = `${Math.min(rect.height - 95, y + 13)}px`;
  elements.mapTooltip.hidden = false;
}

function directionShort(directionId) {
  return DIRECTIONS.find((direction) => direction.id === directionId)?.short ?? directionId;
}

function handleMapClick(event) {
  const road = roadAtEvent(event, state.routeMode);
  if (!road) return;
  if (state.routeMode) {
    if (currentView.closedIds.has(road.id)) {
      showToast(`<strong>${road.name}</strong> 当前窗口封闭，不能作为起终点`);
      return;
    }
    if (!state.routeStart || state.routeEnd) {
      state.routeStart = road.id;
      state.routeEnd = null;
      currentRoute = null;
      showToast(`路线起点：<strong>${road.name}</strong>，请选择终点`);
    } else {
      state.routeEnd = road.id;
      currentRoute = computeRoute(state.routeStart, state.routeEnd, [...currentView.closedIds]);
      if (currentRoute.status === "ok") {
        state.routeMode = false;
        showToast(
          `避障路线已生成：<strong>${currentRoute.lengthKm.toFixed(1)} km</strong> · 已避开 ${currentRoute.avoidedClosed ?? currentView.closures.length} 条封闭路段`,
        );
      } else {
        showToast("未找到避开封闭路段的连通路径，请重新选择终点");
        state.routeEnd = null;
        currentRoute = null;
      }
    }
    renderRoute();
    scheduleMap();
    return;
  }
  if (!currentView.roads.some((item) => item.id === road.id)) return;
  state.selectedRoadId = road.id;
  renderDetail();
  renderHotspotList();
  scheduleMap();
}

function setupFilterEvents() {
  elements.windowOptions.addEventListener("click", (event) => {
    const button = event.target.closest("[data-window]");
    if (button) changeWindow(button.dataset.window);
  });
  elements.directionOptions.addEventListener("click", (event) => {
    const button = event.target.closest("[data-direction]");
    if (button) changeFilter({ direction: button.dataset.direction });
  });
  elements.gradeOptions.addEventListener("click", (event) => {
    const button = event.target.closest("[data-grade]");
    if (!button) return;
    const grade = button.dataset.grade;
    const next = state.grades.includes(grade)
      ? state.grades.filter((item) => item !== grade)
      : [...state.grades, grade];
    changeFilter({ grades: next });
  });
  elements.datasetOptions.addEventListener("click", (event) => {
    const button = event.target.closest("[data-dataset]");
    if (button) changeDataset(button.dataset.dataset);
  });
  $("#resetBtn").addEventListener("click", resetCurrentFilters);
  $("#emptyResetBtn").addEventListener("click", () => {
    changeFilter({ direction: "all", grades: [...ALL_GRADES] });
  });
}

function setupMapEvents() {
  const canvas = elements.mapCanvas;
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    dragging = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (dragging) {
      const dx = event.clientX - dragging.x;
      const dy = event.clientY - dragging.y;
      const total = Math.hypot(event.clientX - dragging.startX, event.clientY - dragging.startY);
      if (total > 3) dragging.moved = true;
      if (dragging.moved) {
        const rect = canvas.getBoundingClientRect();
        const scale = Math.min(rect.width / 1000, rect.height / 620) * state.mapView.zoom;
        state.mapView.centerX -= dx / scale;
        state.mapView.centerY -= dy / scale;
        clampMapCenter();
        scheduleMap();
      }
      dragging.x = event.clientX;
      dragging.y = event.clientY;
      elements.mapTooltip.hidden = true;
      return;
    }
    const road = roadAtEvent(event);
    if (road?.id !== state.hoverRoadId) {
      state.hoverRoadId = road?.id ?? null;
      scheduleMap();
    }
    showRoadTooltip(road, event);
  });

  canvas.addEventListener("pointerup", (event) => {
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    const wasMoved = dragging.moved;
    dragging = null;
    if (!wasMoved) handleMapClick(event);
  });

  canvas.addEventListener("pointercancel", () => {
    dragging = null;
    state.hoverRoadId = null;
    elements.mapTooltip.hidden = true;
    scheduleMap();
  });

  canvas.addEventListener("pointerleave", () => {
    if (dragging) return;
    state.hoverRoadId = null;
    elements.mapTooltip.hidden = true;
    scheduleMap();
  });

  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const { x, y } = eventPoint(event);
      const factor = Math.exp(-event.deltaY * 0.0012);
      zoomMap(state.mapView.zoom * factor, { x, y });
    },
    { passive: false },
  );

  $("#zoomInBtn").addEventListener("click", () => zoomMap(state.mapView.zoom * 1.18));
  $("#zoomOutBtn").addEventListener("click", () => zoomMap(state.mapView.zoom / 1.18));
  $("#resetViewBtn").addEventListener("click", resetMapView);
  elements.routeToggleBtn.addEventListener("click", () => toggleRouteMode());
  elements.routePanelBtn.addEventListener("click", () => toggleRouteMode());
  $("#cancelRouteBtn").addEventListener("click", () => {
    state.routeMode = false;
    renderRoute();
    scheduleMap();
  });
  elements.clearRouteBtn.addEventListener("click", clearRoute);
}

function setupChartEvents() {
  const canvas = elements.chartCanvas;
  canvas.addEventListener("pointermove", (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const plotWidth = rect.width - 34 - 12;
    if (x < 34 || x > rect.width - 12 || !currentView.series.length) {
      if (state.hoverChartIndex != null) {
        state.hoverChartIndex = null;
        scheduleChart();
      }
      return;
    }
    const ratio = (x - 34) / Math.max(1, plotWidth);
    const index = Math.round(ratio * (currentView.series.length - 1));
    const next = Math.max(0, Math.min(currentView.series.length - 1, index));
    if (next !== state.hoverChartIndex) {
      state.hoverChartIndex = next;
      scheduleChart();
    }
  });
  canvas.addEventListener("pointerleave", () => {
    state.hoverChartIndex = null;
    scheduleChart();
  });
}

function setupListEvents() {
  elements.hotspotList.addEventListener("click", (event) => {
    const row = event.target.closest("[data-road-id]");
    if (!row) return;
    state.selectedRoadId = row.dataset.roadId;
    renderDetail();
    renderHotspotList();
    scheduleMap();
  });
  $$("[data-rank]").forEach((button) => {
    button.addEventListener("click", () => {
      state.ranking = button.dataset.rank;
      renderHotspotList();
    });
  });
  elements.showAllBtn.addEventListener("click", () => {
    state.listExpanded = !state.listExpanded;
    renderHotspotList();
  });
}

function setupModalEvents() {
  $("#methodCard").addEventListener("click", () => {
    $("#methodModal").hidden = false;
  });
  $("#openMethodBtn").addEventListener("click", () => {
    $("#methodModal").hidden = false;
  });
  $("#openLogsBtn").addEventListener("click", () => {
    renderLogsModal();
    $("#logsModal").hidden = false;
  });
  $$("[data-close]").forEach((button) => {
    button.addEventListener("click", () => {
      const modal = document.getElementById(button.dataset.close);
      if (modal) modal.hidden = true;
    });
  });
  $$(".modal-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) backdrop.hidden = true;
    });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      $$(".modal-backdrop").forEach((backdrop) => {
        backdrop.hidden = true;
      });
      if (state.routeMode) {
        state.routeMode = false;
        renderRoute();
        scheduleMap();
      }
    }
  });
}

function formatCapturedAt(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(date)
    .replaceAll("/", "-");
}

function makeExportId(date) {
  const datePart = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("");
  return `EXP-${datePart}-${String(exportLogs.length + 1).padStart(3, "0")}`;
}

function buildExportPackage() {
  const now = new Date();
  const view = currentView;
  const selected = selectedRoad();
  const exportId = makeExportId(now);
  const dateTag = exportId.split("-")[1];
  const filename = `road-congestion_${dateTag}_${view.window.start.replace(":", "")}-${view.window.end.replace(":", "")}_${datasetMeta().id}.png`;
  const direction = directionMeta().label;
  const grades = gradeLabels();
  return {
    view,
    mapView: cloneView(),
    selectedRoad: selected,
    route: currentRoute,
    datasetLabel: `${datasetMeta().label}样本`,
    capturedAt: formatCapturedAt(now),
    exportId,
    filename,
    direction,
    grades,
    values: {
      speed: fmt.speed(view.stats.speed),
      queue: fmt.queue(view.stats.queue),
      hotspots: String(view.stats.hotspotCount),
      samples: String(view.stats.samples),
      index: fmt.index(view.stats.index),
      coverage: fmt.pct(view.stats.coverage),
      selected: selected
        ? {
            name: selected.name,
            speed: fmt.speed(selected.speed),
            queue: fmt.queue(selected.queue),
            index: fmt.index(selected.index),
          }
        : null,
    },
  };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function exportCurrentView() {
  const button = $("#exportBtn");
  button.disabled = true;
  const original = button.innerHTML;
  button.innerHTML = "正在生成 PNG…";
  try {
    const model = buildExportPackage();
    const canvas = elements.exportCanvas;
    canvas.dataset.exportId = model.exportId;
    canvas.dataset.speed = model.values.speed;
    canvas.dataset.queue = model.values.queue;
    canvas.dataset.hotspots = model.values.hotspots;
    canvas.dataset.samples = model.values.samples;
    canvas.dataset.viewRevision = model.view.viewRevision;
    const ctx = canvas.getContext("2d");
    drawExport(ctx, model);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error("Canvas export failed"));
      }, "image/png");
    });
    const log = {
      exportId: model.exportId,
      capturedAt: model.capturedAt,
      filename: model.filename,
      datasetId: state.datasetId,
      datasetLabel: model.datasetLabel,
      window: { ...model.view.window },
      filters: {
        direction: model.direction,
        grades: model.grades,
        rawDirection: state.direction,
        rawGrades: [...state.grades],
      },
      values: model.values,
      dataVersion: model.view.dataVersion,
      dataHash: model.view.dataHash,
      viewRevision: model.view.viewRevision,
      selectedRoadId: model.selectedRoad?.id ?? null,
      closedRoads: model.view.closures.map((closure) => closure.roadId),
      routeRoads: model.route?.roadIds ?? [],
      image: { width: canvas.width, height: canvas.height, mime: "image/png" },
    };
    exportLogs.unshift(log);
    exportLogs = exportLogs.slice(0, 30);
    persistExportLogs();
    downloadBlob(blob, model.filename);
    renderLastExport();
    renderLogsModal();
    showToast(
      `已导出 PNG · <strong>${model.values.speed}</strong> km/h · <strong>${model.values.queue}</strong> m · <strong>${model.values.hotspots}</strong> 处热点`,
    );
  } catch (error) {
    console.error(error);
    showToast("导出失败，请重试或检查浏览器下载权限");
  } finally {
    button.disabled = false;
    button.innerHTML = original;
  }
}

function downloadExportLog() {
  const payload = {
    generatedAt: new Date().toISOString(),
    dataVersion: currentView.dataVersion,
    summary: currentView.datasetSummary,
    currentFilter: {
      window: currentView.window.label,
      direction: directionMeta().label,
      grades: gradeLabels(),
      dataset: datasetMeta().label,
    },
    logs: exportLogs,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  downloadBlob(blob, `road-congestion_export-log_${Date.now()}.json`);
  showToast(`已下载 ${exportLogs.length} 条导出日志`);
}

function setupExportEvents() {
  $("#exportBtn").addEventListener("click", exportCurrentView);
  $("#downloadLogBtn").addEventListener("click", downloadExportLog);
}

function setupResize() {
  const observer = new ResizeObserver(() => {
    scheduleMap();
    scheduleChart();
  });
  observer.observe(elements.mapCanvas);
  observer.observe(elements.chartCanvas);
}

function init() {
  renderStaticControls();
  selfChecks = runSelfChecks();
  renderSelfChecks();
  computeCurrent();
  renderAll();
  setupFilterEvents();
  setupMapEvents();
  setupChartEvents();
  setupListEvents();
  setupModalEvents();
  setupExportEvents();
  setupResize();
  renderLogsModal();

  const sandbox = getPreparedDataset(state.datasetId);
  console.info("[traffic-heatmap] ready", {
    dataVersion: sandbox.summary.version,
    dataHash: sandbox.summary.dataHash,
    rows: sandbox.summary.finalRows,
    checks: `${selfChecks.passed}/${selfChecks.total}`,
  });
}

init();
