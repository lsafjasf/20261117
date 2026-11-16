(function () {
  "use strict";

  const P = window.FluidPhysics;
  const networkCanvas = document.getElementById("networkCanvas");
  const trendCanvas = document.getElementById("trendCanvas");
  const mono = '"IBM Plex Mono", "SFMono-Regular", Consolas, "ConsoleSC", monospace';
  const sans = '"Avenir Next", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
  const colors = {
    text: "#e6f1ee",
    muted: "#78918f",
    subtle: "rgba(120,145,143,.42)",
    cyan: "#55e0c2",
    cyanSoft: "rgba(85,224,194,.22)",
    blue: "#5fb7d5",
    amber: "#f2b75d",
    coral: "#ff766f",
    pipe: "rgba(91,125,127,.52)",
    pipeEdge: "rgba(0,0,0,.52)",
    panel: "#0a171b"
  };

  const layout = {
    pump: { x: 0.078, y: 0.62, r: 0.041 },
    header: { x: 0.19, y: 0.62 },
    v1: { x: 0.3, y: 0.34 },
    v2: { x: 0.3, y: 0.84 },
    splitA: { x: 0.365, y: 0.34 },
    tanks: [
      { x: 0.4, y: 0.18, w: 0.118, h: 0.35, cx: 0.459, target: 2.1 },
      { x: 0.585, y: 0.18, w: 0.118, h: 0.35, cx: 0.644, target: 1.4 },
      { x: 0.785, y: 0.39, w: 0.122, h: 0.35, cx: 0.846, target: 1.9 }
    ]
  };

  let networkSize = { width: 0, height: 0 };
  let trendSize = { width: 0, height: 0 };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function resize(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width: rect.width, height: rect.height };
  }

  function point(coord, size) {
    return { x: coord.x * size.width, y: coord.y * size.height };
  }

  function polylineLength(points) {
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
      total += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
    }
    return total;
  }

  function pointAtDistance(points, distance) {
    let remaining = distance;
    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1];
      const end = points[index];
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      if (remaining <= length) {
        const ratio = length === 0 ? 0 : remaining / length;
        return { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio };
      }
      remaining -= length;
    }
    return points[points.length - 1];
  }

  function strokePolyline(ctx, points, width, color) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      ctx.lineTo(points[index].x, points[index].y);
    }
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  }

  function drawGrid(ctx, width, height) {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "rgba(7,17,21,.72)");
    gradient.addColorStop(0.55, "rgba(6,16,20,.24)");
    gradient.addColorStop(1, "rgba(8,20,23,.62)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.strokeStyle = "rgba(103,145,143,.055)";
    ctx.lineWidth = 1;
    const grid = Math.max(26, Math.round(width / 38));
    for (let x = grid; x < width; x += grid) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = grid; y < height; y += grid) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.restore();

    const glow = ctx.createRadialGradient(width * 0.48, height * 0.5, 0, width * 0.48, height * 0.5, width * 0.36);
    glow.addColorStop(0, "rgba(33,93,89,.08)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
  }

  function drawPipe(ctx, normalizedPoints, view, flow, color, width, particleScale) {
    const points = normalizedPoints.map(function (coord) { return point(coord, networkSize); });
    if (points.length < 2) return;
    ctx.save();
    strokePolyline(ctx, points, width + 7, "rgba(0,0,0,.38)");
    strokePolyline(ctx, points, width + 4, colors.pipeEdge);
    strokePolyline(ctx, points, width + 1.5, colors.pipe);
    strokePolyline(ctx, points, width * 0.46, "rgba(128,175,172,.22)");

    if (flow > 0.2) {
      ctx.globalAlpha = 0.18 + Math.min(0.2, flow / 600);
      strokePolyline(ctx, points, width + 2, color);
      ctx.globalAlpha = 1;

      const total = polylineLength(points);
      const spacing = Math.max(19, 34 - flow * 0.08);
      const speed = 16 + flow * 0.85;
      const phase = (view.time * speed) % spacing;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      for (let distance = phase; distance < total; distance += spacing) {
        const dot = pointAtDistance(points, distance);
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, (particleScale || 1) * 1.85, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }
    ctx.restore();
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

  function drawLabelBox(ctx, x, y, width, height, align) {
    const boxX = align === "right" ? x - width : x;
    ctx.fillStyle = "rgba(5,13,16,.82)";
    ctx.strokeStyle = "rgba(117,160,170,.2)";
    ctx.lineWidth = 1;
    roundedRect(ctx, boxX, y, width, height, 2);
    ctx.fill();
    ctx.stroke();
  }

  function drawPipeLabel(ctx, x, y, id, flow, drop, color, align) {
    const width = 103;
    const height = 32;
    drawLabelBox(ctx, x, y, width, height, align);
    const boxX = align === "right" ? x - width : x;
    ctx.textAlign = "left";
    ctx.font = "8px " + mono;
    ctx.fillStyle = color;
    ctx.fillText(id, boxX + 7, y + 11);
    ctx.fillStyle = colors.muted;
    ctx.fillText("Δp " + (drop * 1000).toFixed(1) + " kPa", boxX + 7, y + 24);
    ctx.fillStyle = colors.text;
    ctx.textAlign = "right";
    ctx.fillText(flow.toFixed(1) + " L/s", boxX + width - 7, y + 18);
  }

  function drawTank(ctx, spec, tank, index, view) {
    const x = spec.x * networkSize.width;
    const y = spec.y * networkSize.height;
    const width = spec.w * networkSize.width;
    const height = spec.h * networkSize.height;
    const maxLevel = 2.7;
    const fillHeight = clamp(tank.level / maxLevel, 0, 1) * height;
    const targetY = y + height - clamp(tank.target / maxLevel, 0, 1) * height;
    const bandHalf = (P.TOLERANCE / maxLevel) * height;
    const ready = tank.inBand;
    const border = ready ? colors.cyan : "rgba(132,168,166,.42)";

    ctx.save();
    ctx.fillStyle = "rgba(3,9,12,.62)";
    ctx.strokeStyle = "rgba(0,0,0,.55)";
    ctx.lineWidth = 7;
    roundedRect(ctx, x, y, width, height, 7);
    ctx.fill();
    ctx.stroke();

    ctx.save();
    roundedRect(ctx, x + 2, y + 2, width - 4, height - 4, 5);
    ctx.clip();
    const liquid = ctx.createLinearGradient(0, y + height - fillHeight, 0, y + height);
    liquid.addColorStop(0, index === 1 ? "rgba(242,183,93,.38)" : "rgba(85,224,194,.38)");
    liquid.addColorStop(1, index === 1 ? "rgba(156,105,35,.38)" : "rgba(24,100,103,.48)");
    ctx.fillStyle = liquid;
    ctx.fillRect(x, y + height - fillHeight, width, fillHeight);

    ctx.strokeStyle = ready ? "rgba(85,224,194,.7)" : "rgba(141,191,183,.38)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    const waveY = y + height - fillHeight;
    for (let px = x; px <= x + width; px += 3) {
      const py = waveY + Math.sin((px - x) * 0.12 + view.time * (1.5 + tank.flow * 0.01)) * 1.4;
      if (px === x) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "rgba(242,183,93,.055)";
    ctx.fillRect(x + 2, targetY - bandHalf, width - 4, bandHalf * 2);
    ctx.strokeStyle = "rgba(242,183,93,.72)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x - 3, targetY);
    ctx.lineTo(x + width + 3, targetY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = border;
    ctx.lineWidth = ready ? 2 : 1.2;
    roundedRect(ctx, x, y, width, height, 7);
    ctx.stroke();

    ctx.fillStyle = ready ? colors.cyan : "rgba(182,205,200,.8)";
    ctx.font = "600 10px " + mono;
    ctx.textAlign = "left";
    ctx.fillText("T" + (index + 1), x + 8, y + 15);
    ctx.font = "8px " + mono;
    ctx.fillStyle = colors.muted;
    ctx.textAlign = "right";
    ctx.fillText("TGT " + tank.target.toFixed(2), x + width - 7, y + 15);

    ctx.textAlign = "center";
    ctx.fillStyle = ready ? colors.cyan : colors.text;
    ctx.font = "600 15px " + mono;
    ctx.fillText(tank.level.toFixed(2) + " m", x + width / 2, y + height - 11);

    const flowText = tank.flow.toFixed(1) + " L/s";
    ctx.fillStyle = colors.muted;
    ctx.font = "8px " + mono;
    ctx.fillText(flowText, x + width / 2, y + height + 13);

    if (ready) {
      ctx.strokeStyle = "rgba(85,224,194,.28)";
      ctx.lineWidth = 1;
      roundedRect(ctx, x - 5, y - 5, width + 10, height + 10, 10);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPump(ctx, view) {
    const pump = point(layout.pump, networkSize);
    const radius = Math.max(30, layout.pump.r * Math.min(networkSize.width, networkSize.height));
    const speedRatio = view.pump.speed / 1480;
    const loadRatio = view.pump.load / 100;
    const faulted = view.fault && (view.fault.code === "P-01");

    ctx.save();
    ctx.translate(pump.x, pump.y);
    ctx.strokeStyle = "rgba(85,224,194,.13)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, radius + 15, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "rgba(5,14,17,.88)";
    ctx.strokeStyle = faulted ? colors.coral : "rgba(140,183,178,.52)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.save();
    ctx.rotate(view.time * speedRatio * 1.8);
    ctx.strokeStyle = speedRatio > 0.25 ? "rgba(85,224,194,.72)" : "rgba(120,145,143,.3)";
    ctx.lineWidth = 2;
    for (let blade = 0; blade < 6; blade += 1) {
      ctx.rotate(Math.PI / 3);
      ctx.beginPath();
      ctx.moveTo(4, 0);
      ctx.quadraticCurveTo(radius * 0.45, -7, radius * 0.72, 0);
      ctx.stroke();
    }
    ctx.restore();

    ctx.fillStyle = "rgba(85,224,194,.14)";
    ctx.beginPath();
    ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(95,183,213,.14)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, radius + 10, -Math.PI * 0.82, -Math.PI * 0.82 + Math.PI * 1.18 * clamp(loadRatio, 0, 1));
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.fillStyle = faulted ? colors.coral : colors.text;
    ctx.font = "600 9px " + mono;
    ctx.fillText("P-01", 0, radius + 31);
    ctx.fillStyle = colors.muted;
    ctx.font = "8px " + mono;
    ctx.fillText(view.pump.speed.toFixed(0) + " rpm", 0, radius + 43);
    ctx.fillText(view.pump.load.toFixed(0) + "% LOAD", 0, radius + 54);
    ctx.restore();
  }

  function drawValve(ctx, spec, valve, id, color, view) {
    const pos = point(spec, networkSize);
    const faulted = view.fault && view.fault.code === id;
    const opening = valve.opening / 100;
    const hammer = valve.hammerForce;
    const activeColor = faulted ? colors.coral : hammer > 0.15 ? colors.amber : color;

    ctx.save();
    ctx.translate(pos.x, pos.y);
    if (faulted || hammer > 0.7) {
      ctx.strokeStyle = faulted ? "rgba(255,118,111,.55)" : "rgba(242,183,93,.35)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 20 + Math.sin(view.time * 7) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(5,13,16,.96)";
    ctx.strokeStyle = activeColor;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = activeColor;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-7, -7);
    ctx.lineTo(7, 7);
    ctx.moveTo(-7, 7);
    ctx.lineTo(7, -7);
    ctx.stroke();

    ctx.rotate(-Math.PI / 2 + opening * Math.PI);
    ctx.strokeStyle = activeColor;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(21, 0);
    ctx.stroke();
    ctx.fillStyle = activeColor;
    ctx.beginPath();
    ctx.arc(21, 0, 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "600 8px " + mono;
    ctx.fillStyle = activeColor;
    ctx.fillText(id, pos.x, pos.y + 30);
    ctx.font = "8px " + mono;
    ctx.fillStyle = colors.muted;
    ctx.fillText(valve.opening.toFixed(0) + "%", pos.x, pos.y + 41);
    ctx.restore();
  }

  function drawHeaderNode(ctx, view) {
    const pos = point(layout.header, networkSize);
    const faulted = view.fault && view.fault.code === "H-01";
    ctx.save();
    ctx.fillStyle = "rgba(5,13,16,.92)";
    ctx.strokeStyle = faulted ? colors.coral : colors.blue;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = faulted ? colors.coral : colors.blue;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = "center";
    ctx.font = "8px " + mono;
    ctx.fillStyle = colors.muted;
    ctx.fillText("H-01", pos.x, pos.y + 21);
    ctx.restore();
  }

  function drawFaultMarker(ctx, fault, view) {
    if (!fault || !fault.location) return;
    const x = fault.location.x * networkSize.width;
    const y = fault.location.y * networkSize.height;
    const pulse = 18 + Math.sin(view.time * 6) * 3;
    ctx.save();
    ctx.strokeStyle = "rgba(255,118,111,.85)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,118,111,.3)";
    ctx.beginPath();
    ctx.arc(x, y, pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 18, y);
    ctx.lineTo(x - 11, y);
    ctx.moveTo(x + 11, y);
    ctx.lineTo(x + 18, y);
    ctx.moveTo(x, y - 18);
    ctx.lineTo(x, y - 11);
    ctx.moveTo(x, y + 11);
    ctx.lineTo(x, y + 18);
    ctx.stroke();

    const label = fault.code + " · " + P.formatTime(fault.time);
    ctx.font = "8px " + mono;
    const width = ctx.measureText(label).width + 14;
    const labelX = clamp(x - width / 2, 8, networkSize.width - width - 8);
    const labelY = y > 45 ? y - 42 : y + 24;
    ctx.fillStyle = "rgba(49,16,18,.92)";
    ctx.strokeStyle = "rgba(255,118,111,.48)";
    roundedRect(ctx, labelX, labelY, width, 19, 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ffb7b3";
    ctx.textAlign = "center";
    ctx.fillText(label, labelX + width / 2, labelY + 13);
    ctx.restore();
  }

  function drawNetwork(view) {
    const size = resize(networkCanvas);
    if (size.width < 2 || size.height < 2) return;
    networkSize = size;
    const ctx = networkCanvas.getContext("2d");
    ctx.clearRect(0, 0, size.width, size.height);
    drawGrid(ctx, size.width, size.height);

    const tankSpecs = layout.tanks;
    const mainPath = [layout.pump, layout.header];
    const upPath = [layout.header, { x: 0.22, y: 0.62 }, { x: 0.22, y: 0.34 }, layout.v1];
    const downPath = [layout.header, { x: 0.22, y: 0.62 }, { x: 0.22, y: 0.84 }, layout.v2];
    const a1Path = [layout.v1, layout.splitA, { x: tankSpecs[0].cx, y: 0.34 }, { x: tankSpecs[0].cx, y: tankSpecs[0].y }];
    const a2Path = [layout.splitA, { x: tankSpecs[1].cx, y: 0.34 }, { x: tankSpecs[1].cx, y: tankSpecs[1].y }];
    const bPath = [layout.v2, { x: 0.55, y: 0.84 }, { x: tankSpecs[2].cx, y: 0.84 }, { x: tankSpecs[2].cx, y: tankSpecs[2].y + tankSpecs[2].h }];

    drawPipe(ctx, mainPath, view, view.pump.flow, colors.cyan, 9, 1.2);
    drawPipe(ctx, upPath, view, view.valves[0].flow, colors.blue, 7, 1);
    drawPipe(ctx, downPath, view, view.valves[1].flow, colors.amber, 7, 1);
    drawPipe(ctx, a1Path, view, view.tanks[0].flow, colors.blue, 5.5, 0.9);
    drawPipe(ctx, a2Path, view, view.tanks[1].flow, colors.blue, 4.4, 0.75);
    drawPipe(ctx, bPath, view, view.tanks[2].flow, colors.amber, 6, 0.9);

    drawHeaderNode(ctx, view);
    drawPump(ctx, view);
    drawValve(ctx, layout.v1, view.valves[0], "V-01", colors.blue, view);
    drawValve(ctx, layout.v2, view.valves[1], "V-02", colors.amber, view);

    view.tanks.forEach(function (tank, index) {
      drawTank(ctx, tankSpecs[index], tank, index, view);
    });

    const pipes = {};
    (view.pipes || []).forEach(function (pipe) { pipes[pipe.id] = pipe; });
    if (pipes["M-01"]) {
      drawPipeLabel(ctx, size.width * 0.105, size.height * 0.66,
        "M-01 · DN80", pipes["M-01"].flow, pipes["M-01"].drop, colors.cyan);
    }
    if (pipes["A-01"]) {
      drawPipeLabel(ctx, size.width * 0.395, size.height * 0.095,
        "A-01 · DN65×17m", pipes["A-01"].flow, pipes["A-01"].drop, colors.blue);
    }
    if (pipes["A-02"]) {
      drawPipeLabel(ctx, size.width * 0.58, size.height * 0.095,
        "A-02 · DN50×25m", pipes["A-02"].flow, pipes["A-02"].drop, colors.blue);
    }
    if (pipes["B-01"]) {
      drawPipeLabel(ctx, size.width * 0.55, size.height * 0.875,
        "B-01 · DN65×12m", pipes["B-01"].flow, pipes["B-01"].drop, colors.amber);
    }

    ctx.save();
    ctx.font = "8px " + mono;
    ctx.fillStyle = "rgba(120,145,143,.55)";
    ctx.textAlign = "left";
    ctx.fillText("PUMP HEADER", size.width * 0.022, size.height * 0.04);
    ctx.textAlign = "right";
    ctx.fillText("TARGET BAND ±" + P.TOLERANCE.toFixed(2) + " m", size.width * 0.98, size.height * 0.04);
    ctx.restore();

    drawFaultMarker(ctx, view.fault, view);
  }

  function drawTrend(view) {
    const size = resize(trendCanvas);
    if (size.width < 2 || size.height < 2) return;
    trendSize = size;
    const ctx = trendCanvas.getContext("2d");
    const history = window.__renderContext ? window.__renderContext.getHistory() : [];
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.fillStyle = "rgba(5,13,16,.4)";
    ctx.fillRect(0, 0, size.width, size.height);

    const plot = { left: 42, right: size.width - 13, top: 18, bottom: size.height - 22 };
    const plotWidth = Math.max(1, plot.right - plot.left);
    const plotHeight = Math.max(1, plot.bottom - plot.top);
    const xAt = function (time) { return plot.left + clamp(time / P.MISSION_TIME, 0, 1) * plotWidth; };
    const yAt = function (ratio) { return plot.bottom - clamp(ratio, 0, 1) * plotHeight; };

    ctx.save();
    ctx.strokeStyle = "rgba(100,141,140,.12)";
    ctx.fillStyle = "rgba(120,145,143,.75)";
    ctx.lineWidth = 1;
    ctx.font = "7px " + mono;
    ctx.textAlign = "center";
    for (let second = 0; second <= 60; second += 15) {
      const x = xAt(second);
      ctx.beginPath();
      ctx.moveTo(x, plot.top);
      ctx.lineTo(x, plot.bottom);
      ctx.stroke();
      ctx.fillText(second + "s", x, plot.bottom + 13);
    }
    ctx.textAlign = "right";
    for (let row = 0; row <= 4; row += 1) {
      const y = plot.top + plotHeight * row / 4;
      ctx.beginPath();
      ctx.moveTo(plot.left, y);
      ctx.lineTo(plot.right, y);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(120,145,143,.62)";
    ctx.fillText("MAX", plot.left - 6, plot.top + 3);
    ctx.fillText("0", plot.left - 6, plot.bottom + 3);
    ctx.restore();

    const series = [
      {
        color: colors.blue,
        value: function (frame) { return frame.pump.pressure / 1.15; },
        raw: function (frame) { return frame.pump.pressure; }
      },
      {
        color: colors.amber,
        value: function (frame) { return Math.max(frame.valves[0].hammerForce, frame.valves[1].hammerForce) / 2.0; },
        raw: function (frame) { return Math.max(frame.valves[0].hammerForce, frame.valves[1].hammerForce); }
      },
      {
        color: colors.coral,
        value: function (frame) { return (frame.pump.temperature - 25) / 65; },
        raw: function (frame) { return frame.pump.temperature; }
      }
    ];

    if (history.length < 2) {
      ctx.save();
      ctx.textAlign = "center";
      ctx.fillStyle = colors.muted;
      ctx.font = "9px " + mono;
      ctx.fillText("等待固定步长轨迹", plot.left + plotWidth / 2, plot.top + plotHeight / 2);
      ctx.restore();
      return;
    }

    series.forEach(function (line) {
      ctx.save();
      ctx.beginPath();
      history.forEach(function (frame, index) {
        const x = xAt(frame.time);
        const y = yAt(line.value(frame));
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 1.35;
      ctx.globalAlpha = 0.82;
      ctx.shadowColor = line.color;
      ctx.shadowBlur = 5;
      ctx.stroke();
      ctx.restore();
    });

    const cursorX = xAt(view.time);
    ctx.save();
    ctx.strokeStyle = "rgba(230,241,238,.38)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(cursorX, plot.top);
    ctx.lineTo(cursorX, plot.bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    series.forEach(function (line) {
      const x = xAt(view.time);
      const y = yAt(line.value(view));
      ctx.fillStyle = line.color;
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();

    if (view.fault && view.fault.time > 0) {
      const faultX = xAt(view.fault.time);
      ctx.save();
      ctx.strokeStyle = "rgba(255,118,111,.8)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(faultX, plot.top);
      ctx.lineTo(faultX, plot.bottom);
      ctx.stroke();
      ctx.fillStyle = colors.coral;
      ctx.beginPath();
      ctx.arc(faultX, plot.top + 4, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const pressure = view.pump.pressure;
    const hammer = Math.max(view.valves[0].hammerForce, view.valves[1].hammerForce);
    ctx.save();
    ctx.font = "7px " + mono;
    ctx.textAlign = "right";
    ctx.fillStyle = colors.blue;
    ctx.fillText("P " + pressure.toFixed(2) + " MPa", plot.right, plot.top - 6);
    ctx.fillStyle = colors.amber;
    ctx.fillText("H " + hammer.toFixed(2) + " kN", plot.right - 74, plot.top - 6);
    ctx.fillStyle = colors.coral;
    ctx.fillText("T " + view.pump.temperature.toFixed(1) + " °C", plot.right - 150, plot.top - 6);
    ctx.restore();
  }

  window.__drawNetwork = drawNetwork;
  window.__drawTrend = drawTrend;
})();
