import { AIRPORTS } from "./data.js";

const MAP_BOUNDS = {
  minLon: 98,
  maxLon: 126,
  minLat: 18,
  maxLat: 42,
};

const CHINA_OUTLINE = [
  [109.2, 20.8],
  [111.5, 20.4],
  [113.8, 21.8],
  [116.3, 20.7],
  [118.3, 23.1],
  [120.1, 22.4],
  [122.1, 24.4],
  [121.2, 27],
  [122, 29.1],
  [121.6, 31.5],
  [120.9, 34.1],
  [122.2, 37.1],
  [119.8, 39.1],
  [118.1, 40.4],
  [115.9, 41.2],
  [113.4, 42],
  [110.2, 41.4],
  [106.9, 42],
  [103.1, 40.9],
  [100.7, 39],
  [98.8, 36.8],
  [100, 33.5],
  [98.9, 30.2],
  [101.1, 27.1],
  [102.3, 23.9],
  [105.1, 22.1],
  [107.2, 21.1],
];

const DELAY_BANDS = [
  { max: 15, color: "#43d49c", label: "≤ 15 分 · 准点" },
  { max: 30, color: "#f2b84b", label: "16–30 分" },
  { max: 45, color: "#f58a4b", label: "31–45 分" },
  { max: Infinity, color: "#f26479", label: "> 45 分" },
];

export function getDelayBand(delay) {
  if (delay == null || !Number.isFinite(delay)) {
    return { max: Infinity, color: "#73889a", label: "暂无有效延误" };
  }
  return DELAY_BANDS.find((band) => delay <= band.max) ?? DELAY_BANDS.at(-1);
}

export function routeWidth(count) {
  return Math.min(9, 1.2 + Math.sqrt(Math.max(0, count)) * 1.9);
}

function baseProject(lat, lon, width, height) {
  const padX = Math.max(28, width * 0.055);
  const padY = Math.max(24, height * 0.065);
  const x =
    padX +
    ((lon - MAP_BOUNDS.minLon) / (MAP_BOUNDS.maxLon - MAP_BOUNDS.minLon)) *
      (width - padX * 2);
  const y =
    padY +
    ((MAP_BOUNDS.maxLat - lat) / (MAP_BOUNDS.maxLat - MAP_BOUNDS.minLat)) *
      (height - padY * 2);
  return { x, y };
}

export function projectAirport(code, width, height, view = {}) {
  const airport = AIRPORTS[code];
  if (!airport) return { x: 0, y: 0 };
  const point = baseProject(airport.lat, airport.lon, width, height);
  const scale = view.scale ?? 1;
  const cx = width / 2;
  const cy = height / 2;
  return {
    x: (point.x - cx) * scale + cx + (view.panX ?? 0),
    y: (point.y - cy) * scale + cy + (view.panY ?? 0),
  };
}

function projectCoordinate(lat, lon, width, height, view) {
  const point = baseProject(lat, lon, width, height);
  const scale = view.scale ?? 1;
  const cx = width / 2;
  const cy = height / 2;
  return {
    x: (point.x - cx) * scale + cx + (view.panX ?? 0),
    y: (point.y - cy) * scale + cy + (view.panY ?? 0),
  };
}

function prepareCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const targetWidth = Math.round(width * dpr);
  const targetHeight = Math.round(height * dpr);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  const context = canvas.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { context, width, height, dpr };
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

function drawBackground(context, width, height) {
  const gradient = context.createRadialGradient(
    width * 0.55,
    height * 0.42,
    20,
    width * 0.55,
    height * 0.42,
    Math.max(width, height) * 0.74,
  );
  gradient.addColorStop(0, "#0c2337");
  gradient.addColorStop(1, "#06121f");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  context.save();
  context.strokeStyle = "rgba(81, 129, 158, 0.11)";
  context.lineWidth = 1;
  context.setLineDash([2, 6]);
  for (let lon = 100; lon <= 125; lon += 5) {
    const top = projectCoordinate(42, lon, width, height, { scale: 1 });
    const bottom = projectCoordinate(18, lon, width, height, { scale: 1 });
    context.beginPath();
    context.moveTo(top.x, top.y);
    context.lineTo(bottom.x, bottom.y);
    context.stroke();
  }
  for (let lat = 20; lat <= 40; lat += 5) {
    const left = projectCoordinate(lat, 98, width, height, { scale: 1 });
    const right = projectCoordinate(lat, 126, width, height, { scale: 1 });
    context.beginPath();
    context.moveTo(left.x, left.y);
    context.lineTo(right.x, right.y);
    context.stroke();
  }
  context.restore();
}

function drawLand(context, width, height, view) {
  const points = CHINA_OUTLINE.map(([lon, lat]) =>
    projectCoordinate(lat, lon, width, height, view),
  );
  context.save();
  context.beginPath();
  points.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.closePath();
  context.fillStyle = "rgba(25, 62, 83, 0.24)";
  context.fill();
  context.strokeStyle = "rgba(80, 137, 165, 0.22)";
  context.lineWidth = 1;
  context.stroke();

  const hainan = projectCoordinate(19.2, 109.7, width, height, view);
  context.beginPath();
  context.ellipse(hainan.x, hainan.y, 8 * (view.scale ?? 1), 5 * (view.scale ?? 1), -0.5, 0, Math.PI * 2);
  context.fillStyle = "rgba(25, 62, 83, 0.24)";
  context.fill();
  context.strokeStyle = "rgba(80, 137, 165, 0.2)";
  context.stroke();
  context.restore();
}

function curveControl(origin, destination, key) {
  const midX = (origin.x + destination.x) / 2;
  const midY = (origin.y + destination.y) / 2;
  const dx = destination.x - origin.x;
  const dy = destination.y - origin.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return { x: midX, y: midY };
  const direction = [...key].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 2 ? 1 : -1;
  const bend = Math.min(56, distance * 0.105) * direction;
  return {
    x: midX + (-dy / distance) * bend,
    y: midY + (dx / distance) * bend,
  };
}

function sampleQuadratic(origin, control, destination, samples = 28) {
  return Array.from({ length: samples + 1 }, (_, index) => {
    const t = index / samples;
    const inverse = 1 - t;
    return {
      x: inverse * inverse * origin.x + 2 * inverse * t * control.x + t * t * destination.x,
      y: inverse * inverse * origin.y + 2 * inverse * t * control.y + t * t * destination.y,
    };
  });
}

function traceCurve(context, points) {
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x, points[index].y);
  }
}

function drawLegend(context, width, height, routes) {
  const compact = width < 520;
  const boxWidth = compact ? 158 : 185;
  const boxHeight = compact ? 102 : 112;
  const x = compact ? 12 : 18;
  const y = height - boxHeight - 14;

  context.save();
  roundedRect(context, x, y, boxWidth, boxHeight, 8);
  context.fillStyle = "rgba(5, 17, 29, 0.86)";
  context.fill();
  context.strokeStyle = "rgba(92, 135, 158, 0.2)";
  context.lineWidth = 1;
  context.stroke();

  context.fillStyle = "#a9becb";
  context.font = '600 9px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
  context.fillText("图例 · 平均延误", x + 10, y + 16);
  DELAY_BANDS.forEach((band, index) => {
    const rowY = y + 28 + index * 15;
    context.beginPath();
    context.moveTo(x + 11, rowY);
    context.lineTo(x + 27, rowY);
    context.strokeStyle = band.color;
    context.lineWidth = 3;
    context.stroke();
    context.fillStyle = "#7f98aa";
    context.font = '8.5px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
    context.fillText(band.label, x + 34, rowY + 3);
  });

  const widthY = y + boxHeight - 14;
  const sampleCount = routes.length
    ? Math.round(routes.reduce((sum, route) => sum + route.count, 0) / routes.length)
    : 0;
  context.strokeStyle = "#a8becb";
  context.lineWidth = routeWidth(sampleCount || 1);
  context.beginPath();
  context.moveTo(x + 11, widthY);
  context.lineTo(x + 27, widthY);
  context.stroke();
  context.fillStyle = "#7f98aa";
  context.font = '8.5px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
  context.fillText("宽度 · 班次量", x + 34, widthY + 3);
  context.restore();
}

export function drawRouteMap(canvas, snapshot, options = {}) {
  const { context, width, height } = prepareCanvas(canvas);
  const view = options.mapView ?? { scale: 1, panX: 0, panY: 0 };
  const selectedRouteKey = options.selectedRouteKey ?? null;
  const hoveredRouteKey = options.hoveredRouteKey ?? null;
  context.clearRect(0, 0, width, height);
  drawBackground(context, width, height);
  drawLand(context, width, height, view);

  const traffic = new Map();
  for (const flight of snapshot.flights) {
    traffic.set(flight.origin, (traffic.get(flight.origin) ?? 0) + 1);
    traffic.set(flight.destination, (traffic.get(flight.destination) ?? 0) + 1);
  }

  const airportPoints = new Map(
    Object.keys(AIRPORTS).map((code) => [
      code,
      projectAirport(code, width, height, view),
    ]),
  );
  const geometryRoutes = [];

  const sortedRoutes = [...snapshot.routes].sort((a, b) => {
    if (a.key === selectedRouteKey) return 1;
    if (b.key === selectedRouteKey) return -1;
    if (a.key === hoveredRouteKey) return 1;
    if (b.key === hoveredRouteKey) return -1;
    return b.count - a.count;
  });

  for (const route of sortedRoutes) {
    const origin = airportPoints.get(route.origin);
    const destination = airportPoints.get(route.destination);
    if (!origin || !destination) continue;
    const control = curveControl(origin, destination, route.key);
    const points = sampleQuadratic(origin, control, destination);
    const band = getDelayBand(route.avgDelay);
    const isSelected = route.key === selectedRouteKey;
    const isHovered = route.key === hoveredRouteKey;
    const activeOpacity = selectedRouteKey && !isSelected ? 0.52 : 1;

    context.save();
    context.globalAlpha = activeOpacity;
    if (isSelected) {
      traceCurve(context, points);
      context.strokeStyle = "rgba(89, 215, 232, 0.2)";
      context.lineWidth = routeWidth(route.count) + 9;
      context.stroke();
    }
    if (isHovered) {
      traceCurve(context, points);
      context.strokeStyle = "rgba(225, 244, 250, 0.2)";
      context.lineWidth = routeWidth(route.count) + 5;
      context.stroke();
    }
    traceCurve(context, points);
    context.strokeStyle = isSelected ? "#a9f1f8" : band.color;
    context.lineWidth = routeWidth(route.count) + (isSelected ? 1.1 : 0);
    context.lineCap = "round";
    context.setLineDash(route.avgDelay == null ? [4, 4] : []);
    context.shadowColor = band.color;
    context.shadowBlur = isSelected ? 12 : isHovered ? 8 : 3;
    context.stroke();
    context.setLineDash([]);
    context.shadowBlur = 0;

    if (route.cancelledCount > 0) {
      const marker = points[Math.floor(points.length * 0.5)];
      context.beginPath();
      context.arc(marker.x, marker.y, 2.3, 0, Math.PI * 2);
      context.fillStyle = "#f26479";
      context.fill();
      context.strokeStyle = "#071522";
      context.lineWidth = 1;
      context.stroke();
    }
    context.restore();

    geometryRoutes.push({
      key: route.key,
      route,
      points,
      color: band.color,
      width: routeWidth(route.count),
    });
  }

  const sortedAirports = Object.entries(AIRPORTS).sort(
    (a, b) => (traffic.get(b[0]) ?? 0) - (traffic.get(a[0]) ?? 0),
  );
  for (const [code] of sortedAirports) {
    const point = airportPoints.get(code);
    const trafficCount = traffic.get(code) ?? 0;
    const radius = 2.4 + Math.min(4.5, Math.sqrt(trafficCount) * 1.4);
    context.save();
    if (trafficCount > 0) {
      const glow = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius + 13);
      glow.addColorStop(0, "rgba(89, 215, 232, 0.17)");
      glow.addColorStop(1, "rgba(89, 215, 232, 0)");
      context.fillStyle = glow;
      context.beginPath();
      context.arc(point.x, point.y, radius + 13, 0, Math.PI * 2);
      context.fill();
    }

    context.beginPath();
    context.arc(point.x, point.y, radius + 2, 0, Math.PI * 2);
    context.fillStyle = "#071725";
    context.fill();
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fillStyle = trafficCount ? "#9cecf3" : "#50687a";
    context.fill();
    context.strokeStyle = trafficCount ? "#59d7e8" : "rgba(125, 151, 168, 0.55)";
    context.lineWidth = 1;
    context.stroke();

    const label = code;
    context.font = '600 8.5px "SFMono-Regular", Consolas, monospace';
    const labelWidth = context.measureText(label).width;
    context.fillStyle = trafficCount ? "rgba(6, 20, 33, 0.8)" : "rgba(6, 20, 33, 0.55)";
    roundedRect(context, point.x + radius + 3, point.y - 11, labelWidth + 8, 13, 3);
    context.fill();
    context.fillStyle = trafficCount ? "#bfdce5" : "#6d8494";
    context.fillText(label, point.x + radius + 7, point.y - 1.5);
    context.restore();
  }

  context.save();
  context.fillStyle = "#5e7a8d";
  context.font = '500 8px "SFMono-Regular", Consolas, monospace';
  context.fillText(
    `${Object.keys(AIRPORTS).length} AIRPORTS  /  ${snapshot.routes.length} ACTIVE ROUTES`,
    17,
    20,
  );
  context.textAlign = "right";
  context.fillText("CHINA AIRSPACE · 2026-11-17", width - 17, 20);
  context.restore();

  drawLegend(context, width, height, snapshot.routes);
  return {
    width,
    height,
    routes: geometryRoutes,
    airports: [...airportPoints.entries()].map(([code, point]) => ({ code, ...point })),
  };
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

export function hitTestRoutes(geometry, point, tolerance = 10) {
  let closest = null;
  for (const item of geometry?.routes ?? []) {
    const threshold = Math.max(tolerance, item.width / 2 + 5);
    for (let index = 1; index < item.points.length; index += 1) {
      const distance = distanceToSegment(point, item.points[index - 1], item.points[index]);
      if (distance <= threshold && (!closest || distance < closest.distance)) {
        closest = { ...item, distance };
      }
    }
  }
  return closest;
}
