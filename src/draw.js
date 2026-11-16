import { GRADE_BY_ID, ROADS, ROAD_BY_ID } from "./data.js";
import { routeGeometry } from "./engine.js";

export const MAP_W = 1000;
export const MAP_H = 620;

export const fmt = {
  speed: (value) => (Number.isFinite(Number(value)) ? Number(value).toFixed(1) : "—"),
  queue: (value) => (Number.isFinite(Number(value)) ? String(Math.round(Number(value))) : "—"),
  index: (value) => (Number.isFinite(Number(value)) ? Number(value).toFixed(1) : "—"),
  pct: (value) => `${Math.round(Number(value) * 100)}%`,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function mapTransform(width, height, view) {
  const scale = Math.min(width / MAP_W, height / MAP_H) * view.zoom;
  const offsetX = width / 2 - view.centerX * scale;
  const offsetY = height / 2 - view.centerY * scale;
  return {
    scale,
    offsetX,
    offsetY,
    project(point) {
      return {
        x: point.x * scale + offsetX,
        y: point.y * scale + offsetY,
      };
    },
    unproject(point) {
      return {
        x: (point.x - offsetX) / scale,
        y: (point.y - offsetY) / scale,
      };
    },
  };
}

function applyMapTransform(ctx, transform) {
  ctx.translate(transform.offsetX, transform.offsetY);
  ctx.scale(transform.scale, transform.scale);
}

function appendPolyline(ctx, points, close = false) {
  if (!points.length) return;
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].x, points[index].y);
  }
  if (close) ctx.closePath();
}

const ZONES = [
  { x: 130, y: 123, w: 112, h: 58, tone: "#152b25" },
  { x: 310, y: 128, w: 142, h: 54, tone: "#142821" },
  { x: 530, y: 130, w: 148, h: 48, tone: "#172d27" },
  { x: 750, y: 130, w: 104, h: 48, tone: "#142720" },
  { x: 132, y: 236, w: 108, h: 57, tone: "#172d26" },
  { x: 314, y: 238, w: 142, h: 56, tone: "#132820" },
  { x: 526, y: 240, w: 158, h: 51, tone: "#172c25" },
  { x: 748, y: 238, w: 108, h: 54, tone: "#142920" },
  { x: 146, y: 350, w: 99, h: 52, tone: "#142a23" },
  { x: 318, y: 348, w: 142, h: 49, tone: "#172d26" },
  { x: 534, y: 348, w: 144, h: 49, tone: "#132820" },
  { x: 746, y: 347, w: 98, h: 51, tone: "#172b24" },
  { x: 148, y: 462, w: 108, h: 50, tone: "#152a23" },
  { x: 328, y: 467, w: 130, h: 46, tone: "#142820" },
  { x: 534, y: 458, w: 112, h: 49, tone: "#182d26" },
  { x: 728, y: 460, w: 104, h: 47, tone: "#142820" },
];

function drawBackdrop(ctx) {
  const gradient = ctx.createRadialGradient(490, 300, 60, 490, 300, 560);
  gradient.addColorStop(0, "#142821");
  gradient.addColorStop(0.62, "#10211c");
  gradient.addColorStop(1, "#0b1814");
  ctx.fillStyle = gradient;
  ctx.fillRect(-40, -40, MAP_W + 80, MAP_H + 80);

  ctx.save();
  ctx.strokeStyle = "rgba(163, 199, 180, 0.042)";
  ctx.lineWidth = 1;
  for (let x = 50; x < MAP_W; x += 50) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, MAP_H);
    ctx.stroke();
  }
  for (let y = 45; y < MAP_H; y += 45) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(MAP_W, y);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-40, 596);
  ctx.bezierCurveTo(250, 545, 500, 642, 1040, 454);
  ctx.lineTo(1040, 680);
  ctx.lineTo(-40, 680);
  ctx.closePath();
  const water = ctx.createLinearGradient(0, 520, 0, 650);
  water.addColorStop(0, "rgba(30, 91, 90, 0.25)");
  water.addColorStop(1, "rgba(16, 54, 58, 0.42)");
  ctx.fillStyle = water;
  ctx.fill();
  ctx.strokeStyle = "rgba(94, 157, 151, 0.18)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  for (const [zoneIndex, zone] of ZONES.entries()) {
    ctx.fillStyle = zone.tone;
    ctx.strokeStyle = "rgba(124, 163, 143, 0.055)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.roundRect(zone.x, zone.y, zone.w, zone.h, 4);
    ctx.fill();
    ctx.stroke();

    const columns = zone.w > 120 ? 4 : 3;
    const rows = zone.h > 52 ? 3 : 2;
    const cellW = (zone.w - 12) / columns;
    const cellH = (zone.h - 11) / rows;
    for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
        const seed = (zoneIndex * 17 + rowIndex * 7 + columnIndex * 11) % 13;
        if (seed === 0) continue;
        const padding = 2 + (seed % 3);
        ctx.fillStyle = `rgba(126, 160, 142, ${0.035 + (seed % 4) * 0.012})`;
        ctx.fillRect(
          zone.x + 5 + columnIndex * cellW + padding / 2,
          zone.y + 5 + rowIndex * cellH + padding / 2,
          Math.max(4, cellW - padding - 2),
          Math.max(3, cellH - padding - 2),
        );
      }
    }
  }

  ctx.save();
  ctx.fillStyle = "rgba(76, 124, 87, 0.12)";
  ctx.beginPath();
  ctx.ellipse(215, 168, 22, 11, -0.3, 0, Math.PI * 2);
  ctx.ellipse(858, 276, 19, 10, 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(139, 191, 156, 0.2)";
  ctx.font = '600 7px "Noto Sans SC", sans-serif';
  ctx.fillText("城市绿地", 178, 170);
  ctx.fillText("江湾公园", 820, 279);
  ctx.fillStyle = "rgba(111, 170, 164, 0.24)";
  ctx.font = 'italic 8px "Noto Sans SC", sans-serif';
  ctx.fillText("浦 江", 585, 590);
  ctx.restore();

  ctx.fillStyle = "rgba(151, 188, 170, 0.1)";
  ctx.font = '700 18px "Noto Sans SC", sans-serif';
  ctx.fillText("北 城", 388, 65);
  ctx.fillText("滨 江", 430, 595);
}

function strokeRoad(ctx, road, width, color, options = {}) {
  ctx.save();
  ctx.beginPath();
  appendPolyline(ctx, road.points);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.lineCap = options.lineCap ?? "round";
  ctx.lineJoin = "round";
  if (options.dash) ctx.setLineDash(options.dash);
  if (options.shadow) {
    ctx.shadowColor = options.shadow;
    ctx.shadowBlur = options.shadowBlur ?? 10;
  }
  ctx.globalAlpha = options.alpha ?? 1;
  if (options.gradient) {
    const first = road.points[0];
    const last = road.points[road.points.length - 1];
    const gradient = ctx.createLinearGradient(first.x, first.y, last.x, last.y);
    options.gradient.forEach((stop) => gradient.addColorStop(stop[0], stop[1]));
    ctx.strokeStyle = gradient;
  }
  ctx.stroke();
  ctx.restore();
}

function drawDirectionArrow(ctx, road, color) {
  const start = road.points[0];
  const end = road.points[road.points.length - 1];
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const middle = road.points[Math.floor(road.points.length / 2)];
  ctx.save();
  ctx.translate(middle.x, middle.y);
  ctx.rotate(angle);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.lineCap = "round";
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.moveTo(-4, -3.3);
  ctx.lineTo(0, 0);
  ctx.lineTo(-4, 3.3);
  ctx.stroke();
  ctx.restore();
}

function drawRoadLabels(ctx, view, transform) {
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const visible = new Set(view.roads.map((road) => road.id));
  for (const road of ROADS) {
    if (!visible.has(road.id) || !road.labelAt) continue;
    const grade = GRADE_BY_ID[road.grade];
    const labelX = road.labelAt.x;
    const labelY = road.labelAt.y;
    ctx.font = `600 ${road.grade === "expressway" ? 11.5 : 10.5}px "Noto Sans SC", sans-serif`;
    const width = ctx.measureText(road.name).width + (road.grade === "expressway" ? 22 : 7);
    ctx.fillStyle = "rgba(7, 19, 15, 0.72)";
    ctx.beginPath();
    ctx.roundRect(labelX - 3, labelY - 8, width, 15, 3);
    ctx.fill();
    if (road.grade === "expressway") {
      ctx.fillStyle = grade.color;
      ctx.beginPath();
      ctx.roundRect(labelX - 1, labelY - 6, 16, 10, 2);
      ctx.fill();
      ctx.fillStyle = "#0c1a15";
      ctx.font = '700 6px "Noto Sans SC", sans-serif';
      ctx.fillText("高架", labelX + 1.1, labelY - 0.8);
      ctx.fillStyle = "rgba(222, 236, 228, 0.8)";
      ctx.font = '600 10.5px "Noto Sans SC", sans-serif';
      ctx.fillText(road.name, labelX + 19, labelY);
    } else {
      ctx.fillStyle = "rgba(212, 229, 220, 0.7)";
      ctx.fillText(road.name, labelX + 1, labelY);
    }
  }
  ctx.restore();
}

function drawClosures(ctx, view) {
  for (const closure of view.closures) {
    const road = ROAD_BY_ID[closure.roadId];
    if (!road) continue;
    strokeRoad(ctx, road, 8, "rgba(199, 73, 54, 0.16)", { shadow: "rgba(221, 79, 56, 0.5)", shadowBlur: 9 });
    strokeRoad(ctx, road, 2.2, "#e0644f", { dash: [5, 4] });
    const middle = road.points[Math.floor(road.points.length / 2)];
    ctx.save();
    ctx.translate(middle.x + 9, middle.y - 9);
    ctx.fillStyle = "#e0644f";
    ctx.beginPath();
    ctx.arc(0, 0, 6.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff3ee";
    ctx.font = '700 8px "Noto Sans SC", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("⊘", 0, -0.3);
    ctx.restore();
  }
}

function drawHeat(ctx, view) {
  for (const road of view.roads) {
    const band = view.legend.find((bin) => bin.id === road.band);
    const color = band?.color ?? "#d6a34a";
    strokeRoad(ctx, road, 27, color, { alpha: 0.16, shadow: color, shadowBlur: 15 });
    strokeRoad(ctx, road, 13, color, { alpha: 0.32, shadow: color, shadowBlur: 8 });
    strokeRoad(ctx, road, 5.5, color, { alpha: 0.92 });
    ctx.save();
    ctx.globalAlpha = 0.65;
    drawDirectionArrow(ctx, road, "#f5fff9");
    ctx.restore();
  }
}

function drawSelection(ctx, road) {
  if (!road) return;
  strokeRoad(ctx, road, 12, "rgba(240, 253, 244, 0.25)", { shadow: "#d9f2e5", shadowBlur: 16 });
  strokeRoad(ctx, road, 2, "#f6fff8");
  const first = road.points[0];
  const last = road.points[road.points.length - 1];
  ctx.save();
  ctx.fillStyle = "#f7fff9";
  ctx.strokeStyle = "#18372b";
  ctx.lineWidth = 1.2;
  for (const point of [first, last]) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawRoute(ctx, route, view) {
  if (!route?.roadIds?.length) return;
  const geometry = routeGeometry(route.roadIds);
  ctx.save();
  ctx.globalAlpha = 0.38;
  ctx.strokeStyle = "#d8f15c";
  ctx.lineWidth = 12;
  ctx.lineCap = "round";
  ctx.shadowColor = "#c2e247";
  ctx.shadowBlur = 14;
  for (const road of geometry.routes) {
    ctx.beginPath();
    appendPolyline(ctx, road.points);
    ctx.stroke();
  }
  for (const [left, right] of geometry.connectors) {
    if (!left || !right) continue;
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(right.x, right.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.lineWidth = 3.2;
  ctx.strokeStyle = "#e6f77d";
  ctx.shadowBlur = 5;
  for (const road of geometry.routes) {
    ctx.beginPath();
    appendPolyline(ctx, road.points);
    ctx.stroke();
  }
  for (const [left, right] of geometry.connectors) {
    if (!left || !right) continue;
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(right.x, right.y);
    ctx.stroke();
  }
  const first = geometry.routes[0]?.points[0];
  const lastRoad = geometry.routes[geometry.routes.length - 1];
  const last = lastRoad?.points[lastRoad.points.length - 1];
  if (first && last) {
    ctx.shadowBlur = 8;
    ctx.fillStyle = "#edf977";
    ctx.strokeStyle = "#173326";
    ctx.lineWidth = 1.8;
    for (const point of [first, last]) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function drawMap(ctx, options) {
  const {
    width,
    height,
    view,
    mapView,
    selectedRoadId,
    hoverRoadId,
    route,
    exportMode = false,
  } = options;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0c1a16";
  ctx.fillRect(0, 0, width, height);
  const transform = mapTransform(width, height, mapView);

  ctx.save();
  applyMapTransform(ctx, transform);
  drawBackdrop(ctx);

  for (const road of ROADS) {
    const grade = GRADE_BY_ID[road.grade];
    const widthBase = road.grade === "expressway" ? 8 : road.grade === "arterial" ? 6.2 : 4.4;
    strokeRoad(ctx, road, widthBase + 3, "rgba(3, 12, 9, 0.55)");
    strokeRoad(ctx, road, widthBase, grade.id === "expressway" ? "#304c45" : "#2a3c35");
    if (grade.id === "expressway") {
      strokeRoad(ctx, road, 0.8, "rgba(189, 204, 194, 0.35)");
    }
  }

  drawHeat(ctx, view);
  drawClosures(ctx, view);

  if (hoverRoadId && view.roads.some((road) => road.id === hoverRoadId)) {
    strokeRoad(ctx, ROAD_BY_ID[hoverRoadId], 4, "rgba(244, 255, 248, 0.9)", { shadow: "#fff", shadowBlur: 7 });
  }
  drawSelection(ctx, selectedRoadId ? ROAD_BY_ID[selectedRoadId] : null);
  drawRoute(ctx, route, view);
  drawRoadLabels(ctx, view, transform);
  ctx.restore();

  if (!exportMode) {
    const vignette = ctx.createRadialGradient(width * 0.5, height * 0.45, height * 0.18, width * 0.5, height * 0.5, width * 0.72);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(3, 11, 8, 0.26)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  }
  return transform;
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (!dx && !dy) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

export function distanceToRoad(point, road) {
  let best = Infinity;
  for (let index = 0; index < road.points.length - 1; index += 1) {
    best = Math.min(best, distanceToSegment(point, road.points[index], road.points[index + 1]));
  }
  return best;
}

export function findRoadAt(view, worldPoint, tolerance = 12, includeHidden = false) {
  const candidates = includeHidden ? ROADS : view.roads;
  let best = null;
  let bestDistance = tolerance;
  for (const road of candidates) {
    const distance = distanceToRoad(worldPoint, road);
    if (distance < bestDistance) {
      best = road;
      bestDistance = distance;
    }
  }
  return best;
}

function drawSmoothPath(ctx, points) {
  if (!points.length) return;
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const midX = (previous.x + current.x) / 2;
    ctx.bezierCurveTo(midX, previous.y, midX, current.y, current.x, current.y);
  }
}

export function drawChart(ctx, options) {
  const { width, height, view, hoverIndex = null, exportMode = false } = options;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = exportMode ? "#fbfcf9" : "rgba(251, 252, 249, 0)";
  if (exportMode) ctx.fillRect(0, 0, width, height);

  const margin = { left: 34, right: exportMode ? 24 : 12, top: 9, bottom: 21 };
  const plotWidth = Math.max(20, width - margin.left - margin.right);
  const plotHeight = Math.max(20, height - margin.top - margin.bottom);
  const bottom = margin.top + plotHeight;
  const toY = (index) => margin.top + plotHeight - (clamp(index, 0, 100) / 100) * plotHeight;

  ctx.save();
  ctx.font = '7px "Noto Sans SC", sans-serif';
  ctx.textBaseline = "middle";
  for (const tick of [0, 25, 50, 75, 100]) {
    const y = toY(tick);
    ctx.strokeStyle = tick === 50 ? "rgba(192, 204, 195, 0.65)" : "rgba(220, 226, 220, 0.7)";
    ctx.lineWidth = 0.7;
    ctx.setLineDash(tick === 50 ? [3, 3] : []);
    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(width - margin.right, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#93a099";
    ctx.textAlign = "right";
    ctx.fillText(String(tick), margin.left - 7, y);
  }
  ctx.restore();

  const series = view.series;
  if (!series.length) {
    ctx.fillStyle = "#a0aaa4";
    ctx.font = '8px "Noto Sans SC", sans-serif';
    ctx.textAlign = "center";
    ctx.fillText("当前筛选无采样序列", width / 2, height / 2);
    return;
  }

  const xStep = plotWidth / Math.max(series.length - 1, 1);
  const points = series.map((point, index) => ({
    x: margin.left + index * xStep,
    y: toY(point.index),
    value: point,
    index,
  }));

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(points[0].x, bottom);
  for (const point of points) ctx.lineTo(point.x, point.y);
  ctx.lineTo(points[points.length - 1].x, bottom);
  ctx.closePath();
  const fill = ctx.createLinearGradient(0, margin.top, 0, bottom);
  fill.addColorStop(0, "rgba(226, 133, 64, 0.22)");
  fill.addColorStop(1, "rgba(226, 133, 64, 0.015)");
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.beginPath();
  drawSmoothPath(ctx, points);
  ctx.strokeStyle = "#d87c3e";
  ctx.lineWidth = exportMode ? 2.2 : 1.7;
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(216, 124, 62, 0.22)";
  ctx.shadowBlur = 7;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "#91a099";
  ctx.lineWidth = 0.8;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(margin.left, toY(view.stats.index));
  ctx.lineTo(width - margin.right, toY(view.stats.index));
  ctx.stroke();
  ctx.restore();

  const labelEvery = series.length > 8 ? 3 : 1;
  ctx.save();
  ctx.font = '7px "SFMono-Regular", Consolas, monospace';
  ctx.fillStyle = "#8c9992";
  ctx.textBaseline = "top";
  for (let index = 0; index < series.length; index += 1) {
    if (index % labelEvery !== 0 && index !== series.length - 1) continue;
    const x = margin.left + index * xStep;
    ctx.textAlign = index === 0 ? "left" : index === series.length - 1 ? "right" : "center";
    ctx.fillText(series[index].time, x, bottom + 7);
  }
  ctx.restore();

  const peakIndex = series.reduce((best, point, index) => (point.index > series[best].index ? index : best), 0);
  const peak = points[peakIndex];
  ctx.save();
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#d87c3e";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(peak.x, peak.y, 3.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  if (hoverIndex != null && series[hoverIndex]) {
    drawChartTooltip(ctx, points[hoverIndex], { margin, bottom, width });
  }
}

function drawChartTooltip(ctx, point, layout) {
  const { margin, bottom, width } = layout;
  ctx.save();
  ctx.strokeStyle = "rgba(119, 139, 127, 0.5)";
  ctx.lineWidth = 0.8;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(point.x, margin.top);
  ctx.lineTo(point.x, bottom);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#d87c3e";
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  const boxW = 132;
  const boxH = 37;
  const boxX = clamp(point.x - boxW / 2, margin.left, width - margin.right - boxW);
  const boxY = Math.max(2, point.y - 48);
  ctx.fillStyle = "rgba(22, 36, 30, 0.94)";
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxW, boxH, 5);
  ctx.fill();
  ctx.fillStyle = "#eff7f2";
  ctx.font = '7px "Noto Sans SC", sans-serif';
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(point.value.time, boxX + 7, boxY + 8);
  ctx.fillStyle = "#c8d8ce";
  ctx.font = '6px "Noto Sans SC", sans-serif';
  ctx.fillText(
    `速度 ${fmt.speed(point.value.speed)} km/h · 排队 ${fmt.queue(point.value.queue)} m`,
    boxX + 7,
    boxY + 21,
  );
  ctx.fillStyle = "#e7c274";
  ctx.font = '600 6px "SFMono-Regular", Consolas, monospace';
  ctx.fillText(`指数 ${fmt.index(point.value.index)}`, boxX + 7, boxY + 31);
  ctx.restore();
}

function roundedCard(ctx, x, y, width, height, options = {}) {
  ctx.save();
  ctx.fillStyle = options.fill ?? "#fbfcf9";
  ctx.strokeStyle = options.stroke ?? "#dce2dc";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, options.radius ?? 10);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function canvasLabel(ctx, text, x, y, options = {}) {
  ctx.save();
  ctx.fillStyle = options.color ?? "#6f7b75";
  ctx.font = `${options.weight ?? 400} ${options.size ?? 12}px "Noto Sans SC", sans-serif`;
  ctx.textAlign = options.align ?? "left";
  ctx.textBaseline = options.baseline ?? "middle";
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawExportLegend(ctx, view, x, y, width) {
  ctx.save();
  ctx.fillStyle = "rgba(9, 23, 18, 0.84)";
  ctx.strokeStyle = "rgba(197, 221, 208, 0.2)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, width, 77, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#dce9e2";
  ctx.font = '600 9px "Noto Sans SC", sans-serif';
  ctx.fillText("拥堵指数 · 当前筛选", x + 10, y + 15);
  ctx.fillStyle = "#8ca79a";
  ctx.font = '7px "SFMono-Regular", Consolas, monospace';
  ctx.textAlign = "right";
  ctx.fillText(`${view.legend.reduce((sum, bin) => sum + bin.count, 0)} 条显示`, x + width - 10, y + 15);
  const cell = (width - 20) / 4;
  view.legend.forEach((bin, index) => {
    const cellX = x + 10 + index * cell;
    ctx.fillStyle = bin.color;
    ctx.fillRect(cellX, y + 31, 20, 4);
    ctx.fillStyle = "#bdcfc5";
    ctx.font = '7px "Noto Sans SC", sans-serif';
    ctx.textAlign = "left";
    ctx.fillText(bin.label, cellX, y + 49);
    ctx.fillStyle = "#edf5f0";
    ctx.font = '600 9px "SFMono-Regular", Consolas, monospace';
    ctx.fillText(String(bin.count).padStart(2, "0"), cellX, y + 64);
  });
  ctx.restore();
}

export function drawExport(ctx, model) {
  const { view, mapView, selectedRoad, route, datasetLabel, capturedAt, exportId } = model;
  const width = 1800;
  const height = 1220;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#eef1ed";
  ctx.fillRect(0, 0, width, height);

  drawExportHeader(ctx, view, capturedAt, exportId);
  drawExportConditions(ctx, view, datasetLabel);
  drawExportKpis(ctx, view);

  roundedCard(ctx, 48, 307, 1120, 592);
  canvasLabel(ctx, "路网热力", 66, 330, { size: 14, color: "#1d2b25", weight: 700 });
  canvasLabel(ctx, `${view.window.compact} · 筛选后聚合`, 144, 330, { size: 8, color: "#8d9a93" });
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(60, 345, 1096, 541, 7);
  ctx.clip();
  ctx.translate(60, 345);
  drawMap(ctx, {
    width: 1096,
    height: 541,
    view,
    mapView,
    selectedRoadId: selectedRoad?.id,
    route,
    exportMode: true,
  });
  ctx.restore();
  drawExportLegend(ctx, view, 965, 780, 173);
  if (!view.roads.length) {
    ctx.fillStyle = "rgba(9, 22, 18, 0.82)";
    ctx.beginPath();
    ctx.roundRect(472, 548, 296, 105, 8);
    ctx.fill();
    canvasLabel(ctx, "当前筛选无匹配路段", 620, 584, { size: 13, color: "#edf4ef", align: "center", weight: 600 });
    canvasLabel(ctx, "导出快照保留筛选与零值统计", 620, 610, { size: 9, color: "#9bb3a6", align: "center" });
  }

  drawExportDetails(ctx, view, selectedRoad, route);
  drawExportChart(ctx, view);
  drawExportFooter(ctx, view, exportId);
}

function drawExportHeader(ctx, view, capturedAt, exportId) {
  ctx.fillStyle = "#fbfcf9";
  ctx.fillRect(0, 0, 1800, 120);
  ctx.fillStyle = "#17201d";
  ctx.beginPath();
  ctx.roundRect(46, 27, 46, 46, 10);
  ctx.fill();
  ctx.strokeStyle = "#b8d648";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(56, 42);
  ctx.lineTo(82, 42);
  ctx.moveTo(61, 59);
  ctx.lineTo(83, 59);
  ctx.stroke();
  canvasLabel(ctx, "ROAD CONGESTION / CURRENT VIEW", 111, 38, { size: 9, color: "#91a099", weight: 700 });
  canvasLabel(ctx, "路网拥堵热图 · 当前视图导出", 110, 67, { size: 25, color: "#17201d", weight: 700 });
  canvasLabel(ctx, `数据版本 ${view.dataVersion}  ·  ${view.dataHash}`, 111, 91, {
    size: 9,
    color: "#75837c",
  });
  canvasLabel(ctx, `EXPORT ${exportId}`, 1755, 40, { size: 9, color: "#7b8881", align: "right", weight: 600 });
  canvasLabel(ctx, capturedAt, 1755, 63, { size: 11, color: "#26362f", align: "right", weight: 600 });
  canvasLabel(ctx, "同源快照 · 地图 / 曲线 / 列表数值一致", 1755, 86, {
    size: 9,
    color: "#4c7965",
    align: "right",
  });
  ctx.fillStyle = "#e7ebe4";
  ctx.fillRect(0, 119, 1800, 1);
}

function drawExportConditions(ctx, view, datasetLabel) {
  const directionLabel = view.filters.direction === "all" ? "全部方向" : view.directionMeta.label;
  const gradeLabel =
    view.filters.grades.length === 3
      ? "全部等级"
      : view.filters.grades.length
        ? ["expressway", "arterial", "secondary"]
            .filter((id) => view.filters.grades.includes(id))
            .map((id) => GRADE_BY_ID[id]?.label)
            .join(" + ")
        : "未选择";
  const conditions = [
    ["时间窗口", `${view.window.label} · ${view.window.name}`],
    ["方向", directionLabel],
    ["道路等级", gradeLabel || "未选择"],
    ["样本", datasetLabel],
    ["封闭路段", `${view.closures.length} 条`],
  ];
  conditions.forEach(([label, value], index) => {
    const x = 48 + index * 345;
    canvasLabel(ctx, label, x, 146, { size: 8, color: "#8b9891" });
    canvasLabel(ctx, value, x, 166, { size: 11, color: "#293a32", weight: 600 });
    if (index < conditions.length - 1) {
      ctx.fillStyle = "#e0e5df";
      ctx.fillRect(x + 316, 141, 1, 31);
    }
  });
}

function drawExportKpis(ctx, view) {
  const kpis = [
    ["平均速度", `${fmt.speed(view.stats.speed)} km/h`, `自由流 ${fmt.speed(view.stats.freeFlow)} km/h`],
    ["平均排队", `${fmt.queue(view.stats.queue)} m`, "当前筛选路段均值"],
    ["拥堵热点", `${view.stats.hotspotCount} 处`, `路段总数 ${view.stats.roadCount} 条`],
    ["有效样本", `${view.stats.samples} 条`, `覆盖率 ${fmt.pct(view.stats.coverage)}`],
  ];
  kpis.forEach(([label, value, detail], index) => {
    const x = 48 + index * 430;
    roundedCard(ctx, x, 198, 414, 89);
    canvasLabel(ctx, label, x + 17, 218, { size: 9, color: "#7b8881" });
    canvasLabel(ctx, value, x + 17, 249, { size: 25, color: "#17201d", weight: 600 });
    canvasLabel(ctx, detail, x + 17, 272, { size: 8, color: "#8a9891" });
  });
}

function drawExportDetails(ctx, view, selectedRoad, route) {
  roundedCard(ctx, 1184, 307, 568, 592);
  canvasLabel(ctx, "当前路段与热点", 1203, 330, { size: 14, color: "#1d2b25", weight: 700 });
  canvasLabel(ctx, "按拥堵指数降序", 1732, 330, { size: 8, color: "#8d9a93", align: "right" });
  if (selectedRoad) {
    ctx.fillStyle = "#f0f4ed";
    ctx.beginPath();
    ctx.roundRect(1203, 346, 530, 82, 7);
    ctx.fill();
    canvasLabel(ctx, selectedRoad.name, 1219, 367, { size: 15, color: "#1a2b23", weight: 700 });
    canvasLabel(
      ctx,
      `${GRADE_BY_ID[selectedRoad.grade].label} · ${view.directionMeta.label} · 指数 ${fmt.index(selectedRoad.index)}`,
      1219,
      389,
      { size: 8, color: "#78867f" },
    );
    canvasLabel(ctx, `速度 ${fmt.speed(selectedRoad.speed)} km/h`, 1219, 412, {
      size: 11,
      color: "#2b5d49",
      weight: 600,
    });
    canvasLabel(ctx, `排队 ${fmt.queue(selectedRoad.queue)} m`, 1394, 412, {
      size: 11,
      color: "#a16535",
      weight: 600,
    });
    canvasLabel(ctx, `${selectedRoad.samples} 个采样`, 1718, 412, {
      size: 8,
      color: "#8b9891",
      align: "right",
    });
  } else {
    canvasLabel(ctx, "无匹配路段，未生成虚构详情", 1203, 373, { size: 11, color: "#8a9891" });
  }

  const topRows = view.roads.slice(0, 8);
  canvasLabel(ctx, "路段", 1205, 452, { size: 8, color: "#8b9891" });
  canvasLabel(ctx, "指数", 1515, 452, { size: 8, color: "#8b9891", align: "right" });
  canvasLabel(ctx, "速度", 1605, 452, { size: 8, color: "#8b9891", align: "right" });
  canvasLabel(ctx, "排队", 1724, 452, { size: 8, color: "#8b9891", align: "right" });
  topRows.forEach((road, index) => {
    const y = 473 + index * 28;
    if (index % 2 === 0) {
      ctx.fillStyle = "#f7f8f5";
      ctx.fillRect(1203, y - 11, 530, 25);
    }
    ctx.fillStyle = view.legend.find((bin) => bin.id === road.band).color;
    ctx.fillRect(1204, y - 6, 3, 13);
    canvasLabel(ctx, `${String(index + 1).padStart(2, "0")}  ${road.name}`, 1217, y, {
      size: 9,
      color: "#33463d",
      weight: 600,
    });
    canvasLabel(ctx, fmt.index(road.index), 1515, y, { size: 9, color: "#a75b37", align: "right", weight: 600 });
    canvasLabel(ctx, fmt.speed(road.speed), 1605, y, { size: 9, color: "#40574c", align: "right" });
    canvasLabel(ctx, fmt.queue(road.queue), 1724, y, { size: 9, color: "#40574c", align: "right" });
  });
  if (!topRows.length) {
    canvasLabel(ctx, "空结果 · 0 条路段", 1470, 560, { size: 11, color: "#9aa59f", align: "center" });
  }

  ctx.fillStyle = "#e3e8e2";
  ctx.fillRect(1203, 715, 530, 1);
  canvasLabel(ctx, "数据摘要", 1203, 736, { size: 10, color: "#25382f", weight: 700 });
  const quality = view.quality;
  const qualityItems = [
    ["原始记录", quality.raw],
    ["唯一键去重", quality.duplicates],
    ["补缺字段", quality.filled],
    ["异常修复", quality.anomaly],
    ["坏记录剔除", quality.invalid],
    ["最终可用", quality.final],
  ];
  qualityItems.forEach(([label, value], index) => {
    const x = 1203 + (index % 3) * 178;
    const y = 767 + Math.floor(index / 3) * 46;
    canvasLabel(ctx, label, x, y, { size: 8, color: "#8b9891" });
    canvasLabel(ctx, String(value), x, y + 19, { size: 15, color: "#2a3d34", weight: 600 });
  });
  canvasLabel(ctx, `SHA ${view.dataHash}  ·  视图 ${view.viewRevision.slice(-10)}`, 1203, 860, {
    size: 7,
    color: "#93a099",
  });

  if (route?.roadIds?.length) {
    ctx.fillStyle = "#f2f6e9";
    ctx.beginPath();
    ctx.roundRect(1203, 872, 530, 38, 6);
    ctx.fill();
    canvasLabel(ctx, `避障路线 ${route.roadIds.length} 段 · ${route.lengthKm.toFixed(1)} km`, 1217, 891, {
      size: 9,
      color: "#50613d",
      weight: 600,
    });
    canvasLabel(ctx, `已避开 ${view.closures.length} 条封闭路段`, 1717, 891, {
      size: 8,
      color: "#738267",
      align: "right",
    });
  }
}

function drawExportChart(ctx, view) {
  roundedCard(ctx, 48, 916, 1704, 198);
  canvasLabel(ctx, "拥堵指数曲线 · 5 分钟采样", 66, 940, { size: 13, color: "#1d2b25", weight: 700 });
  canvasLabel(ctx, `窗口均值 ${fmt.index(view.stats.index)}  ·  峰值 ${fmt.index(view.stats.peakIndex)}`, 1734, 940, {
    size: 9,
    color: "#66756e",
    align: "right",
  });
  ctx.save();
  ctx.translate(60, 955);
  drawChart(ctx, { width: 1680, height: 143, view, exportMode: true });
  ctx.restore();
}

function drawExportFooter(ctx, view, exportId) {
  ctx.fillStyle = "#dfe4de";
  ctx.fillRect(48, 1131, 1704, 1);
  canvasLabel(
    ctx,
    "统计口径：速度按采样量加权；排队取路段算术均值；指数 = 65×(1−速度/自由流) + 25×min(排队/150,1) + 10×min(流量/2500,1)。",
    48,
    1150,
    { size: 8, color: "#7c8982" },
  );
  canvasLabel(ctx, `导出 ID ${exportId} · 由当前视图快照实时绘制，未使用预设图形数值`, 48, 1171, {
    size: 8,
    color: "#7c8982",
  });
  canvasLabel(ctx, `DATA ${view.dataHash}`, 1752, 1161, {
    size: 8,
    color: "#9aa59f",
    align: "right",
    weight: 700,
  });
}
