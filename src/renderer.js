import { clipDuration, clipEnd, frameAt, projectDuration } from "./project.js";

const COLORS = {
  ink: "#111820",
  paper: "#e8dfca",
  soft: "rgba(232, 223, 202, 0.46)",
  faint: "rgba(232, 223, 202, 0.13)",
  lime: "#c9fa62",
  cyan: "#56d9d1",
  coral: "#ff7d70"
};

function hash(n) {
  const value = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function line(ctx, points, close = false) {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
  if (close) ctx.closePath();
  ctx.stroke();
}

function smoothPath(ctx, points) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length - 1; i += 1) {
    const midX = (points[i][0] + points[i + 1][0]) / 2;
    const midY = (points[i][1] + points[i + 1][1]) / 2;
    ctx.quadraticCurveTo(points[i][0], points[i][1], midX, midY);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last[0], last[1]);
  ctx.stroke();
}

function setLine(ctx, color, width, alpha = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

function drawGrain(ctx, width, height, frame, amount = 26) {
  ctx.save();
  for (let i = 0; i < amount; i += 1) {
    const x = hash(i + frame * 2.1) * width;
    const y = hash(i * 2.7 + frame * 1.3) * height;
    const alpha = hash(i * 5.3) * 0.055 + 0.012;
    ctx.fillStyle = `rgba(244, 236, 216, ${alpha})`;
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.restore();
}

function drawAtmosphere(ctx, width, height) {
  const gradient = ctx.createRadialGradient(width * 0.5, height * 0.47, 20, width * 0.5, height * 0.5, width * 0.64);
  gradient.addColorStop(0, "#1c2730");
  gradient.addColorStop(0.54, "#131b22");
  gradient.addColorStop(1, "#0b1015");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function drawRails(ctx, width, height, frame) {
  const vx = width * 0.526;
  const vy = height * 0.548;
  const bob = (hash(frame + 2) - 0.5) * 1.2;
  setLine(ctx, COLORS.soft, 1.15, 0.72);
  line(ctx, [[vx - 3 + bob, vy], [width * 0.02, height], [width * 0.17, height]]);
  line(ctx, [[vx + 3 + bob, vy], [width * 0.98, height], [width * 0.83, height]]);
  line(ctx, [[vx - 16 + bob, vy], [width * 0.12, height], [width * 0.33, height]]);
  line(ctx, [[vx + 16 + bob, vy], [width * 0.88, height], [width * 0.67, height]]);
  setLine(ctx, COLORS.faint, 1, 0.9);
  for (let i = 0; i < 9; i += 1) {
    const p = i / 8;
    const y = vy + Math.pow(p, 1.7) * (height - vy);
    const spread = 9 + Math.pow(p, 1.6) * width * 0.43;
    line(ctx, [[vx - spread, y], [vx + spread, y]]);
  }
}

function drawPlatform(ctx, width, height, frame, localTime) {
  drawAtmosphere(ctx, width, height);
  const sway = Math.sin(localTime * 1.9) * 1.5;

  ctx.save();
  setLine(ctx, COLORS.faint, 1, 0.86);
  const skyline = [
    [0.02, 0.31, 0.11, 0.15], [0.14, 0.25, 0.08, 0.21], [0.235, 0.33, 0.07, 0.13],
    [0.69, 0.29, 0.09, 0.18], [0.79, 0.22, 0.12, 0.25], [0.92, 0.31, 0.07, 0.16]
  ];
  for (const [x, y, w, h] of skyline) {
    ctx.strokeRect(x * width, y * height, w * width, h * height);
    for (let i = 0; i < 3; i += 1) {
      ctx.fillStyle = i === frame % 3 ? "rgba(201,250,98,.35)" : "rgba(232,223,202,.12)";
      ctx.fillRect((x + 0.014 + i * 0.024) * width, (y + 0.03) * height, 2, 2);
    }
  }
  ctx.restore();

  drawRails(ctx, width, height, frame);

  setLine(ctx, COLORS.paper, 1.45, 0.9);
  const vp = [width * 0.526, height * 0.548];
  line(ctx, [[0, height * 0.09], [width * 0.31, height * 0.09], [width * 0.27, height * 0.49], [0, height * 0.54]], true);
  setLine(ctx, COLORS.soft, 1.1, 0.62);
  line(ctx, [[0, height * 0.16], [width * 0.25, height * 0.16]]);
  line(ctx, [[0, height * 0.24], [width * 0.235, height * 0.24]]);
  for (let i = 0; i < 7; i += 1) {
    const x = i * width * 0.047;
    line(ctx, [[x, height * 0.09], [x + width * 0.012, height * 0.49]]);
  }
  setLine(ctx, COLORS.soft, 1.2, 0.7);
  line(ctx, [[width * 0.018, height * 0.38], [width * 0.02, height * 0.53]]);
  roundedArc(ctx, width * 0.045, height * 0.34, width * 0.063, height * 0.12);
  line(ctx, [[width * 0.027, height * 0.5], [width * 0.027, height * 0.68]]);
  ctx.beginPath();
  ctx.arc(width * 0.027, height * 0.69, 3, 0, Math.PI * 2);
  ctx.stroke();

  ctx.save();
  setLine(ctx, COLORS.paper, 1.7, 0.93);
  const tramX = width * 0.405 + sway;
  const tramY = height * 0.392 + Math.sin(localTime * 2.2) * 0.7;
  const tramW = width * 0.418;
  const tramH = height * 0.295;
  roundRect(ctx, tramX, tramY, tramW, tramH, 16);
  ctx.stroke();
  setLine(ctx, COLORS.soft, 1, 0.66);
  ctx.beginPath();
  ctx.moveTo(tramX + width * 0.044, tramY);
  ctx.lineTo(tramX + width * 0.052, tramY - height * 0.016);
  ctx.lineTo(tramX + tramW - width * 0.055, tramY - height * 0.016);
  ctx.lineTo(tramX + tramW - width * 0.042, tramY);
  ctx.stroke();
  setLine(ctx, COLORS.paper, 1.15, 0.84);
  for (let i = 0; i < 5; i += 1) {
    const wx = tramX + width * 0.032 + i * width * 0.074;
    roundRect(ctx, wx, tramY + height * 0.04, width * 0.055, height * 0.105, 4);
    ctx.stroke();
    if (i === 1 || i === 4) {
      ctx.fillStyle = "rgba(201,250,98,.09)";
      ctx.fill();
    }
  }
  setLine(ctx, COLORS.soft, 1, 0.64);
  line(ctx, [[tramX + width * 0.018, tramY + height * 0.185], [tramX + tramW - width * 0.018, tramY + height * 0.185]]);
  line(ctx, [[tramX + width * 0.018, tramY + height * 0.225], [tramX + tramW - width * 0.018, tramY + height * 0.225]]);
  ctx.fillStyle = "rgba(201,250,98,.8)";
  ctx.fillRect(tramX + width * 0.355, tramY + height * 0.105, 7, 4);
  setLine(ctx, COLORS.paper, 1.4, 0.82);
  ctx.beginPath();
  ctx.arc(tramX + width * 0.11, tramY + tramH + 2, 11, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(tramX + tramW - width * 0.11, tramY + tramH + 2, 11, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  drawWires(ctx, width, height, frame);
  drawRain(ctx, width, height, frame);
  drawGrain(ctx, width, height, frame);
}

function roundedArc(ctx, x, y, width, height) {
  ctx.beginPath();
  ctx.ellipse(x, y, width, height, 0, Math.PI, Math.PI * 2);
  ctx.stroke();
}

function drawWires(ctx, width, height, frame) {
  ctx.save();
  setLine(ctx, COLORS.faint, 1, 0.95);
  const sag = 5 + hash(frame) * 2;
  for (let i = 0; i < 3; i += 1) {
    const y = height * (0.16 + i * 0.065);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(width * 0.27, y + sag + i * 2, width * 0.67, y - sag, width, y + 1);
    ctx.stroke();
  }
  line(ctx, [[width * 0.02, height * 0.47], [width * 0.02, height * 0.12], [width * 0.24, height * 0.12]]);
  line(ctx, [[width * 0.98, height * 0.47], [width * 0.98, height * 0.12], [width * 0.74, height * 0.12]]);
  ctx.restore();
}

function drawRain(ctx, width, height, frame) {
  ctx.save();
  setLine(ctx, "rgba(180, 216, 219, 0.19)", 0.7, 0.8);
  for (let i = 0; i < 34; i += 1) {
    const seed = hash(i * 3.4 + frame * 0.19);
    const x = seed * width;
    const y = (hash(i * 7.9 + frame * 0.13) * height + frame * 7) % height;
    line(ctx, [[x, y], [x - 2, y + 8 + hash(i) * 10]]);
  }
  ctx.restore();
}

function drawWindow(ctx, width, height, frame, localTime) {
  drawAtmosphere(ctx, width, height);
  const drift = (localTime * 38) % (width * 0.72);
  ctx.save();
  setLine(ctx, COLORS.faint, 1, 0.8);
  for (let i = 0; i < 13; i += 1) {
    const x = ((i * 0.093 * width - drift + width * 0.5) % (width * 1.04)) - width * 0.02;
    const h = height * (0.1 + hash(i + frame) * 0.2);
    ctx.strokeRect(x, height * 0.32 - h, width * 0.047, h);
    ctx.fillStyle = i % 3 === frame % 3 ? "rgba(255,125,112,.34)" : "rgba(232,223,202,.15)";
    ctx.fillRect(x + 8, height * 0.32 - h + 8, 2, 2);
  }
  setLine(ctx, COLORS.faint, 1, 0.6);
  line(ctx, [[0, height * 0.365], [width, height * 0.365]]);
  ctx.restore();

  ctx.save();
  setLine(ctx, COLORS.paper, 1.7, 0.9);
  roundRect(ctx, width * 0.14, height * 0.1, width * 0.72, height * 0.71, 24);
  ctx.stroke();
  setLine(ctx, COLORS.soft, 1.1, 0.58);
  roundRect(ctx, width * 0.163, height * 0.128, width * 0.674, height * 0.654, 15);
  ctx.stroke();
  line(ctx, [[width * 0.5, height * 0.13], [width * 0.5, height * 0.782]]);
  line(ctx, [[width * 0.164, height * 0.46], [width * 0.836, height * 0.46]]);
  setLine(ctx, COLORS.paper, 1.3, 0.55);
  line(ctx, [[width * 0.11, height * 0.095], [width * 0.09, height * 0.78]]);
  line(ctx, [[width * 0.89, height * 0.095], [width * 0.91, height * 0.78]]);

  ctx.save();
  ctx.beginPath();
  roundRect(ctx, width * 0.163, height * 0.13, width * 0.674, height * 0.65, 15);
  ctx.clip();
  setLine(ctx, "rgba(180,216,219,.18)", 0.8, 0.8);
  for (let i = 0; i < 30; i += 1) {
    const x = hash(i * 2.3 + Math.floor(localTime * 8)) * width;
    const y = hash(i * 5.2) * height * 0.8;
    line(ctx, [[x, y], [x - 1, y + 12 + hash(i) * 14]]);
  }
  const lampX = width * (0.25 + ((localTime * 0.17) % 0.6));
  ctx.fillStyle = "rgba(201,250,98,.58)";
  ctx.shadowColor = COLORS.lime;
  ctx.shadowBlur = 13;
  ctx.beginPath();
  ctx.arc(lampX, height * 0.32, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.restore();

  ctx.save();
  setLine(ctx, COLORS.paper, 1.45, 0.78);
  ctx.beginPath();
  ctx.arc(width * 0.62, height * 0.47, width * 0.045, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(width * 0.57, height * 0.51);
  ctx.bezierCurveTo(width * 0.53, height * 0.59, width * 0.51, height * 0.7, width * 0.5, height * 0.82);
  ctx.lineTo(width * 0.75, height * 0.82);
  ctx.bezierCurveTo(width * 0.74, height * 0.68, width * 0.7, height * 0.58, width * 0.665, height * 0.51);
  ctx.stroke();
  setLine(ctx, COLORS.faint, 1, 0.8);
  line(ctx, [[width * 0.17, height * 0.83], [width * 0.83, height * 0.83]]);
  ctx.restore();

  drawGrain(ctx, width, height, frame, 18);
}

function drawTrace(ctx, trace, color, width, opacity, isActive) {
  if (!trace || trace.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = opacity;
  ctx.lineWidth = width;
  ctx.shadowColor = color;
  ctx.shadowBlur = isActive ? 6 : 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  smoothPath(ctx, trace);
  const start = trace[0];
  const end = trace[trace.length - 1];
  ctx.globalAlpha = Math.max(0.35, opacity * 0.8);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(start[0], start[1], isActive ? 3.4 : 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(end[0], end[1], isActive ? 3.4 : 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawTraceLayer(ctx, width, height, project, frameIndex, selectedFrame = false) {
  const frame = project.frames[frameIndex];
  if (!frame) return;
  const { width: strokeWidth, opacity, colors, activePath } = project.brush;
  for (const path of ["A", "B"]) {
    const points = frame[`trace${path}`].map(([x, y]) => [x * width, y * height]);
    drawTrace(ctx, points, colors[path], strokeWidth * (width / 960), opacity, selectedFrame && activePath === path);
  }
}

function activeClips(project, time) {
  return orderedClipsLocal(project).filter((clip) => time >= clip.start - 1e-5 && time < clipEnd(clip) - 1e-5);
}

function orderedClipsLocal(project) {
  return [...project.timeline.clips].sort((a, b) => a.start - b.start);
}

function drawScene(ctx, width, height, scene, frame, localTime) {
  if (scene === "window") drawWindow(ctx, width, height, frame, localTime);
  else drawPlatform(ctx, width, height, frame, localTime);
}

function drawSubtitle(ctx, width, height, project, time) {
  const subtitle = project.timeline.subtitles.find(
    (item) => time >= item.start && time <= item.start + item.duration
  );
  if (!subtitle) return;
  const text = subtitle.text;
  ctx.save();
  ctx.font = '500 23px "Noto Sans SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = "center";
  const metrics = ctx.measureText(text);
  const x = width / 2;
  const y = height * 0.865;
  ctx.fillStyle = "rgba(8, 11, 14, 0.58)";
  roundRect(ctx, x - metrics.width / 2 - 18, y - 27, metrics.width + 36, 40, 4);
  ctx.fill();
  ctx.fillStyle = "rgba(244, 238, 224, 0.95)";
  ctx.shadowColor = "rgba(0,0,0,.7)";
  ctx.shadowBlur = 4;
  ctx.fillText(text, x, y);
  ctx.restore();
}

export function renderStage(ctx, project, time, options = {}) {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const duration = projectDuration(project);
  const clamped = Math.min(Math.max(0, time), Math.max(0, duration - 1e-4));
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  drawAtmosphere(ctx, width, height);
  const visible = activeClips(project, clamped);
  const manualFrame = options.manualFrame;

  if (!visible.length) {
    drawScene(ctx, width, height, "platform", 0, 0);
  } else if (visible.length === 1) {
    const clip = visible[0];
    const frameIndex = Number.isInteger(manualFrame)
      ? manualFrame
      : frameAt(project, Math.max(0, clamped - clip.start + clip.sourceIn));
    const local = clamped - clip.start + clip.sourceIn;
    if (project.showBase) drawScene(ctx, width, height, clip.scene, frameIndex, local);
    if (project.onion && options.paused && Number.isInteger(manualFrame) && project.showBase) {
      ctx.save();
      ctx.globalAlpha = 0.1;
      const previous = (manualFrame - 1 + project.frames.length) % project.frames.length;
      const offset = (hash(manualFrame) - 0.5) * 3;
      ctx.translate(offset, -2);
      drawScene(ctx, width, height, clip.scene, previous, local - 1 / project.animationFps);
      ctx.restore();
    }
    drawTraceLayer(ctx, width, height, project, frameIndex, Boolean(options.paused));
  } else {
    const first = visible[0];
    const second = visible[1];
    const overlap = Math.max(1e-5, clipEnd(first) - second.start);
    const progress = Math.min(1, Math.max(0, (clamped - second.start) / overlap));
    const firstFrame = Number.isInteger(manualFrame)
      ? manualFrame
      : frameAt(project, Math.max(0, clamped - first.start + first.sourceIn));
    const secondFrame = Number.isInteger(manualFrame)
      ? manualFrame
      : frameAt(project, Math.max(0, clamped - second.start + second.sourceIn));
    ctx.save();
    ctx.globalAlpha = 1 - progress;
    if (project.showBase) drawScene(ctx, width, height, first.scene, firstFrame, clamped - first.start + first.sourceIn);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = progress;
    if (project.showBase) drawScene(ctx, width, height, second.scene, secondFrame, clamped - second.start + second.sourceIn);
    ctx.restore();
    drawTraceLayer(ctx, width, height, project, secondFrame, Boolean(options.paused));
  }

  drawSubtitle(ctx, width, height, project, clamped);
  if (options.safeFrames) drawSafeFrames(ctx, width, height);
  drawCornerMarks(ctx, width, height);
  ctx.restore();
}

function drawSafeFrames(ctx, width, height) {
  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = "rgba(201,250,98,.42)";
  ctx.lineWidth = 1;
  ctx.strokeRect(width * 0.05, height * 0.05, width * 0.9, height * 0.9);
  ctx.strokeStyle = "rgba(255,125,112,.3)";
  ctx.strokeRect(width * 0.1, height * 0.1, width * 0.8, height * 0.8);
  ctx.fillStyle = "rgba(201,250,98,.55)";
  ctx.font = '8px "SFMono-Regular", monospace';
  ctx.fillText("TITLE SAFE 90%", width * 0.05 + 7, height * 0.05 + 12);
  ctx.restore();
}

function drawCornerMarks(ctx, width, height) {
  ctx.save();
  ctx.strokeStyle = "rgba(232,223,202,.22)";
  ctx.lineWidth = 1;
  const pad = Math.max(9, width * 0.012);
  const len = Math.max(11, width * 0.014);
  for (const [x, y, sx, sy] of [
    [pad, pad, 1, 1], [width - pad, pad, -1, 1],
    [pad, height - pad, 1, -1], [width - pad, height - pad, -1, -1]
  ]) {
    ctx.beginPath();
    ctx.moveTo(x + sx * len, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + sy * len);
    ctx.stroke();
  }
  ctx.restore();
}

export function renderThumbnail(canvas, project, frameIndex) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  drawScene(ctx, width, height, "platform", frameIndex, frameIndex / project.animationFps);
  drawTraceLayer(ctx, width, height, project, frameIndex, false);
  drawGrain(ctx, width, height, frameIndex, 8);
}

export function renderPoster(canvas, project) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  drawScene(ctx, width, height, "platform", 3, 0.7);
  drawTraceLayer(ctx, width, height, project, 3, false);
  drawSubtitle(ctx, width, height, project, 1.2);
}

export function sceneAt(project, time) {
  const visible = activeClips(project, time);
  return visible[0]?.scene || "platform";
}
