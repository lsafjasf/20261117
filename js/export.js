import { AIRLINES, formatWindow } from "./data.js";

export function buildExportModel(snapshot, meta = {}) {
  const selectedAirlines = snapshot.airlines.map(
    (code) => `${code} ${AIRLINES[code]?.short ?? ""}`.trim(),
  );
  return {
    title: "机场航线延误分析 · 当前视图",
    generatedAt: meta.generatedAt ?? new Date(),
    scenario: snapshot.scenarioLabel,
    window: formatWindow(snapshot.window),
    date: snapshot.date,
    selectedAirlines,
    airlinesText: selectedAirlines.length ? selectedAirlines.join("、") : "未选择航司",
    summary: { ...snapshot.summary },
    quality: { ...snapshot.quality },
    routes: snapshot.routes.map((route) => ({
      key: route.key,
      count: route.count,
      avgDelay: route.avgDelay,
      cancelledCount: route.cancelledCount,
      cancelRate: route.cancelRate,
    })),
    flights: snapshot.flights.map((flight) => ({
      flightNo: flight.flightNo,
      airline: flight.airline,
      scheduled: flight.scheduled,
      actual: flight.cancelled ? null : flight.actual,
      delayMin: flight.delayMinFinal,
      status: flight.status,
      route: flight.routeKey,
      delaySource: flight.delaySource,
    })),
    dataVersion: snapshot.dataVersion,
    viewVersion: snapshot.viewVersion,
    selectedRouteKey: meta.selectedRouteKey ?? null,
    filters: {
      scenarioId: snapshot.scenarioId,
      windowId: snapshot.window.id,
      airlines: [...snapshot.airlines],
    },
  };
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function setFont(context, weight, size, family = "sans") {
  const fontFamily =
    family === "mono"
      ? '"SFMono-Regular", Consolas, "Noto Sans SC", "PingFang SC", monospace'
      : '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
  context.font = `${weight} ${size}px ${fontFamily}`;
}

function wrapText(context, text, x, y, maxWidth, lineHeight, maxLines = 2) {
  const characters = [...text];
  let line = "";
  let lineIndex = 0;
  for (let index = 0; index < characters.length; index += 1) {
    const test = line + characters[index];
    if (context.measureText(test).width > maxWidth && line) {
      context.fillText(line, x, y + lineIndex * lineHeight);
      line = characters[index];
      lineIndex += 1;
      if (lineIndex >= maxLines - 1) break;
    } else {
      line = test;
    }
  }
  if (lineIndex < maxLines) context.fillText(line, x, y + lineIndex * lineHeight);
}

function formatDelay(value) {
  return value == null ? "—" : `${value.toFixed(1)} 分`;
}

function formatPercent(value) {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function drawKpi(context, x, y, width, label, value, suffix, tone) {
  roundedRect(context, x, y, width, 92, 10);
  context.fillStyle = "rgba(13, 37, 57, 0.88)";
  context.fill();
  context.strokeStyle = "rgba(91, 127, 150, 0.16)";
  context.lineWidth = 1;
  context.stroke();

  context.fillStyle = "#7890a2";
  setFont(context, 500, 12);
  context.fillText(label, x + 16, y + 23);
  context.fillStyle = tone;
  setFont(context, 600, 31, "mono");
  context.fillText(String(value), x + 16, y + 61);
  if (suffix) {
    const valueWidth = context.measureText(String(value)).width;
    context.fillStyle = "#5c7486";
    setFont(context, 500, 11);
    context.fillText(suffix, x + 20 + valueWidth, y + 60);
  }
}

function drawMapImage(context, image, x, y, width, height) {
  if (!image?.width) return;
  roundedRect(context, x, y, width, height, 12);
  context.save();
  context.clip();
  context.drawImage(image, x, y, width, height);
  context.restore();
  roundedRect(context, x, y, width, height, 12);
  context.strokeStyle = "rgba(91, 127, 150, 0.22)";
  context.lineWidth = 1;
  context.stroke();
}

function drawChip(context, text, x, y, tone = "#59d7e8") {
  setFont(context, 500, 11);
  const width = context.measureText(text).width + 20;
  roundedRect(context, x, y, width, 27, 6);
  context.fillStyle = "rgba(89, 215, 232, 0.055)";
  context.fill();
  context.strokeStyle = "rgba(89, 215, 232, 0.18)";
  context.lineWidth = 1;
  context.stroke();
  context.fillStyle = tone;
  context.fillText(text, x + 10, y + 18);
  return width;
}

function drawHeader(context, model) {
  context.fillStyle = "#eaf2f8";
  setFont(context, 600, 30);
  context.fillText(model.title, 60, 57);
  context.fillStyle = "#6f879a";
  setFont(context, 500, 11, "mono");
  context.fillText(
    `SNAPSHOT ${model.viewVersion}  ·  DATA ${model.dataVersion}  ·  ${model.date}`,
    62,
    78,
  );

  const stamp = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(model.generatedAt);
  roundedRect(context, 1260, 30, 280, 39, 8);
  context.fillStyle = "rgba(67, 212, 156, 0.06)";
  context.fill();
  context.strokeStyle = "rgba(67, 212, 156, 0.2)";
  context.stroke();
  context.fillStyle = "#43d49c";
  setFont(context, 600, 10, "mono");
  context.fillText("EXPORT VERIFIED", 1275, 54);
  context.fillStyle = "#71889a";
  setFont(context, 500, 9, "mono");
  context.fillText(stamp, 1384, 54);
}

function drawFilters(context, model) {
  let x = 60;
  const y = 101;
  x += drawChip(context, `场景 · ${model.scenario}`, x, y) + 8;
  x += drawChip(context, `时间 · ${model.window}`, x, y) + 8;
  x += drawChip(context, `航司 · ${model.airlinesText}`, x, y) + 8;
  drawChip(context, `筛选结果 · ${model.summary.flights} 班`, x, y, "#f2b84b");
}

function drawKpis(context, model) {
  const y = 151;
  const gap = 12;
  const width = (1480 - gap * 3) / 4;
  const values = [
    ["执行航班", model.summary.flights, "班", "#59d7e8"],
    ["活跃航线", model.summary.routes, "条", "#9a8df5"],
    ["平均延误", formatDelay(model.summary.avgDelay), "", "#f2b84b"],
    ["取消率", formatPercent(model.summary.cancelRate), "", "#f26479"],
  ];
  values.forEach(([label, value, suffix, tone], index) => {
    drawKpi(context, 60 + index * (width + gap), y, width, label, value, suffix, tone);
  });
}

function drawDataSummary(context, model, x, y, width) {
  roundedRect(context, x, y, width, 116, 10);
  context.fillStyle = "rgba(11, 30, 48, 0.86)";
  context.fill();
  context.strokeStyle = "rgba(91, 127, 150, 0.16)";
  context.stroke();

  context.fillStyle = "#9eb3c2";
  setFont(context, 600, 12);
  context.fillText("数据摘要与口径", x + 14, y + 21);
  context.fillStyle = "#607b8f";
  setFont(context, 500, 9);
  context.fillText(
    `原始 ${model.quality.sourceRows} · 有效 ${model.quality.accepted} · 去重 ${model.quality.duplicatesRemoved} · 补缺 ${model.quality.repairedMissing} · 异常修正 ${model.quality.repairedInvalid}`,
    x + 14,
    y + 42,
  );
  wrapText(
    context,
    "延误=实际起飞晚于计划且 >15 分钟；航线颜色=非取消航班加权平均延误；宽度=去重后班次量；取消率=取消航班÷筛选内全部航班。",
    x + 14,
    y + 62,
    width - 28,
    16,
    3,
  );
}

function routeDelayColor(delay) {
  if (delay == null) return "#73889a";
  if (delay <= 15) return "#43d49c";
  if (delay <= 30) return "#f2b84b";
  if (delay <= 45) return "#f58a4b";
  return "#f26479";
}

function drawRightPanel(context, model, x, y, width, height) {
  roundedRect(context, x, y, width, height, 12);
  context.fillStyle = "rgba(9, 27, 44, 0.9)";
  context.fill();
  context.strokeStyle = "rgba(91, 127, 150, 0.18)";
  context.stroke();

  const selectedRoute = model.routes.find((route) => route.key === model.selectedRouteKey);
  const panelTitle = selectedRoute ? selectedRoute.key.replace("-", " → ") : "航线排行";
  const routeFlights = selectedRoute
    ? model.flights.filter((flight) => flight.route === selectedRoute.key)
    : [];

  context.fillStyle = "#b8ccd8";
  setFont(context, 600, 14);
  context.fillText(panelTitle, x + 18, y + 28);
  context.fillStyle = "#607b8f";
  setFont(context, 500, 9, "mono");
  context.fillText(
    selectedRoute ? `${routeFlights.length} FLIGHTS · 具体航班` : `${model.routes.length} ROUTES`,
    x + 18,
    y + 44,
  );
  context.strokeStyle = "rgba(91, 127, 150, 0.16)";
  context.beginPath();
  context.moveTo(x + 18, y + 56);
  context.lineTo(x + width - 18, y + 56);
  context.stroke();

  let rowY = y + 75;
  if (selectedRoute) {
    for (const flight of routeFlights.slice(0, 15)) {
      const cancelled = flight.status === "取消";
      const tone = cancelled ? "#f26479" : flight.delayMin > 15 ? "#f2b84b" : "#43d49c";
      context.fillStyle = "#d5e4ed";
      setFont(context, 600, 11, "mono");
      context.fillText(flight.flightNo, x + 18, rowY);
      context.fillStyle = "#627d90";
      setFont(context, 500, 9);
      context.fillText(`${flight.airline} · ${flight.scheduled}`, x + 92, rowY);
      context.fillStyle = tone;
      setFont(context, 600, 10, "mono");
      context.textAlign = "right";
      context.fillText(
        cancelled ? "取消" : `${flight.delayMin.toFixed(0)} min`,
        x + width - 20,
        rowY,
      );
      context.textAlign = "left";
      rowY += 28;
      if (rowY > y + height - 70) break;
    }
    const shown = Math.min(routeFlights.length, Math.floor((height - 145) / 28));
    if (routeFlights.length > shown) {
      context.fillStyle = "#607b8f";
      setFont(context, 500, 9);
      context.fillText(`另有 ${routeFlights.length - shown} 班未展开`, x + 18, y + height - 31);
    }
  } else {
    const maxCount = Math.max(...model.routes.map((route) => route.count), 1);
    for (const route of model.routes.slice(0, 12)) {
      const tone = routeDelayColor(route.avgDelay);
      context.fillStyle = "#c6d8e3";
      setFont(context, 600, 11);
      context.fillText(route.key.replace("-", " → "), x + 18, rowY);
      context.fillStyle = tone;
      setFont(context, 600, 10, "mono");
      context.textAlign = "right";
      context.fillText(
        route.avgDelay == null ? "—" : `${route.avgDelay.toFixed(1)}m`,
        x + width - 20,
        rowY,
      );
      context.textAlign = "left";

      const barX = x + 18;
      const barY = rowY + 8;
      context.fillStyle = "rgba(91, 127, 150, 0.12)";
      context.fillRect(barX, barY, width - 38, 2);
      context.fillStyle = tone;
      context.fillRect(barX, barY, ((width - 38) * route.count) / maxCount, 2);
      context.fillStyle = "#5e788b";
      setFont(context, 500, 8.5, "mono");
      context.fillText(`${route.count} 班 · 取消 ${route.cancelledCount}`, x + 18, rowY + 23);
      rowY += 47;
    }
    if (model.routes.length > 12) {
      context.fillStyle = "#607b8f";
      setFont(context, 500, 9);
      context.fillText(`另有 ${model.routes.length - 12} 条航线`, x + 18, y + height - 31);
    }
  }
}

export function composeExportCanvas(model, canvases = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 1240;
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  const background = context.createLinearGradient(0, 0, 1600, 1240);
  background.addColorStop(0, "#071624");
  background.addColorStop(0.56, "#06111f");
  background.addColorStop(1, "#081827");
  context.fillStyle = background;
  context.fillRect(0, 0, 1600, 1240);

  context.save();
  context.globalAlpha = 0.16;
  context.strokeStyle = "#2b526c";
  context.lineWidth = 1;
  for (let x = 20; x < 1600; x += 32) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, 1240);
    context.stroke();
  }
  for (let y = 20; y < 1240; y += 32) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(1600, y);
    context.stroke();
  }
  context.restore();

  drawHeader(context, model);
  drawFilters(context, model);
  drawKpis(context, model);

  drawMapImage(context, canvases.mapCanvas, 60, 268, 960, 500);
  context.fillStyle = "#8ca2b2";
  setFont(context, 600, 12);
  context.fillText("时段运行曲线", 62, 795);
  context.fillStyle = "#607b8f";
  setFont(context, 500, 9);
  context.textAlign = "right";
  context.fillText("柱 · 班次（红色为取消）   线 · 平均延误", 1018, 795);
  context.textAlign = "left";
  drawMapImage(context, canvases.trendCanvas, 60, 807, 960, 235);
  drawRightPanel(context, model, 1042, 268, 498, 774);
  drawDataSummary(context, model, 60, 1062, 1480);

  context.strokeStyle = "rgba(91, 127, 150, 0.2)";
  context.beginPath();
  context.moveTo(60, 1201);
  context.lineTo(1540, 1201);
  context.stroke();
  context.fillStyle = "#526d81";
  setFont(context, 500, 9, "mono");
  context.fillText(
    `同源校验 · 地图/曲线/列表均来自 ${model.viewVersion} · 统计值 ${model.summary.flights} 班 / ${model.summary.routes} 航线 / ${formatDelay(model.summary.avgDelay)} / 取消 ${model.summary.cancelled}`,
    60,
    1222,
  );
  context.textAlign = "right";
  context.fillText("AIRPORT FLOW · EXPORT", 1540, 1222);
  context.textAlign = "left";
  return canvas;
}

export function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("PNG 编码失败"));
    }, "image/png");
  });
}

export function makeExportFilename(model, generatedAt = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  const stamp = [
    generatedAt.getFullYear(),
    pad(generatedAt.getMonth() + 1),
    pad(generatedAt.getDate()),
    "-",
    pad(generatedAt.getHours()),
    pad(generatedAt.getMinutes()),
    pad(generatedAt.getSeconds()),
  ].join("");
  return `airport-flow_${model.filters.windowId}_${model.viewVersion}_${stamp}.png`;
}
