import { cameraAt, clipEnd, FPS, sampleCameraPath, viewfinderFrame, findPathViolations } from "./model.js";

const INK = "#171713";
const PAPER = "#eee9df";
const CORAL = "#ff5a36";
const ACID = "#c8f04d";
const BLUE = "#1b3bff";

export function videoLayersAt(project, time) {
  const clips = project.timeline.videoClips
    .filter((clip) => time >= clip.start - 0.0001 && time < clipEnd(clip) - 0.0001)
    .sort((a, b) => a.start - b.start);
  if (!clips.length) {
    return [{ clip: { variant: "form" }, alpha: 1 }];
  }
  if (clips.length === 1) return [{ clip: clips[0], alpha: 1 }];

  const first = clips[0];
  const second = clips[clips.length - 1];
  const transition = project.timeline.transitions.find(
    (item) =>
      (item.fromGroup === first.groupId && item.toGroup === second.groupId) ||
      (item.fromGroup === second.groupId && item.toGroup === first.groupId),
  );
  if (!transition) {
    return clips.map((clip, index) => ({ clip, alpha: index === 0 ? 1 : 0.55 }));
  }
  const progress = Math.max(0, Math.min(1, (time - transition.start) / transition.duration));
  const incoming = transition.toGroup === second.groupId ? second : first;
  const outgoing = incoming === second ? first : second;
  return [
    { clip: outgoing, alpha: 1 },
    { clip: incoming, alpha: progress },
  ];
}

export function activeSubtitle(project, time) {
  return project.timeline.subtitleClips.find(
    (clip) => time >= clip.start && time < clipEnd(clip),
  );
}

function drawGrid(ctx) {
  ctx.save();
  ctx.strokeStyle = "rgba(23, 23, 19, 0.075)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= 1200; x += 60) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 675);
    ctx.stroke();
  }
  for (let y = 0; y <= 675; y += 60) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(1200, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCross(ctx, x, y, size, color, width = 2) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x - size, y);
  ctx.lineTo(x + size, y);
  ctx.moveTo(x, y - size);
  ctx.lineTo(x, y + size);
  ctx.stroke();
  ctx.restore();
}

function drawFormScene(ctx, time) {
  ctx.save();
  ctx.translate(610, 336);
  ctx.rotate(-0.08);
  ctx.fillStyle = "rgba(23,23,19,0.08)";
  ctx.beginPath();
  ctx.arc(0, 0, 238, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 238, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.translate(438, 382);
  ctx.rotate(-0.13 + Math.sin(time * 0.38) * 0.025);
  ctx.fillStyle = CORAL;
  ctx.beginPath();
  ctx.arc(0, 0, 172, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(64, -48, 60, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(930, 88);
  ctx.rotate(0.06);
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, 176, 176);
  ctx.fillStyle = ACID;
  ctx.fillRect(18, 18, 52, 52);
  ctx.fillStyle = PAPER;
  ctx.font = '600 24px "Arial Narrow", sans-serif';
  ctx.fillText("PAGE 08", 20, 145);
  ctx.restore();

  ctx.save();
  ctx.fillStyle = INK;
  ctx.font = '900 176px "Arial Black", Impact, sans-serif';
  ctx.fillText("FORM", 84, 150);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.strokeRect(82, 174, 532, 2);
  ctx.fillStyle = INK;
  ctx.font = '500 15px ui-monospace, monospace';
  ctx.fillText("A STUDY IN WEIGHT / VOLUME / RHYTHM", 86, 202);
  ctx.restore();

  ctx.save();
  ctx.translate(843, 518);
  ctx.rotate(-0.11);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5;
  for (let index = 0; index < 7; index += 1) {
    ctx.beginPath();
    ctx.moveTo(index * 32, 0);
    ctx.lineTo(index * 32 - 60, 92);
    ctx.stroke();
  }
  ctx.restore();
  drawCross(ctx, 105, 565, 12, INK, 1.5);
  drawCross(ctx, 1120, 300, 12, INK, 1.5);
}

function drawFlowScene(ctx, time) {
  ctx.save();
  ctx.translate(600, 345);
  ctx.rotate(0.05);
  ctx.fillStyle = BLUE;
  ctx.beginPath();
  ctx.roundRect(-430, -235, 860, 470, 58);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(398, 346);
  ctx.rotate(-0.35 + Math.sin(time * 0.5) * 0.02);
  ctx.strokeStyle = ACID;
  ctx.lineWidth = 58;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-86, -170);
  ctx.bezierCurveTo(220, -210, -170, 80, 150, 176);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.translate(887, 337);
  ctx.rotate(0.18);
  ctx.fillStyle = CORAL;
  ctx.beginPath();
  ctx.arc(0, 0, 142, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(0, 0, 54, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = PAPER;
  ctx.font = '900 154px "Arial Black", Impact, sans-serif';
  ctx.fillText("FLOW", 120, 150);
  ctx.font = '500 15px ui-monospace, monospace';
  ctx.fillText("CONTINUOUS MOTION / FRAME 08", 124, 183);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([8, 9]);
  ctx.beginPath();
  ctx.arc(610, 350, 292, 0.2, Math.PI * 1.55);
  ctx.stroke();
  ctx.restore();
  drawCross(ctx, 106, 560, 12, PAPER, 1.5);
  drawCross(ctx, 1112, 300, 12, PAPER, 1.5);
}

function drawWorld(ctx, variant, time) {
  const gradient = ctx.createLinearGradient(0, 0, 1200, 675);
  gradient.addColorStop(0, variant === "flow" ? "#112bd0" : "#f3eee5");
  gradient.addColorStop(1, variant === "flow" ? "#3152ff" : "#ddd4c7");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1200, 675);
  if (variant !== "flow") drawGrid(ctx);
  if (variant === "flow") drawFlowScene(ctx, time);
  else drawFormScene(ctx, time);

  ctx.save();
  ctx.fillStyle = variant === "flow" ? "rgba(238,233,223,0.7)" : "rgba(23,23,19,0.35)";
  ctx.font = '500 11px ui-monospace, monospace';
  ctx.fillText("STAGE 1200 × 675", 24, 650);
  ctx.fillText("FRAME//08", 1082, 650);
  ctx.restore();
}

function drawSubtitle(ctx, subtitle, width, height, time) {
  if (!subtitle) return;
  const fadeIn = Math.min(1, (time - subtitle.start) / 0.12);
  const fadeOut = Math.min(1, (subtitle.start + subtitle.duration - time) / 0.12);
  const opacity = Math.max(0, Math.min(fadeIn, fadeOut));
  const base = width / 1280;
  const panelWidth = Math.min(width * 0.62, 710 * base);
  const panelHeight = 92 * base;
  const x = width / 2 - panelWidth / 2;
  const y = height - 65 * base - panelHeight;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = "rgba(15,15,12,0.88)";
  ctx.beginPath();
  ctx.roundRect(x, y, panelWidth, panelHeight, 4 * base);
  ctx.fill();
  ctx.fillStyle = CORAL;
  ctx.fillRect(x, y, 6 * base, panelHeight);
  ctx.fillStyle = ACID;
  ctx.font = `600 ${10.5 * base}px ui-monospace, monospace`;
  ctx.letterSpacing = `${1.4 * base}px`;
  ctx.fillText(subtitle.kicker, x + 27 * base, y + 30 * base);
  ctx.fillStyle = "#f4f0e8";
  ctx.font = `600 ${23 * base}px "FRAME CJK", "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.letterSpacing = "0px";
  ctx.fillText(subtitle.text, x + 27 * base, y + 67 * base);
  ctx.restore();
}

function drawPreviewHud(ctx, project, time, width, height) {
  const scale = width / 1280;
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = "rgba(255,255,255,0.72)";
  ctx.lineWidth = 1.2 * scale;
  const inset = 20 * scale;
  const length = 27 * scale;
  const corners = [
    [inset, inset, 1, 1],
    [width - inset, inset, -1, 1],
    [inset, height - inset, 1, -1],
    [width - inset, height - inset, -1, -1],
  ];
  for (const [x, y, dx, dy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x + dx * length, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + dy * length);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(15,15,12,0.76)";
  const badgeWidth = 148 * scale;
  const badgeHeight = 27 * scale;
  ctx.beginPath();
  ctx.roundRect(inset, inset + 18 * scale, badgeWidth, badgeHeight, 2 * scale);
  ctx.fill();
  ctx.fillStyle = CORAL;
  ctx.beginPath();
  ctx.arc(inset + 14 * scale, inset + 31.5 * scale, 3.2 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f4f0e8";
  ctx.font = `500 ${10 * scale}px ui-monospace, monospace`;
  const seconds = Math.max(0, time - project.timeline.inPoint);
  ctx.fillText(`CAM 01   ${seconds.toFixed(2).padStart(5, "0")} / 08.00`, inset + 24 * scale, inset + 35 * scale);
  ctx.restore();
}

export function renderComposite(canvas, project, time, options = {}) {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext("2d", { alpha: false });
  const camera = cameraAt(project, time);
  const frame = viewfinderFrame(project, camera);
  const scale = width / frame.width;

  ctx.save();
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);
  ctx.translate(width / 2, height / 2);
  ctx.scale(scale, scale);
  ctx.rotate((-frame.rotation * Math.PI) / 180);
  ctx.translate(-camera.x, -camera.y);
  for (const layer of videoLayersAt(project, time)) {
    ctx.globalAlpha = layer.alpha;
    drawWorld(ctx, layer.clip.variant || "form", time + (layer.clip.sourceIn || 0));
  }
  ctx.restore();

  const vignette = ctx.createRadialGradient(
    width * 0.52, height * 0.46, width * 0.16,
    width * 0.52, height * 0.46, width * 0.68,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(16,16,12,0.16)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  const subtitle = activeSubtitle(project, time);
  drawSubtitle(ctx, subtitle, width, height, time);
  if (!options.exportMode) drawPreviewHud(ctx, project, time, width, height);
  return { camera, frame, subtitle };
}

export function renderOverview(canvas, project, time, selectedKeyframeId) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const scale = width / project.stage.width;
  const toCanvas = (x, y) => ({ x: x * scale, y: y * scale });

  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#171713";
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.scale(scale, scale);
  ctx.globalAlpha = 0.15;
  drawWorld(ctx, "form", time);
  ctx.restore();

  ctx.strokeStyle = "rgba(238,233,223,0.18)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += width / 8) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += height / 5) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  const samples = sampleCameraPath(project, 160);
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, CORAL);
  gradient.addColorStop(0.52, ACID);
  gradient.addColorStop(1, "#7f9bff");
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.beginPath();
  samples.forEach((sample, index) => {
    const point = toCanvas(sample.camera.x, sample.camera.y);
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();

  project.camera.keyframes.forEach((keyframe, index) => {
    const point = toCanvas(keyframe.x, keyframe.y);
    const active = keyframe.id === selectedKeyframeId;
    ctx.fillStyle = active ? CORAL : "#eee9df";
    ctx.beginPath();
    ctx.arc(point.x, point.y, active ? 6 : 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#171713";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = active ? "#171713" : "rgba(238,233,223,0.7)";
    ctx.font = "600 8px ui-monospace, monospace";
    ctx.fillText(`0${index + 1}`, point.x + 8, point.y - 7);
  });

  const current = cameraAt(project, time);
  const currentFrame = viewfinderFrame(project, current);
  ctx.save();
  ctx.translate(current.x * scale, current.y * scale);
  ctx.rotate((current.rotation * Math.PI) / 180);
  ctx.strokeStyle = CORAL;
  ctx.lineWidth = 2;
  ctx.strokeRect(
    (-currentFrame.width / 2) * scale,
    (-currentFrame.height / 2) * scale,
    currentFrame.width * scale,
    currentFrame.height * scale,
  );
  ctx.fillStyle = "rgba(255,90,54,0.08)";
  ctx.fillRect(
    (-currentFrame.width / 2) * scale,
    (-currentFrame.height / 2) * scale,
    currentFrame.width * scale,
    currentFrame.height * scale,
  );
  ctx.restore();

  const violation = findPathViolations(project)[0];
  if (violation) {
    const point = toCanvas(
      Math.max(0, Math.min(project.stage.width, violation.point.x)),
      Math.max(0, Math.min(project.stage.height, violation.point.y)),
    );
    ctx.strokeStyle = CORAL;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 9, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(238,233,223,0.55)";
  ctx.font = "500 8px ui-monospace, monospace";
  ctx.fillText(`${project.stage.width} × ${project.stage.height}`, 9, height - 9);
  ctx.fillStyle = CORAL;
  ctx.fillText("CAM 01 / LIVE", width - 72, height - 9);
  ctx.restore();
}

export function timecode(time, fps = FPS) {
  const clamped = Math.max(0, time);
  const totalFrames = Math.round(clamped * fps);
  const frames = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}
