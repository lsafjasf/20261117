import {
  AREAS,
  BUCKET_MINUTES,
  DATASETS,
  DATE_LABEL,
  THRESHOLD,
  WINDOWS,
  formatTime,
  formatWindow,
  getProcessedDataset,
  getWindowRows,
  getZone
} from "./data.js";

const $ = (id) => document.getElementById(id);
const directionLabels = { all: "全部流向", in: "仅进站", out: "仅出站" };
const viewLabels = { all: "全站", entrance: "出入口", passage: "通道" };
const areaById = new Map(AREAS.map((area) => [area.id, area]));

function defaultWindowState(windowId) {
  const window = WINDOWS.find((item) => item.id === windowId);
  return {
    selectedAreas: new Set(AREAS.map((area) => area.id)),
    direction: "all",
    view: "all",
    currentTime: windowId === "0809" ? 515 : Math.max(window.start, window.start + 35)
  };
}

const state = {
  datasetId: "normal",
  windowId: "0809",
  previousWindowId: null,
  direction: "all",
  view: "all",
  selectedAreas: new Set(AREAS.map((area) => area.id)),
  currentTime: 515,
  playing: false,
  speed: 1,
  selectedInfo: null,
  windowMemory: Object.fromEntries(WINDOWS.map((item) => [item.id, defaultWindowState(item.id)]))
};

let playTimer = null;
let lastSnapshot = null;
let mapHitboxes = [];
let toastTimer = null;
const exportLogs = [];

function saveWindowMemory() {
  state.windowMemory[state.windowId] = {
    selectedAreas: new Set(state.selectedAreas),
    direction: state.direction,
    view: state.view,
    currentTime: state.currentTime
  };
}

function activeViewAreas() {
  return AREAS.filter((area) => state.view === "all" || area.type === state.view);
}

function activeAreas() {
  return activeViewAreas().filter((area) => state.selectedAreas.has(area.id));
}

function viewFactor(area) {
  return state.view === "all" || area.type === state.view;
}

function bucketForTime(time) {
  return Math.floor(time / BUCKET_MINUTES) * BUCKET_MINUTES;
}

function uniqueBuckets(rows) {
  return [...new Set(rows.map((row) => row.bucketTime))].sort((a, b) => a - b);
}

function buildSnapshot() {
  const processed = getProcessedDataset(state.datasetId);
  const window = WINDOWS.find((item) => item.id === state.windowId);
  const windowRows = getWindowRows(processed, window.id);
  const buckets = uniqueBuckets(windowRows);
  const bucketTime = buckets.includes(bucketForTime(state.currentTime))
    ? bucketForTime(state.currentTime)
    : buckets.reduce((best, value) => Math.abs(value - state.currentTime) < Math.abs(best - state.currentTime) ? value : best, buckets[0] ?? window.start);
  state.currentTime = bucketTime;
  const filteredRows = windowRows.filter((row) => {
    const area = areaById.get(row.zoneId);
    return area && viewFactor(area) && state.selectedAreas.has(area.id);
  });
  const currentRows = filteredRows.filter((row) => row.bucketTime === bucketTime);
  const hotRows = [...currentRows].sort((a, b) => b.density - a.density);

  let peakBucket = null;
  const series = buckets.map((time) => {
    const rows = filteredRows.filter((row) => row.bucketTime === time);
    const density = rows.length ? rows.reduce((sum, row) => sum + row.density, 0) / rows.length : null;
    const inflow = rows.reduce((sum, row) => sum + row.inflow, 0);
    const outflow = rows.reduce((sum, row) => sum + row.outflow, 0);
    if (density !== null && (!peakBucket || density > peakBucket.density)) peakBucket = { time, density };
    return {
      time,
      density,
      inflow,
      outflow,
      anomaly: rows.some((row) => row.density >= THRESHOLD),
      rows: rows.length
    };
  });

  const anomalyMap = new Map();
  for (const row of filteredRows.filter((item) => item.density >= THRESHOLD)) {
    const existing = anomalyMap.get(row.zoneId);
    if (!existing || row.density > existing.density) {
      anomalyMap.set(row.zoneId, {
        zoneId: row.zoneId,
        zoneName: row.zoneName,
        density: row.density,
        time: row.bucketTime,
        sampleCount: (existing?.sampleCount || 0) + 1
      });
    } else {
      existing.sampleCount += 1;
    }
  }
  const anomalies = [...anomalyMap.values()].sort((a, b) => b.density - a.density);
  const currentDensity = currentRows.length
    ? currentRows.reduce((sum, row) => sum + row.density, 0) / currentRows.length
    : null;
  const inflow = currentRows.reduce((sum, row) => sum + row.inflow, 0);
  const outflow = currentRows.reduce((sum, row) => sum + row.outflow, 0);
  const windowFlow = filteredRows.reduce((sum, row) => sum + (row.inflow + row.outflow) * BUCKET_MINUTES, 0);
  const legendMax = Math.max(8, Math.ceil(Math.max(...filteredRows.map((row) => row.density), 0)));

  return {
    processed,
    window,
    buckets,
    bucketTime,
    windowRows,
    filteredRows,
    currentRows,
    hotRows,
    anomalies,
    series,
    peakBucket,
    currentDensity,
    inflow,
    outflow,
    windowFlow,
    legendMax,
    areas: activeAreas(),
    isEmpty: !currentRows.length,
    version: processed.summary.version
  };
}

function renderDatasetControls() {
  $("datasetTabs").innerHTML = DATASETS.map((dataset) => {
    const summary = getProcessedDataset(dataset.id).summary;
    return `
      <button class="dataset-tab ${dataset.id === state.datasetId ? "active" : ""}" data-dataset="${dataset.id}" data-accent="${dataset.accent}" type="button">
        <i></i><span>${dataset.name}</span><small>${summary.uniqueRows} ROWS</small>
      </button>`;
  }).join("");

  $("datasetList").innerHTML = DATASETS.map((dataset) => {
    const summary = getProcessedDataset(dataset.id).summary;
    return `
      <button class="dataset-item ${dataset.id === state.datasetId ? "active" : ""}" data-dataset="${dataset.id}" data-accent="${dataset.accent}" type="button">
        <i></i>
        <span class="dataset-copy"><strong>${dataset.name}</strong><small>${dataset.caption}</small></span>
        <span class="dataset-meta"><b>${summary.uniqueRows}</b><small>${dataset.tag}</small></span>
      </button>`;
  }).join("");
}

function renderWindowControls() {
  $("windowOptions").innerHTML = WINDOWS.map((window) => `
    <button class="window-option ${window.id === state.windowId ? "active" : ""}" data-window="${window.id}" type="button">
      <small>${window.name}</small>
      <strong>${formatWindow(window)}</strong>
      <span>${window.end - window.start} min</span>
    </button>`).join("");
  $("windowDuration").textContent = "60 MIN";
  const previous = WINDOWS.find((window) => window.id === state.previousWindowId);
  $("restoreWindow").disabled = !previous || previous.id === state.windowId;
  $("restoreLabel").textContent = previous ? `返回 ${formatWindow(previous)}` : "返回上一窗口";
}

function renderAreaChips() {
  const areas = activeViewAreas();
  $("areaChips").innerHTML = areas.map((area) => `
    <button class="area-chip ${state.selectedAreas.has(area.id) ? "active" : ""}" data-area="${area.id}" type="button" aria-pressed="${state.selectedAreas.has(area.id)}">${area.name}</button>`).join("");
  const selected = areas.filter((area) => state.selectedAreas.has(area.id)).length;
  $("areaCount").textContent = `${selected} / ${areas.length}`;
}

function renderDirectionAndView() {
  document.querySelectorAll("#directionControl button").forEach((button) => {
    button.classList.toggle("active", button.dataset.direction === state.direction);
  });
  document.querySelectorAll("#viewControl button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.view);
  });
}

function renderFilterSummary(snapshot) {
  const visibleAreas = activeViewAreas().filter((area) => state.selectedAreas.has(area.id));
  const areaText = visibleAreas.length === 0
    ? "无区域"
    : visibleAreas.length === activeViewAreas().length
      ? `全部 ${visibleAreas.length} 区域`
      : visibleAreas.map((area) => area.name).join("、");
  $("filterChips").innerHTML = `
    <span class="summary-chip accent"><b>${snapshot.processed.dataset.name}</b></span>
    <span class="summary-chip"><b>${formatWindow(snapshot.window)}</b></span>
    <span class="summary-chip">${directionLabels[state.direction]}</span>
    <span class="summary-chip">${viewLabels[state.view]}</span>
    <span class="summary-chip">${areaText}</span>
    <span class="summary-chip">阈值 <b>${THRESHOLD.toFixed(1)}</b></span>`;
  $("summaryVersion").textContent = `#${snapshot.version}`;
}

function renderQuality(snapshot) {
  const summary = snapshot.processed.summary;
  $("qualityRaw").textContent = summary.rawRows;
  $("qualityDuplicate").textContent = summary.duplicateRows;
  $("qualityImputed").textContent = summary.imputedRows;
  $("qualityAggregated").textContent = summary.aggregatedRows;
  $("qualityGaps").textContent = `${summary.remainingGaps} 缺口残留`;
  $("qualityVersion").textContent = `#${summary.version}`;
  $("topVersion").textContent = `VER ${summary.version}`;
  $("exportLogVersion").textContent = `VER ${summary.version}`;
}

function setGauge(snapshot) {
  const density = snapshot.currentDensity;
  const gauge = $("densityGauge");
  const max = Math.max(8, snapshot.legendMax);
  const progress = density === null ? 0 : Math.min(100, (density / max) * 100);
  gauge.style.setProperty("--gauge", `${progress}%`);
  gauge.className = "density-gauge";
  if (density === null) {
    gauge.classList.add("empty");
    $("gaugeValue").textContent = "—";
    $("gaugeLabel").textContent = "无数据";
    $("gaugeScope").textContent = "筛选结果为空";
  } else {
    const hasCurrentAlert = snapshot.currentRows.some((row) => row.density >= THRESHOLD);
    if (hasCurrentAlert) gauge.classList.add("danger");
    else if (density >= THRESHOLD * 0.82) gauge.classList.add("warning");
    $("gaugeValue").textContent = density.toFixed(2);
    $("gaugeLabel").textContent = density >= THRESHOLD ? "超出预警线" : density >= THRESHOLD * 0.82 ? "接近预警线" : "处于舒适区间";
    $("gaugeScope").textContent = `${snapshot.currentRows.length} 个区域 · 5 min 均值`;
  }
}

function renderSnapshot(snapshot) {
  const currentAlerts = snapshot.currentRows.filter((row) => row.density >= THRESHOLD);
  const status = $("snapshotStatus");
  status.className = "status-pill";
  if (snapshot.isEmpty) {
    status.textContent = "空结果";
    status.classList.add("empty");
  } else if (currentAlerts.length) {
    status.textContent = "异常";
    status.classList.add("danger");
  } else if (snapshot.anomalies.length) {
    status.textContent = "关注";
    status.classList.add("warning");
  } else {
    status.textContent = "正常";
  }
  $("snapshotTime").textContent = snapshot.isEmpty ? "--:--" : formatTime(snapshot.bucketTime);
  $("snapshotZoneCount").textContent = `${snapshot.currentRows.length} 区域`;
  $("metricIn").textContent = snapshot.isEmpty ? "—" : Math.round(snapshot.inflow).toLocaleString("zh-CN");
  $("metricOut").textContent = snapshot.isEmpty ? "—" : Math.round(snapshot.outflow).toLocaleString("zh-CN");
  $("metricFlow").textContent = snapshot.isEmpty ? "—" : Math.round(snapshot.windowFlow).toLocaleString("zh-CN");
  $("metricPeak").textContent = snapshot.peakBucket ? formatTime(snapshot.peakBucket.time) : "—";
  $("metricPeakValue").textContent = snapshot.peakBucket ? `${snapshot.peakBucket.density.toFixed(2)} p/m²` : "无峰值";
  $("mapClock").textContent = snapshot.isEmpty ? "--:--" : formatTime(snapshot.bucketTime);
  $("mapDensity").innerHTML = snapshot.currentDensity === null
    ? "— <em>p/m²</em>"
    : `${snapshot.currentDensity.toFixed(2)} <em>p/m²</em>`;
  $("legendMax").textContent = snapshot.legendMax;
  $("timelineClock").textContent = snapshot.isEmpty ? formatTime(snapshot.bucketTime) : formatTime(snapshot.bucketTime);
  $("timelineCaption").textContent = snapshot.isEmpty ? "当前筛选无有效区域" : `${snapshot.currentRows.length} 区域 · 5 min 均值`;
  $("timelineWindow").textContent = `${snapshot.window.startLabel} – ${snapshot.window.endLabel}`;
  $("snapshotZoneCount").title = activeAreas().map((area) => area.name).join("、");
  setGauge(snapshot);

  const bucketIndex = snapshot.buckets.indexOf(snapshot.bucketTime);
  const slider = $("timeSlider");
  slider.max = Math.max(0, snapshot.buckets.length - 1);
  slider.value = Math.max(0, bucketIndex);
  const progress = snapshot.buckets.length > 1 ? (bucketIndex / (snapshot.buckets.length - 1)) * 100 : 0;
  slider.style.setProperty("--progress", `${progress}%`);
  $("playButton").classList.toggle("playing", state.playing);
  $("playButton").setAttribute("aria-label", state.playing ? "暂停时间轴" : "播放时间轴");
  $("speedButton").textContent = `${state.speed}×`;

  const ticks = document.querySelector(".timeline-ticks");
  const start = snapshot.window.start;
  const span = snapshot.window.end - start;
  ticks.innerHTML = Array.from({ length: 5 }, (_, index) => {
    const time = start + Math.round((span * index) / 4 / 5) * 5;
    return `<span>${formatTime(time)}</span>`;
  }).join("");

  $("chartPeak").textContent = snapshot.peakBucket ? `${snapshot.peakBucket.density.toFixed(2)} @ ${formatTime(snapshot.peakBucket.time)}` : "—";
  $("chartThreshold").textContent = THRESHOLD.toFixed(1);
  $("mapEmpty").hidden = !snapshot.isEmpty;
  $("chartEmpty").hidden = snapshot.series.some((point) => point.density !== null);
}

function renderHotspots(snapshot) {
  $("hotspotCount").textContent = snapshot.hotRows.length;
  if (!snapshot.hotRows.length) {
    $("hotspotList").innerHTML = `<div class="list-empty">当前时刻与筛选下没有可统计的热点区域</div>`;
    return;
  }
  $("hotspotList").innerHTML = snapshot.hotRows.slice(0, 4).map((row, index) => {
    const width = Math.max(4, Math.min(100, (row.density / snapshot.legendMax) * 100));
    return `
      <div class="hotspot-row ${row.density >= THRESHOLD ? "high" : ""}" title="${row.zoneName} ${row.density.toFixed(2)} p/m²">
        <span class="hotspot-rank">${String(index + 1).padStart(2, "0")}</span>
        <span class="hotspot-name"><strong>${row.zoneName}</strong><small>${row.anomaly ? "超阈值" : "采样正常"}</small></span>
        <span class="hotspot-bar"><i style="width:${width}%"></i></span>
        <span class="hotspot-value">${row.density.toFixed(2)}<small>p/m²</small></span>
      </div>`;
  }).join("");
}

function renderAnomalies(snapshot) {
  $("anomalyCount").textContent = snapshot.anomalies.length;
  $("anomalyThreshold").textContent = THRESHOLD.toFixed(1);
  if (!snapshot.anomalies.length) {
    $("anomalyList").innerHTML = `<div class="no-alert"><i>✓</i><span>窗口内无区域超过 ${THRESHOLD.toFixed(1)} p/m²</span></div>`;
    return;
  }
  $("anomalyList").innerHTML = snapshot.anomalies.map((item) => `
    <div class="anomaly-row">
      <i></i>
      <div><strong>${item.zoneName}</strong><small>峰值 ${formatTime(item.time)} · ${item.sampleCount} 个聚合时段</small></div>
      <b>${item.density.toFixed(2)}<small> p/m²</small></b>
    </div>`).join("");
}

function renderExportLog() {
  if (!exportLogs.length) {
    $("exportLog").innerHTML = `<div class="log-empty">尚未导出。文件名将包含数据版本与时间窗口。</div>`;
    return;
  }
  $("exportLog").innerHTML = exportLogs.slice(0, 4).map((entry) => `
    <div class="export-log-entry">
      <i>${entry.type}</i>
      <span title="${entry.file}">${entry.file}</span>
      <time>${entry.time}</time>
    </div>`).join("");
}

function renderAll() {
  const snapshot = buildSnapshot();
  lastSnapshot = snapshot;
  renderDatasetControls();
  renderWindowControls();
  renderDirectionAndView();
  renderAreaChips();
  renderQuality(snapshot);
  renderFilterSummary(snapshot);
  renderSnapshot(snapshot);
  renderHotspots(snapshot);
  renderAnomalies(snapshot);
  renderExportLog();
  drawMap(snapshot);
  drawTrend(snapshot);
}

function prepareCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const targetWidth = Math.round(width * dpr);
  const targetHeight = Math.round(height * dpr);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

function roundedPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function mixColor(from, to, ratio) {
  return from.map((value, index) => Math.round(value + (to[index] - value) * ratio));
}

function densityColor(value, max = 8) {
  const ratio = Math.max(0, Math.min(1, value / max));
  const stops = [
    [0, [24, 109, 96]],
    [0.38, [76, 190, 173]],
    [0.6, [149, 229, 161]],
    [0.77, [229, 224, 103]],
    [0.9, [239, 151, 67]],
    [1, [231, 70, 58]]
  ];
  for (let index = 1; index < stops.length; index += 1) {
    if (ratio <= stops[index][0]) {
      const previous = stops[index - 1];
      const next = stops[index];
      const local = (ratio - previous[0]) / (next[0] - previous[0]);
      return mixColor(previous[1], next[1], local);
    }
  }
  return stops.at(-1)[1];
}

function makeDensityField(snapshot, width, height) {
  const fieldWidth = Math.max(80, Math.round(width / 5));
  const fieldHeight = Math.max(60, Math.round(height / 5));
  const fieldCanvas = document.createElement("canvas");
  fieldCanvas.width = fieldWidth;
  fieldCanvas.height = fieldHeight;
  const fieldCtx = fieldCanvas.getContext("2d");
  const image = fieldCtx.createImageData(fieldWidth, fieldHeight);
  const rows = snapshot.currentRows;
  for (let y = 0; y < fieldHeight; y += 1) {
    for (let x = 0; x < fieldWidth; x += 1) {
      const px = x / (fieldWidth - 1);
      const py = y / (fieldHeight - 1);
      let value = 0;
      for (const row of rows) {
        const area = areaById.get(row.zoneId);
        if (!area) continue;
        const cx = area.x + area.w / 2;
        const cy = area.y + area.h / 2;
        const dx = (px - cx) / Math.max(0.11, area.w * 0.72);
        const dy = (py - cy) / Math.max(0.075, area.h * 0.9);
        const influence = row.density * Math.exp(-0.5 * (dx * dx + dy * dy));
        value = Math.max(value, influence);
      }
      const offset = (y * fieldWidth + x) * 4;
      const color = densityColor(value, snapshot.legendMax);
      const ratio = Math.min(1, value / Math.max(0.6, snapshot.legendMax));
      image.data[offset] = color[0];
      image.data[offset + 1] = color[1];
      image.data[offset + 2] = color[2];
      image.data[offset + 3] = rows.length ? Math.round(26 + ratio * 150) : 0;
    }
  }
  fieldCtx.putImageData(image, 0, 0);
  return fieldCanvas;
}

function drawArrow(ctx, startX, startY, endX, endY, color, lineWidth = 1.2) {
  const angle = Math.atan2(endY - startY, endX - startX);
  const head = 6;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX - Math.cos(angle) * 3, endY - Math.sin(angle) * 3);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(endX - Math.cos(angle - Math.PI / 6) * head, endY - Math.sin(angle - Math.PI / 6) * head);
  ctx.lineTo(endX - Math.cos(angle + Math.PI / 6) * head, endY - Math.sin(angle + Math.PI / 6) * head);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawStationPlan(ctx, width, height, snapshot, options = {}) {
  const interactive = Boolean(options.interactive);
  const padX = Math.max(18, width * 0.032);
  const padY = Math.max(14, height * 0.035);
  const plan = { x: padX, y: padY, w: width - padX * 2, h: height - padY * 2 };
  if (interactive) mapHitboxes = [];

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#0a1714");
  bg.addColorStop(0.55, "#0b1917");
  bg.addColorStop(1, "#07110f");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.fillStyle = "rgba(146, 207, 186, 0.09)";
  const dotGap = 21;
  for (let x = 10; x < width; x += dotGap) {
    for (let y = 10; y < height; y += dotGap) ctx.fillRect(x, y, 1, 1);
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(132, 230, 189, 0.08)";
  ctx.lineWidth = 1;
  ctx.strokeRect(plan.x + 0.5, plan.y + 0.5, plan.w - 1, plan.h - 1);
  ctx.restore();

  const stationX = plan.x + plan.w * 0.025;
  const stationY = plan.y + plan.h * 0.055;
  const stationW = plan.w * 0.95;
  const stationH = plan.h * 0.89;
  roundedPath(ctx, stationX, stationY, stationW, stationH, Math.min(24, stationW * 0.04));
  ctx.fillStyle = "rgba(13, 34, 29, 0.72)";
  ctx.fill();
  ctx.strokeStyle = "rgba(158, 222, 199, 0.2)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.save();
  roundedPath(ctx, stationX + 2, stationY + 2, stationW - 4, stationH - 4, Math.min(23, stationW * 0.04));
  ctx.clip();
  if (snapshot.currentRows.length) {
    const field = makeDensityField(snapshot, Math.round(stationW), Math.round(stationH));
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.94;
    ctx.drawImage(field, stationX, stationY, stationW, stationH);
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  drawStationStructure(ctx, plan, snapshot);

  ctx.save();
  const gradient = ctx.createLinearGradient(plan.x, plan.y, plan.x + plan.w, plan.y);
  gradient.addColorStop(0, "rgba(132, 230, 189, 0.35)");
  gradient.addColorStop(0.5, "rgba(132, 230, 189, 0.12)");
  gradient.addColorStop(1, "rgba(132, 230, 189, 0.35)");
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plan.x, plan.y + 5);
  ctx.lineTo(plan.x + plan.w, plan.y + 5);
  ctx.stroke();
  ctx.restore();

  return plan;
}

function areaRect(plan, area) {
  return {
    x: plan.x + area.x * plan.w,
    y: plan.y + area.y * plan.h,
    w: area.w * plan.w,
    h: area.h * plan.h
  };
}

function drawStationStructure(ctx, plan, snapshot) {
  const rowMap = new Map(snapshot.currentRows.map((row) => [row.zoneId, row]));
  const selected = new Set(snapshot.areas.map((area) => area.id));
  const visible = activeViewAreas();
  const hottest = snapshot.hotRows[0]?.zoneId;

  ctx.save();
  ctx.strokeStyle = "rgba(132, 230, 189, 0.12)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 5]);
  for (const area of AREAS.filter((item) => item.type === "entrance")) {
    const rect = areaRect(plan, area);
    const targetX = plan.x + plan.w * 0.5;
    ctx.beginPath();
    ctx.moveTo(rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.lineTo(targetX, rect.y + rect.h / 2);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "rgba(159, 230, 205, 0.24)";
  ctx.fillRect(plan.x + plan.w * 0.486, plan.y + plan.h * 0.39, 1, plan.h * 0.23);
  for (let index = 0; index < 4; index += 1) {
    const gateY = plan.y + plan.h * (0.405 + index * 0.025);
    ctx.fillStyle = "rgba(189, 238, 220, 0.17)";
    ctx.fillRect(plan.x + plan.w * 0.465, gateY, plan.w * 0.07, 2);
  }
  ctx.fillStyle = "rgba(200, 241, 226, 0.34)";
  ctx.font = "600 8px ui-monospace, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.fillText("FARE GATE", plan.x + plan.w * 0.5, plan.y + plan.h * 0.405 + 17);
  ctx.restore();

  for (const area of AREAS) {
    if (!visible.includes(area)) continue;
    const rect = areaRect(plan, area);
    const row = rowMap.get(area.id);
    const isSelected = selected.has(area.id);
    const isHot = area.id === hottest && row;
    const accent = row && row.density >= THRESHOLD ? "#ff7968" : isHot ? "#c9f78c" : "#8fe7c3";

    roundedPath(ctx, rect.x, rect.y, rect.w, rect.h, Math.min(10, rect.h * 0.16));
    ctx.fillStyle = isSelected ? "rgba(7, 19, 16, 0.34)" : "rgba(7, 19, 16, 0.12)";
    ctx.fill();
    ctx.lineWidth = isHot ? 1.8 : 1;
    ctx.strokeStyle = isSelected ? `${accent}${isHot ? "" : "55"}` : "rgba(168, 220, 202, 0.13)";
    if (!isSelected) ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    if (!isSelected) {
      ctx.fillStyle = "rgba(190, 224, 212, 0.28)";
      ctx.font = "500 9px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${area.name} · 未选择`, rect.x + rect.w / 2, rect.y + rect.h / 2 + 3);
      if (interactiveHitboxes()) mapHitboxes.push({ ...rect, area });
      continue;
    }

    if (!row) {
      ctx.fillStyle = "rgba(217, 236, 229, 0.42)";
      ctx.font = "500 9px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("无当前快照", rect.x + rect.w / 2, rect.y + rect.h / 2 + 3);
      if (interactiveHitboxes()) mapHitboxes.push({ ...rect, area });
      continue;
    }
    drawAreaReadout(ctx, rect, area, row, isHot, plan, snapshot);
    if (interactiveHitboxes()) mapHitboxes.push({ ...rect, area });
  }
}

let allowHitboxes = false;
function interactiveHitboxes() {
  return allowHitboxes;
}

function drawAreaReadout(ctx, rect, area, row, isHot, plan, snapshot) {
  const fontSize = Math.max(9, Math.min(12, rect.h * 0.22));
  const hotColor = row.density >= THRESHOLD;
  if (rect.w < 108) {
    const compactSize = Math.max(7, Math.min(9, rect.h * 0.18));
    const direction = state.direction === "in"
      ? area.inward
      : state.direction === "out"
        ? -area.inward
        : row.inflow >= row.outflow
          ? area.inward
          : -area.inward;
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.65)";
    ctx.shadowBlur = 4;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(238, 252, 246, 0.96)";
    ctx.font = `650 ${compactSize}px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif`;
    ctx.fillText(area.name, rect.x + 5, rect.y + 5);
    ctx.fillStyle = hotColor ? "#ff9b8d" : "rgba(238, 252, 246, 0.88)";
    ctx.font = `650 ${compactSize + 1}px ui-monospace, Menlo, monospace`;
    ctx.fillText(row.density.toFixed(2), rect.x + 5, rect.y + compactSize + 8);
    ctx.fillStyle = "rgba(224, 243, 235, 0.38)";
    ctx.font = `500 ${compactSize - 2}px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif`;
    ctx.fillText("p/m²", rect.x + 5, rect.y + compactSize * 2 + 10);
    const arrowY = rect.y + rect.h * 0.82;
    drawArrow(
      ctx,
      direction > 0 ? rect.x + 10 : rect.x + rect.w - 10,
      arrowY,
      direction > 0 ? rect.x + rect.w - 10 : rect.x + 10,
      arrowY,
      hotColor ? "rgba(255, 166, 148, 0.88)" : "rgba(173, 239, 211, 0.62)",
      1
    );
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.shadowColor = "rgba(0, 0, 0, 0.65)";
  ctx.shadowBlur = 5;
  ctx.fillStyle = "rgba(238, 252, 246, 0.96)";
  ctx.font = `650 ${fontSize}px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif`;
  ctx.fillText(area.name, rect.x + 8, rect.y + 7);

  ctx.textAlign = "right";
  ctx.fillStyle = hotColor ? "#ff9b8d" : "rgba(238, 252, 246, 0.9)";
  ctx.font = `650 ${fontSize}px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif`;
  ctx.fillText(`${row.density.toFixed(2)}`, rect.x + rect.w - 8, rect.y + 7);
  ctx.fillStyle = "rgba(224, 243, 235, 0.42)";
  ctx.font = `500 ${Math.max(6, fontSize * 0.58)}px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif`;
  ctx.fillText("p/m²", rect.x + rect.w - 8, rect.y + 7 + fontSize + 1);

  const direction = state.direction === "in"
    ? area.inward
    : state.direction === "out"
      ? -area.inward
      : row.inflow >= row.outflow
        ? area.inward
        : -area.inward;
  const arrowY = rect.y + rect.h * 0.69;
  const left = rect.x + 15;
  const right = rect.x + rect.w - 15;
  const startX = direction > 0 ? left : right;
  const endX = direction > 0 ? right : left;
  const arrowColor = hotColor ? "rgba(255, 166, 148, 0.88)" : isHot ? "rgba(199, 248, 135, 0.8)" : "rgba(173, 239, 211, 0.62)";
  drawArrow(ctx, startX, arrowY, endX, arrowY, arrowColor, 1.15);

  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(214, 242, 231, 0.4)";
  ctx.font = `500 ${Math.max(6, fontSize * 0.55)}px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif`;
  ctx.fillText(`进 ${Math.round(row.inflow)}`, rect.x + 8, rect.y + rect.h - 11);
  ctx.textAlign = "right";
  ctx.fillText(`出 ${Math.round(row.outflow)}`, rect.x + rect.w - 8, rect.y + rect.h - 11);
  ctx.restore();

  if (isHot) {
    ctx.save();
    ctx.fillStyle = "rgba(210, 248, 133, 0.75)";
    ctx.beginPath();
    ctx.arc(rect.x + rect.w - 6, rect.y + 6, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawMap(snapshot) {
  const canvas = $("mapCanvas");
  const { ctx, width, height } = prepareCanvas(canvas);
  allowHitboxes = true;
  drawStationPlan(ctx, width, height, snapshot, { interactive: true });
  allowHitboxes = false;

  ctx.save();
  ctx.fillStyle = "rgba(187, 229, 213, 0.3)";
  ctx.font = "600 7px ui-monospace, Menlo, monospace";
  ctx.textAlign = "left";
  ctx.fillText("DENSITY FIELD / LIVE", 18, height - 10);
  ctx.textAlign = "right";
  ctx.fillStyle = snapshot.isEmpty ? "rgba(243, 111, 86, 0.6)" : "rgba(132, 230, 189, 0.38)";
  ctx.fillText(snapshot.isEmpty ? "NO MATCHING AREA" : `SNAPSHOT ${formatTime(snapshot.bucketTime)} · ${snapshot.currentRows.length} ZONES`, width - 18, height - 10);
  ctx.restore();
}

let trendGeometry = null;

function drawTrend(snapshot) {
  const canvas = $("trendCanvas");
  const { ctx, width, height } = prepareCanvas(canvas);
  const margin = { left: width < 520 ? 28 : 38, right: 14, top: 10, bottom: 20 };
  const plot = {
    x: margin.left,
    y: margin.top,
    w: Math.max(1, width - margin.left - margin.right),
    h: Math.max(1, height - margin.top - margin.bottom)
  };
  const valid = snapshot.series.filter((point) => point.density !== null);
  const maxValue = Math.max(THRESHOLD + 0.8, ...valid.map((point) => point.density), 5.6);
  const yMax = Math.ceil(maxValue * 2) / 2;
  const xFor = (index) => plot.x + (snapshot.series.length <= 1 ? plot.w / 2 : (index / (snapshot.series.length - 1)) * plot.w);
  const yFor = (value) => plot.y + plot.h - (value / yMax) * plot.h;
  trendGeometry = { plot, snapshot, xFor };

  ctx.save();
  ctx.strokeStyle = "rgba(39, 61, 53, 0.09)";
  ctx.lineWidth = 1;
  const gridValues = [0, yMax / 2, yMax];
  for (const value of gridValues) {
    const y = yFor(value);
    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.w, y);
    ctx.stroke();
    ctx.fillStyle = "rgba(95, 112, 105, 0.62)";
    ctx.font = "500 7px ui-monospace, Menlo, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(value.toFixed(1), plot.x - 7, y);
  }

  const thresholdY = yFor(THRESHOLD);
  ctx.strokeStyle = "rgba(220, 61, 53, 0.45)";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(plot.x, thresholdY);
  ctx.lineTo(plot.x + plot.w, thresholdY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(201, 61, 50, 0.72)";
  ctx.font = "600 7px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(`预警 ${THRESHOLD.toFixed(1)}`, plot.x + plot.w, thresholdY - 6);

  const points = snapshot.series.map((point, index) => ({
    ...point,
    x: xFor(index),
    y: point.density === null ? null : yFor(point.density)
  }));
  if (points.some((point) => point.y !== null)) {
    const gradient = ctx.createLinearGradient(0, plot.y, 0, plot.y + plot.h);
    gradient.addColorStop(0, "rgba(53, 187, 143, 0.24)");
    gradient.addColorStop(1, "rgba(53, 187, 143, 0.015)");
    ctx.beginPath();
    let started = false;
    for (const point of points) {
      if (point.y === null) {
        started = false;
        continue;
      }
      if (!started) {
        ctx.moveTo(point.x, point.y);
        started = true;
      } else {
        ctx.lineTo(point.x, point.y);
      }
    }
    const last = [...points].reverse().find((point) => point.y !== null);
    const first = points.find((point) => point.y !== null);
    if (first && last) {
      ctx.lineTo(last.x, plot.y + plot.h);
      ctx.lineTo(first.x, plot.y + plot.h);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    ctx.beginPath();
    started = false;
    for (const point of points) {
      if (point.y === null) {
        started = false;
        continue;
      }
      if (!started) {
        ctx.moveTo(point.x, point.y);
        started = true;
      } else {
        ctx.lineTo(point.x, point.y);
      }
    }
    ctx.strokeStyle = "#1d9d77";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();

    for (const point of points) {
      if (point.y === null) continue;
      if (point.anomaly) {
        ctx.fillStyle = "#e14a3e";
        ctx.beginPath();
        ctx.arc(point.x, point.y, 3.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }
  }

  const currentIndex = snapshot.buckets.indexOf(snapshot.bucketTime);
  if (currentIndex >= 0) {
    const current = points[currentIndex];
    ctx.strokeStyle = "rgba(27, 73, 60, 0.26)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(current.x, plot.y);
    ctx.lineTo(current.x, plot.y + plot.h);
    ctx.stroke();
    if (current.y !== null) {
      ctx.fillStyle = "#102a22";
      ctx.beginPath();
      ctx.arc(current.x, current.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#d4f9e8";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      const label = `${current.density.toFixed(2)}`;
      ctx.font = "650 8px ui-monospace, Menlo, monospace";
      const labelWidth = ctx.measureText(label).width + 8;
      const labelX = Math.min(plot.x + plot.w - labelWidth, Math.max(plot.x, current.x - labelWidth / 2));
      const labelY = Math.max(plot.y, current.y - 18);
      ctx.fillStyle = "#102a22";
      roundedPath(ctx, labelX, labelY, labelWidth, 12, 4);
      ctx.fill();
      ctx.fillStyle = "#e5fbf1";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, labelX + labelWidth / 2, labelY + 6.5);
    }
  }

  const tickCount = Math.min(5, snapshot.buckets.length);
  for (let index = 0; index < tickCount; index += 1) {
    const seriesIndex = tickCount === 1 ? 0 : Math.round((snapshot.buckets.length - 1) * index / (tickCount - 1));
    const x = xFor(seriesIndex);
    ctx.fillStyle = "rgba(92, 108, 101, 0.62)";
    ctx.font = "500 7px ui-monospace, Menlo, monospace";
    ctx.textAlign = index === 0 ? "left" : index === tickCount - 1 ? "right" : "center";
    ctx.textBaseline = "top";
    ctx.fillText(formatTime(snapshot.buckets[seriesIndex]), x, plot.y + plot.h + 7);
  }
  ctx.restore();
}

function stopPlayback() {
  if (playTimer) window.clearTimeout(playTimer);
  playTimer = null;
  state.playing = false;
}

function schedulePlayback() {
  if (!state.playing) return;
  playTimer = window.setTimeout(() => {
    if (!state.playing) return;
    const snapshot = lastSnapshot || buildSnapshot();
    const index = snapshot.buckets.indexOf(snapshot.bucketTime);
    const next = index >= snapshot.buckets.length - 1 ? 0 : index + 1;
    state.currentTime = snapshot.buckets[next];
    renderAll();
    schedulePlayback();
  }, 900 / state.speed);
}

function togglePlayback() {
  state.playing = !state.playing;
  if (state.playing) {
    $("playButton").classList.add("playing");
    schedulePlayback();
  } else {
    stopPlayback();
    $("playButton").classList.remove("playing");
  }
  $("playButton").setAttribute("aria-label", state.playing ? "暂停时间轴" : "播放时间轴");
}

function changeWindow(windowId) {
  if (windowId === state.windowId) return;
  stopPlayback();
  saveWindowMemory();
  state.previousWindowId = state.windowId;
  state.windowId = windowId;
  const memory = state.windowMemory[windowId];
  state.selectedAreas = new Set(memory.selectedAreas);
  state.direction = memory.direction;
  state.view = memory.view;
  state.currentTime = memory.currentTime;
  renderAll();
}

function selectDataset(datasetId) {
  if (datasetId === state.datasetId) return;
  state.datasetId = datasetId;
  renderAll();
}

function toggleArea(areaId) {
  if (state.selectedAreas.has(areaId)) state.selectedAreas.delete(areaId);
  else state.selectedAreas.add(areaId);
  renderAll();
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2600);
}

function bindControls() {
  document.addEventListener("click", (event) => {
    const datasetButton = event.target.closest("[data-dataset]");
    if (datasetButton) selectDataset(datasetButton.dataset.dataset);
    const windowButton = event.target.closest("[data-window]");
    if (windowButton) changeWindow(windowButton.dataset.window);
    const directionButton = event.target.closest("[data-direction]");
    if (directionButton) {
      state.direction = directionButton.dataset.direction;
      renderAll();
    }
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) {
      state.view = viewButton.dataset.view;
      renderAll();
    }
    const areaButton = event.target.closest("[data-area]");
    if (areaButton) toggleArea(areaButton.dataset.area);
  });

  $("restoreWindow").addEventListener("click", () => {
    if (state.previousWindowId) changeWindow(state.previousWindowId);
  });
  $("selectAllAreas").addEventListener("click", () => {
    state.selectedAreas = new Set(AREAS.map((area) => area.id));
    renderAll();
  });
  $("clearAreas").addEventListener("click", () => {
    state.selectedAreas.clear();
    renderAll();
  });
  $("resetFilters").addEventListener("click", () => {
    stopPlayback();
    state.direction = "all";
    state.view = "all";
    state.selectedAreas = new Set(AREAS.map((area) => area.id));
    state.currentTime = defaultWindowState(state.windowId).currentTime;
    renderAll();
    showToast("已重置当前窗口的筛选与播放位置");
  });
  $("playButton").addEventListener("click", togglePlayback);
  $("speedButton").addEventListener("click", () => {
    state.speed = state.speed === 1 ? 2 : state.speed === 2 ? 4 : 1;
    $("speedButton").textContent = `${state.speed}×`;
    if (state.playing) {
      if (playTimer) window.clearTimeout(playTimer);
      schedulePlayback();
    }
  });
  $("timeSlider").addEventListener("input", (event) => {
    stopPlayback();
    const snapshot = lastSnapshot || buildSnapshot();
    state.currentTime = snapshot.buckets[Number(event.target.value)];
    renderAll();
  });

  const mapCanvas = $("mapCanvas");
  mapCanvas.addEventListener("mousemove", (event) => {
    const rect = mapCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hit = mapHitboxes.find((box) => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h);
    const tooltip = $("mapTooltip");
    if (!hit || !lastSnapshot) {
      tooltip.hidden = true;
      return;
    }
    const row = lastSnapshot.currentRows.find((item) => item.zoneId === hit.area.id);
    const status = !state.selectedAreas.has(hit.area.id) ? "未选择" : !row ? "无快照" : row.density >= THRESHOLD ? "超阈值" : "正常";
    tooltip.innerHTML = `
      <div class="tooltip-head"><strong>${hit.area.name}</strong><span>${status}</span></div>
      <div class="tooltip-row"><span>当前密度</span><b>${row ? `${row.density.toFixed(2)} p/m²` : "—"}</b></div>
      <div class="tooltip-row"><span>进 / 出</span><b>${row ? `${Math.round(row.inflow)} / ${Math.round(row.outflow)}` : "—"}</b></div>
      <div class="tooltip-row"><span>操作</span><b>${state.selectedAreas.has(hit.area.id) ? "点击移除筛选" : "点击加入筛选"}</b></div>`;
    const stageRect = $("mapStage").getBoundingClientRect();
    const left = Math.min(event.clientX - stageRect.left + 12, stageRect.width - 190);
    tooltip.style.left = `${Math.max(4, left)}px`;
    tooltip.style.top = `${event.clientY - stageRect.top}px`;
    tooltip.hidden = false;
  });
  mapCanvas.addEventListener("mouseleave", () => {
    $("mapTooltip").hidden = true;
  });
  mapCanvas.addEventListener("click", (event) => {
    const rect = mapCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hit = mapHitboxes.find((box) => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h);
    if (!hit) return;
    toggleArea(hit.area.id);
    showToast(`${state.selectedAreas.has(hit.area.id) ? "已加入" : "已移除"} ${hit.area.name}`);
  });

  $("trendCanvas").addEventListener("click", (event) => {
    if (!trendGeometry || !lastSnapshot) return;
    const rect = $("trendCanvas").getBoundingClientRect();
    const x = event.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, (x - trendGeometry.plot.x) / trendGeometry.plot.w));
    const index = Math.round(ratio * (lastSnapshot.buckets.length - 1));
    stopPlayback();
    state.currentTime = lastSnapshot.buckets[index];
    renderAll();
  });

  $("auditButton").addEventListener("click", openAudit);
  $("qualityDetailButton").addEventListener("click", openAudit);
  $("closeAudit").addEventListener("click", () => $("auditDialog").close());
  $("closeAuditBottom").addEventListener("click", () => $("auditDialog").close());
  $("exportPng").addEventListener("click", exportPng);
  $("exportCsv").addEventListener("click", exportCsv);
}

function evaluateScenario(processed, windowId, view, zoneIds) {
  const rows = getWindowRows(processed, windowId).filter((row) => {
    const area = areaById.get(row.zoneId);
    return area && (view === "all" || area.type === view) && zoneIds.includes(area.id);
  });
  const buckets = uniqueBuckets(rows);
  const anomalousRows = rows.filter((row) => row.density >= THRESHOLD);
  const averageDensity = rows.length ? rows.reduce((sum, row) => sum + row.density, 0) / rows.length : null;
  return { rows, buckets, anomalousRows, averageDensity };
}

function auditCheck(title, detail, passed, result) {
  return `
    <div class="audit-check ${passed ? "pass" : "fail"}">
      <i>${passed ? "✓" : "!"}</i>
      <div><strong>${title}</strong><small>${detail}</small></div>
      <em>${result}</em>
    </div>`;
}

function openAudit() {
  const current = getProcessedDataset("normal");
  const cards = DATASETS.map((dataset) => {
    const summary = getProcessedDataset(dataset.id).summary;
    const statusClass = dataset.id === "normal" ? "" : dataset.id === "missing" ? "warn" : "bad";
    return `
      <div class="audit-dataset">
        <div><h4>${dataset.name}</h4><span class="${statusClass}">${dataset.tag}</span></div>
        <dl>
          <dt>原始 / 去重</dt><dd>${summary.rawRows} / ${summary.uniqueRows}</dd>
          <dt>重复折叠</dt><dd>${summary.duplicateRows}</dd>
          <dt>缺失 / 补缺</dt><dd>${summary.missingRows} / ${summary.imputedRows}</dd>
          <dt>聚合行</dt><dd>${summary.aggregatedRows}</dd>
          <dt>异常区域</dt><dd>${summary.anomalyZones}</dd>
          <dt>版本</dt><dd>#${summary.version}</dd>
        </dl>
      </div>`;
  }).join("");

  const normalScenario = evaluateScenario(current, "0809", "passage", ["N", "M"]);
  const emptyScenario = evaluateScenario(current, "0809", "passage", []);
  const dedupePass = current.summary.duplicateRows > 0 && current.summary.uniqueRows === current.summary.expectedSamples;
  const gapPass = current.summary.imputedRows === current.summary.missingRows && current.summary.remainingGaps === 0;
  const aggregatePass = current.summary.aggregatedRows === AREAS.length * 24;
  const normalPass = normalScenario.rows.length > 0;
  const emptyPass = emptyScenario.rows.length === 0 && emptyScenario.averageDensity === null;
  const screenValue = $("gaugeValue").textContent;
  const expectedValue = lastSnapshot?.currentDensity === null || lastSnapshot?.currentDensity === undefined
    ? "—"
    : lastSnapshot.currentDensity.toFixed(2);
  const parityPass = screenValue === expectedValue && lastSnapshot?.version === getProcessedDataset(state.datasetId).summary.version;

  $("auditContent").innerHTML = `
    <div class="audit-grid">${cards}</div>
    <div class="audit-section-title"><strong>链路校验</strong><span>基于当前内置采样实时计算</span></div>
    <div class="audit-checks">
      ${auditCheck("去重校验", "键：区域 + 采样时刻；同键仅保留一条", dedupePass, `${current.summary.duplicateRows} 条重复 → ${current.summary.uniqueRows} 条唯一`)}
      ${auditCheck("补缺校验", "同区域前后邻点线性插值；边界取最近点", gapPass, `${current.summary.imputedRows} 点补全 / ${current.summary.remainingGaps} 点残留`)}
      ${auditCheck("聚合校验", "7 个区域 × 24 个 5 分钟桶", aggregatePass, `${current.summary.aggregatedRows} 行`)}
      ${auditCheck("正常筛选", "08:00–09:00 · 进站 · 通道 · 北通道 + 中央通道", normalPass, `${normalScenario.rows.length} 聚合行 · ${normalScenario.anomalousRows.length} 异常行`)}
      ${auditCheck("空结果", "同一筛选链路传入空区域集合，不绕过计算", emptyPass, `${emptyScenario.rows.length} 行 · 曲线为空 · 地图为空`)}
      ${auditCheck("屏幕 / 导出同源", "导出直接读取当前快照，不读取预设文案", parityPass, `#${lastSnapshot?.version} · ${screenValue}`)}
    </div>`;
  const dialog = $("auditDialog");
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function formatNow() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date());
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function recordExport(type, file, snapshot) {
  exportLogs.unshift({
    type,
    file,
    time: formatNow(),
    version: snapshot.version,
    rows: snapshot.currentRows.length
  });
  renderExportLog();
}

function filterFileToken(snapshot) {
  const selected = activeViewAreas().filter((area) => state.selectedAreas.has(area.id)).length;
  return snapshot.isEmpty ? "empty" : `${state.view}_${state.direction}_${selected}z`;
}

function drawExportGauge(ctx, x, y, value, max) {
  const radius = 37;
  const ratio = value === null ? 0 : Math.max(0, Math.min(1, value / Math.max(8, max)));
  ctx.save();
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#e6ece8";
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
  const color = value !== null && value >= THRESHOLD ? "#dc3d35" : value !== null && value >= THRESHOLD * 0.82 ? "#dea832" : "#1c9e72";
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(x, y, radius, -Math.PI / 2, -Math.PI / 2 + ratio * Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#13231f";
  ctx.font = "650 23px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(value === null ? "—" : value.toFixed(2), x, y - 2);
  ctx.fillStyle = "#8b9994";
  ctx.font = "500 9px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
  ctx.fillText("p/m²", x, y + 18);
  ctx.restore();
}

function drawExportTrend(ctx, x, y, width, height, snapshot) {
  roundedPath(ctx, x, y, width, height, 14);
  ctx.fillStyle = "#fbfcfa";
  ctx.fill();
  ctx.strokeStyle = "rgba(17, 33, 30, 0.1)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#152820";
  ctx.font = "650 16px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("窗口密度趋势", x + 18, y + 14);
  ctx.fillStyle = "#8a9792";
  ctx.font = "500 9px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
  ctx.fillText(`5 min 均值 · p/m² · ${formatWindow(snapshot.window)}`, x + 18, y + 37);
  const plot = { x: x + 46, y: y + 58, w: width - 68, h: height - 84 };
  const valid = snapshot.series.filter((point) => point.density !== null);
  const yMax = Math.ceil(Math.max(THRESHOLD + 0.8, ...valid.map((point) => point.density), 5.6) * 2) / 2;
  const xFor = (index) => plot.x + (snapshot.series.length <= 1 ? plot.w / 2 : index / (snapshot.series.length - 1) * plot.w);
  const yFor = (value) => plot.y + plot.h - value / yMax * plot.h;

  ctx.strokeStyle = "rgba(39, 61, 53, 0.1)";
  ctx.lineWidth = 1;
  for (const value of [0, yMax / 2, yMax]) {
    const lineY = yFor(value);
    ctx.beginPath();
    ctx.moveTo(plot.x, lineY);
    ctx.lineTo(plot.x + plot.w, lineY);
    ctx.stroke();
    ctx.fillStyle = "#85938e";
    ctx.font = "500 8px ui-monospace, Menlo, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(value.toFixed(1), plot.x - 8, lineY);
  }
  const thresholdY = yFor(THRESHOLD);
  ctx.strokeStyle = "rgba(220, 61, 53, 0.55)";
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(plot.x, thresholdY);
  ctx.lineTo(plot.x + plot.w, thresholdY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(193, 57, 48, 0.8)";
  ctx.font = "600 8px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(`预警 ${THRESHOLD.toFixed(1)}`, plot.x + plot.w, thresholdY - 7);

  if (valid.length) {
    ctx.beginPath();
    let started = false;
    snapshot.series.forEach((point, index) => {
      if (point.density === null) {
        started = false;
        return;
      }
      const px = xFor(index);
      const py = yFor(point.density);
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else {
        ctx.lineTo(px, py);
      }
    });
    ctx.strokeStyle = "#1d9d77";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();
    snapshot.series.forEach((point, index) => {
      if (point.density !== null && point.anomaly) {
        ctx.fillStyle = "#e14a3e";
        ctx.beginPath();
        ctx.arc(xFor(index), yFor(point.density), 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  const currentIndex = snapshot.buckets.indexOf(snapshot.bucketTime);
  if (currentIndex >= 0) {
    const currentX = xFor(currentIndex);
    const current = snapshot.series[currentIndex];
    ctx.strokeStyle = "rgba(25, 65, 53, 0.32)";
    ctx.beginPath();
    ctx.moveTo(currentX, plot.y);
    ctx.lineTo(currentX, plot.y + plot.h);
    ctx.stroke();
    if (current.density !== null) {
      ctx.fillStyle = "#102a22";
      ctx.beginPath();
      ctx.arc(currentX, yFor(current.density), 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#102a22";
      ctx.font = "650 9px ui-monospace, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(`${current.density.toFixed(2)}`, currentX, yFor(current.density) - 7);
    }
  }
  const tickCount = Math.min(5, snapshot.buckets.length);
  for (let index = 0; index < tickCount; index += 1) {
    const seriesIndex = tickCount === 1 ? 0 : Math.round((snapshot.buckets.length - 1) * index / (tickCount - 1));
    ctx.fillStyle = "#7c8b86";
    ctx.font = "500 8px ui-monospace, Menlo, monospace";
    ctx.textAlign = index === 0 ? "left" : index === tickCount - 1 ? "right" : "center";
    ctx.textBaseline = "top";
    ctx.fillText(formatTime(snapshot.buckets[seriesIndex]), xFor(seriesIndex), plot.y + plot.h + 8);
  }
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 2) {
  const characters = [...text];
  let line = "";
  let lineIndex = 0;
  for (let index = 0; index < characters.length; index += 1) {
    const test = line + characters[index];
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y + lineIndex * lineHeight);
      lineIndex += 1;
      line = characters[index];
      if (lineIndex >= maxLines - 1) {
        line += characters.slice(index + 1).join("");
        break;
      }
    } else {
      line = test;
    }
  }
  if (line && lineIndex < maxLines) {
    let output = line;
    while (ctx.measureText(output).width > maxWidth && output.length) output = output.slice(0, -1);
    if (output !== line) output += "…";
    ctx.fillText(output, x, y + lineIndex * lineHeight);
  }
  return y + Math.min(maxLines, lineIndex + 1) * lineHeight;
}

function buildExportCanvas(snapshot) {
  const canvas = document.createElement("canvas");
  canvas.width = 1440;
  canvas.height = 920;
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "alphabetic";

  const bg = ctx.createLinearGradient(0, 0, 1440, 920);
  bg.addColorStop(0, "#edf2ef");
  bg.addColorStop(1, "#e4ebe7");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1440, 920);

  const header = ctx.createLinearGradient(0, 0, 1440, 84);
  header.addColorStop(0, "#0b1716");
  header.addColorStop(1, "#122722");
  ctx.fillStyle = header;
  ctx.fillRect(0, 0, 1440, 84);
  ctx.fillStyle = "rgba(132, 230, 189, 0.1)";
  ctx.fillRect(24, 22, 40, 40);
  ctx.strokeStyle = "#84e6bd";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(32, 48);
  ctx.bezierCurveTo(38, 48, 39, 35, 45, 35);
  ctx.bezierCurveTo(51, 35, 52, 48, 58, 48);
  ctx.stroke();
  ctx.fillStyle = "#effaf5";
  ctx.font = "650 20px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("流序 FLOWFIELD", 78, 42);
  ctx.fillStyle = "rgba(239, 250, 245, 0.44)";
  ctx.font = "500 8px ui-monospace, Menlo, monospace";
  ctx.fillText("STATION CROWD INTELLIGENCE · DENSITY SNAPSHOT", 78, 58);

  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(239, 250, 245, 0.42)";
  ctx.font = "500 8px ui-monospace, Menlo, monospace";
  ctx.fillText("DATA VERSION", 1414, 31);
  ctx.fillStyle = "#84e6bd";
  ctx.font = "650 14px ui-monospace, Menlo, monospace";
  ctx.fillText(`#${snapshot.version}`, 1414, 50);
  ctx.fillStyle = "rgba(239, 250, 245, 0.38)";
  ctx.font = "500 8px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
  ctx.fillText(`${DATE_LABEL} · ${formatWindow(snapshot.window)} · EXPORTED ${formatNow()}`, 1414, 66);

  const mapX = 24;
  const mapY = 102;
  const mapW = 878;
  const mapH = 486;
  const shadow = ctx.createLinearGradient(0, mapY, 0, mapY + mapH);
  shadow.addColorStop(0, "rgba(8, 20, 17, 0.12)");
  shadow.addColorStop(1, "rgba(8, 20, 17, 0)");
  ctx.fillStyle = shadow;
  roundedPath(ctx, mapX + 4, mapY + 7, mapW, mapH, 16);
  ctx.fill();

  const exportMap = document.createElement("canvas");
  exportMap.width = mapW;
  exportMap.height = mapH;
  const mapCtx = exportMap.getContext("2d");
  drawStationPlan(mapCtx, mapW, mapH, snapshot, { interactive: false });
  roundedPath(ctx, mapX, mapY, mapW, mapH, 15);
  ctx.save();
  ctx.clip();
  ctx.drawImage(exportMap, mapX, mapY);
  ctx.restore();
  roundedPath(ctx, mapX, mapY, mapW, mapH, 15);
  ctx.strokeStyle = "rgba(19, 45, 37, 0.23)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "rgba(6, 18, 15, 0.72)";
  roundedPath(ctx, mapX + 14, mapY + 13, 315, 25, 6);
  ctx.fill();
  ctx.fillStyle = "rgba(222, 248, 237, 0.62)";
  ctx.font = "600 9px ui-monospace, Menlo, monospace";
  ctx.textAlign = "left";
  ctx.fillText(`B2 PLAN · ${formatTime(snapshot.bucketTime)} · ${snapshot.currentRows.length} ZONES`, mapX + 25, mapY + 29);
  const legendX = mapX + mapW - 152;
  ctx.fillStyle = "rgba(6, 18, 15, 0.72)";
  roundedPath(ctx, legendX, mapY + 13, 138, 25, 6);
  ctx.fill();
  const legend = ctx.createLinearGradient(legendX + 32, 0, legendX + 122, 0);
  legend.addColorStop(0, "#1b7666");
  legend.addColorStop(0.45, "#95e5a1");
  legend.addColorStop(0.75, "#e5e067");
  legend.addColorStop(1, "#e7463a");
  ctx.fillStyle = legend;
  ctx.fillRect(legendX + 32, mapY + 24, 90, 4);
  ctx.fillStyle = "rgba(235, 250, 244, 0.6)";
  ctx.font = "500 8px ui-monospace, Menlo, monospace";
  ctx.fillText("0", legendX + 22, mapY + 29);
  ctx.fillText(String(snapshot.legendMax), legendX + 126, mapY + 29);

  if (snapshot.isEmpty) {
    ctx.fillStyle = "rgba(5, 16, 13, 0.76)";
    roundedPath(ctx, mapX, mapY, mapW, mapH, 15);
    ctx.fill();
    ctx.fillStyle = "#a8c8bb";
    ctx.font = "650 18px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("当前筛选无区域", mapX + mapW / 2, mapY + mapH / 2);
    ctx.fillStyle = "rgba(200, 230, 218, 0.48)";
    ctx.font = "500 10px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
    ctx.fillText("地图、曲线、统计与导出均保持空结果", mapX + mapW / 2, mapY + mapH / 2 + 21);
  }

  drawExportTrend(ctx, 24, 604, 878, 292, snapshot);
  drawExportSidebar(ctx, snapshot, 918, 102, 498, 794);

  ctx.fillStyle = "#7b8984";
  ctx.font = "500 8px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`同一数据版本 #${snapshot.version} · 去重 → 补缺 → 5 min 聚合 · 统计口径：区域密度均值`, 24, 917);
  return canvas;
}

function drawExportSidebar(ctx, snapshot, x, y, width, height) {
  const pad = 20;
  roundedPath(ctx, x, y, width, height, 15);
  ctx.fillStyle = "#fbfcfa";
  ctx.fill();
  ctx.strokeStyle = "rgba(17, 33, 30, 0.11)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "#81908a";
  ctx.font = "650 8px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("LIVE SNAPSHOT / 当前快照", x + pad, y + 24);
  ctx.fillStyle = "#14261f";
  ctx.font = "650 18px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
  ctx.fillText("客流密度截面", x + pad, y + 50);

  const hasCurrentAlert = snapshot.currentRows.some((row) => row.density >= THRESHOLD);
  const status = snapshot.isEmpty ? "空结果" : hasCurrentAlert ? "异常" : snapshot.anomalies.length ? "关注" : "正常";
  const statusColor = snapshot.isEmpty ? "#697872" : hasCurrentAlert ? "#b3352c" : snapshot.anomalies.length ? "#9b670d" : "#167451";
  ctx.fillStyle = hasCurrentAlert ? "#ffe9e5" : snapshot.anomalies.length ? "#fff3d8" : "#e3f6ed";
  roundedPath(ctx, x + width - 84, y + 23, 62, 24, 12);
  ctx.fill();
  ctx.fillStyle = statusColor;
  ctx.font = "650 9px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(status, x + width - 53, y + 39);

  ctx.fillStyle = "#14261f";
  ctx.font = "580 44px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(snapshot.isEmpty ? "--:--" : formatTime(snapshot.bucketTime), x + pad, y + 88);
  ctx.fillStyle = "#8d9994";
  ctx.font = "500 9px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
  ctx.fillText(`${DATE_LABEL} · ${snapshot.currentRows.length} 区域 · ${formatWindow(snapshot.window)}`, x + pad, y + 142);

  drawExportGauge(ctx, x + 57, y + 206, snapshot.currentDensity, snapshot.legendMax);
  ctx.textAlign = "left";
  ctx.fillStyle = "#8b9994";
  ctx.font = "500 9px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
  ctx.fillText("当前筛选区域均值", x + 110, y + 184);
  ctx.fillStyle = "#192b24";
  ctx.font = "650 16px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
  ctx.fillText(
    snapshot.currentDensity === null ? "无数据" : snapshot.currentDensity >= THRESHOLD ? "超出预警线" : snapshot.currentDensity >= THRESHOLD * 0.82 ? "接近预警线" : "处于舒适区间",
    x + 110,
    y + 207
  );
  ctx.fillStyle = "#8a9792";
  ctx.font = "500 8px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
  ctx.fillText(`${snapshot.currentRows.length} 区域 · 5 min 聚合 · p/m²`, x + 110, y + 224);

  const metricY = y + 250;
  const metricW = (width - pad * 2 - 2) / 2;
  const metrics = [
    ["进站流率", snapshot.isEmpty ? "—" : Math.round(snapshot.inflow).toLocaleString("zh-CN"), "人 / min"],
    ["出站流率", snapshot.isEmpty ? "—" : Math.round(snapshot.outflow).toLocaleString("zh-CN"), "人 / min"],
    ["窗口客流", snapshot.isEmpty ? "—" : Math.round(snapshot.windowFlow).toLocaleString("zh-CN"), "人"],
    ["峰值时段", snapshot.peakBucket ? formatTime(snapshot.peakBucket.time) : "—", snapshot.peakBucket ? `${snapshot.peakBucket.density.toFixed(2)} p/m²` : "无峰值"]
  ];
  metrics.forEach((metric, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const cellX = x + pad + col * (metricW + 2);
    const cellY = metricY + row * 52;
    ctx.fillStyle = "#f7faf8";
    ctx.fillRect(cellX, cellY, metricW, 50);
    ctx.strokeStyle = "#e3e9e5";
    ctx.strokeRect(cellX + 0.5, cellY + 0.5, metricW - 1, 49);
    ctx.fillStyle = "#899691";
    ctx.font = "500 8px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(metric[0], cellX + 10, cellY + 14);
    ctx.fillStyle = "#172920";
    ctx.font = "650 15px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
    ctx.fillText(metric[1], cellX + 10, cellY + 33);
    ctx.fillStyle = "#9aa5a1";
    ctx.font = "500 7px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(metric[2], cellX + metricW - 9, cellY + 33);
  });

  const visibleAreas = activeViewAreas().filter((area) => state.selectedAreas.has(area.id));
  const areaText = visibleAreas.length === 0
    ? "无区域"
    : visibleAreas.length === activeViewAreas().length
      ? `全部 ${visibleAreas.length} 区域`
      : visibleAreas.map((area) => area.name).join("、");
  const filterText = `${snapshot.processed.dataset.name} · ${formatWindow(snapshot.window)} · ${directionLabels[state.direction]} · ${viewLabels[state.view]} · ${areaText} · 阈值 ${THRESHOLD.toFixed(1)}`;
  const filterY = y + 364;
  ctx.fillStyle = "#f2f6f3";
  roundedPath(ctx, x + pad, filterY, width - pad * 2, 72, 8);
  ctx.fill();
  ctx.fillStyle = "#71817b";
  ctx.font = "650 8px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("当前筛选", x + pad + 11, filterY + 16);
  ctx.fillStyle = "#344941";
  ctx.font = "500 9px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
  drawWrappedText(ctx, filterText, x + pad + 11, filterY + 34, width - pad * 2 - 22, 14, 2);

  const hotspotY = y + 450;
  ctx.fillStyle = "#14261f";
  ctx.font = "650 13px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("热点区域", x + pad, hotspotY);
  ctx.fillStyle = "#8b9893";
  ctx.font = "500 8px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(`${snapshot.hotRows.length} 个 · 当前时刻降序`, x + width - pad, hotspotY);
  if (!snapshot.hotRows.length) {
    ctx.fillStyle = "#97a39f";
    ctx.font = "500 9px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("无匹配热点区域", x + width / 2, hotspotY + 34);
  } else {
    snapshot.hotRows.slice(0, 4).forEach((row, index) => {
      const rowY = hotspotY + 15 + index * 31;
      if (row.density >= THRESHOLD) {
        ctx.fillStyle = "#fff5f2";
        ctx.fillRect(x + pad, rowY, width - pad * 2, 27);
      }
      ctx.fillStyle = index === 0 ? "#f8e9b8" : "#eef2ef";
      roundedPath(ctx, x + pad, rowY + 3, 20, 20, 4);
      ctx.fill();
      ctx.fillStyle = "#60716a";
      ctx.font = "650 8px ui-monospace, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillText(String(index + 1).padStart(2, "0"), x + pad + 10, rowY + 17);
      ctx.fillStyle = "#1d3028";
      ctx.font = "650 10px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(row.zoneName, x + pad + 29, rowY + 17);
      const barX = x + pad + 106;
      const barW = width - pad * 2 - 150;
      ctx.fillStyle = "#e7ece9";
      roundedPath(ctx, barX, rowY + 10, barW, 5, 3);
      ctx.fill();
      const barWidth = Math.max(3, Math.min(barW, row.density / snapshot.legendMax * barW));
      ctx.fillStyle = row.density >= THRESHOLD ? "#e75c4d" : "#36b68b";
      roundedPath(ctx, barX, rowY + 10, barWidth, 5, 3);
      ctx.fill();
      ctx.fillStyle = row.density >= THRESHOLD ? "#c33b31" : "#23443a";
      ctx.font = "650 11px ui-monospace, Menlo, monospace";
      ctx.textAlign = "right";
      ctx.fillText(row.density.toFixed(2), x + width - pad, rowY + 17);
    });
  }

  const anomalyY = y + 596;
  ctx.fillStyle = "#14261f";
  ctx.font = "650 13px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("异常密度区域", x + pad, anomalyY);
  ctx.fillStyle = "#a23a31";
  ctx.font = "500 8px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(`≥ ${THRESHOLD.toFixed(1)} p/m²`, x + width - pad, anomalyY);
  if (!snapshot.anomalies.length) {
    ctx.fillStyle = "#eff8f3";
    roundedPath(ctx, x + pad, anomalyY + 13, width - pad * 2, 38, 7);
    ctx.fill();
    ctx.fillStyle = "#4f7466";
    ctx.font = "500 9px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("窗口内无区域超过预警线", x + width / 2, anomalyY + 37);
  } else {
    snapshot.anomalies.slice(0, 3).forEach((item, index) => {
      const rowY = anomalyY + 13 + index * 33;
      ctx.fillStyle = "#fff7f4";
      roundedPath(ctx, x + pad, rowY, width - pad * 2, 29, 6);
      ctx.fill();
      ctx.strokeStyle = "#f0d5cf";
      ctx.stroke();
      ctx.fillStyle = "#e15143";
      ctx.beginPath();
      ctx.arc(x + pad + 12, rowY + 14.5, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#752c25";
      ctx.font = "650 9px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(item.zoneName, x + pad + 23, rowY + 18);
      ctx.fillStyle = "#a8807a";
      ctx.font = "500 7px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
      ctx.fillText(`峰值 ${formatTime(item.time)} · ${item.sampleCount} 时段`, x + pad + 89, rowY + 18);
      ctx.fillStyle = "#bf372e";
      ctx.font = "650 11px ui-monospace, Menlo, monospace";
      ctx.textAlign = "right";
      ctx.fillText(`${item.density.toFixed(2)} p/m²`, x + width - pad - 9, rowY + 18);
    });
  }

  ctx.strokeStyle = "#e1e7e3";
  ctx.beginPath();
  ctx.moveTo(x + pad, y + height - 52);
  ctx.lineTo(x + width - pad, y + height - 52);
  ctx.stroke();
  ctx.fillStyle = "#86938e";
  ctx.font = "500 8px Avenir Next, Segoe UI, Noto Sans SC Local, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("地图 / 曲线 / 热点 / 列表 / 导出共用同一快照", x + pad, y + height - 30);
  ctx.fillStyle = "#188562";
  ctx.font = "650 8px ui-monospace, Menlo, monospace";
  ctx.textAlign = "right";
  ctx.fillText(`DATA #${snapshot.version}`, x + width - pad, y + height - 30);
}

async function exportPng() {
  if (!lastSnapshot) return;
  const snapshot = lastSnapshot;
  const canvas = buildExportCanvas(snapshot);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) {
    showToast("PNG 生成失败，请重试");
    return;
  }
  const filename = `density_${snapshot.processed.dataset.id}_${snapshot.window.id}_${formatTime(snapshot.bucketTime).replace(":", "")}_${filterFileToken(snapshot)}_${snapshot.version}.png`;
  triggerDownload(blob, filename);
  recordExport("PNG", filename, snapshot);
  showToast(`已导出当前图与统计 · #${snapshot.version} · ${snapshot.currentRows.length} 区域`);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function exportCsv() {
  if (!lastSnapshot) return;
  const snapshot = lastSnapshot;
  const visibleAreas = activeViewAreas().filter((area) => state.selectedAreas.has(area.id));
  const areaText = visibleAreas.length
    ? visibleAreas.map((area) => area.name).join("、")
    : "无区域";
  const rows = [
    ["# 车站人流密度统计"],
    ["数据版本", `#${snapshot.version}`],
    ["数据集", snapshot.processed.dataset.name],
    ["时间窗口", formatWindow(snapshot.window)],
    ["当前时刻", snapshot.isEmpty ? "空结果" : formatTime(snapshot.bucketTime)],
    ["流向", directionLabels[state.direction]],
    ["视图", viewLabels[state.view]],
    ["区域筛选", areaText],
    ["统计口径", "去重键=区域+时刻；同区邻点线性补缺；5 分钟聚合；密度为区域均值"],
    ["异常阈值", `${THRESHOLD.toFixed(1)} p/m²`],
    [],
    ["区域", "类型", "密度(p/m²)", "进站流率(人/min)", "出站流率(人/min)", "是否异常", "时间", "数据版本"],
    ...snapshot.hotRows.map((row) => [
      row.zoneName,
      row.type === "entrance" ? "出入口" : "通道",
      row.density.toFixed(2),
      row.inflow.toFixed(1),
      row.outflow.toFixed(1),
      row.density >= THRESHOLD ? "是" : "否",
      formatTime(snapshot.bucketTime),
      snapshot.version
    ])
  ];
  const content = "\ufeff" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const filename = `density_stats_${snapshot.processed.dataset.id}_${snapshot.window.id}_${formatTime(snapshot.bucketTime).replace(":", "")}_${filterFileToken(snapshot)}_${snapshot.version}.csv`;
  triggerDownload(new Blob([content], { type: "text/csv;charset=utf-8" }), filename);
  recordExport("CSV", filename, snapshot);
  showToast(`已导出统计 CSV · #${snapshot.version} · ${snapshot.hotRows.length} 行`);
}

function init() {
  bindControls();
  renderAll();
  document.fonts.ready.then(() => renderAll());
  let resizeFrame = null;
  const observer = new ResizeObserver(() => {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      if (!lastSnapshot) return;
      drawMap(lastSnapshot);
      drawTrend(lastSnapshot);
    });
  });
  observer.observe($("mapStage"));
  observer.observe($("trendStage"));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopPlayback();
  });
  window.addEventListener("beforeunload", () => {
    observer.disconnect();
    if (playTimer) window.clearTimeout(playTimer);
  });
  window.stationDensityApp = {
    getSnapshot: () => lastSnapshot,
    getState: () => ({
      datasetId: state.datasetId,
      windowId: state.windowId,
      direction: state.direction,
      view: state.view,
      selectedAreas: [...state.selectedAreas],
      currentTime: state.currentTime,
      playing: state.playing
    }),
    buildSnapshot,
    exportPng,
    exportCsv
  };
}

init();
