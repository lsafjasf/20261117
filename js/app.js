import {
  AIRLINES,
  WINDOWS,
  SCENARIOS,
  buildSnapshot,
  filterFlights,
  formatFlightTime,
  formatWindow,
  getScenario,
  processFlights,
} from "./data.js";
import { drawRouteMap, getDelayBand, hitTestRoutes } from "./map.js";
import { DEFAULT_MAP_VIEW, WindowStateStore, normalizeMapView } from "./state.js";
import { drawTrendChart } from "./trend.js";
import {
  buildExportModel,
  canvasToBlob,
  composeExportCanvas,
  makeExportFilename,
} from "./export.js";
import { runValidationTests } from "./validation.js";

const allAirlineCodes = Object.keys(AIRLINES);
const windowState = new WindowStateStore();
const airlineColors = {
  CA: "#f26479",
  MU: "#59d7e8",
  CZ: "#7fca6b",
  HU: "#f2b84b",
  "3U": "#9a8df5",
};

const appState = {
  scenarioId: "normal",
  windowId: "morning",
  airlines: [...allAirlineCodes],
  selectedRouteKey: null,
  mapView: { ...DEFAULT_MAP_VIEW },
  snapshot: null,
  mapGeometry: null,
  hoveredRouteKey: null,
  exportCount: 0,
  exportEntries: [],
};

const elements = {
  scenarioSelect: document.querySelector("#scenarioSelect"),
  scenarioNote: document.querySelector("#scenarioNote"),
  airlineFilter: document.querySelector("#airlineFilter"),
  selectAllAirlines: document.querySelector("#selectAllAirlines"),
  clearAirlines: document.querySelector("#clearAirlines"),
  windowTabs: document.querySelector("#windowTabs"),
  windowStateNote: document.querySelector("#windowStateNote"),
  currentFilters: document.querySelector("#currentFilters"),
  filterResultCount: document.querySelector("#filterResultCount"),
  filterSentence: document.querySelector("#filterSentence"),
  dataVersion: document.querySelector("#dataVersion"),
  snapshotTime: document.querySelector("#snapshotTime"),
  footerVersion: document.querySelector("#footerVersion"),
  kpiFlights: document.querySelector("#kpiFlights"),
  kpiRoutes: document.querySelector("#kpiRoutes"),
  kpiDelay: document.querySelector("#kpiDelay"),
  kpiCancel: document.querySelector("#kpiCancel"),
  kpiCancelMeta: document.querySelector("#kpiCancelMeta"),
  qualityBadge: document.querySelector("#qualityBadge"),
  sumSource: document.querySelector("#sumSource"),
  sumAccepted: document.querySelector("#sumAccepted"),
  sumDuplicates: document.querySelector("#sumDuplicates"),
  sumMissing: document.querySelector("#sumMissing"),
  sumInvalid: document.querySelector("#sumInvalid"),
  sumCancelled: document.querySelector("#sumCancelled"),
  sumCoverage: document.querySelector("#sumCoverage"),
  validationToggle: document.querySelector("#validationToggle"),
  validationList: document.querySelector("#validationList"),
  mapCanvas: document.querySelector("#mapCanvas"),
  mapTooltip: document.querySelector("#mapTooltip"),
  mapEmpty: document.querySelector("#mapEmpty"),
  mapScale: document.querySelector("#mapScale"),
  selectedRoutePill: document.querySelector("#selectedRoutePill"),
  resetMapBtn: document.querySelector("#resetMapBtn"),
  flightTitle: document.querySelector("#flightTitle"),
  flightPanelMeta: document.querySelector("#flightPanelMeta"),
  flightPanelBody: document.querySelector("#flightPanelBody"),
  backToRoutes: document.querySelector("#backToRoutes"),
  trendCanvas: document.querySelector("#trendCanvas"),
  exportBtn: document.querySelector("#exportBtn"),
  exportStatus: document.querySelector("#exportStatus"),
  exportSnapshotValue: document.querySelector("#exportSnapshotValue"),
  exportCheckValue: document.querySelector("#exportCheckValue"),
  exportLog: document.querySelector("#exportLog"),
  syncState: document.querySelector("#syncState"),
  toast: document.querySelector("#toast"),
};

let toastTimer = null;
let renderFrame = null;
let hasDragged = false;
let dragStart = null;
let pointerStart = null;

function escapeText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatDelay(value, digits = 1) {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

function formatPercent(value) {
  return value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(1)}%`;
}

function setMetric(element, value, unit = "") {
  element.replaceChildren(document.createTextNode(String(value)));
  if (unit) {
    const span = document.createElement("span");
    span.className = "unit";
    span.textContent = unit;
    element.append(span);
  }
}

function showToast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", isError);
  elements.toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("show"), 3600);
}

function flashSync() {
  elements.syncState.classList.remove("flash");
  void elements.syncState.offsetWidth;
  elements.syncState.classList.add("flash");
}

function saveCurrentWindowState() {
  windowState.save(appState.scenarioId, appState.windowId, {
    airlines: appState.airlines,
    selectedRouteKey: appState.selectedRouteKey,
    mapView: appState.mapView,
  });
}

function restoreWindowState(scenarioId, windowId) {
  return windowState.load(scenarioId, windowId, {
    airlines: [...allAirlineCodes],
    selectedRouteKey: null,
    mapView: DEFAULT_MAP_VIEW,
  });
}

function airlineLabel(codes) {
  if (!codes.length) return "未选择航司";
  return codes.map((code) => AIRLINES[code]?.short ?? code).join("、");
}

function routeLabel(route) {
  return `${route.origin} → ${route.destination}`;
}

function getWindowAirlineCounts() {
  const processed = processFlights(getScenario(appState.scenarioId).flights);
  const window = WINDOWS.find((item) => item.id === appState.windowId) ?? WINDOWS[0];
  const flights = filterFlights(processed.flights, {
    airlines: allAirlineCodes,
    start: window.start,
    end: window.end,
  });
  const counts = new Map(allAirlineCodes.map((code) => [code, 0]));
  flights.forEach((flight) => counts.set(flight.airline, (counts.get(flight.airline) ?? 0) + 1));
  return counts;
}

function renderWindowTabs() {
  elements.windowTabs.replaceChildren();
  for (const windowItem of WINDOWS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `window-tab${windowItem.id === appState.windowId ? " active" : ""}`;
    button.dataset.windowId = windowItem.id;
    button.setAttribute("aria-pressed", String(windowItem.id === appState.windowId));
    button.innerHTML = `<strong>${escapeText(windowItem.label)}</strong><small>${escapeText(windowItem.range)}</small>`;
    button.addEventListener("click", () => switchTimeWindow(windowItem.id));
    elements.windowTabs.append(button);
  }
  const remembered = WINDOWS.filter((item) => windowState.has(appState.scenarioId, item.id)).length;
  elements.windowStateNote.innerHTML = `
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3a7 7 0 1 0 7 7m-7-3v3l2.2 1.5M14.5 3.5v4h-4" /></svg>
    当前窗口已记忆航司、选中航线与地图范围 · ${remembered}/${WINDOWS.length} 个窗口有记录
  `;
}

function renderAirlines() {
  const counts = getWindowAirlineCounts();
  elements.airlineFilter.replaceChildren();
  for (const code of allAirlineCodes) {
    const airline = AIRLINES[code];
    const label = document.createElement("label");
    label.className = "airline-option";
    label.innerHTML = `
      <input type="checkbox" value="${escapeText(code)}" ${appState.airlines.includes(code) ? "checked" : ""} />
      <span class="checkmark" aria-hidden="true"></span>
      <span class="airline-dot" style="--airline-color:${airlineColors[code]}"></span>
      <span class="airline-name">${escapeText(airline.name)}</span>
      <span class="airline-count">${counts.get(code) ?? 0}</span>
    `;
    const input = label.querySelector("input");
    input.addEventListener("change", () => {
      const selected = new Set(appState.airlines);
      if (input.checked) selected.add(code);
      else selected.delete(code);
      appState.airlines = allAirlineCodes.filter((airlineCode) => selected.has(airlineCode));
      saveCurrentWindowState();
      renderAll({ rebuild: true });
    });
    elements.airlineFilter.append(label);
  }
}

function renderCurrentFilters() {
  const snapshot = appState.snapshot;
  const chips = [
    `场景 · ${snapshot.scenarioLabel}`,
    `时段 · ${formatWindow(snapshot.window)}`,
    `航司 · ${airlineLabel(appState.airlines)}`,
    `口径 · 延误 > 15 分`,
    `数据 · ${snapshot.dataVersion}`,
  ];
  elements.currentFilters.replaceChildren(
    ...chips.map((text) => {
      const chip = document.createElement("span");
      chip.className = "filter-chip";
      chip.textContent = text;
      return chip;
    }),
  );
  elements.filterResultCount.textContent = `${snapshot.summary.flights} 班 / ${snapshot.summary.routes} 航线`;
  elements.filterSentence.textContent = `${snapshot.date} · ${snapshot.window.label} ${formatWindow(snapshot.window)} · ${appState.airlines.length} 家航司 · 所有视图使用同一快照 ${snapshot.viewVersion}`;
  elements.scenarioNote.textContent = snapshot.scenarioNote;
}

function renderKpis() {
  const summary = appState.snapshot.summary;
  setMetric(elements.kpiFlights, summary.flights, " 班");
  setMetric(elements.kpiRoutes, summary.routes, " 条");
  setMetric(elements.kpiDelay, formatDelay(summary.avgDelay), summary.avgDelay == null ? "" : " 分");
  setMetric(elements.kpiCancel, formatPercent(summary.cancelRate));
  elements.kpiCancelMeta.textContent = `${summary.cancelled} 班取消 · 非取消 ${summary.active} 班`;
}

function renderDataSummary() {
  const snapshot = appState.snapshot;
  const quality = snapshot.quality;
  elements.sumSource.textContent = quality.sourceRows;
  elements.sumAccepted.textContent = quality.accepted;
  elements.sumDuplicates.textContent = quality.duplicatesRemoved;
  elements.sumMissing.textContent = quality.repairedMissing;
  elements.sumInvalid.textContent = quality.repairedInvalid;
  elements.sumCancelled.textContent = quality.cancellationCount;
  elements.sumCoverage.textContent = `${quality.dateFrom} → ${quality.dateTo}`;
  [elements.sumDuplicates, elements.sumMissing, elements.sumInvalid].forEach((element) => {
    element.classList.toggle("has-value", Number(element.textContent) > 0);
  });

  const repairs = quality.repairedMissing + quality.repairedInvalid + quality.duplicatesRemoved;
  elements.qualityBadge.textContent = repairs
    ? `已修复 ${repairs} 处`
    : "数据完整";
  elements.qualityBadge.classList.toggle("good", repairs === 0);
  elements.qualityBadge.classList.toggle("warn", repairs > 0);
}

function selectRoute(routeKey) {
  appState.selectedRouteKey = appState.selectedRouteKey === routeKey ? null : routeKey;
  saveCurrentWindowState();
  renderFlightPanel();
  renderMap();
  updateExportReadiness();
  flashSync();
}

function renderFlightPanel() {
  const snapshot = appState.snapshot;
  const selectedRoute = snapshot.routes.find((route) => route.key === appState.selectedRouteKey);
  elements.backToRoutes.hidden = !selectedRoute;

  if (!snapshot.flights.length) {
    elements.flightTitle.textContent = "航线与航班";
    elements.flightPanelMeta.textContent = "当前筛选 0 班";
    elements.flightPanelBody.innerHTML = `
      <div class="flight-empty">
        <span>◎</span>
        <b>没有匹配的航班</b>
        <small>这是有效的空结果；调整航司或时段后，地图、曲线、列表与导出会同步恢复。</small>
      </div>
    `;
    return;
  }

  if (selectedRoute) {
    elements.flightTitle.textContent = routeLabel(selectedRoute);
    elements.flightPanelMeta.textContent = `${selectedRoute.count} 班 · ${selectedRoute.cancelledCount} 班取消 · ${selectedRoute.avgDelay == null ? "无有效延误" : `平均延误 ${formatDelay(selectedRoute.avgDelay)} 分`}`;
    elements.flightPanelBody.replaceChildren();
    const fragment = document.createDocumentFragment();
    for (const flight of selectedRoute.flights) {
      const item = document.createElement("article");
      item.className = "flight-item";
      const times = formatFlightTime(flight);
      const statusClass = flight.cancelled ? "cancelled" : flight.delayMinFinal > 15 ? "delayed" : "ok";
      const statusLabel = flight.cancelled ? "取消" : flight.delayMinFinal > 15 ? "延误" : "准点";
      const delayColor = getDelayBand(flight.delayMinFinal).color;
      const imputed = flight.delaySource.startsWith("imputed")
        ? '<span class="imputed-tag">已补缺</span>'
        : "";
      item.innerHTML = `
        <div class="flight-top">
          <span class="flight-number">${escapeText(flight.flightNo)}</span>
          <span class="flight-status ${statusClass}">${statusLabel}</span>
        </div>
        <div class="flight-detail-row">
          <span>${escapeText(AIRLINES[flight.airline]?.name ?? flight.airline)} · ${escapeText(flight.origin)} → ${escapeText(flight.destination)}</span>
          <b>${escapeText(times.scheduled)} / ${escapeText(times.actual)}</b>
          <span class="flight-delay" style="--delay-color:${delayColor}">
            ${flight.cancelled ? "取消" : `${formatDelay(flight.delayMinFinal, 0)} min`}${imputed}
          </span>
        </div>
      `;
      fragment.append(item);
    }
    elements.flightPanelBody.append(fragment);
    return;
  }

  elements.flightTitle.textContent = "航线与航班";
  elements.flightPanelMeta.textContent = `${snapshot.routes.length} 条活跃航线 · 点击航线查看具体航班`;
  elements.flightPanelBody.replaceChildren();
  const fragment = document.createDocumentFragment();
  const maxCount = Math.max(...snapshot.routes.map((route) => route.count), 1);
  for (const route of snapshot.routes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "route-row";
    const color = getDelayBand(route.avgDelay).color;
    button.style.setProperty("--delay-color", color);
    button.innerHTML = `
      <span class="route-name">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 14.5 9 6l1.3 6.4L17 14l-4.5 1L10 18l-1.4-2.8L3 14.5Z"/></svg>
        ${escapeText(route.origin)} → ${escapeText(route.destination)}
      </span>
      <span class="route-metric">${formatDelay(route.avgDelay)}<small>min</small></span>
      <span class="route-sub">
        <span>${route.count} 班</span>
        <span>${route.cancelledCount} 取消</span>
      </span>
      <span class="route-sub">${route.activeCount} 有效 · 准点 ${route.onTimeCount}</span>
      <span class="route-bar" style="grid-column:1/-1"><i style="width:${Math.max(8, (route.count / maxCount) * 100)}%"></i></span>
    `;
    button.addEventListener("click", () => selectRoute(route.key));
    fragment.append(button);
  }
  elements.flightPanelBody.append(fragment);
}

function renderMap() {
  if (!appState.snapshot) return;
  appState.mapGeometry = drawRouteMap(elements.mapCanvas, appState.snapshot, {
    selectedRouteKey: appState.selectedRouteKey,
    hoveredRouteKey: appState.hoveredRouteKey,
    mapView: appState.mapView,
  });
  const hasFlights = appState.snapshot.flights.length > 0;
  elements.mapEmpty.hidden = hasFlights;
  elements.mapScale.textContent = `范围 ${Math.round(appState.mapView.scale * 100)}%`;

  const selected = appState.snapshot.routes.find(
    (route) => route.key === appState.selectedRouteKey,
  );
  elements.selectedRoutePill.hidden = !selected;
  if (selected) {
    elements.selectedRoutePill.textContent = `${routeLabel(selected)} · ${selected.count} 班`;
  }
}

function renderChart() {
  if (!appState.snapshot) return;
  drawTrendChart(elements.trendCanvas, appState.snapshot);
}

function renderValidation() {
  const tests = runValidationTests();
  const passed = tests.filter((test) => test.pass).length;
  elements.validationList.replaceChildren();
  for (const test of tests) {
    const row = document.createElement("div");
    row.className = "validation-row";
    row.innerHTML = `
      <span class="${test.pass ? "pass" : "fail"}">${test.pass ? "✓" : "×"}</span>
      <span><b>${escapeText(test.label)}</b><small>${escapeText(test.detail)}</small></span>
      <em>${passed}/${tests.length}</em>
    `;
    elements.validationList.append(row);
  }
  const qualityBadge = elements.qualityBadge;
  if (passed === tests.length) qualityBadge.title = `数据巡检 ${passed}/${tests.length} 通过`;
}

function updateExportReadiness() {
  const snapshot = appState.snapshot;
  const model = buildExportModel(snapshot, {
    selectedRouteKey: appState.selectedRouteKey,
  });
  const checks = [
    model.summary.flights === snapshot.summary.flights,
    model.summary.routes === snapshot.summary.routes,
    model.summary.avgDelay === snapshot.summary.avgDelay,
    model.summary.cancelRate === snapshot.summary.cancelRate,
    model.routes.length === snapshot.routes.length,
    model.flights.length === snapshot.flights.length,
    model.viewVersion === snapshot.viewVersion,
  ];
  const synced = checks.every(Boolean);
  elements.exportSnapshotValue.textContent = `${snapshot.viewVersion} · ${snapshot.summary.flights} 班`;
  elements.exportCheckValue.textContent = synced ? "就绪 · 同源" : "快照不一致";
  elements.exportCheckValue.classList.toggle("good", synced);
  elements.exportStatus.textContent = appState.exportCount ? `已导出 ${appState.exportCount}` : "待导出";
  return { model, synced };
}

function renderExportLog() {
  if (!appState.exportEntries.length) {
    elements.exportLog.innerHTML = '<div class="empty-log">本次会话尚无导出记录</div>';
    return;
  }
  elements.exportLog.replaceChildren();
  for (const entry of appState.exportEntries.slice(0, 6)) {
    const row = document.createElement("article");
    row.className = "export-row";
    const time = new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(entry.at);
    row.innerHTML = `
      <div class="export-row-top">
        <b>${escapeText(entry.scenario)} · ${escapeText(entry.window)}</b>
        <time>${escapeText(time)}</time>
      </div>
      <p><strong>${entry.flights} 班 / ${entry.routes} 航线 / ${escapeText(entry.avgDelay)} / 取消率 ${escapeText(entry.cancelRate)}</strong><br />
      ${escapeText(entry.airlines)} · <span class="export-check">✓ ${escapeText(entry.check)}</span> · ${escapeText(entry.filename)}</p>
    `;
    elements.exportLog.append(row);
  }
}

async function exportCurrentView() {
  const generatedAt = new Date();
  const snapshot = appState.snapshot;
  saveCurrentWindowState();
  appState.hoveredRouteKey = null;
  elements.mapTooltip.hidden = true;
  renderMap();
  renderChart();
  const { model, synced } = updateExportReadiness();
  if (!synced) {
    showToast("导出中止：视图快照与统计数据不一致", true);
    return;
  }

  try {
    const exportCanvas = composeExportCanvas(model, {
      mapCanvas: elements.mapCanvas,
      trendCanvas: elements.trendCanvas,
    });
    const blob = await canvasToBlob(exportCanvas);
    const filename = makeExportFilename(model, generatedAt);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);

    appState.exportCount += 1;
    appState.exportEntries.unshift({
      at: generatedAt,
      scenario: snapshot.scenarioLabel,
      window: `${snapshot.window.label} ${snapshot.window.range}`,
      airlines: airlineLabel(appState.airlines),
      flights: snapshot.summary.flights,
      routes: snapshot.summary.routes,
      avgDelay: snapshot.summary.avgDelay == null ? "平均延误 —" : `平均延误 ${formatDelay(snapshot.summary.avgDelay)} 分`,
      cancelRate: formatPercent(snapshot.summary.cancelRate),
      check: `导出与屏幕一致 · ${snapshot.viewVersion}`,
      filename,
    });
    renderExportLog();
    elements.exportStatus.textContent = `已导出 ${appState.exportCount}`;
    elements.exportCheckValue.textContent = "✓ 与屏幕一致";
    elements.exportCheckValue.classList.add("good");
    showToast(`PNG 已导出 · ${snapshot.summary.flights} 班 / ${snapshot.summary.routes} 航线 · 校验一致`);
  } catch (error) {
    showToast(`导出失败：${error instanceof Error ? error.message : String(error)}`, true);
  } finally {
    renderMap();
  }
}

function renderAll() {
  const previousRoute = appState.selectedRouteKey;
  appState.snapshot = buildSnapshot({
    scenarioId: appState.scenarioId,
    windowId: appState.windowId,
    airlines: appState.airlines,
  });
  if (
    appState.selectedRouteKey &&
    !appState.snapshot.routes.some((route) => route.key === appState.selectedRouteKey)
  ) {
    appState.selectedRouteKey = null;
  }
  if (previousRoute !== appState.selectedRouteKey) {
    saveCurrentWindowState();
  }
  elements.scenarioSelect.value = appState.scenarioId;
  elements.dataVersion.textContent = appState.snapshot.viewVersion;
  elements.dataVersion.title = `数据 ${appState.snapshot.dataVersion} · 视图 ${appState.snapshot.viewVersion}`;
  elements.snapshotTime.textContent = `${appState.snapshot.date} · ${appState.snapshot.window.range} CST`;
  elements.footerVersion.textContent = `数据 ${appState.snapshot.dataVersion} · 视图 ${appState.snapshot.viewVersion}`;

  renderWindowTabs();
  renderAirlines();
  renderCurrentFilters();
  renderKpis();
  renderDataSummary();
  renderFlightPanel();
  renderMap();
  renderChart();
  updateExportReadiness();
  saveCurrentWindowState();
  renderWindowTabs();
  flashSync();
}

function switchTimeWindow(windowId) {
  if (windowId === appState.windowId) return;
  saveCurrentWindowState();
  appState.windowId = windowId;
  const restored = restoreWindowState(appState.scenarioId, windowId);
  appState.airlines = restored.airlines.filter((code) => allAirlineCodes.includes(code));
  appState.selectedRouteKey = restored.selectedRouteKey;
  appState.mapView = normalizeMapView(restored.mapView);
  appState.hoveredRouteKey = null;
  elements.mapTooltip.hidden = true;
  renderAll();
  const windowItem = WINDOWS.find((item) => item.id === windowId);
  showToast(`已切回${windowItem.label}窗口，航司、航线选择与地图范围已恢复`);
}

function switchScenario(scenarioId) {
  if (scenarioId === appState.scenarioId) return;
  saveCurrentWindowState();
  appState.scenarioId = scenarioId;
  const restored = restoreWindowState(appState.scenarioId, appState.windowId);
  appState.airlines = restored.airlines.filter((code) => allAirlineCodes.includes(code));
  appState.selectedRouteKey = restored.selectedRouteKey;
  appState.mapView = normalizeMapView(restored.mapView);
  appState.hoveredRouteKey = null;
  elements.mapTooltip.hidden = true;
  renderAll();
  showToast(`已加载${SCENARIOS[scenarioId].label}，全视图切换至新数据版本`);
}

function resetMapView() {
  appState.mapView = { ...DEFAULT_MAP_VIEW };
  appState.hoveredRouteKey = null;
  elements.mapTooltip.hidden = true;
  saveCurrentWindowState();
  renderMap();
  flashSync();
}

function canvasPoint(event) {
  const rect = elements.mapCanvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    rect,
  };
}

function hideMapTooltip() {
  elements.mapTooltip.hidden = true;
  if (appState.hoveredRouteKey) {
    appState.hoveredRouteKey = null;
    renderMap();
  }
  elements.mapCanvas.classList.remove("route-hover");
}

function showMapTooltip(route, point) {
  const frameRect = elements.mapCanvas.getBoundingClientRect();
  const band = getDelayBand(route.avgDelay);
  elements.mapTooltip.innerHTML = `
    <strong>${escapeText(route.origin)} → ${escapeText(route.destination)} <i>${escapeText(route.key)}</i></strong>
    <div><span>平均延误</span><b style="color:${band.color}">${formatDelay(route.avgDelay)} 分</b></div>
    <div><span>班次量</span><b>${route.count} 班</b></div>
    <div><span>取消</span><b>${route.cancelledCount} 班 · ${formatPercent(route.cancelRate)}</b></div>
    <div><span>有效航班</span><b>${route.activeCount} 班</b></div>
  `;
  elements.mapTooltip.hidden = false;
  const tooltipWidth = elements.mapTooltip.offsetWidth;
  const tooltipHeight = elements.mapTooltip.offsetHeight;
  const left =
    point.x + tooltipWidth + 28 > frameRect.width
      ? Math.max(6, point.x - tooltipWidth - 14)
      : point.x + 14;
  const top =
    point.y + tooltipHeight + 20 > frameRect.height
      ? Math.max(6, point.y - tooltipHeight - 10)
      : point.y + 12;
  elements.mapTooltip.style.left = `${left}px`;
  elements.mapTooltip.style.top = `${top}px`;
}

function setupMapInteractions() {
  const canvas = elements.mapCanvas;
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const point = canvasPoint(event);
    hasDragged = false;
    dragStart = {
      x: event.clientX,
      y: event.clientY,
      panX: appState.mapView.panX,
      panY: appState.mapView.panY,
    };
    pointerStart = { x: point.x, y: point.y };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("dragging");
    elements.mapTooltip.hidden = true;
  });

  canvas.addEventListener("pointermove", (event) => {
    if (dragStart) {
      const dx = event.clientX - dragStart.x;
      const dy = event.clientY - dragStart.y;
      if (Math.hypot(dx, dy) > 2) hasDragged = true;
      appState.mapView.panX = dragStart.panX + dx;
      appState.mapView.panY = dragStart.panY + dy;
      elements.mapTooltip.hidden = true;
      renderMap();
      saveCurrentWindowState();
      return;
    }

    const point = canvasPoint(event);
    const hit = hitTestRoutes(appState.mapGeometry, point);
    if (!hit) {
      if (appState.hoveredRouteKey) {
        appState.hoveredRouteKey = null;
        renderMap();
      }
      canvas.classList.remove("route-hover");
      elements.mapTooltip.hidden = true;
      return;
    }
    canvas.classList.add("route-hover");
    if (hit.key !== appState.hoveredRouteKey) {
      appState.hoveredRouteKey = hit.key;
      renderMap();
    }
    showMapTooltip(hit.route, point);
  });

  const finishPointer = (event) => {
    if (!dragStart) return;
    const point = pointerStart;
    dragStart = null;
    pointerStart = null;
    canvas.classList.remove("dragging");
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    if (!hasDragged && point) {
      const hit = hitTestRoutes(appState.mapGeometry, point);
      if (hit) selectRoute(hit.key);
    }
    hasDragged = false;
  };

  canvas.addEventListener("pointerup", finishPointer);
  canvas.addEventListener("pointercancel", finishPointer);
  canvas.addEventListener("pointerleave", () => {
    if (!dragStart) hideMapTooltip();
  });
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const point = canvasPoint(event);
      const oldScale = appState.mapView.scale;
      const direction = event.deltaY > 0 ? -1 : 1;
      const nextScale = normalizeMapView({
        ...appState.mapView,
        scale: oldScale * (direction > 0 ? 1.11 : 0.9),
      }).scale;
      if (nextScale === oldScale) return;
      const worldX = (point.x - point.rect.width / 2 - appState.mapView.panX) / oldScale;
      const worldY = (point.y - point.rect.height / 2 - appState.mapView.panY) / oldScale;
      appState.mapView.scale = nextScale;
      appState.mapView.panX = point.x - point.rect.width / 2 - worldX * nextScale;
      appState.mapView.panY = point.y - point.rect.height / 2 - worldY * nextScale;
      saveCurrentWindowState();
      renderMap();
      elements.mapTooltip.hidden = true;
    },
    { passive: false },
  );
  canvas.addEventListener("dblclick", resetMapView);
}

function setupControls() {
  elements.scenarioSelect.addEventListener("change", () => {
    switchScenario(elements.scenarioSelect.value);
  });
  elements.selectAllAirlines.addEventListener("click", () => {
    appState.airlines = [...allAirlineCodes];
    renderAll();
    showToast("已选择全部航空公司");
  });
  elements.clearAirlines.addEventListener("click", () => {
    appState.airlines = [];
    renderAll();
    showToast("已清空航司筛选，当前为空结果");
  });
  elements.backToRoutes.addEventListener("click", () => selectRoute(appState.selectedRouteKey));
  elements.resetMapBtn.addEventListener("click", resetMapView);
  elements.exportBtn.addEventListener("click", exportCurrentView);
  elements.validationToggle.addEventListener("click", () => {
    const expanded = elements.validationToggle.getAttribute("aria-expanded") !== "false";
    elements.validationToggle.setAttribute("aria-expanded", String(!expanded));
    elements.validationList.hidden = expanded;
  });
  setupMapInteractions();

  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver(() => {
      if (renderFrame) cancelAnimationFrame(renderFrame);
      renderFrame = requestAnimationFrame(() => {
        renderMap();
        renderChart();
      });
    });
    observer.observe(elements.mapCanvas);
    observer.observe(elements.trendCanvas);
  } else {
    window.addEventListener("resize", () => {
      renderMap();
      renderChart();
    });
  }
}

async function start() {
  renderValidation();
  setupControls();
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }
  renderAll();
  renderExportLog();
}

start();
