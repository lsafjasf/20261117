import { FLOORS, ZONES } from "./energy-data.js";
import { buildExportManifest } from "./energy-core.js";

export const COLORS = {
  ink: "#17322e",
  inkSoft: "#425851",
  muted: "#77817b",
  line: "rgba(23, 50, 46, 0.13)",
  paper: "#f0ede5",
  card: "#fbfaf6",
  teal: "#12766f",
  mint: "#cde9dd",
  lime: "#d9ed83",
  amber: "#d39b31",
  coral: "#cc654c",
  blue: "#426f91",
};

const SANS = '"Energy Sans", "Aptos", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
const MONO = '"IBM Plex Mono", "SFMono-Regular", "Cascadia Code", "Energy Sans", monospace';

export function formatPower(value, digits = 1) {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatPercent(value, digits = 1) {
  if (!Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

function rgba(hex, alpha) {
  const normalized = hex.replace("#", "");
  const full = normalized.length === 3 ? normalized.split("").map((char) => char + char).join("") : normalized;
  const number = Number.parseInt(full, 16);
  const red = (number >> 16) & 255;
  const green = (number >> 8) & 255;
  const blue = number & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
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

function clippedText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && ctx.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}

function nodeText(ctx, node, x, y, width, height, selected) {
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = COLORS.ink;
  ctx.font = `600 ${width < 84 ? 9 : 10}px ${SANS}`;
  const labelY = height > 35 ? y + height / 2 - 6 : y + height / 2;
  ctx.fillText(clippedText(ctx, node.label, width - 17), x + 11, labelY);
  if (height > 23) {
    ctx.fillStyle = selected ? COLORS.teal : COLORS.muted;
    ctx.font = `500 8px ${MONO}`;
    ctx.fillText(`${formatPower(node.value, 1)} kW`, x + 11, y + height / 2 + 7);
  }
}

export function computeSankeyLayout(snapshot, width, height, selectedNode = null) {
  const nodes = snapshot.flow.nodes;
  const margin = { left: Math.max(18, width * 0.025), right: Math.max(18, width * 0.025), top: 50, bottom: 18 };
  const nodeWidth = Math.max(46, Math.min(108, width * 0.11));
  const availableWidth = width - margin.left - margin.right;
  const gapX = (availableWidth - nodeWidth * 5) / 4;
  const columnX = Array.from({ length: 5 }, (_, index) => margin.left + index * (nodeWidth + gapX));
  const availableHeight = height - margin.top - margin.bottom;
  const gapY = Math.max(7, Math.min(14, height * 0.027));
  const groups = Array.from({ length: 5 }, (_, column) => nodes.filter((node) => node.column === column));
  const totalValue = Math.max(1, snapshot.flow.totals.input);
  let scale = (availableHeight - gapY * 4) / totalValue;

  const heightAtScale = (candidate) => Math.max(...groups.map((group) => (
    group.reduce((sum, node) => sum + Math.max(25, node.value * candidate), 0) + gapY * Math.max(0, group.length - 1)
  )));
  for (let index = 0; index < 30 && heightAtScale(scale) > availableHeight; index += 1) {
    scale *= 0.92;
  }

  const layoutNodes = [];
  for (let column = 0; column < 5; column += 1) {
    const group = groups[column];
    const heights = group.map((node) => Math.max(25, node.value * scale));
    const contentHeight = heights.reduce((sum, item) => sum + item, 0) + gapY * Math.max(0, group.length - 1);
    let cursorY = margin.top + Math.max(0, (availableHeight - contentHeight) / 2);
    group.forEach((node, index) => {
      const nodeHeight = heights[index];
      layoutNodes.push({
        ...node,
        x: columnX[column],
        y: cursorY,
        width: nodeWidth,
        height: nodeHeight,
        selected: node.id === selectedNode,
      });
      cursorY += nodeHeight + gapY;
    });
  }

  const byId = new Map(layoutNodes.map((node) => [node.id, node]));
  const links = snapshot.flow.links.map((link) => ({
    ...link,
    sourceNode: byId.get(link.source),
    targetNode: byId.get(link.target),
    thickness: Math.max(0, link.value * scale),
  })).filter((link) => link.sourceNode && link.targetNode && link.thickness > 0.2);

  const outCursor = new Map();
  const inCursor = new Map();
  for (const node of layoutNodes) {
    const outgoing = links
      .filter((link) => link.source === node.id)
      .sort((a, b) => a.targetNode.y - b.targetNode.y);
    const thickness = outgoing.reduce((sum, link) => sum + link.thickness, 0);
    outCursor.set(node.id, node.y + Math.max(0, (node.height - thickness) / 2));
    const incoming = links
      .filter((link) => link.target === node.id)
      .sort((a, b) => a.sourceNode.y - b.sourceNode.y);
    const incomingThickness = incoming.reduce((sum, link) => sum + link.thickness, 0);
    inCursor.set(node.id, node.y + Math.max(0, (node.height - incomingThickness) / 2));
  }

  for (const link of links) {
    link.startY = outCursor.get(link.source);
    link.endY = inCursor.get(link.target);
    outCursor.set(link.source, link.startY + link.thickness);
    inCursor.set(link.target, link.endY + link.thickness);
  }

  return { width, height, margin, nodeWidth, nodes: layoutNodes, links, columnX, scale };
}

function linkPath(ctx, link, sourceNode, targetNode) {
  const startX = sourceNode.x + sourceNode.width;
  const endX = targetNode.x;
  const middleX = startX + (endX - startX) * 0.48;
  ctx.beginPath();
  ctx.moveTo(startX, link.startY);
  ctx.bezierCurveTo(middleX, link.startY, middleX, link.endY, endX, link.endY);
  ctx.lineTo(endX, link.endY + link.thickness);
  ctx.bezierCurveTo(middleX, link.endY + link.thickness, middleX, link.startY + link.thickness, startX, link.startY + link.thickness);
  ctx.closePath();
}

function pointOnLink(link, sourceNode, targetNode, t) {
  const x0 = sourceNode.x + sourceNode.width;
  const y0 = link.startY + link.thickness / 2;
  const x3 = targetNode.x;
  const y3 = link.endY + link.thickness / 2;
  const x1 = x0 + (x3 - x0) * 0.48;
  const x2 = x1;
  const mt = 1 - t;
  return {
    x: mt ** 3 * x0 + 3 * mt ** 2 * t * x1 + 3 * mt * t ** 2 * x2 + t ** 3 * x3,
    y: mt ** 3 * y0 + 3 * mt ** 2 * t * y0 + 3 * mt * t ** 2 * y3 + t ** 3 * y3,
  };
}

export function drawSankey(ctx, snapshot, width, height, options = {}) {
  const selectedNode = options.selectedNode || null;
  const time = options.time || 0;
  const animate = options.animate !== false;
  const layout = computeSankeyLayout(snapshot, width, height, selectedNode);
  if (options.clear !== false) ctx.clearRect(0, 0, width, height);

  const headers = ["能源输入", "配电转换", "设备转换", "有效服务", "损失"];
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = COLORS.muted;
  ctx.font = `600 8px ${MONO}`;
  layout.columnX.forEach((x, index) => {
    ctx.fillText(headers[index].toLocaleUpperCase("zh-CN"), x + layout.nodeWidth / 2, 15);
  });

  ctx.strokeStyle = "rgba(23, 50, 46, 0.055)";
  ctx.lineWidth = 1;
  layout.columnX.forEach((x) => {
    ctx.beginPath();
    ctx.moveTo(x + layout.nodeWidth / 2, 30);
    ctx.lineTo(x + layout.nodeWidth / 2, height - 6);
    ctx.stroke();
  });

  layout.links.forEach((link, index) => {
    const gradient = ctx.createLinearGradient(
      link.sourceNode.x + link.sourceNode.width,
      0,
      link.targetNode.x,
      0,
    );
    gradient.addColorStop(0, rgba(link.color, 0.29));
    gradient.addColorStop(1, rgba(link.color, 0.16));
    ctx.fillStyle = gradient;
    linkPath(ctx, link, link.sourceNode, link.targetNode);
    ctx.fill();
    ctx.strokeStyle = rgba(link.color, 0.16);
    ctx.lineWidth = 0.7;
    ctx.stroke();

    if (link.thickness > 3) {
      const arrow = pointOnLink(link, link.sourceNode, link.targetNode, 0.62);
      const before = pointOnLink(link, link.sourceNode, link.targetNode, 0.6);
      const angle = Math.atan2(arrow.y - before.y, arrow.x - before.x);
      ctx.save();
      ctx.translate(arrow.x, arrow.y);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(4, 0);
      ctx.lineTo(-2, -2.4);
      ctx.lineTo(-2, 2.4);
      ctx.closePath();
      ctx.fillStyle = rgba(link.color, 0.68);
      ctx.fill();
      ctx.restore();
    }

    if (animate && link.thickness > 5) {
      for (let dot = 0; dot < 2; dot += 1) {
        const t = (time * 0.000075 + index * 0.093 + dot * 0.42) % 1;
        const point = pointOnLink(link, link.sourceNode, link.targetNode, t);
        ctx.beginPath();
        ctx.arc(point.x, point.y, 1.45, 0, Math.PI * 2);
        ctx.fillStyle = rgba(link.color, 0.88);
        ctx.fill();
      }
    }
  });

  for (const node of layout.nodes) {
    if (node.selected) {
      roundedRect(ctx, node.x - 4, node.y - 4, node.width + 8, node.height + 8, 8);
      ctx.fillStyle = rgba(node.color, 0.09);
      ctx.fill();
      ctx.strokeStyle = rgba(node.color, 0.5);
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    roundedRect(ctx, node.x, node.y, node.width, node.height, 6);
    ctx.fillStyle = node.selected ? "#ffffff" : COLORS.card;
    ctx.fill();
    ctx.strokeStyle = node.selected ? rgba(node.color, 0.75) : "rgba(23, 50, 46, 0.14)";
    ctx.lineWidth = node.selected ? 1.4 : 0.8;
    ctx.stroke();
    roundedRect(ctx, node.x + 4, node.y + 5, 3, Math.max(5, node.height - 10), 2);
    ctx.fillStyle = node.color;
    ctx.fill();
    nodeText(ctx, node, node.x, node.y, node.width, node.height, node.selected);
  }

  return layout;
}

function interpolateColor(from, to, amount) {
  const parse = (hex) => {
    const normalized = hex.replace("#", "");
    return [Number.parseInt(normalized.slice(0, 2), 16), Number.parseInt(normalized.slice(2, 4), 16), Number.parseInt(normalized.slice(4, 6), 16)];
  };
  const a = parse(from);
  const b = parse(to);
  const mix = a.map((channel, index) => Math.round(channel + (b[index] - channel) * amount));
  return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
}

export function heatColor(amount) {
  const clamped = Math.max(0, Math.min(1, amount));
  if (clamped < 0.5) return interpolateColor("#dce9dc", "#d3a044", clamped * 2);
  return interpolateColor("#d3a044", "#bb5541", (clamped - 0.5) * 2);
}

export function drawCurve(ctx, snapshot, width, height, options = {}) {
  const rangeMode = options.rangeMode || "window";
  const hoverSlot = Number.isInteger(options.hoverSlot) ? options.hoverSlot : null;
  const animate = options.animate === true;
  const time = options.time || 0;
  const window = snapshot.window;
  const startSlot = rangeMode === "day" ? 0 : window.startSlot;
  const endSlot = rangeMode === "day" ? 87 : window.endSlot - 1;
  const margin = { left: 42, right: 15, top: 16, bottom: 27 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const visible = snapshot.aggregate.day.filter((item) => item.slot >= startSlot && item.slot <= endSlot);
  const maxValue = Math.max(10, ...visible.map((item) => item.totalPower));
  const yMax = Math.ceil((maxValue * 1.16) / 10) * 10;
  const xFor = (slot) => margin.left + ((slot - startSlot) / Math.max(1, endSlot - startSlot)) * plotWidth;
  const yFor = (value) => margin.top + plotHeight - (value / yMax) * plotHeight;

  if (options.clear !== false) ctx.clearRect(0, 0, width, height);

  const activeStart = Math.max(startSlot, window.startSlot);
  const activeEnd = Math.min(endSlot, window.endSlot - 1);
  if (activeStart <= activeEnd) {
    ctx.fillStyle = "rgba(217, 237, 131, 0.13)";
    ctx.fillRect(xFor(activeStart), margin.top, Math.max(2, xFor(activeEnd) - xFor(activeStart)), plotHeight);
    ctx.fillStyle = "rgba(18, 118, 111, 0.65)";
    ctx.font = `600 7px ${MONO}`;
    ctx.textAlign = "left";
    ctx.fillText("ACTIVE", xFor(activeStart) + 4, margin.top + 8);
  }

  ctx.strokeStyle = "rgba(23, 50, 46, 0.08)";
  ctx.lineWidth = 1;
  ctx.font = `500 7px ${MONO}`;
  ctx.fillStyle = COLORS.muted;
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = (yMax / 4) * tick;
    const y = yFor(value);
    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(width - margin.right, y);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(`${Math.round(value)}`, margin.left - 7, y);
  }

  const totalPoints = visible.map((item) => ({ x: xFor(item.slot), y: yFor(item.totalPower) }));
  if (totalPoints.length) {
    ctx.beginPath();
    totalPoints.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.lineTo(totalPoints.at(-1).x, margin.top + plotHeight);
    ctx.lineTo(totalPoints[0].x, margin.top + plotHeight);
    ctx.closePath();
    const area = ctx.createLinearGradient(0, margin.top, 0, margin.top + plotHeight);
    area.addColorStop(0, "rgba(18, 118, 111, 0.21)");
    area.addColorStop(1, "rgba(18, 118, 111, 0.015)");
    ctx.fillStyle = area;
    ctx.fill();

    ctx.beginPath();
    totalPoints.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = COLORS.teal;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = "round";
    ctx.stroke();

    const showPv = snapshot.config.filter.source !== "grid";
    if (showPv) {
      ctx.beginPath();
      visible.forEach((item, index) => {
        const x = xFor(item.slot);
        const y = yFor(item.pvPower);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = COLORS.amber;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  const tickHours = rangeMode === "day" ? [0, 6, 12, 18, 22] : Array.from(
    { length: Math.floor((window.end - window.start) / 2) + 1 },
    (_, index) => window.start + index * 2,
  );
  ctx.fillStyle = COLORS.muted;
  ctx.font = `500 7px ${MONO}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const hour of tickHours) {
    const slot = Math.min(87, hour * 4);
    if (slot < startSlot || slot > endSlot) continue;
    const x = xFor(slot);
    ctx.fillText(`${String(hour).padStart(2, "0")}:00`, x, height - margin.bottom + 7);
  }

  if (hoverSlot !== null && hoverSlot >= startSlot && hoverSlot <= endSlot) {
    const item = snapshot.aggregate.day[hoverSlot];
    if (item) {
      const x = xFor(item.slot);
      const y = yFor(item.totalPower);
      const pulse = animate ? 1.5 + Math.sin(time * 0.004) * 0.6 : 2;
      ctx.beginPath();
      ctx.moveTo(x, margin.top);
      ctx.lineTo(x, margin.top + plotHeight);
      ctx.strokeStyle = "rgba(23, 50, 46, 0.2)";
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, pulse + 3, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(18, 118, 111, 0.12)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, pulse, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.teal;
      ctx.fill();

      const boxWidth = 118;
      const boxHeight = 45;
      const boxX = Math.min(width - boxWidth - 4, Math.max(margin.left, x - boxWidth / 2));
      const boxY = Math.max(margin.top + 2, y - boxHeight - 9);
      roundedRect(ctx, boxX, boxY, boxWidth, boxHeight, 6);
      ctx.fillStyle = "rgba(23, 50, 46, 0.93)";
      ctx.fill();
      ctx.fillStyle = "#f7f4ec";
      ctx.font = `600 9px ${MONO}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(item.time, boxX + 8, boxY + 7);
      ctx.fillStyle = "rgba(247, 244, 236, 0.68)";
      ctx.font = `500 8px ${MONO}`;
      ctx.fillText(`总 ${formatPower(item.totalPower)} kW`, boxX + 8, boxY + 20);
      ctx.fillText(`PV ${formatPower(item.pvPower)} kW`, boxX + 8, boxY + 31);
    }
  }

  return { startSlot, endSlot, yMax, xFor, margin };
}

export function drawMap(ctx, snapshot, width, height) {
  const filterFloor = snapshot.config.filter.floor;
  const floorList = filterFloor === "all" ? FLOORS : FLOORS.filter((floor) => floor.id === filterFloor);
  const padding = 11;
  const labelWidth = 36;
  const rowGap = 7;
  const rowHeight = (height - padding * 2 - rowGap * Math.max(0, floorList.length - 1)) / Math.max(1, floorList.length);
  const zoneValues = new Map(snapshot.aggregate.zones.map((zone) => [zone.zoneId, zone.averagePower]));
  const maxValue = Math.max(1, ...snapshot.aggregate.zones.map((zone) => zone.averagePower));
  const hitZones = [];

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(23, 50, 46, 0.018)";
  ctx.fillRect(0, 0, width, height);

  floorList.forEach((floor, floorIndex) => {
    const y = padding + floorIndex * (rowHeight + rowGap);
    const plateX = padding + labelWidth;
    const plateWidth = width - plateX - padding;
    roundedRect(ctx, plateX, y, plateWidth, rowHeight, 8);
    ctx.fillStyle = floor.id === "roof" ? "rgba(211, 155, 49, 0.055)" : "rgba(255, 255, 255, 0.48)";
    ctx.fill();
    ctx.strokeStyle = "rgba(23, 50, 46, 0.09)";
    ctx.lineWidth = 0.8;
    ctx.stroke();

    ctx.fillStyle = COLORS.ink;
    ctx.font = `600 9px ${MONO}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(floor.label, padding, y + rowHeight / 2 - 5);
    ctx.fillStyle = COLORS.muted;
    ctx.font = `500 7px ${SANS}`;
    ctx.fillText(floor.name, padding, y + rowHeight / 2 + 6);

    const floorZones = ZONES.filter((zone) => zone.floor === floor.id);
    const innerPadding = 6;
    const cellGap = 4;
    const cellWidth = (plateWidth - innerPadding * 2 - cellGap * Math.max(0, floorZones.length - 1)) / Math.max(1, floorZones.length);
    floorZones.forEach((zone, zoneIndex) => {
      const value = zoneValues.get(zone.id) || 0;
      const intensity = value > 0 ? 0.16 + (value / maxValue) * 0.84 : 0;
      const x = plateX + innerPadding + zoneIndex * (cellWidth + cellGap);
      const cellY = y + innerPadding;
      const cellHeight = rowHeight - innerPadding * 2;
      hitZones.push({ x, y: cellY, width: cellWidth, height: cellHeight, zoneId: zone.id, zoneName: zone.name });
      roundedRect(ctx, x, cellY, cellWidth, cellHeight, 5);
      ctx.fillStyle = value > 0 ? heatColor(intensity) : "rgba(23, 50, 46, 0.035)";
      ctx.fill();
      if (value > 0) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.26)";
        for (let stripe = 0; stripe < 3; stripe += 1) {
          const sy = cellY + 8 + stripe * 13;
          if (sy < cellY + cellHeight - 4) ctx.fillRect(x + 7, sy, Math.max(8, cellWidth * 0.28), 1);
        }
      }
      ctx.strokeStyle = "rgba(23, 50, 46, 0.08)";
      ctx.stroke();

      ctx.fillStyle = value > 0 ? "rgba(255, 255, 255, 0.95)" : COLORS.inkSoft;
      ctx.font = `600 ${cellWidth < 55 ? 7 : 8}px ${SANS}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(clippedText(ctx, zone.name, cellWidth - 12), x + 6, cellY + 6);
      ctx.fillStyle = value > 0 ? "rgba(255, 255, 255, 0.78)" : COLORS.muted;
      ctx.font = `500 7px ${MONO}`;
      ctx.fillText(value > 0 ? `${formatPower(value, 1)} kW` : "无命中", x + 6, cellY + cellHeight - 15);
    });
  });

  if (!snapshot.aggregate.hasData) {
    ctx.fillStyle = "rgba(251, 250, 246, 0.62)";
    ctx.fillRect(0, 0, width, height);
  }
  return { floorList, hitZones };
}

function drawReportCard(ctx, x, y, width, height, radius = 16) {
  roundedRect(ctx, x, y, width, height, radius);
  ctx.fillStyle = COLORS.card;
  ctx.fill();
  ctx.strokeStyle = "rgba(23, 50, 46, 0.14)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function reportLabel(ctx, text, x, y, color = COLORS.muted, size = 10, weight = 600) {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${MONO}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(text, x, y);
}

export function drawExportReport(snapshot, width = 1800, height = 1320) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const manifest = buildExportManifest(snapshot);
  const margin = 58;
  const gap = 22;
  const contentWidth = width - margin * 2;

  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(23, 50, 46, 0.025)";
  for (let x = 0; x < width; x += 40) {
    for (let y = 0; y < height; y += 40) ctx.fillRect(x, y, 1, 1);
  }

  ctx.fillStyle = COLORS.ink;
  ctx.font = `700 36px ${SANS}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(manifest.title, margin, 48);
  reportLabel(ctx, "ENERGY ATLAS / EXPORTED SNAPSHOT", margin, 99, COLORS.teal, 10, 700);

  ctx.textAlign = "right";
  ctx.fillStyle = COLORS.ink;
  ctx.font = `500 12px ${MONO}`;
  ctx.fillText(`${manifest.dataset.label} · ${manifest.window.label} ${manifest.window.range}`, width - margin, 56);
  ctx.fillStyle = COLORS.muted;
  ctx.font = `500 9px ${MONO}`;
  ctx.fillText(`${manifest.dataVersion} / ${manifest.scenarioVersion}`, width - margin, 80);
  ctx.fillText(`生成 ${new Date(manifest.generatedAt).toLocaleString("zh-CN", { hour12: false })}`, width - margin, 98);

  const conditionY = 125;
  roundedRect(ctx, margin, conditionY, contentWidth, 48, 9);
  ctx.fillStyle = "rgba(255, 255, 255, 0.58)";
  ctx.fill();
  ctx.strokeStyle = "rgba(23, 50, 46, 0.12)";
  ctx.stroke();
  reportLabel(ctx, "当前筛选", margin + 16, conditionY + 12, COLORS.teal, 9, 700);
  ctx.fillStyle = COLORS.ink;
  ctx.font = `600 13px ${SANS}`;
  ctx.textAlign = "left";
  const displaySuffix = manifest.displayRange === manifest.window.range ? "" : ` · 显示 ${manifest.displayRange}`;
  ctx.fillText(clippedText(ctx, `${manifest.filter.text} · ${manifest.window.range}${displaySuffix}`, contentWidth - 240), margin + 82, conditionY + 17);
  ctx.textAlign = "right";
  ctx.fillStyle = COLORS.inkSoft;
  ctx.font = `500 10px ${MONO}`;
  ctx.fillText(`守恒 ${manifest.conservation.ok ? "PASS" : "FAIL"} · 误差 ${manifest.conservation.balanceError.toExponential(1)} kW`, width - margin - 16, conditionY + 19);

  const kpiY = 194;
  const kpiGap = 12;
  const kpiWidth = (contentWidth - kpiGap * 3) / 4;
  const cards = [
    ["总输入", formatPower(manifest.kpis.input, 1), "kW", COLORS.teal],
    ["有效服务", formatPower(manifest.kpis.useful, 1), "kW", "#688b39"],
    ["能量损失", formatPower(manifest.kpis.loss, 1), "kW", COLORS.coral],
    ["系统效率", formatPercent(manifest.kpis.efficiency, 1), "", "#986f1e"],
  ];
  cards.forEach(([label, value, unit, accent], index) => {
    const x = margin + index * (kpiWidth + kpiGap);
    drawReportCard(ctx, x, kpiY, kpiWidth, 110, 12);
    reportLabel(ctx, label, x + 17, kpiY + 16, COLORS.muted, 9, 700);
    ctx.fillStyle = accent;
    ctx.font = `500 32px ${MONO}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(value, x + 17, kpiY + 41);
    if (unit) {
      ctx.fillStyle = COLORS.muted;
      ctx.font = `500 10px ${MONO}`;
      ctx.fillText(unit, x + 24 + ctx.measureText(value).width, kpiY + 60);
    }
    ctx.fillStyle = rgba(accent, 0.18);
    ctx.fillRect(x + 17, kpiY + 88, (kpiWidth - 34) * (index === 3 ? Math.min(1, manifest.kpis.efficiency) : 1), 3);
  });

  const flowY = 326;
  const flowHeight = 654;
  const flowWidth = contentWidth * 0.66 - 10;
  drawReportCard(ctx, margin, flowY, flowWidth, flowHeight);
  reportLabel(ctx, "建筑能量流 / SANKEY", margin + 18, flowY + 16, COLORS.teal, 9, 700);
  ctx.fillStyle = COLORS.ink;
  ctx.font = `600 18px ${SANS}`;
  ctx.fillText(`${manifest.window.label}窗口 · 设备负载场景`, margin + 18, flowY + 34);
  ctx.save();
  ctx.translate(margin + 9, flowY + 54);
  drawSankey(ctx, snapshot, flowWidth - 18, flowHeight - 62, {
    selectedNode: snapshot.config.selectedNode,
    animate: false,
    clear: false,
  });
  ctx.restore();

  const rightX = margin + flowWidth + gap;
  const rightWidth = contentWidth - flowWidth - gap;
  drawReportCard(ctx, rightX, flowY, rightWidth, 350);
  reportLabel(ctx, "数据摘要 / DATA QUALITY", rightX + 18, flowY + 16, COLORS.teal, 9, 700);
  const summaryRows = [
    ["原始记录", `${snapshot.clean.stats.rawCount}`],
    ["去重记录", `${snapshot.clean.stats.duplicates}`],
    ["补缺点", `${snapshot.clean.stats.missingFilled}`],
    ["异常修正", `${snapshot.clean.stats.anomaliesCorrected}`],
    ["当前窗口样本", `${manifest.quality.records}`],
    ["当前窗口补缺 / 修正", `${manifest.quality.filled} / ${manifest.quality.corrected}`],
  ];
  summaryRows.forEach(([label, value], index) => {
    const rowY = flowY + 48 + index * 43;
    ctx.fillStyle = COLORS.muted;
    ctx.font = `500 10px ${SANS}`;
    ctx.textAlign = "left";
    ctx.fillText(label, rightX + 18, rowY);
    ctx.fillStyle = COLORS.ink;
    ctx.font = `600 16px ${MONO}`;
    ctx.textAlign = "right";
    ctx.fillText(value, rightX + rightWidth - 18, rowY - 2);
    ctx.strokeStyle = "rgba(23, 50, 46, 0.08)";
    ctx.beginPath();
    ctx.moveTo(rightX + 18, rowY + 16);
    ctx.lineTo(rightX + rightWidth - 18, rowY + 16);
    ctx.stroke();
  });

  drawReportCard(ctx, rightX, flowY + 370, rightWidth, 284);
  reportLabel(ctx, "节点功率 / NODE POWER", rightX + 18, flowY + 386, COLORS.teal, 9, 700);
  const nodes = manifest.nodes;
  nodes.forEach((node, index) => {
    const rowY = flowY + 408 + index * 16;
    ctx.fillStyle = index % 2 === 0 ? "rgba(23, 50, 46, 0.025)" : "transparent";
    ctx.fillRect(rightX + 12, rowY - 4, rightWidth - 24, 15);
    ctx.fillStyle = COLORS.inkSoft;
    ctx.font = `500 8px ${SANS}`;
    ctx.textAlign = "left";
    ctx.fillText(node.label, rightX + 20, rowY);
    ctx.fillStyle = COLORS.ink;
    ctx.font = `600 8px ${MONO}`;
    ctx.textAlign = "right";
    ctx.fillText(`${formatPower(node.value, 1)} kW`, rightX + rightWidth - 20, rowY);
  });

  const curveY = 1002;
  const curveHeight = 260;
  drawReportCard(ctx, margin, curveY, contentWidth, curveHeight);
  reportLabel(ctx, "功率曲线 / LOAD PROFILE", margin + 18, curveY + 15, COLORS.teal, 9, 700);
  ctx.fillStyle = COLORS.ink;
  ctx.font = `600 16px ${SANS}`;
  ctx.fillText(`${manifest.displayRange} · 总输入 ${formatPower(manifest.kpis.input, 1)} kW`, margin + 18, curveY + 33);
  ctx.save();
  ctx.translate(margin + 18, curveY + 58);
  drawCurve(ctx, snapshot, contentWidth - 36, 188, {
    rangeMode: snapshot.config.rangeMode,
    animate: false,
    clear: false,
  });
  ctx.restore();

  ctx.strokeStyle = "rgba(23, 50, 46, 0.12)";
  ctx.beginPath();
  ctx.moveTo(margin, height - 42);
  ctx.lineTo(width - margin, height - 42);
  ctx.stroke();
  ctx.fillStyle = COLORS.muted;
  ctx.font = `500 8px ${MONO}`;
  ctx.textAlign = "left";
  ctx.fillText(`统计口径：${manifest.scope}`, margin, height - 29);
  ctx.textAlign = "right";
  ctx.fillText(`${manifest.dataVersion} · ${manifest.scenarioVersion} · 数值与屏幕同快照`, width - margin, height - 29);
  return canvas;
}
