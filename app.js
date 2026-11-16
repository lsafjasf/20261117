(function () {
  "use strict";

  const Lab = window.SensorLab;
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const svgNS = "http://www.w3.org/2000/svg";
  const STATUS_LABELS = { valid: "有效", imputed: "补缺", anomaly: "异常" };
  const VIEW_LABELS = { compare: "对比", raw: "原始", error: "误差" };

  const state = {
    scenario: "normal",
    filters: Lab.defaultFilters(),
    view: "compare",
    snapshot: null,
    focusedIndex: null,
    history: [],
    cache: {},
    exportLogs: [],
    exportImage: null,
    exportMeta: null,
    toastTimer: null,
    gesture: null,
    chartMetrics: null
  };
  state.cache[state.scenario] = clone(state.filters);

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function formatNumber(value, digits = 1) {
    return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "—";
  }

  function signed(value, digits = 2) {
    if (!Number.isFinite(Number(value))) return "—";
    const number = Number(value);
    return `${number > 0 ? "+" : ""}${number.toFixed(digits)}`;
  }

  function nowTime() {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(new Date());
  }

  function hashText(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
  }

  function snapshotSignature(snapshot) {
    const payload = {
      version: snapshot.version.id,
      filter: snapshot.filters,
      counts: snapshot.counts,
      stats: snapshot.stats,
      points: snapshot.points.map((point) => [point.sensorId, point.index, point.raw, point.corrected, point.error, point.status])
    };
    return hashText(JSON.stringify(payload));
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
  }

  function currentView() {
    return { scenario: state.scenario, filters: clone(state.filters) };
  }

  function pushHistory() {
    state.history.push(currentView());
    if (state.history.length > 24) state.history.shift();
    updateBackButton();
  }

  function updateBackButton() {
    const button = $("#backBtn");
    button.disabled = state.history.length === 0;
    button.style.opacity = state.history.length ? "1" : ".45";
  }

  function cacheCurrentView() {
    state.cache[state.scenario] = clone(state.filters);
  }

  function updateFilters(mutator, options = {}) {
    const before = currentView();
    mutator(state.filters);
    state.filters = Lab.normalizeFilters(state.filters);
    cacheCurrentView();
    if (options.history !== false && JSON.stringify(before.filters) !== JSON.stringify(state.filters)) {
      state.history.push(before);
      if (state.history.length > 24) state.history.shift();
      updateBackButton();
    }
    renderAll();
  }

  function switchScenario(scenario) {
    if (!Lab.DATASETS[scenario] || scenario === state.scenario) return;
    const before = currentView();
    cacheCurrentView();
    state.history.push(before);
    if (state.history.length > 24) state.history.shift();
    state.scenario = scenario;
    state.filters = state.cache[scenario] ? clone(state.cache[scenario]) : Lab.defaultFilters();
    state.focusedIndex = null;
    renderAll();
    updateBackButton();
  }

  function restorePrevious() {
    const previous = state.history.pop();
    if (!previous) return;
    cacheCurrentView();
    state.scenario = previous.scenario;
    state.filters = Lab.normalizeFilters(clone(previous.filters));
    state.focusedIndex = null;
    renderAll();
    updateBackButton();
    showToast("已恢复上一筛选视图");
  }

  function resetCurrent() {
    updateFilters((filters) => {
      const defaults = Lab.defaultFilters();
      Object.assign(filters, defaults);
    });
    state.focusedIndex = null;
    showToast("筛选条件已重置");
  }

  function renderFilterChips(snapshot) {
    const sensors = snapshot.filters.sensors;
    const chips = [];
    chips.push(`<span class="filter-chip accent"><span class="dot"></span><b>${escapeHtml(snapshot.dataset.label)}</b></span>`);
    if (sensors.length) {
      sensors.forEach((id, index) => {
        chips.push(`<span class="filter-chip sensor-${index + 1}"><span class="dot" style="color:${Lab.SENSOR_BY_ID[id].color}"></span>${escapeHtml(id)}</span>`);
      });
    } else {
      chips.push('<span class="filter-chip"><b>0 个测点</b> · 空结果</span>');
    }
    chips.push(`<span class="filter-chip">时间 <b>${escapeHtml(snapshot.filterSummary.window)}</b></span>`);
    chips.push(`<span class="filter-chip">窗口 <b>${escapeHtml(snapshot.filterSummary.calibration)}</b></span>`);
    chips.push(`<span class="filter-chip">参考 <b>${escapeHtml(snapshot.filterSummary.reference)}</b></span>`);
    chips.push(`<span class="filter-chip">状态 <b>${escapeHtml(snapshot.filterSummary.status)}</b></span>`);
    $("#filterChips").innerHTML = chips.join("");
  }

  function renderSummary(snapshot) {
    const { counts, stats, completeness, digest } = snapshot;
    $("#sampleCount").textContent = counts.all.toLocaleString("zh-CN");
    $("#sampleFoot").textContent = `有效 ${counts.valid} · 补缺 ${counts.imputed} · 异常 ${counts.anomaly}`;
    $("#completeness").innerHTML = `${formatNumber(completeness, 1)}<span>%</span>`;
    $("#qualityFoot").textContent = `${digest.uniqueCount} 条去重源记录 · 期望 ${snapshot.expectedSelected} 点`;
    $("#qualityBar").style.width = `${Math.max(0, Math.min(100, completeness))}%`;
    $("#qualityTrend").textContent = completeness >= 99 ? "● 完整" : completeness >= 90 ? "● 可接受" : "● 有缺口";
    $("#rmse").innerHTML = `${stats.rmse === null ? "—" : formatNumber(stats.rmse, 2)}<span>°C</span>`;
    $("#errorFoot").textContent = stats.count
      ? `MAE ${formatNumber(stats.mae, 2)} °C · 最大 ${formatNumber(stats.maxAbsError, 2)} °C`
      : "当前筛选无可用误差样本";
    const alertCount = counts.anomaly + counts.imputed;
    $("#anomalyCount").textContent = alertCount.toLocaleString("zh-CN");
    $("#anomalyFoot").textContent = alertCount
      ? `${counts.anomaly} 个异常尖峰 · ${counts.imputed} 个插值补缺`
      : "当前筛选没有待核查记录";
    $("#anomalyTrend").textContent = alertCount ? "需关注" : "● 清零";

    const maxBucket = Math.max(1, ...snapshot.bucketStats.map((bucket) => bucket.count));
    $("#sampleBars").innerHTML = snapshot.bucketStats
      .map((bucket) => `<i style="height:${Math.max(3, (bucket.count / maxBucket) * 25)}px"></i>`)
      .join("");
    const stripCount = 11;
    $("#anomalyStrip").innerHTML = Array.from({ length: stripCount }, (_, index) => {
      const active = index < Math.min(stripCount, alertCount);
      return `<i class="${active ? "hot" : ""}"></i>`;
    }).join("");

    const errorValues = snapshot.bucketStats.filter((bucket) => bucket.meanError !== null).map((bucket) => Math.abs(bucket.meanError));
    const maxError = Math.max(0.5, ...errorValues);
    const points = errorValues.map((value, index) => {
      const x = (index / Math.max(1, errorValues.length - 1)) * 104;
      const y = 25 - (value / maxError) * 19;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    $("#rmseSpark").innerHTML = points.length
      ? `<svg viewBox="0 0 104 28" preserveAspectRatio="none"><polyline points="${points.join(" ")}" fill="none" stroke="#54c8e8" stroke-width="1.4" opacity=".75"/></svg>`
      : "";
  }

  function renderMap(snapshot) {
    const center = { x: 220, y: 170 };
    const connections = [];
    const nodes = [];
    snapshot.allSensors.forEach((sensor) => {
      const className = sensor.selected ? "on" : "off";
      const temp = sensor.meanCorrected === null ? "—" : `${sensor.meanCorrected.toFixed(1)}°C`;
      const stateText = sensor.anomalyCount ? `${sensor.anomalyCount} 异常` : sensor.imputedCount ? `${sensor.imputedCount} 补缺` : "稳定";
      const stateColor = sensor.anomalyCount ? "#ff6f6f" : sensor.imputedCount ? "#b79cff" : "#4bd9c5";
      connections.push(`<line class="map-connection ${sensor.selected ? "" : "off"}" x1="${center.x}" y1="${center.y}" x2="${sensor.mapX}" y2="${sensor.mapY}" stroke="${sensor.color}"/>`);
      nodes.push(`
        <g class="map-node ${className}" data-sensor="${sensor.id}" transform="translate(${sensor.mapX} ${sensor.mapY})" tabindex="0" role="button" aria-label="${sensor.id} ${sensor.zone}，${sensor.selected ? "已选" : "未选"}">
          <circle class="node-hit" r="34"/>
          <circle class="node-halo" r="27" stroke="${sensor.color}" style="transform-origin:center"/>
          <circle class="node-ring" r="18" stroke="${sensor.color}"/>
          <circle class="node-core" r="12"/>
          <text class="node-label" y="-2" text-anchor="middle" fill="${sensor.color}">${sensor.id}</text>
          <text class="node-temp" y="8" text-anchor="middle">${temp}</text>
          <text class="node-state" y="34" text-anchor="middle" fill="${stateColor}">${stateText}</text>
          <circle class="selected-tick" cx="14" cy="-14" r="4" fill="${sensor.color}" stroke="#081319" stroke-width="2"/>
        </g>`);
    });
    $("#mapConnections").innerHTML = connections.join("");
    $("#mapNodes").innerHTML = nodes.join("");

    $("#sensorSwitches").innerHTML = snapshot.allSensors.map((sensor) => `
      <button class="sensor-switch ${sensor.selected ? "active" : "off"}" data-sensor="${sensor.id}" type="button" style="--sensor-color:${sensor.color}" aria-pressed="${sensor.selected}">
        <span class="sensor-dot"></span>
        <span><strong>${sensor.id}</strong><small>${sensor.selected ? `${sensor.visible.length} 点` : "未纳入"}</small></span>
        <span class="check-mark">${sensor.selected ? "✓" : "+"}</span>
      </button>`).join("");

    $("#mapVersion").textContent = snapshot.version.short;
    $("#mapLock").textContent = `同版本快照 · ${snapshot.version.short}`;
  }

  function renderChartChrome(snapshot) {
    const legend = snapshot.sensors.map((sensor) => `
      <span class="legend-item" style="--sensor-color:${sensor.color}"><i class="legend-swatch"></i>${sensor.id} 校准</span>
      <span class="legend-item" style="--sensor-color:${sensor.color}"><i class="legend-swatch raw"></i>原始</span>
    `).join("");
    $("#chartLegend").innerHTML = `${legend}<span class="legend-item"><i class="legend-swatch band"></i>误差带 ±1.96σ</span>`;
    $("#refReadout").textContent = `${snapshot.reference.toFixed(1)} °C`;
    $("#calReadout").textContent = snapshot.calibration.label;
    $("#countInvariant").textContent = `样本数锁定 · ${snapshot.invariance.beforeAdjustment} → ${snapshot.invariance.afterAdjustment}`;
    $("#headerVersion").textContent = snapshot.version.label;
    $("#digestVersion").textContent = snapshot.version.short;
    $("#footerState").textContent = `${snapshot.sensors.length} sensors · 20 s cadence · ${snapshot.window.label} · ${snapshot.version.short}`;
    $("#canvasEmpty").hidden = snapshot.points.length > 0;
  }

  function renderRecords(snapshot) {
    const body = $("#recordsBody");
    const empty = $("#tableEmpty");
    $("#resultCount").textContent = `${snapshot.tableRows.length} 条`;
    $("#listScope").textContent = `${snapshot.window.label} · ${snapshot.filterSummary.status}`;
    $("#filterFooter").textContent = `${snapshot.dataset.label} · ${snapshot.sensors.map((sensor) => sensor.id).join(" / ") || "无测点"} · 共 ${snapshot.points.length} 个采样点`;
    if (!snapshot.tableRows.length) {
      body.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    body.innerHTML = snapshot.tableRows.map((row) => {
      const deltaClass = row.error >= 0 ? "delta-pos" : "delta-neg";
      return `
        <tr data-index="${row.index}" class="${state.focusedIndex === row.index ? "focused" : ""}">
          <td><span class="record-site" style="--sensor-color:${row.sensor.color}"><i></i>${row.sensorId}<time>${row.timestamp.slice(0, 5)}</time></span></td>
          <td>${row.raw.toFixed(2)} °C</td>
          <td>${row.corrected.toFixed(2)} °C</td>
          <td class="${deltaClass}">${signed(row.error, 2)} °C</td>
          <td><span class="status-pill ${row.status}">${STATUS_LABELS[row.status]}</span></td>
          <td><span class="record-version">${snapshot.version.short} · ${row.sensorId}</span></td>
        </tr>`;
    }).join("");
  }

  function renderDigest(snapshot) {
    const digest = snapshot.digest;
    $("#digestRaw").textContent = digest.rawCount;
    $("#digestDedup").textContent = `−${digest.duplicateCount}`;
    $("#digestFilled").textContent = `+${digest.filledCount}`;
    $("#digestOutlier").textContent = digest.anomalyCount;
    $("#digestNote").textContent = `${snapshot.dataset.description}；唯一记录 ${digest.uniqueCount} / 期望 ${digest.expectedCount}，补缺后按 20 秒网格聚合并按分钟复核。`;
  }

  function renderExportLog() {
    const container = $("#exportLog");
    if (!state.exportLogs.length) {
      container.innerHTML = `
        <div class="log-empty">
          <span>⇩</span>
          <p>尚未导出。生成对比图后将在此记录筛选条件、统计值与版本指纹。</p>
        </div>`;
      return;
    }
    container.innerHTML = state.exportLogs.map((entry) => `
      <div class="log-entry">
        <div class="log-entry-top">
          <span class="log-status">✓ PNG</span>
          <strong>${entry.version}</strong>
          <time>${entry.time}</time>
        </div>
        <div class="log-detail">${escapeHtml(entry.filter)}</div>
        <div class="log-result">
          <span>${entry.points} 点 · RMSE ${entry.rmse} °C</span>
          <span class="match">屏幕值 = 导出值 · ${entry.checksum}</span>
        </div>
      </div>`).join("");
  }

  function renderControls(snapshot) {
    $$(".dataset-tab").forEach((button) => {
      const active = button.dataset.dataset === state.scenario;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    $("#windowSelect").value = state.filters.windowKey;
    $$("#statusFilter button").forEach((button) => {
      button.classList.toggle("active", button.dataset.status === state.filters.status);
    });
    $$("#viewTabs button").forEach((button) => {
      button.classList.toggle("active", button.dataset.view === state.view);
    });
  }

  function renderAll() {
    const snapshot = Lab.createSnapshot(state.scenario, state.filters);
    state.snapshot = snapshot;
    renderControls(snapshot);
    renderFilterChips(snapshot);
    renderSummary(snapshot);
    renderMap(snapshot);
    renderChartChrome(snapshot);
    renderRecords(snapshot);
    renderDigest(snapshot);
    renderExportLog();
    drawMainChart();
  }

  function toggleSensor(sensorId) {
    updateFilters((filters) => {
      if (filters.sensors.includes(sensorId)) {
        filters.sensors = filters.sensors.filter((id) => id !== sensorId);
      } else {
        filters.sensors = [...filters.sensors, sensorId];
      }
    });
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function plotGeometry(snapshot, rect, view) {
    const main = rect.w > 300;
    const margin = {
      left: main ? 49 : 26,
      right: main ? 21 : 14,
      top: 18,
      bottom: 24
    };
    const inner = {
      x: rect.x + margin.left,
      y: rect.y + margin.top,
      w: Math.max(20, rect.w - margin.left - margin.right),
      h: Math.max(40, rect.h - margin.top - margin.bottom)
    };
    const showValues = view !== "error";
    const showErrors = view !== "raw";
    let value = null;
    let error = null;
    if (showValues && showErrors) {
      const gap = 28;
      const topHeight = inner.h * 0.6;
      value = { x: inner.x, y: inner.y, w: inner.w, h: topHeight };
      error = { x: inner.x, y: inner.y + topHeight + gap, w: inner.w, h: inner.h - topHeight - gap };
    } else if (showValues) {
      value = { x: inner.x, y: inner.y, w: inner.w, h: inner.h };
    } else {
      error = { x: inner.x, y: inner.y, w: inner.w, h: inner.h };
    }
    return { rect, inner, value, error, showValues, showErrors };
  }

  function valueDomain(snapshot) {
    const values = [];
    snapshot.series.forEach((series) => {
      series.points.forEach((point) => {
        values.push(point.raw, point.corrected);
      });
    });
    values.push(snapshot.reference);
    if (!values.length) return { min: 60, max: 74 };
    let min = Math.min(...values);
    let max = Math.max(...values);
    const pad = Math.max(0.8, (max - min) * 0.12);
    return { min: min - pad, max: max + pad };
  }

  function errorDomain(snapshot) {
    const values = [0, 0.4];
    snapshot.series.forEach((series) => series.points.forEach((point) => values.push(point.error)));
    snapshot.errorBand.forEach((band) => values.push(band.lower, band.upper));
    let max = Math.max(...values.map((value) => Math.abs(value)));
    max = Math.max(0.6, max * 1.1);
    return { min: -max, max };
  }

  function drawPlot(ctx, snapshot, rect, options = {}) {
    const view = options.view || "compare";
    const geometry = plotGeometry(snapshot, rect, view);
    const { value: valueRect, error: errorRect } = geometry;
    const window = snapshot.window;
    const indexSpan = Math.max(1, window.end - window.start);
    const xAt = (index, plot) => plot.x + ((index - window.start) / indexSpan) * plot.w;
    const values = valueDomain(snapshot);
    const errors = errorDomain(snapshot);
    const yValue = (value) => valueRect.y + (1 - (value - values.min) / (values.max - values.min)) * valueRect.h;
    const yError = (value) => errorRect.y + (1 - (value - errors.min) / (errors.max - errors.min)) * errorRect.h;
    const xStart = xAt(snapshot.calibration.start, geometry.inner);
    const xEnd = xAt(snapshot.calibration.end, geometry.inner);
    const fontFamily = '"Ubuntu Sans", "Noto Sans SC", sans-serif';
    const monoFamily = '"Ubuntu Mono", "Noto Sans SC", monospace';
    const font = (size) => `${Math.round(size * (options.scale || 1))}px ${fontFamily}`;
    const mono = (size) => `${Math.round(size * (options.scale || 1))}px ${monoFamily}`;

    ctx.save();
    ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
    ctx.fillStyle = "#081319";
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

    ctx.fillStyle = "rgba(255,177,93,.035)";
    ctx.fillRect(xStart, geometry.inner.y, Math.max(1, xEnd - xStart), geometry.inner.h);
    ctx.strokeStyle = "rgba(255,177,93,.27)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(xStart, geometry.inner.y);
    ctx.lineTo(xStart, geometry.inner.y + geometry.inner.h);
    ctx.moveTo(xEnd, geometry.inner.y);
    ctx.lineTo(xEnd, geometry.inner.y + geometry.inner.h);
    ctx.stroke();
    ctx.setLineDash([]);

    const drawPanel = (plot, domain, formatter, showXLabels) => {
      if (!plot) return;
      ctx.fillStyle = "#071319";
      ctx.fillRect(plot.x, plot.y, plot.w, plot.h);
      ctx.strokeStyle = "#1b3038";
      ctx.lineWidth = 1;
      ctx.strokeRect(plot.x + 0.5, plot.y + 0.5, plot.w - 1, plot.h - 1);
      ctx.font = font(8);
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (let tick = 0; tick <= 4; tick += 1) {
        const y = plot.y + (plot.h / 4) * tick;
        const value = domain.max - ((domain.max - domain.min) / 4) * tick;
        ctx.strokeStyle = tick === 4 ? "#203740" : "#162a32";
        ctx.beginPath();
        ctx.moveTo(plot.x, y + 0.5);
        ctx.lineTo(plot.x + plot.w, y + 0.5);
        ctx.stroke();
        ctx.fillStyle = "#607a83";
        ctx.fillText(formatter(value), plot.x - 7, y);
      }
      const targetTicks = rect.w > 620 ? 7 : 5;
      for (let tick = 0; tick <= targetTicks; tick += 1) {
        const index = Math.round(window.start + (indexSpan / targetTicks) * tick);
        const x = xAt(index, plot);
        ctx.strokeStyle = "rgba(31, 54, 63, .58)";
        ctx.beginPath();
        ctx.moveTo(x + 0.5, plot.y);
        ctx.lineTo(x + 0.5, plot.y + plot.h);
        ctx.stroke();
        if (showXLabels && tick % (rect.w < 560 ? 2 : 1) === 0) {
          ctx.fillStyle = "#57727b";
          ctx.font = mono(8);
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillText(Lab.TIMES[index].short, x, plot.y + plot.h + 7);
        }
      }
    };

    if (valueRect) {
      drawPanel(valueRect, values, (number) => number.toFixed(1), !errorRect);
      ctx.fillStyle = options.exportMode ? "#7d969e" : "#5e7881";
      ctx.font = font(8);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText("温度 / °C", valueRect.x, Math.max(rect.y + 4, valueRect.y - 12));

      const cy = yValue(snapshot.reference);
      ctx.strokeStyle = "rgba(213, 227, 231, .68)";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(valueRect.x, cy + 0.5);
      ctx.lineTo(valueRect.x + valueRect.w, cy + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      const refX = valueRect.x + valueRect.w - 5;
      ctx.fillStyle = "#d5e3e7";
      ctx.beginPath();
      ctx.arc(refX, cy, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#081319";
      ctx.beginPath();
      ctx.arc(refX, cy, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#a8bdc4";
      ctx.font = mono(8);
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText(`Tref ${snapshot.reference.toFixed(1)}`, refX - 8, cy - 5);

      snapshot.series.forEach((series) => {
        const points = series.points.slice().sort((a, b) => a.index - b.index);
        if (points.length < 1) return;
        ctx.strokeStyle = series.color;
        ctx.lineWidth = view === "raw" ? 1.8 : 1.25;
        ctx.globalAlpha = view === "raw" ? 0.95 : 0.5;
        ctx.setLineDash(view === "compare" ? [3, 4] : []);
        ctx.beginPath();
        points.forEach((point, index) => {
          const x = xAt(point.index, valueRect);
          const y = yValue(point.raw);
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;

        if (view !== "raw") {
          ctx.strokeStyle = series.color;
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          points.forEach((point, index) => {
            const x = xAt(point.index, valueRect);
            const y = yValue(point.corrected);
            if (index === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.stroke();
          points.forEach((point) => {
            const x = xAt(point.index, valueRect);
            const y = yValue(point.corrected);
            if (point.status === "anomaly") {
              ctx.strokeStyle = "#ff6f6f";
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.arc(x, y, 4.5, 0, Math.PI * 2);
              ctx.stroke();
            } else if (point.status === "imputed") {
              ctx.save();
              ctx.translate(x, y);
              ctx.rotate(Math.PI / 4);
              ctx.fillStyle = series.color;
              ctx.fillRect(-1.6, -1.6, 3.2, 3.2);
              ctx.restore();
            } else if (point.index % 5 === 0) {
              ctx.fillStyle = series.color;
              ctx.beginPath();
              ctx.arc(x, y, 1.45, 0, Math.PI * 2);
              ctx.fill();
            }
          });
        }
      });
    }

    if (errorRect && snapshot.errorBand.length) {
      drawPanel(errorRect, errors, (number) => signed(number, 1), true);
      ctx.fillStyle = options.exportMode ? "#7d969e" : "#5e7881";
      ctx.font = font(8);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText("误差 / °C", errorRect.x, Math.max(rect.y + 4, errorRect.y - 12));

      ctx.fillStyle = "rgba(183, 156, 255, .13)";
      ctx.strokeStyle = "rgba(183, 156, 255, .32)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      snapshot.errorBand.forEach((band, index) => {
        const x = xAt(band.index, errorRect);
        const y = yError(band.upper);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      [...snapshot.errorBand].reverse().forEach((band) => {
        ctx.lineTo(xAt(band.index, errorRect), yError(band.lower));
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      const zeroY = yError(0);
      ctx.strokeStyle = "rgba(150, 170, 177, .35)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(errorRect.x, zeroY);
      ctx.lineTo(errorRect.x + errorRect.w, zeroY);
      ctx.stroke();
      ctx.setLineDash([]);

      snapshot.series.forEach((series) => {
        const points = series.points.slice().sort((a, b) => a.index - b.index);
        if (!points.length) return;
        ctx.strokeStyle = series.color;
        ctx.globalAlpha = 0.82;
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        points.forEach((point, index) => {
          const x = xAt(point.index, errorRect);
          const y = yError(point.error);
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.globalAlpha = 1;
      });
      const bandY = yError(snapshot.errorBand[snapshot.errorBand.length - 1].center);
      ctx.fillStyle = "rgba(183, 156, 255, .72)";
      ctx.font = mono(8);
      ctx.textAlign = "right";
      ctx.fillText("±1.96σ", errorRect.x + errorRect.w - 5, Math.max(errorRect.y + 4, bandY - 14));
    }

    if (state.focusedIndex !== null && state.focusedIndex >= window.start && state.focusedIndex <= window.end) {
      const focusX = xAt(state.focusedIndex, geometry.inner);
      ctx.strokeStyle = "rgba(255,177,93,.65)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(focusX, geometry.inner.y);
      ctx.lineTo(focusX, geometry.inner.y + geometry.inner.h);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.fillStyle = "rgba(255,177,93,.72)";
    ctx.font = mono(8);
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    const calLabelX = (xStart + xEnd) / 2;
    if (xEnd - xStart > 58) ctx.fillText(`CAL ${snapshot.calibration.label}`, calLabelX, geometry.inner.y - 4);
    ctx.fillStyle = "#ffb15d";
    ctx.fillRect(xStart - 1, geometry.inner.y, 2, geometry.inner.h);
    ctx.fillRect(xEnd - 1, geometry.inner.y, 2, geometry.inner.h);
    [xStart, xEnd].forEach((x) => {
      roundedRect(ctx, x - 5, geometry.inner.y + geometry.inner.h / 2 - 9, 10, 18, 3);
      ctx.fillStyle = "#ffb15d";
      ctx.fill();
      ctx.fillStyle = "#1a140d";
      ctx.fillRect(x - 1.5, geometry.inner.y + geometry.inner.h / 2 - 5, 1, 10);
      ctx.fillRect(x + 0.7, geometry.inner.y + geometry.inner.h / 2 - 5, 1, 10);
    });

    if (!snapshot.points.length) {
      ctx.fillStyle = "rgba(8,19,25,.82)";
      ctx.fillRect(geometry.inner.x, geometry.inner.y, geometry.inner.w, geometry.inner.h);
      ctx.fillStyle = "#aebfc5";
      ctx.font = font(11);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("当前筛选为空 · 无采样点", geometry.inner.x + geometry.inner.w / 2, geometry.inner.y + geometry.inner.h / 2);
    }

    ctx.fillStyle = "#415b64";
    ctx.font = mono(8);
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(`${snapshot.version.short} · screen/export shared`, geometry.inner.x + geometry.inner.w, rect.y + rect.h - 3);
    ctx.restore();

    return {
      geometry,
      xAt,
      yValue,
      values,
      errors,
      xIndex: (x, plot) => Math.round(window.start + ((x - plot.x) / plot.w) * indexSpan),
      yRef: valueRect ? yValue(snapshot.reference) : null,
      refX: valueRect ? valueRect.x + valueRect.w - 5 : null
    };
  }

  function drawMainChart() {
    const snapshot = state.snapshot;
    const canvas = $("#curveCanvas");
    if (!snapshot || !canvas) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pixelWidth = Math.round(bounds.width * dpr);
    const pixelHeight = Math.round(bounds.height * dpr);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.chartMetrics = drawPlot(ctx, snapshot, { x: 0, y: 0, w: bounds.width, h: bounds.height }, { view: state.view });
    canvas.dataset.refY = String(state.chartMetrics.yRef || "");
    canvas.dataset.valueTop = String(state.chartMetrics.geometry.value ? state.chartMetrics.geometry.value.y : "");
    canvas.dataset.calStartX = String(state.chartMetrics.xAt(snapshot.calibration.start, state.chartMetrics.geometry.inner));
    canvas.dataset.calEndX = String(state.chartMetrics.xAt(snapshot.calibration.end, state.chartMetrics.geometry.inner));
  }

  function canvasPoint(event) {
    const rect = $("#curveCanvas").getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top, rect };
  }

  function beginChartGesture(event) {
    if (!state.snapshot || !state.chartMetrics) return;
    const point = canvasPoint(event);
    const metrics = state.chartMetrics;
    const inner = metrics.geometry.inner;
    const startX = metrics.xAt(state.snapshot.calibration.start, inner);
    const endX = metrics.xAt(state.snapshot.calibration.end, inner);
    const nearChart = point.x >= inner.x - 10 && point.x <= inner.x + inner.w + 10 && point.y >= inner.y && point.y <= inner.y + inner.h;
    if (!nearChart) return;

    let type = null;
    if (Math.abs(point.x - startX) <= 9) type = "cal-start";
    else if (Math.abs(point.x - endX) <= 9) type = "cal-end";
    else if (state.view !== "error" && metrics.yRef !== null && Math.abs(point.y - metrics.yRef) <= 7) type = "reference";
    if (!type) return;

    state.gesture = {
      type,
      initial: currentView(),
      moved: false,
      pointerId: event.pointerId
    };
    event.preventDefault();
    $("#curveCanvas").setPointerCapture(event.pointerId);
  }

  function moveChartGesture(event) {
    const gesture = state.gesture;
    if (!gesture || gesture.pointerId !== event.pointerId || !state.chartMetrics) return;
    const point = canvasPoint(event);
    const metrics = state.chartMetrics;
    const window = state.snapshot.window;
    if (gesture.type === "reference") {
      const plot = metrics.geometry.value;
      if (!plot) return;
      const ratio = Math.max(0, Math.min(1, (point.y - plot.y) / plot.h));
      const value = metrics.values.max - ratio * (metrics.values.max - metrics.values.min);
      const reference = Math.round(Math.max(50, Math.min(85, value)) * 10) / 10;
      if (reference !== state.filters.reference) {
        state.filters.reference = reference;
        gesture.moved = true;
        cacheCurrentView();
        renderAll();
      }
      return;
    }

    const index = Math.max(window.start, Math.min(window.end, metrics.xIndex(point.x, metrics.geometry.inner)));
    let changed = false;
    if (gesture.type === "cal-start") {
      const next = Math.min(index, state.filters.calibration.end - 1);
      if (next !== state.filters.calibration.start) {
        state.filters.calibration.start = next;
        changed = true;
      }
    } else {
      const next = Math.max(index, state.filters.calibration.start + 1);
      if (next !== state.filters.calibration.end) {
        state.filters.calibration.end = next;
        changed = true;
      }
    }
    if (changed) {
      gesture.moved = true;
      state.filters = Lab.normalizeFilters(state.filters);
      cacheCurrentView();
      renderAll();
    }
  }

  function endChartGesture(event) {
    const gesture = state.gesture;
    if (!gesture || (event && gesture.pointerId !== event.pointerId)) return;
    if (gesture.moved) {
      state.history.push(gesture.initial);
      if (state.history.length > 24) state.history.shift();
      updateBackButton();
      if (gesture.type === "reference") {
        showToast(`参考点已设为 ${state.filters.reference.toFixed(1)} °C · 采样数不变`);
      } else {
        showToast(`校准窗口 ${state.snapshot.calibration.label} · 采样数不变`);
      }
    }
    state.gesture = null;
    if (event && event.pointerId !== undefined && $("#curveCanvas").hasPointerCapture(event.pointerId)) {
      $("#curveCanvas").releasePointerCapture(event.pointerId);
    }
  }

  function bindEvents() {
    $("#datasetTabs").addEventListener("click", (event) => {
      const button = event.target.closest("[data-dataset]");
      if (button) switchScenario(button.dataset.dataset);
    });
    $("#windowSelect").addEventListener("change", (event) => {
      updateFilters((filters) => { filters.windowKey = event.target.value; });
      showToast(`时间窗口已切换至 ${state.snapshot.window.detail}`);
    });
    $("#statusFilter").addEventListener("click", (event) => {
      const button = event.target.closest("[data-status]");
      if (!button) return;
      updateFilters((filters) => { filters.status = button.dataset.status; });
    });
    $("#viewTabs").addEventListener("click", (event) => {
      const button = event.target.closest("[data-view]");
      if (!button) return;
      state.view = button.dataset.view;
      renderControls(state.snapshot);
      drawMainChart();
    });
    $("#sensorSwitches").addEventListener("click", (event) => {
      const button = event.target.closest("[data-sensor]");
      if (button) toggleSensor(button.dataset.sensor);
    });
    $("#siteMap").addEventListener("click", (event) => {
      const node = event.target.closest("[data-sensor]");
      if (node) toggleSensor(node.dataset.sensor);
    });
    $("#siteMap").addEventListener("keydown", (event) => {
      const node = event.target.closest("[data-sensor]");
      if (node && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        toggleSensor(node.dataset.sensor);
      }
    });
    $("#recordsBody").addEventListener("click", (event) => {
      const row = event.target.closest("tr[data-index]");
      if (!row) return;
      const index = Number(row.dataset.index);
      state.focusedIndex = state.focusedIndex === index ? null : index;
      renderRecords(state.snapshot);
      drawMainChart();
      if (state.focusedIndex !== null) showToast(`已定位 ${Lab.TIMES[index].clock} 的采样点`);
    });
    $("#backBtn").addEventListener("click", restorePrevious);
    $("#resetBtn").addEventListener("click", resetCurrent);
    $$("[data-action='reset']").forEach((button) => button.addEventListener("click", resetCurrent));
    $("#clearLogBtn").addEventListener("click", () => {
      state.exportLogs = [];
      renderExportLog();
      showToast("导出日志已清空");
    });
    const canvas = $("#curveCanvas");
    canvas.addEventListener("pointerdown", beginChartGesture);
    canvas.addEventListener("pointermove", moveChartGesture);
    canvas.addEventListener("pointerup", endChartGesture);
    canvas.addEventListener("pointercancel", endChartGesture);
    canvas.addEventListener("pointerleave", (event) => {
      if (state.gesture && event.buttons === 0) endChartGesture(event);
    });
    if (window.ResizeObserver) {
      new ResizeObserver(() => drawMainChart()).observe($("#canvasWrap"));
    } else {
      window.addEventListener("resize", drawMainChart);
    }
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeExportModal();
    });
    $$("[data-close-modal]").forEach((element) => element.addEventListener("click", closeExportModal));
    $("#exportBtn").addEventListener("click", openExportPreview);
    $("#downloadBtn").addEventListener("click", downloadExport);
  }

  function drawChip(ctx, x, y, text, color, background) {
    ctx.font = '13px "Ubuntu Sans", "Noto Sans SC", sans-serif';
    const width = Math.ceil(ctx.measureText(text).width) + 24;
    roundedRect(ctx, x, y, width, 31, 15);
    ctx.fillStyle = background;
    ctx.fill();
    ctx.strokeStyle = "rgba(107, 142, 151, .28)";
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + 12, y + 16);
    return width;
  }

  function drawExportCanvas(snapshot) {
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 1120;
    const ctx = canvas.getContext("2d");
    const sans = '"Ubuntu Sans", "Noto Sans SC", sans-serif';
    const mono = '"Ubuntu Mono", "Noto Sans SC", monospace';
    const signature = snapshotSignature(snapshot);

    const background = ctx.createLinearGradient(0, 0, 1600, 1120);
    background.addColorStop(0, "#071116");
    background.addColorStop(0.55, "#09161c");
    background.addColorStop(1, "#061015");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const glow = ctx.createRadialGradient(1180, 0, 10, 1180, 0, 620);
    glow.addColorStop(0, "rgba(60, 142, 151, .16)");
    glow.addColorStop(1, "rgba(60, 142, 151, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(700, 0, 900, 780);

    ctx.fillStyle = "#ffb15d";
    ctx.fillRect(64, 49, 4, 44);
    ctx.fillStyle = "#7e949c";
    ctx.font = `12px ${mono}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("THERMAL CALIBRATION / SYNCHRONIZED EXPORT", 84, 45);
    ctx.fillStyle = "#edf5f7";
    ctx.font = `600 31px ${sans}`;
    ctx.fillText("三源热传感器 · 校准对比报告", 82, 65);
    ctx.textAlign = "right";
    ctx.fillStyle = "#4bd9c5";
    ctx.font = `14px ${mono}`;
    ctx.fillText(`${snapshot.version.label}  /  ${signature}`, 1536, 53);
    ctx.fillStyle = "#657f88";
    ctx.font = `11px ${mono}`;
    ctx.fillText(`GENERATED ${new Date().toLocaleString("zh-CN", { hour12: false })}`, 1536, 78);
    ctx.strokeStyle = "#203740";
    ctx.beginPath();
    ctx.moveTo(64, 111);
    ctx.lineTo(1536, 111);
    ctx.stroke();

    ctx.fillStyle = "#617b84";
    ctx.font = `600 11px ${sans}`;
    ctx.textAlign = "left";
    ctx.fillText("当前筛选", 64, 130);
    let chipX = 135;
    const chips = [
      [snapshot.dataset.label, "#ffc98b", "rgba(255,177,93,.07)"],
      ...snapshot.sensors.map((sensor) => [sensor.id, sensor.color, "rgba(22,42,50,.9)"]),
      [`时间 ${snapshot.filterSummary.window}`, "#b7c9ce", "rgba(22,42,50,.9)"],
      [`校准窗 ${snapshot.filterSummary.calibration}`, "#b7c9ce", "rgba(22,42,50,.9)"],
      [`参考 ${snapshot.filterSummary.reference}`, "#b7c9ce", "rgba(22,42,50,.9)"],
      [`状态 ${snapshot.filterSummary.status}`, "#b7c9ce", "rgba(22,42,50,.9)"]
    ];
    if (!snapshot.sensors.length) chips.splice(1, 0, ["0 个测点 · 空结果", "#ff8e8e", "rgba(255,111,111,.07)"]);
    chips.forEach(([text, color, fill]) => {
      const width = drawChip(ctx, chipX, 120, text, color, fill);
      chipX += width + 8;
    });

    const cards = [
      ["采样数量", `${snapshot.counts.all}`, "点", `去重后 ${snapshot.digest.uniqueCount} 条源记录 · 校准不改变样本数`, "#4bd9c5"],
      ["数据完整度", snapshot.completeness.toFixed(1), "%", `有效 ${snapshot.counts.valid} · 补缺 ${snapshot.counts.imputed}`, "#54c8e8"],
      ["校准 RMSE", snapshot.stats.rmse === null ? "—" : snapshot.stats.rmse.toFixed(2), "°C", `MAE ${snapshot.stats.mae === null ? "—" : snapshot.stats.mae.toFixed(2)} °C · 最大 ${snapshot.stats.maxAbsError === null ? "—" : snapshot.stats.maxAbsError.toFixed(2)} °C`, "#b79cff"],
      ["待核查点", `${snapshot.counts.anomaly + snapshot.counts.imputed}`, "点", `异常 ${snapshot.counts.anomaly} · 补缺 ${snapshot.counts.imputed}`, "#ffb15d"]
    ];
    const cardY = 170;
    const cardW = 356;
    cards.forEach(([label, value, unit, foot, accent], index) => {
      const x = 64 + index * (cardW + 16);
      roundedRect(ctx, x, cardY, cardW, 104, 12);
      ctx.fillStyle = "rgba(14, 30, 37, .96)";
      ctx.fill();
      ctx.strokeStyle = "#203840";
      ctx.stroke();
      ctx.fillStyle = "#81979f";
      ctx.font = `12px ${sans}`;
      ctx.textAlign = "left";
      ctx.fillText(label, x + 18, cardY + 17);
      ctx.fillStyle = "#edf5f7";
      ctx.font = `600 34px ${mono}`;
      ctx.fillText(String(value), x + 18, cardY + 37);
      ctx.fillStyle = "#718991";
      ctx.font = `13px ${sans}`;
      ctx.fillText(unit, x + 25 + ctx.measureText(String(value)).width, cardY + 51);
      ctx.fillStyle = "#657f87";
      ctx.font = `10px ${sans}`;
      ctx.fillText(foot, x + 18, cardY + 79);
      ctx.fillStyle = accent;
      ctx.fillRect(x, cardY, 3, 104);
    });

    ctx.fillStyle = "#879da4";
    ctx.font = `600 12px ${sans}`;
    ctx.textAlign = "left";
    ctx.fillText("校准曲线与误差带", 64, 302);
    ctx.fillStyle = "#5f7880";
    ctx.font = `10px ${mono}`;
    ctx.textAlign = "right";
    ctx.fillText(`COMPARE VIEW · ${snapshot.window.detail} · ${snapshot.calibration.modelSamples} CAL SAMPLES`, 1536, 303);
    const plotRect = { x: 64, y: 318, w: 1472, h: 584 };
    ctx.save();
    roundedRect(ctx, plotRect.x, plotRect.y, plotRect.w, plotRect.h, 10);
    ctx.clip();
    drawPlot(ctx, snapshot, plotRect, { view: "compare", scale: 1.55, exportMode: true });
    ctx.restore();
    ctx.strokeStyle = "#27434c";
    roundedRect(ctx, plotRect.x + 0.5, plotRect.y + 0.5, plotRect.w - 1, plotRect.h - 1, 10);
    ctx.stroke();

    const footY = 922;
    roundedRect(ctx, 64, footY, 998, 132, 10);
    ctx.fillStyle = "rgba(12, 27, 33, .96)";
    ctx.fill();
    ctx.strokeStyle = "#1f353e";
    ctx.stroke();
    ctx.fillStyle = "#9cb0b6";
    ctx.font = `600 12px ${sans}`;
    ctx.textAlign = "left";
    ctx.fillText("统计口径与聚合", 82, footY + 18);
    ctx.fillStyle = "#6b858d";
    ctx.font = `11px ${sans}`;
    ctx.fillText("误差 = 校准温度 − 参考温度；RMSE / MAE 在筛选窗口内逐点计算。", 82, footY + 45);
    ctx.fillText(`补缺采用时间序列线性插值；20 秒采样按 1 分钟聚合为 ${snapshot.bucketStats.length} 个桶。`, 82, footY + 67);
    ctx.fillText(`测点 ${snapshot.filterSummary.sensors.join(" / ") || "无"} · ${snapshot.filterSummary.windowDetail} · 参考 ${snapshot.filterSummary.reference}`, 82, footY + 89);
    ctx.fillStyle = "#4bd9c5";
    ctx.font = `10px ${mono}`;
    ctx.fillText(`SAMPLE LOCK ${snapshot.invariance.beforeAdjustment} → ${snapshot.invariance.afterAdjustment} · CAL ${snapshot.calibration.label}`, 82, footY + 111);

    roundedRect(ctx, 1078, footY, 458, 132, 10);
    ctx.fillStyle = "rgba(12, 27, 33, .96)";
    ctx.fill();
    ctx.strokeStyle = "rgba(75, 217, 197, .28)";
    ctx.stroke();
    ctx.fillStyle = "#4bd9c5";
    ctx.font = `600 12px ${sans}`;
    ctx.fillText("✓ 一致性校验", 1096, footY + 18);
    ctx.fillStyle = "#d5e4e7";
    ctx.font = `14px ${mono}`;
    ctx.fillText(signature, 1096, footY + 45);
    ctx.fillStyle = "#6d8790";
    ctx.font = `10px ${mono}`;
    ctx.fillText(`DATA ${snapshot.version.short}`, 1096, footY + 67);
    ctx.fillText(`SCREEN ${signature}`, 1096, footY + 87);
    ctx.fillText(`EXPORT ${signature}`, 1096, footY + 107);
    ctx.fillStyle = "#4bd9c5";
    ctx.fillText("MATCH · 屏幕值 = 导出值", 1332, footY + 107);

    ctx.fillStyle = "#405b64";
    ctx.font = `10px ${mono}`;
    ctx.textAlign = "left";
    ctx.fillText("GENERATED FROM LIVE SNAPSHOT · VALUES ARE NOT PRESET", 64, 1082);
    ctx.textAlign = "right";
    ctx.fillText("THERMAL CALIBRATION WORKBENCH / 03", 1536, 1082);
    return { canvas, signature };
  }

  function openExportPreview() {
    const screenSnapshot = state.snapshot;
    if (!screenSnapshot) return;
    const exportSnapshot = clone(screenSnapshot);
    const rendered = drawExportCanvas(exportSnapshot);
    const screenSignature = snapshotSignature(screenSnapshot);
    const exportSignature = snapshotSignature(exportSnapshot);
    const matches = screenSignature === exportSignature;
    const url = rendered.canvas.toDataURL("image/png");
    state.exportImage = {
      url,
      name: `thermal-calibration-${screenSnapshot.scenario}-${screenSnapshot.version.short}-${Date.now()}.png`
    };
    const entry = {
      time: nowTime(),
      version: screenSnapshot.version.short,
      filter: `${screenSnapshot.dataset.label} · ${screenSnapshot.filterSummary.sensors.join("/") || "无测点"} · ${screenSnapshot.filterSummary.window} · ${screenSnapshot.filterSummary.status} · 参考 ${screenSnapshot.filterSummary.reference} · 校准 ${screenSnapshot.filterSummary.calibration}`,
      points: screenSnapshot.counts.all,
      rmse: screenSnapshot.stats.rmse === null ? "—" : screenSnapshot.stats.rmse.toFixed(2),
      checksum: screenSignature,
      matches
    };
    state.exportLogs.unshift(entry);
    if (state.exportLogs.length > 4) state.exportLogs.pop();
    renderExportLog();
    state.exportMeta = entry;
    $("#exportPreview").src = url;
    $("#exportMeta").textContent = `屏幕 SHA ${screenSignature} · 导出 SHA ${exportSignature} · ${screenSnapshot.counts.all} 点 · RMSE ${entry.rmse} °C · ${matches ? "逐项一致" : "存在差异"}`;
    $("#exportModal").classList.add("open");
    $("#exportModal").setAttribute("aria-hidden", "false");
    showToast(matches ? "对比图已生成，屏幕与导出数值一致" : "检测到导出差异");
  }

  function closeExportModal() {
    $("#exportModal").classList.remove("open");
    $("#exportModal").setAttribute("aria-hidden", "true");
  }

  function downloadExport() {
    if (!state.exportImage) return;
    const link = document.createElement("a");
    link.href = state.exportImage.url;
    link.download = state.exportImage.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    showToast("PNG 对比图已下载");
  }

  function startClock() {
    const update = () => { $("#clock").textContent = nowTime(); };
    update();
    setInterval(update, 1000);
  }

  function init() {
    bindEvents();
    startClock();
    updateBackButton();
    renderAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
