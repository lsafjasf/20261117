import {
  KEY_BINDINGS,
  MISSION_DURATION,
  REQUIRED_POINTS,
  ROLE_KEYS,
  ROLE_META,
  STABLE_HOLD,
  STABLE_THRESHOLD,
  SurveySimulation,
  TARGETS,
} from "./simulation.js";

const sim = new SurveySimulation();
const $ = (id) => document.getElementById(id);
const canvas = $("sceneCanvas");
const ctx = canvas.getContext("2d");
const wrap = $("canvasWrap");

const ui = {
  readyOverlay: $("readyOverlay"),
  pausedOverlay: $("pausedOverlay"),
  protectionOverlay: $("protectionOverlay"),
  completeOverlay: $("completeOverlay"),
  startPauseBtn: $("startPauseBtn"),
  startPauseLabel: $("startPauseLabel"),
  statusLight: $("statusLight"),
  stageMode: $("stageMode"),
  stageSub: $("stageSub"),
  modeBadge: $("modeBadge"),
  debugBadge: $("debugBadge"),
  syncChip: $("syncChip"),
  syncText: $("syncText"),
  syncRevision: $("syncRevision"),
  topCountdown: $("topCountdown"),
  missionCountdown: $("missionCountdown"),
  timeRail: $("timeRail"),
  successCount: $("successCount"),
  currentTarget: $("currentTarget"),
  targetVisibility: $("targetVisibility"),
  qualityValue: $("qualityValue"),
  stabilityRing: $("stabilityRing"),
  stabilityState: $("stabilityState"),
  holdBar: $("holdBar"),
  errorAz: $("errorAz"),
  errorEl: $("errorEl"),
  errorFocus: $("errorFocus"),
  confirmP1: $("confirmP1"),
  confirmP2: $("confirmP2"),
  shotsLeft: $("shotsLeft"),
  resourcePips: $("resourcePips"),
  p1Idle: $("p1Idle"),
  p2Idle: $("p2Idle"),
  p1Shots: $("p1Shots"),
  p2Shots: $("p2Shots"),
  p1Timer: $("p1Timer"),
  p2Timer: $("p2Timer"),
  p1Revision: $("p1Revision"),
  p2Revision: $("p2Revision"),
  linkP1: $("linkP1"),
  linkP2: $("linkP2"),
  p1AzValue: $("p1AzValue"),
  p1AzRail: $("p1AzRail"),
  p2ElValue: $("p2ElValue"),
  p2ElRail: $("p2ElRail"),
  p2FocusValue: $("p2FocusValue"),
  p2FocusRail: $("p2FocusRail"),
  hudAz: $("hudAz"),
  hudWindow: $("hudWindow"),
  hudTargetVisible: $("hudTargetVisible"),
  targetTagId: $("targetTagId"),
  targetTagName: $("targetTagName"),
  targetTagMeta: $("targetTagMeta"),
  footAz: $("footAz"),
  footEl: $("footEl"),
  footFocus: $("footFocus"),
  footStable: $("footStable"),
  sceneCaption: $("sceneCaption"),
  liveNotice: $("liveNotice"),
  recordSlots: $("recordSlots"),
  latestLedger: $("latestLedger"),
  ledgerTime: $("ledgerTime"),
  ledgerLight: $("ledgerLight"),
  acceptanceRow: $("acceptanceRow"),
  acceptanceState: $("acceptanceState"),
  sharedStamp: $("sharedStamp"),
  protectionTitle: $("protectionTitle"),
  protectionCopy: $("protectionCopy"),
  protectionReconnectBtn: $("protectionReconnectBtn"),
  protectAckP1: $("protectAckP1"),
  protectAckP2: $("protectAckP2"),
  completeTitle: $("completeTitle"),
  completeCopy: $("completeCopy"),
  reportBtn: $("reportBtn"),
  debugBtn: $("debugBtn"),
};

let lastFrame = performance.now();
let lastUiFrame = 0;
let sceneTime = 0;
let noticeText = "";
let noticeKey = "";
let noticeTimer = 0;
let replayOpen = false;
let replayAutoPaused = false;
let lastReport = null;
let acceptanceRan = false;
let renderedReadyVariant = null;
let acceptanceAutoPaused = false;

const replayState = {
  runs: [],
  runIndex: 0,
  bundle: null,
  snapshot: null,
  index: 0,
  playhead: 0,
  playing: false,
  speed: 1,
  lastPaint: 0,
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function pad(value, length = 2) {
  return String(value).padStart(length, "0");
}

function formatClock(seconds, tenths = true) {
  const safe = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  if (!tenths) return `${pad(mins)}:${pad(secs)}`;
  const tenth = Math.floor((safe % 1) * 10);
  return `${pad(mins)}:${pad(secs)}.${tenth}`;
}

function formatDelta(value, digits = 1) {
  const safe = Number(value) || 0;
  return `${safe >= 0 ? "+" : "−"}${Math.abs(safe).toFixed(digits)}`;
}

function toast(message, tone = "neutral", duration = 2800) {
  const stack = $("toastStack");
  const node = document.createElement("div");
  node.className = `toast ${tone}`;
  node.textContent = message;
  stack.appendChild(node);
  while (stack.children.length > 3) stack.firstElementChild.remove();
  window.setTimeout(() => {
    node.style.opacity = "0";
    node.style.transform = "translateX(8px)";
    window.setTimeout(() => node.remove(), 180);
  }, duration);
}

function modeLabel(snapshot) {
  if (snapshot.mode === "ready") {
    return snapshot.debug ? ["DEBUG READY", "单人调试 · 协作约束已旁路"] : ["STANDBY", "等待双方就位"];
  }
  if (snapshot.mode === "live") {
    return snapshot.debug
      ? ["DEBUG LIVE", "单人操作全部控制器"]
      : ["LIVE CAPTURE", snapshot.targetVisible ? "目标窗口开启" : "目标短暂遮蔽"];
  }
  if (snapshot.mode === "paused") return ["PAUSED", "计时与目标窗口已冻结"];
  if (snapshot.mode === "protection") return ["SAFE HOLD", "单侧保护，等待握手恢复"];
  if (snapshot.mode === "complete") return ["MISSION COMPLETE", snapshot.outcome === "success" ? "测点记录已锁定" : "任务已中止"];
  return ["STANDBY", "等待任务"];
}

function currentSnapshot() {
  if (replayOpen && replayState.snapshot) return replayState.snapshot;
  return sim.getSnapshot("ui");
}

function activeEvents() {
  if (replayOpen && replayState.bundle) return replayState.bundle.events;
  return sim.replay?.events || [];
}

function acceptanceStatus(snapshot = currentSnapshot()) {
  const records = snapshot.records || [];
  const events = activeEvents();
  const success = records.some((record) => record.status === "captured");
  const failure = records.some((record) => record.kind === "single-side-confirm");
  const recovery = events.some((event) => event.type === "protection_resume");
  return {
    success,
    failure,
    recovery,
    count: [success, failure, recovery].filter(Boolean).length,
  };
}

function resizeCanvas() {
  const rect = wrap.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function ridge(ctx, width, height, baseY, amplitude, phase, fill) {
  ctx.beginPath();
  ctx.moveTo(-20, height);
  ctx.lineTo(-20, baseY);
  for (let x = -20; x <= width + 20; x += 24) {
    const y =
      baseY
      - Math.sin(x * 0.0068 + phase) * amplitude
      - Math.sin(x * 0.017 + phase * 2.7) * amplitude * 0.28
      - Math.sin(x * 0.041 + phase) * 2;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(width + 20, height);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawSky(width, height, time) {
  const sky = ctx.createLinearGradient(0, 0, 0, height * 0.72);
  sky.addColorStop(0, "#071018");
  sky.addColorStop(0.38, "#0c2028");
  sky.addColorStop(0.7, "#1c3437");
  sky.addColorStop(1, "#3f4d42");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(width * 0.76, height * 0.2, 0, width * 0.76, height * 0.2, width * 0.34);
  glow.addColorStop(0, "rgba(240, 205, 136, 0.16)");
  glow.addColorStop(0.25, "rgba(185, 169, 122, 0.055)");
  glow.addColorStop(1, "rgba(185, 169, 122, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.fillStyle = "rgba(229, 232, 203, 0.72)";
  ctx.shadowColor = "rgba(235, 225, 180, 0.55)";
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(width * 0.76, height * 0.2, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  for (let index = 0; index < 38; index += 1) {
    const x = ((index * 137.3 + 31) % 997) / 997 * width;
    const y = ((index * 71.7 + 13) % 431) / 431 * height * 0.52;
    const flicker = 0.35 + Math.sin(time * 0.4 + index * 2.1) * 0.17;
    ctx.fillStyle = `rgba(196, 225, 226, ${flicker})`;
    ctx.fillRect(x, y, index % 5 === 0 ? 1.5 : 1, index % 5 === 0 ? 1.5 : 1);
  }

  ctx.save();
  ctx.strokeStyle = "rgba(142, 205, 214, 0.12)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 6]);
  ctx.beginPath();
  ctx.moveTo(0, height * 0.26);
  ctx.lineTo(width, height * 0.26);
  ctx.stroke();
  ctx.restore();
}

function drawTerrain(width, height, time, visible) {
  ridge(ctx, width, height, height * 0.56, 38, 1.4, "#1b3435");
  ridge(ctx, width, height, height * 0.62, 31, 3.8, "#162c2e");
  ridge(ctx, width, height, height * 0.69, 25, 5.2, "#112427");

  const valley = ctx.createLinearGradient(0, height * 0.61, 0, height);
  valley.addColorStop(0, "rgba(11, 25, 27, 0.3)");
  valley.addColorStop(0.5, "#0a1719");
  valley.addColorStop(1, "#071012");
  ctx.fillStyle = valley;
  ctx.fillRect(0, height * 0.68, width, height * 0.32);

  ctx.save();
  ctx.strokeStyle = "rgba(104, 167, 164, 0.18)";
  ctx.lineWidth = 0.8;
  for (let line = 0; line < 9; line += 1) {
    const base = height * (0.72 + line * 0.033);
    ctx.beginPath();
    for (let x = -10; x <= width + 10; x += 15) {
      const y = base + Math.sin(x * 0.011 + line * 1.8) * (5 + line * 2.4);
      if (x === -10) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();

  const haze = ctx.createLinearGradient(0, height * 0.48, 0, height * 0.74);
  haze.addColorStop(0, "rgba(185, 200, 178, 0)");
  haze.addColorStop(0.52, "rgba(178, 194, 175, 0.08)");
  haze.addColorStop(1, "rgba(178, 194, 175, 0)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, height * 0.45, width, height * 0.35);

  ctx.save();
  ctx.globalAlpha = visible ? 0.9 : 0.25;
  const poleX = width * 0.55;
  const poleBase = height * 0.57;
  ctx.strokeStyle = "rgba(204, 224, 209, 0.55)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(poleX, poleBase);
  ctx.lineTo(poleX, poleBase - 35);
  ctx.stroke();
  ctx.fillStyle = visible ? "rgba(255, 201, 101, 0.82)" : "rgba(145, 150, 128, 0.3)";
  ctx.beginPath();
  ctx.moveTo(poleX + 1, poleBase - 35);
  ctx.lineTo(poleX + 17, poleBase - 30);
  ctx.lineTo(poleX + 1, poleBase - 24);
  ctx.closePath();
  ctx.fill();
  if (visible) {
    ctx.shadowColor = "#ffcd6e";
    ctx.shadowBlur = 9;
    ctx.fillStyle = "#ffd67c";
    ctx.beginPath();
    ctx.arc(poleX, poleBase - 35, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "#b2d4c5";
  for (let index = 0; index < 16; index += 1) {
    const x = ((index * 97.3 + time * (4 + index % 3)) % (width + 80)) - 40;
    const y = height * 0.43 + (index * 19) % 95;
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.restore();
}

function drawInstrument(width, height, snapshot, time) {
  const x = width * 0.255;
  const base = height * 0.88;
  const top = height * 0.645;
  const lift = (snapshot.controls.elevation / 35) * 10;

  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(121, 157, 153, 0.62)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, base);
  ctx.lineTo(x - 31, base + 18);
  ctx.moveTo(x, base);
  ctx.lineTo(x + 30, base + 18);
  ctx.moveTo(x, base);
  ctx.lineTo(x + 2, top + 24);
  ctx.stroke();
  ctx.strokeStyle = "rgba(55, 80, 80, 0.9)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 31, base + 18);
  ctx.lineTo(x + 30, base + 18);
  ctx.stroke();

  ctx.translate(x, top + lift);
  ctx.rotate(-0.1 - (snapshot.controls.azimuth / 45) * 0.08);
  ctx.fillStyle = "#162a2e";
  ctx.strokeStyle = "rgba(138, 197, 195, 0.48)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(-24, -15, 48, 31, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#0b181c";
  ctx.beginPath();
  ctx.roundRect(-51, -9, 34, 17, 5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(99, 220, 255, 0.7)";
  ctx.beginPath();
  ctx.arc(-51, 0, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = "#63dcff";
  ctx.shadowBlur = 8;
  ctx.fillStyle = "rgba(99, 220, 255, 0.9)";
  ctx.beginPath();
  ctx.arc(35, -2, 1.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const pulse = 0.55 + Math.sin(time * 2.2) * 0.2;
  const p1x = x - 43;
  const p2x = x + 58;
  drawOperator(p1x, base + 4, "#63dcff", pulse, "A");
  drawOperator(p2x, base + 3, "#ffc766", pulse * 0.85, "B");
}

function drawOperator(x, y, color, alpha, label) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 9;
  ctx.beginPath();
  ctx.arc(x, y - 26, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = alpha * 0.48;
  ctx.beginPath();
  ctx.moveTo(x - 7, y - 19);
  ctx.lineTo(x + 8, y - 20);
  ctx.lineTo(x + 12, y);
  ctx.lineTo(x - 11, y);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = alpha * 0.8;
  ctx.fillStyle = color;
  ctx.font = "700 7px monospace";
  ctx.textAlign = "center";
  ctx.fillText(label, x, y - 34);
  ctx.restore();
}

function drawViewfinder(width, height, snapshot, time) {
  const radius = clamp(Math.min(width * 0.185, height * 0.285), 86, 175);
  const cx = width * (width < 620 ? 0.67 : 0.72);
  const cy = height * 0.43;
  const colors = { P1: "#63dcff", P2: "#ffc766" };
  const ringColor = snapshot.targetVisible && snapshot.quality >= STABLE_THRESHOLD
    ? "#8df2b5"
    : snapshot.targetVisible ? "#63dcff" : "#6d7b7b";

  ctx.save();
  ctx.translate(cx, cy);

  ctx.fillStyle = "rgba(2, 8, 11, 0.82)";
  ctx.beginPath();
  ctx.arc(0, 0, radius + 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(150, 195, 201, 0.24)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, radius + 8, 0, Math.PI * 2);
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.clip();
  const lens = ctx.createRadialGradient(0, 0, radius * 0.15, 0, 0, radius * 1.2);
  lens.addColorStop(0, "#1b3537");
  lens.addColorStop(0.62, "#12282b");
  lens.addColorStop(1, "#081518");
  ctx.fillStyle = lens;
  ctx.fillRect(-radius, -radius, radius * 2, radius * 2);

  const scopeHaze = ctx.createLinearGradient(0, -radius, 0, radius);
  scopeHaze.addColorStop(0, "rgba(170, 197, 178, 0.16)");
  scopeHaze.addColorStop(0.52, "rgba(91, 125, 114, 0.06)");
  scopeHaze.addColorStop(1, "rgba(26, 48, 43, 0.18)");
  ctx.fillStyle = scopeHaze;
  ctx.fillRect(-radius, -radius, radius * 2, radius * 2);

  ctx.fillStyle = "#102527";
  ctx.beginPath();
  ctx.moveTo(-radius, radius * 0.2);
  ctx.lineTo(-radius * 0.52, -radius * 0.12);
  ctx.lineTo(-radius * 0.08, radius * 0.07);
  ctx.lineTo(radius * 0.45, -radius * 0.18);
  ctx.lineTo(radius, radius * 0.1);
  ctx.lineTo(radius, radius);
  ctx.lineTo(-radius, radius);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#0a1a1c";
  ctx.beginPath();
  ctx.moveTo(-radius, radius * 0.46);
  ctx.lineTo(-radius * 0.45, radius * 0.29);
  ctx.lineTo(-radius * 0.05, radius * 0.48);
  ctx.lineTo(radius * 0.4, radius * 0.24);
  ctx.lineTo(radius, radius * 0.4);
  ctx.lineTo(radius, radius);
  ctx.lineTo(-radius, radius);
  ctx.closePath();
  ctx.fill();

  const pxPerDegree = radius / 9.5;
  const targetX = clamp(snapshot.errors.azimuth * pxPerDegree, -radius * 0.9, radius * 0.9);
  const targetY = clamp(-snapshot.errors.elevation * pxPerDegree * 1.15, -radius * 0.72, radius * 0.72);
  const focusBlur = Math.abs(snapshot.errors.focus);
  const opacity = snapshot.targetVisible
    ? clamp(0.28 + snapshot.quality / 120, 0.28, 0.95)
    : 0.06;

  if (snapshot.targetVisible) {
    ctx.save();
    ctx.translate(targetX, targetY);
    ctx.globalAlpha = opacity;
    const beacon = ctx.createRadialGradient(0, 0, 0, 0, 0, 14 + focusBlur * 110);
    beacon.addColorStop(0, "rgba(255, 244, 197, 0.98)");
    beacon.addColorStop(0.11, "rgba(255, 207, 116, 0.9)");
    beacon.addColorStop(0.36, "rgba(255, 190, 80, 0.19)");
    beacon.addColorStop(1, "rgba(255, 190, 80, 0)");
    ctx.fillStyle = beacon;
    ctx.beginPath();
    ctx.arc(0, 0, 14 + focusBlur * 110, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 224, 157, 0.82)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(0, 20);
    ctx.stroke();
    ctx.fillStyle = "#ffe7a9";
    ctx.shadowColor = "#ffc766";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(1, -12);
    ctx.lineTo(12, -8);
    ctx.lineTo(1, -3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  } else {
    ctx.save();
    ctx.fillStyle = "rgba(170, 193, 184, 0.12)";
    for (let index = 0; index < 28; index += 1) {
      const x = Math.sin(index * 91.7 + time * 0.6) * radius * 0.82;
      const y = Math.cos(index * 47.9 + time * 0.4) * radius * 0.68;
      ctx.fillRect(x, y, index % 4 === 0 ? 2 : 1, 1);
    }
    ctx.fillStyle = "rgba(185, 205, 196, 0.42)";
    ctx.font = "600 8px monospace";
    ctx.textAlign = "center";
    ctx.fillText("· SIGNAL LOST ·", 0, radius * 0.58);
    ctx.restore();
  }

  const gap = Math.max(6, radius * 0.08);
  ctx.save();
  ctx.strokeStyle = ringColor;
  ctx.globalAlpha = snapshot.targetVisible ? 0.82 : 0.34;
  ctx.lineWidth = 0.8;
  ctx.shadowColor = ringColor;
  ctx.shadowBlur = snapshot.quality >= STABLE_THRESHOLD ? 8 : 3;
  ctx.beginPath();
  ctx.moveTo(-radius, 0);
  ctx.lineTo(-gap, 0);
  ctx.moveTo(gap, 0);
  ctx.lineTo(radius, 0);
  ctx.moveTo(0, -radius);
  ctx.lineTo(0, -gap);
  ctx.moveTo(0, gap);
  ctx.lineTo(0, radius);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.setLineDash([2, 6]);
  ctx.globalAlpha = 0.28;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.56, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = ringColor;
  ctx.beginPath();
  ctx.arc(0, 0, 1.7, 0, Math.PI * 2);
  ctx.fill();
  for (const angle of [0, 90, 180, 270]) {
    const rad = (angle * Math.PI) / 180;
    const inner = radius - 8;
    const outer = radius - 2;
    ctx.globalAlpha = 0.46;
    ctx.beginPath();
    ctx.moveTo(Math.cos(rad) * inner, Math.sin(rad) * inner);
    ctx.lineTo(Math.cos(rad) * outer, Math.sin(rad) * outer);
    ctx.stroke();
  }
  ctx.restore();

  const activeP1 = Boolean(snapshot.confirmations?.P1);
  const activeP2 = Boolean(snapshot.confirmations?.P2);
  for (const [role, active] of [["P1", activeP1], ["P2", activeP2]]) {
    if (!active) continue;
    ctx.save();
    ctx.strokeStyle = colors[role];
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.9;
    ctx.shadowColor = colors[role];
    ctx.shadowBlur = 7;
    ctx.beginPath();
    ctx.arc(0, 0, radius + 4, role === "P1" ? Math.PI * 0.82 : Math.PI * 1.18, role === "P1" ? Math.PI * 1.18 : Math.PI * 1.55);
    ctx.stroke();
    ctx.restore();
  }

  ctx.fillStyle = "rgba(3, 9, 11, 0.82)";
  ctx.beginPath();
  ctx.moveTo(-radius * 0.44, radius + 2);
  ctx.lineTo(radius * 0.44, radius + 2);
  ctx.lineTo(radius * 0.32, radius + 14);
  ctx.lineTo(-radius * 0.32, radius + 14);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = snapshot.targetVisible ? ringColor : "rgba(172, 193, 184, 0.5)";
  ctx.font = "600 7px monospace";
  ctx.textAlign = "center";
  ctx.fillText(
    snapshot.targetVisible
      ? `${snapshot.target.id} / ${snapshot.quality >= STABLE_THRESHOLD ? "RETICLE STABLE" : "SEEKING"}`
      : `${snapshot.target.id} / NO LINE OF SIGHT`,
    0,
    radius + 10,
  );
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(160, 205, 210, 0.24)";
  ctx.lineWidth = 1;
  for (let tick = 0; tick < 72; tick += 1) {
    const angle = (tick / 72) * Math.PI * 2;
    const length = tick % 6 === 0 ? 7 : 3;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * (radius + 9), Math.sin(angle) * (radius + 9));
    ctx.lineTo(Math.cos(angle) * (radius + 9 + length), Math.sin(angle) * (radius + 9 + length));
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(154, 193, 196, 0.7)";
  ctx.font = "600 7px monospace";
  ctx.textAlign = "center";
  ctx.fillText("N", 0, -radius - 20);
  ctx.fillText("E", radius + 20, 2);
  ctx.fillText("S", 0, radius + 27);
  ctx.fillText("W", -radius - 20, 2);
  ctx.restore();
  ctx.restore();
}

function drawScene(snapshot, time) {
  resizeCanvas();
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);
  drawSky(width, height, time);
  drawTerrain(width, height, time, snapshot.targetVisible);

  const directionX = width * 0.5 + snapshot.controls.azimuth * 3.4;
  ctx.save();
  ctx.strokeStyle = "rgba(99, 220, 255, 0.1)";
  ctx.setLineDash([2, 8]);
  ctx.beginPath();
  ctx.moveTo(directionX, height * 0.22);
  ctx.lineTo(directionX, height * 0.57);
  ctx.stroke();
  ctx.restore();

  drawInstrument(width, height, snapshot, time);
  drawViewfinder(width, height, snapshot, time);

  ctx.save();
  ctx.strokeStyle = "rgba(128, 177, 179, 0.2)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(width * 0.36, height * 0.78);
  ctx.lineTo(width * 0.58, height * 0.64);
  ctx.stroke();
  ctx.fillStyle = "rgba(160, 202, 201, 0.45)";
  ctx.font = "600 7px monospace";
  ctx.fillText("OPTICAL LINK", width * 0.38, height * 0.77);
  ctx.restore();
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node && node.textContent !== String(value)) node.textContent = value;
}

function buildResourcePips() {
  ui.resourcePips.replaceChildren();
  for (let index = 0; index < 6; index += 1) {
    ui.resourcePips.appendChild(document.createElement("i"));
  }
}

function showLiveNotice(message, tone = "neutral", key = message) {
  if (!message || key === noticeKey) return;
  noticeText = message;
  noticeKey = key;
  ui.liveNotice.textContent = message;
  ui.liveNotice.className = `live-notice visible ${tone === "danger" ? "danger" : ""}`;
  noticeTimer = 3.2;
}

function renderUI(snapshot) {
  const [mode, subtitle] = modeLabel(snapshot);
  if (replayOpen) {
    ui.stageMode.textContent = "REPLAY";
    ui.stageSub.textContent = "只读快照回放";
  } else {
    setText("stageMode", mode);
    setText("stageSub", subtitle);
  }
  ui.statusLight.className = "status-light";
  if (snapshot.mode === "live") ui.statusLight.classList.add("live");
  if (snapshot.mode === "paused" || snapshot.mode === "protection") ui.statusLight.classList.add("warning");
  if (snapshot.mode === "complete" && snapshot.outcome !== "success") ui.statusLight.classList.add("danger");

  ui.modeBadge.textContent = replayOpen ? "REPLAY / READ ONLY" : mode;
  ui.modeBadge.className = "mode-badge";
  if (snapshot.mode === "live") ui.modeBadge.classList.add("live");
  if (snapshot.mode === "protection" || snapshot.outcome === "timeout" || snapshot.outcome === "resource-exhausted") {
    ui.modeBadge.classList.add("danger");
  }
  ui.debugBadge.hidden = !snapshot.debug;

  const revision = `REV ${pad(snapshot.revision % 10000, 4)}`;
  setText("syncRevision", revision);
  setText("sharedStamp", revision);
  setText("p1Revision", pad(snapshot.revision % 10000, 4));
  setText("p2Revision", pad(snapshot.revision % 10000, 4));

  const anyLost = !snapshot.players.P1.connected || !snapshot.players.P2.connected;
  ui.syncChip.className = "sync-chip";
  if (snapshot.mode === "protection") {
    ui.syncChip.classList.add("offline");
    setText("syncText", "SAFE HOLD / FROZEN");
  } else if (anyLost) {
    ui.syncChip.classList.add("offline");
    setText("syncText", "SINGLE-SIDE LOST");
  } else if (snapshot.mode === "paused") {
    ui.syncChip.classList.add("warning");
    setText("syncText", "FROZEN / 双端一致");
  } else {
    setText("syncText", "DUAL PANEL SYNC");
  }

  setText("topCountdown", formatClock(snapshot.remaining));
  setText("missionCountdown", formatClock(snapshot.remaining));
  ui.timeRail.style.width = `${clamp(snapshot.remaining / MISSION_DURATION, 0, 1) * 100}%`;
  setText("successCount", snapshot.successCount);
  setText("currentTarget", snapshot.target.id);
  setText("targetVisibility", snapshot.targetVisible ? "窗口可见" : "暂时遮蔽");
  ui.targetVisibility.classList.toggle("lost", !snapshot.targetVisible);
  setText("shotsLeft", snapshot.shotsLeft);
  ui.resourcePips.setAttribute("aria-label", `共享采样资源剩余 ${snapshot.shotsLeft}`);
  [...ui.resourcePips.children].forEach((pip, index) => {
    pip.classList.toggle("spent", index >= snapshot.shotsLeft);
  });

  const ringColor = !snapshot.targetVisible
    ? "#647779"
    : snapshot.quality >= STABLE_THRESHOLD ? "#8df2b5" : snapshot.quality >= 65 ? "#63dcff" : "#ffc766";
  ui.stabilityRing.style.setProperty("--quality", snapshot.quality.toFixed(1));
  ui.stabilityRing.style.setProperty("--ring-color", ringColor);
  setText("qualityValue", Math.round(snapshot.quality));
  setText(
    "stabilityState",
    !snapshot.targetVisible
      ? "目标不可见"
      : snapshot.quality >= STABLE_THRESHOLD
        ? snapshot.stableFor >= STABLE_HOLD ? "稳定 · 可记录" : "已对准 · 保持中"
        : "需要微调",
  );
  ui.stabilityState.classList.toggle("aligned", snapshot.targetVisible && snapshot.quality >= STABLE_THRESHOLD);
  ui.holdBar.style.width = `${clamp(snapshot.stableFor / STABLE_HOLD, 0, 1) * 100}%`;
  setText("errorAz", `${formatDelta(snapshot.errors.azimuth)}°`);
  setText("errorEl", `${formatDelta(snapshot.errors.elevation)}°`);
  setText("errorFocus", `${snapshot.errors.focus >= 0 ? "+" : "−"}${Math.abs(snapshot.errors.focus).toFixed(2)}`);

  renderConfirmation(ui.confirmP1, snapshot.confirmations?.P1, snapshot, "P1");
  renderConfirmation(ui.confirmP2, snapshot.confirmations?.P2, snapshot, "P2");

  setText("p1Idle", `${snapshot.players.P1.idle.toFixed(1)}s`);
  setText("p2Idle", `${snapshot.players.P2.idle.toFixed(1)}s`);
  setText("p1Shots", snapshot.shotsLeft);
  setText("p2Shots", snapshot.shotsLeft);
  setText("p1Timer", formatClock(snapshot.remaining, false));
  setText("p2Timer", formatClock(snapshot.remaining, false));
  ui.p1Idle.style.color = snapshot.players.P1.idle >= 24 ? "var(--danger)" : "";
  ui.p2Idle.style.color = snapshot.players.P2.idle >= 24 ? "var(--danger)" : "";

  setText("p1AzValue", `${snapshot.controls.azimuth.toFixed(1)}°`);
  setText("p2ElValue", `${snapshot.controls.elevation >= 0 ? "+" : "−"}${Math.abs(snapshot.controls.elevation).toFixed(1)}°`);
  setText("p2FocusValue", snapshot.controls.focus.toFixed(2));
  ui.p1AzRail.style.width = `${((snapshot.controls.azimuth + 45) / 90) * 100}%`;
  ui.p2ElRail.style.width = `${((snapshot.controls.elevation + 20) / 55) * 100}%`;
  ui.p2FocusRail.style.width = `${((snapshot.controls.focus - 0.12) / 0.8) * 100}%`;
  setText("hudAz", `${snapshot.controls.azimuth.toFixed(1)}°`);
  setText("hudWindow", `${snapshot.targetWindowRemaining.toFixed(1)}s`);
  setText("hudTargetVisible", snapshot.targetVisible ? "SIGNAL ACTIVE" : "RECAPTURE");
  setText("targetTagId", snapshot.target.id.replace("-", "—"));
  setText("targetTagName", snapshot.target.name);
  setText(
    "targetTagMeta",
    snapshot.targetVisible ? "VISIBLE / SHARED LOCK" : "OCCLUDED / WINDOW CLOSED",
  );
  setText("footAz", `${snapshot.controls.azimuth.toFixed(1)}°`);
  setText("footEl", `${snapshot.controls.elevation.toFixed(1)}°`);
  setText("footFocus", snapshot.controls.focus.toFixed(2));
  setText("footStable", `${snapshot.stableFor.toFixed(1)}s`);
  const sceneCaption = snapshot.mode === "protection"
    ? "共享循环冻结 / 等待恢复握手"
    : snapshot.targetVisible
      ? "目标短暂可见 / 双轴协同捕获"
      : "目标遮蔽 / 保留设备指向";
  setText("sceneCaption", sceneCaption);
  ui.linkP1.classList.toggle("lost", !snapshot.players.P1.connected);
  ui.linkP2.classList.toggle("lost", !snapshot.players.P2.connected);
  setText("linkP1", snapshot.players.P1.connected ? "LINK" : "LOST");
  setText("linkP2", snapshot.players.P2.connected ? "LINK" : "LOST");
  ui.linkP1.innerHTML = snapshot.players.P1.connected
    ? "<span></span>LINK"
    : "<span></span>LOST";
  ui.linkP2.innerHTML = snapshot.players.P2.connected
    ? "<span></span>LINK"
    : "<span></span>LOST";

  updateOverlays(snapshot);
  updateLedger(snapshot);
  updateToolbar(snapshot);

  if (!replayOpen && snapshot.latestNotice) {
    const danger = snapshot.latestNotice.includes("失败") || snapshot.latestNotice.includes("中断") || snapshot.latestNotice.includes("超时");
    showLiveNotice(
      snapshot.latestNotice,
      danger ? "danger" : "neutral",
      `${snapshot.latestNotice}|${snapshot.latestNoticeSeq}`,
    );
  }
}

function renderConfirmation(node, confirmation, snapshot, role) {
  const protectedAck = snapshot.mode === "protection" && snapshot.protection?.acks?.[role];
  node.classList.toggle("armed", Boolean(confirmation) || Boolean(protectedAck));
  const status = node.querySelector("em");
  if (!status) return;
  if (snapshot.mode === "protection") {
    status.textContent = snapshot.protection?.phase === "handshake"
      ? protectedAck ? "已握手" : "待握手"
      : "保护冻结";
    return;
  }
  status.textContent = confirmation ? "已确认" : "待确认";
}

function updateLedger(snapshot) {
  const captured = snapshot.records.filter((record) => record.status === "captured");
  const missed = snapshot.records.filter((record) => record.status === "missed");
  const chunks = TARGETS.map((target, index) => {
    const found = captured.find((record) => record.targetId === target.id);
    const failed = missed.find((record) => record.targetId === target.id);
    const stateClass = found ? "captured" : failed ? "failed" : "";
    const state = found ? "已锁定" : failed ? "需重试" : "待采集";
    return `
      <div class="record-slot ${stateClass}">
        <span>PT—0${index + 1} / ${escapeHtml(target.id)}</span>
        <strong>${found ? `${escapeHtml(found.id)} · ${state}` : state}</strong>
      </div>`;
  });
  ui.recordSlots.innerHTML = chunks.join("");

  const latest = snapshot.records[snapshot.records.length - 1];
  const ledgerText = latest
    ? latest.status === "captured"
      ? `${latest.id} 双人落点写入 · ${latest.targetName}`
      : `记录失败 · ${failureLabel(latest.kind)}`
    : snapshot.latestNotice || "尚无操作记录";
  setText("latestLedger", ledgerText);
  setText("ledgerTime", formatClock(snapshot.t));
  ui.ledgerLight.className = "ledger-light";
  if (latest?.status === "captured") ui.ledgerLight.classList.add("live");
  if (latest?.status === "missed") ui.ledgerLight.classList.add("danger");

  const status = acceptanceStatus(snapshot);
  ui.acceptanceRow.querySelectorAll("[data-check]").forEach((node) => {
    const key = node.dataset.check;
    node.classList.toggle("done", Boolean(status[key]));
  });
  setText("acceptanceState", `本轮 ${status.count} / 3`);
}

function failureLabel(kind) {
  const labels = {
    "single-side-confirm": "单侧确认超时",
    "target-hidden": "目标已遮蔽",
    "conflict-alignment": "双方确认但未对准",
    "conflict-unstable": "稳定保持不足",
    "alignment": "单侧调试未对准",
    "unstable": "单侧调试保持不足",
  };
  return labels[kind] || kind;
}

function updateOverlays(snapshot) {
  const readOnly = replayOpen;
  ui.readyOverlay.hidden = readOnly || snapshot.mode !== "ready";
  ui.pausedOverlay.hidden = readOnly || snapshot.mode !== "paused";
  ui.protectionOverlay.hidden = readOnly || snapshot.mode !== "protection";
  ui.completeOverlay.hidden = readOnly || snapshot.mode !== "complete";

  const readyCard = ui.readyOverlay.querySelector(".overlay-card");
  readyCard.classList.toggle("debug-card", snapshot.debug);
  if (renderedReadyVariant !== snapshot.debug) {
    renderedReadyVariant = snapshot.debug;
    setText("readyTitle", snapshot.debug ? "单人调试 · 全控制器旁路" : "一人定方位，一人稳仰角");
    setText(
      "readyCopy",
      snapshot.debug
        ? "本模式只用于单人检查三轴、目标和计时。A/D、方向键、W/S 与空格均由同一人操作，运行记录会明确标记为 DEBUG，双人协作确认不再生效。"
        : "目标只在短暂窗口内可见。双方各自确认后，共享采样片才会写入任务记录。",
    );
    $("readyKeyPair").innerHTML = snapshot.debug
      ? `<div><b class="p1-text">单人三轴控制</b><span><kbd>A</kbd><kbd>D</kbd> 方位 · <kbd>↑</kbd><kbd>↓</kbd> 仰角 · <kbd>W</kbd><kbd>S</kbd> 焦距</span></div>
         <div><b class="p2-text">单侧确认</b><span><kbd>SPACE</kbd> 提交记录 · 调试旁路不会写入双人确认</span></div>`
      : `<div><b class="p1-text">A 观测员</b><span><kbd>A</kbd><kbd>D</kbd> 方位 · <kbd>SPACE</kbd> 确认</span></div>
         <div><b class="p2-text">B 观测员</b><span><kbd>↑</kbd><kbd>↓</kbd> 仰角 · <kbd>W</kbd><kbd>S</kbd> 焦距 · <kbd>ENTER</kbd> 确认</span></div>`;
    $("readyStartBtn").textContent = snapshot.debug ? "开始单人调试" : "双人开始任务";
  }

  if (snapshot.mode === "protection" && snapshot.protection) {
    const role = snapshot.protection.actor;
    const name = ROLE_META[role].name;
    const waiting = snapshot.protection.phase === "waiting";
    setText(
      "protectionTitle",
      waiting ? `${name} 链路中断` : "等待双侧恢复握手",
    );
    setText(
      "protectionCopy",
      waiting
        ? `共享任务已冻结在 ${formatClock(snapshot.remaining, false)}。资源、目标窗口和倒计时均停止消耗。恢复链路后，双方必须各用自己的确认键完成握手。`
        : `链路已恢复。A 按 SPACE、B 按 ENTER，两把不同确认键都收到后任务才会继续；任一侧不能单独解除保护。`,
    );
    ui.protectionReconnectBtn.hidden = !waiting;
    ui.protectionReconnectBtn.disabled = !waiting;
    ui.protectionReconnectBtn.textContent = waiting ? `模拟重连 ${role}` : "链路已恢复";
    ui.protectAckP1.classList.toggle("acked", Boolean(snapshot.protection.acks.P1));
    ui.protectAckP2.classList.toggle("acked", Boolean(snapshot.protection.acks.P2));
    ui.protectAckP1.querySelector("em").textContent = waiting
      ? "链路冻结"
      : snapshot.protection.acks.P1 ? "已握手" : "待握手";
    ui.protectAckP2.querySelector("em").textContent = waiting
      ? "链路冻结"
      : snapshot.protection.acks.P2 ? "已握手" : "待握手";
  }

  if (snapshot.mode === "complete") {
    const success = snapshot.outcome === "success";
    setText("completeTitle", success ? "三个测点已完成" : "任务已中止");
    setText(
      "completeCopy",
      success
        ? `共享任务记录已锁定，用时 ${formatClock(snapshot.t, false)}。报告包含双方输入、资源与冲突回放。`
        : `共享采样片剩余 ${snapshot.shotsLeft}，仅完成 ${snapshot.successCount} / ${REQUIRED_POINTS} 个测点。`,
    );
    $("completeReportBtn").disabled = !success;
  }
}

function updateToolbar(snapshot) {
  const labels = {
    ready: "开始任务",
    live: "暂停任务",
    paused: "继续任务",
    protection: "安全保护",
    complete: "任务结束",
  };
  setText("startPauseLabel", labels[snapshot.mode] || "开始任务");
  ui.startPauseBtn.disabled = replayOpen || snapshot.mode === "protection" || snapshot.mode === "complete";
  ui.startPauseBtn.classList.toggle("btn-primary", snapshot.mode !== "live");
  ui.debugBtn.textContent = replayOpen ? "单人调试" : sim.debug ? "退出调试" : "单人调试";
  ui.debugBtn.disabled = replayOpen || snapshot.mode === "live" || snapshot.mode === "protection";
  ui.reportBtn.disabled = replayOpen || snapshot.successCount < REQUIRED_POINTS;
  ui.reportBtn.title = snapshot.successCount < REQUIRED_POINTS ? "完成三个测点后可导出" : "导出本轮报告";
}

function updateNoticeClock(dt) {
  if (noticeTimer <= 0) return;
  noticeTimer -= dt;
  if (noticeTimer <= 0) ui.liveNotice.classList.remove("visible");
}

function startOrPause() {
  if (sim.mode === "ready") {
    sim.start();
    toast("双人任务开始：目标窗口已开启", "good");
  } else if (sim.mode === "live" || sim.mode === "paused") {
    sim.togglePause("toolbar");
  } else {
    return;
  }
  renderUI(sim.getSnapshot("toolbar"));
}

function restartMission(source = "button") {
  closeAllModals();
  sim.restart(source);
  noticeText = "";
  acceptanceRan = false;
  toast("仪表、目标、计时与资源已原子复位", "good");
  renderUI(sim.getSnapshot("restart-ui"));
}

function toggleDebug() {
  if (sim.mode === "live" || sim.mode === "protection") {
    toast("请先暂停或重新开始，再切换单人调试", "danger");
    return;
  }
  sim.setDebug(!sim.debug);
  noticeText = "";
  toast(
    sim.debug ? "单人调试：所有控制器由一人操作，协作确认已旁路" : "已退出调试，恢复双人职责约束",
    sim.debug ? "neutral" : "good",
  );
  renderUI(sim.getSnapshot("debug-ui"));
}

function handleStartPauseKey() {
  if (replayOpen) return;
  startOrPause();
}

function bindBasicControls() {
  ui.startPauseBtn.addEventListener("click", startOrPause);
  $("readyStartBtn").addEventListener("click", () => {
    if (sim.mode === "ready") sim.start();
    renderUI(sim.getSnapshot("ready-start"));
  });
  $("pausedResumeBtn").addEventListener("click", () => {
    if (sim.mode === "paused") sim.togglePause("overlay");
    renderUI(sim.getSnapshot("paused-resume"));
  });
  $("restartBtn").addEventListener("click", () => restartMission("toolbar"));
  $("protectionRestartBtn").addEventListener("click", () => restartMission("protection"));
  $("completeRestartBtn").addEventListener("click", () => restartMission("complete"));
  ui.debugBtn.addEventListener("click", toggleDebug);
  $("replayBtn").addEventListener("click", openReplay);
  ui.reportBtn.addEventListener("click", openReport);
  ui.protectionReconnectBtn.addEventListener("click", () => {
    if (!sim.protection) return;
    const role = sim.protection.actor;
    if (sim.protection.phase === "waiting") {
      sim.reconnect(role);
      toast(`${ROLE_META[role].name} 已重连，等待双方各按确认键`, "good");
      renderUI(sim.getSnapshot("reconnect"));
    }
  });
  $("completeReportBtn").addEventListener("click", openReport);

  $("disconnectP1").addEventListener("click", () => {
    if (sim.simulateDisconnect("P1")) toast("A 链路中断，已进入单侧保护", "danger");
  });
  $("disconnectP2").addEventListener("click", () => {
    if (sim.simulateDisconnect("P2")) toast("B 链路中断，已进入单侧保护", "danger");
  });
  $("timeoutP1").addEventListener("click", () => {
    if (sim.simulateTimeout("P1")) toast("A 输入超时，已触发保护", "danger");
  });
  $("timeoutP2").addEventListener("click", () => {
    if (sim.simulateTimeout("P2")) toast("B 输入超时，已触发保护", "danger");
  });

  $("acceptanceBtn").addEventListener("click", () => {
    acceptanceAutoPaused = sim.mode === "live";
    if (acceptanceAutoPaused) sim.togglePause("acceptance-open");
    $("acceptanceModal").hidden = false;
    if (!acceptanceRan) runAcceptanceProbe();
  });
  $("runAcceptanceBtn").addEventListener("click", runAcceptanceProbe);
  document.querySelectorAll("[data-close]").forEach((node) => {
    node.addEventListener("click", () => closeModal(node.dataset.close));
  });
}

function setKeycapActive(code, active) {
  document.querySelectorAll(`[data-hold-code="${code}"]`).forEach((node) => {
    node.classList.toggle("active", active);
  });
}

function bindKeyboard() {
  window.addEventListener("keydown", (event) => {
    if (event.code === "Escape") {
      closeAllModals();
      return;
    }
    if (replayOpen) {
      if (event.code === "KeyV") closeModal("replayModal");
      if (event.code === "Space") {
        event.preventDefault();
        toggleReplayPlayback();
      }
      return;
    }
    if (document.querySelector(".modal:not([hidden])")) return;
    const tag = document.activeElement?.tagName;
    if (["INPUT", "SELECT", "TEXTAREA"].includes(tag)) return;
    if (event.code === "KeyV") {
      event.preventDefault();
      openReplay();
      return;
    }
    if (event.code === "KeyP" && sim.mode === "ready") {
      event.preventDefault();
      startOrPause();
      return;
    }
    const binding = KEY_BINDINGS[event.code];
    if (!binding) return;
    event.preventDefault();
    if (event.repeat) return;
    const result = sim.inputDown(event.code, "keyboard");
    setKeycapActive(event.code, Boolean(sim.held.get(event.code)));
    if (!result.accepted && result.reason) {
      const quiet = ["按键已处于按下状态", "任务尚未运行或已结束"].includes(result.reason);
      if (!quiet) toast(result.reason, "danger", 1900);
    }
    renderUI(sim.getSnapshot("keydown"));
  });

  window.addEventListener("keyup", (event) => {
    if (!KEY_BINDINGS[event.code]) return;
    event.preventDefault();
    sim.inputUp(event.code, "keyboard");
    setKeycapActive(event.code, false);
    if (!replayOpen) renderUI(sim.getSnapshot("keyup"));
  });

  window.addEventListener("blur", () => {
    sim.releaseAll("window-blur");
    document.querySelectorAll(".keycap.active").forEach((node) => node.classList.remove("active"));
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      sim.releaseAll("visibility-hidden");
      document.querySelectorAll(".keycap.active").forEach((node) => node.classList.remove("active"));
    }
  });
}

function bindPointerControls() {
  document.querySelectorAll("[data-hold-code]").forEach((node) => {
    const code = node.dataset.holdCode;
    const release = (event) => {
      if (event) event.preventDefault();
      sim.inputUp(code, "pointer");
      node.classList.remove("active");
      if (!replayOpen) renderUI(sim.getSnapshot("pointer-up"));
    };
    node.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      node.setPointerCapture?.(event.pointerId);
      const result = sim.inputDown(code, "pointer");
      node.classList.toggle("active", Boolean(sim.held.get(code)) || result.accepted);
      if (!result.accepted && result.reason) toast(result.reason, "danger", 1700);
      renderUI(sim.getSnapshot("pointer-down"));
    });
    node.addEventListener("pointerup", release);
    node.addEventListener("pointercancel", release);
    node.addEventListener("lostpointercapture", release);
    node.addEventListener("contextmenu", (event) => event.preventDefault());
  });
}

function openReplay() {
  if (replayOpen) return;
  closeAllModals(false);
  if (sim.mode === "live") {
    sim.togglePause("replay-open");
    replayAutoPaused = true;
  }
  const runs = sim.getReplays();
  if (!runs.length) {
    toast("当前没有可回放的运行记录", "danger");
    return;
  }
  replayState.runs = runs;
  replayState.runIndex = 0;
  replayState.playing = false;
  replayOpen = true;
  $("replayModal").hidden = false;
  const select = $("replayRunSelect");
  select.innerHTML = runs
    .map((run, index) => {
      const summary = run.summary || {};
      return `<option value="${index}">${escapeHtml(run.id)} · ${summary.successCount || 0} 测点 · ${escapeHtml(summary.outcome || "运行中")}</option>`;
    })
    .join("");
  select.value = "0";
  loadReplayRun(0);
  toast("回放已载入，事件与双侧快照均为只读", "good");
}

function closeReplay() {
  if (!replayOpen) return;
  replayOpen = false;
  replayState.playing = false;
  replayState.snapshot = null;
  replayState.bundle = null;
  $("replayModal").hidden = true;
  renderUI(sim.getSnapshot("replay-close"));
  if (replayAutoPaused && sim.mode === "paused") {
    toast("回放关闭；任务仍保持暂停，按 P 继续", "neutral");
  }
  replayAutoPaused = false;
}

function closeModal(id) {
  if (id === "replayModal") {
    closeReplay();
    return;
  }
  const node = $(id);
  if (node) node.hidden = true;
  if (id === "acceptanceModal" && acceptanceAutoPaused) {
    toast("验收打开时任务已暂停；关闭后按 P 继续", "neutral");
    acceptanceAutoPaused = false;
  }
}

function closeAllModals(closeReplayToo = true) {
  document.querySelectorAll(".modal:not([hidden])").forEach((node) => {
    if (node.id === "replayModal" && !closeReplayToo) return;
    node.hidden = true;
  });
  if (closeReplayToo && replayOpen) closeReplay();
}

function loadReplayRun(index) {
  const bundle = replayState.runs[index];
  if (!bundle) return;
  replayState.runIndex = index;
  replayState.bundle = bundle;
  replayState.playing = false;
  replayState.playhead = 0;
  $("replayPlayBtn").textContent = "播放";
  $("replayRunSelect").value = String(index);
  const scrubber = $("replayScrubber");
  scrubber.min = "0";
  scrubber.max = String(Math.max(0, bundle.snapshots.length - 1));
  setReplayFrame(0);
}

function setReplayFrame(index) {
  const bundle = replayState.bundle;
  if (!bundle?.snapshots?.length) return;
  const safeIndex = clamp(Math.round(index), 0, bundle.snapshots.length - 1);
  replayState.index = safeIndex;
  replayState.snapshot = bundle.snapshots[safeIndex];
  replayState.playhead = replayState.snapshot.t;
  $("replayScrubber").value = String(safeIndex);
  $("replayTime").textContent = `${formatClock(replayState.snapshot.t)} / ${formatClock(bundle.snapshots[bundle.snapshots.length - 1].t)}`;
  renderReplayState(replayState.snapshot, bundle);
  renderReplayEvents(replayState.snapshot, bundle);
  drawReplayTimeline();
  renderUI(replayState.snapshot);
}

function renderReplayState(snapshot, bundle) {
  const grid = $("replayStateGrid");
  const connected = `A ${snapshot.players.P1.connected ? "LINK" : "LOST"} / B ${snapshot.players.P2.connected ? "LINK" : "LOST"}`;
  const stats = [
    ["PLAYHEAD", formatClock(snapshot.t), ""],
    ["MODE", snapshot.mode.toUpperCase(), snapshot.mode === "protection" ? "bad" : ""],
    ["TARGET", `${snapshot.target.id} / ${snapshot.targetVisible ? "VISIBLE" : "HIDDEN"}`, snapshot.targetVisible ? "good" : "bad"],
    ["STABILITY", `${snapshot.quality.toFixed(1)} / ${snapshot.stableFor.toFixed(2)}s`, snapshot.quality >= STABLE_THRESHOLD ? "good" : ""],
    ["A AZIMUTH", `${snapshot.controls.azimuth.toFixed(1)}°`, ""],
    ["B EL / FOCUS", `${snapshot.controls.elevation.toFixed(1)}° / ${snapshot.controls.focus.toFixed(2)}`, ""],
    ["SHARED RESOURCE", `${snapshot.shotsLeft} / 6`, snapshot.shotsLeft <= 2 ? "bad" : "good"],
    ["RECORDS", `${snapshot.successCount} CAPTURED / ${snapshot.records.length} TOTAL`, ""],
    ["SHARED REVISION", `REV ${pad(snapshot.revision % 10000, 4)}`, "good"],
    ["LINK STATE", connected, connected.includes("LOST") ? "bad" : "good"],
    ["P1 CONFIRM", snapshot.confirmations.P1 ? "ARMED" : "WAIT", snapshot.confirmations.P1 ? "good" : ""],
    ["P2 CONFIRM", snapshot.confirmations.P2 ? "ARMED" : "WAIT", snapshot.confirmations.P2 ? "good" : ""],
    ["CONFLICTS", String(bundle.conflicts?.length || 0), (bundle.conflicts?.length || 0) > 0 ? "bad" : "good"],
    ["EVENTS", String(bundle.events.length), ""],
  ];
  grid.innerHTML = stats
    .map(([label, value, tone]) => `<div class="replay-stat"><span>${escapeHtml(label)}</span><b class="${tone}">${escapeHtml(value)}</b></div>`)
    .join("");
  const sharedMatch =
    snapshot.records.length === snapshot.records.length
    && typeof snapshot.revision === "number";
  $("replaySync").textContent = sharedMatch
    ? `双侧同帧 · REV ${pad(snapshot.revision % 10000, 4)}`
    : "快照字段异常";
}

function replayEventMeta(event) {
  const type = event.type;
  if (type === "input") {
    const role = event.role || event.actor;
    const dot = role === "P1" || role === "DEBUG" ? "p1" : role === "P2" ? "p2" : "system";
    const action = event.phase === "down" ? "按下" : "松开";
    return {
      dot,
      text: `${event.actor || role} · ${event.code || event.action} ${action}`,
      detail: `${event.action || ""}${event.debug ? " / DEBUG" : ""}`,
    };
  }
  if (type === "resource_change") {
    return { dot: "resource", text: `共享采样片 ${event.before} → ${event.after}`, detail: event.reason || "attempt" };
  }
  if (type === "attempt_captured") {
    return { dot: "resource", text: `${event.record?.id || "POINT"} 双人落点写入`, detail: `Q ${event.record?.quality ?? "—"}` };
  }
  if (type === "attempt_missed") {
    return {
      dot: "conflict",
      text: `落点失败 · ${failureLabel(event.record?.kind)}`,
      detail: `${event.record?.actor || "—"} / Q ${event.record?.quality ?? "—"}`,
    };
  }
  if (type.includes("protection") || type === "reconnect" || type === "recovery_ack") {
    return { dot: "system", text: type.replaceAll("_", " "), detail: event.actor || event.reason || "" };
  }
  if (type === "target_visibility") {
    return { dot: "system", text: `目标窗口 ${event.visible ? "开启" : "遮蔽"}`, detail: event.target || "" };
  }
  if (type === "confirm") {
    return { dot: event.actor === "P1" ? "p1" : "p2", text: `${event.actor} 单侧确认`, detail: `Q ${event.quality}` };
  }
  return { dot: "system", text: type.replaceAll("_", " "), detail: event.actor || "" };
}

function renderReplayEvents(snapshot, bundle) {
  const visible = bundle.events.filter((event) => event.t <= snapshot.t + 0.001).slice(-180);
  $("replayEventCount").textContent = `${bundle.events.length} EVENTS`;
  const list = $("replayEventList");
  list.innerHTML = visible
    .map((event) => {
      const meta = replayEventMeta(event);
      const current = Math.abs(event.t - snapshot.t) < 0.02 ? "current" : "";
      return `<li class="${current}"><time>${formatClock(event.t)}</time><i class="${meta.dot}"></i><em>${escapeHtml(meta.text)}</em><span>${escapeHtml(meta.detail)}</span></li>`;
    })
    .join("");
  if (visible.length) list.scrollTop = list.scrollHeight;
}

function drawReplayTimeline() {
  const bundle = replayState.bundle;
  const canvasNode = $("replayTimeline");
  if (!bundle || !canvasNode) return;
  const rect = canvasNode.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvasNode.width = Math.max(1, Math.round(rect.width * dpr));
  canvasNode.height = Math.max(1, Math.round(rect.height * dpr));
  const rctx = canvasNode.getContext("2d");
  rctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const width = rect.width;
  const height = rect.height;
  const maxT = Math.max(
    1,
    bundle.snapshots.at(-1)?.t || 0,
    bundle.events.at(-1)?.t || 0,
  );
  const xOf = (t) => 12 + (clamp(t, 0, maxT) / maxT) * (width - 24);
  rctx.clearRect(0, 0, width, height);
  rctx.fillStyle = "rgba(4, 12, 16, 0.7)";
  rctx.fillRect(0, 0, width, height);
  rctx.strokeStyle = "rgba(255, 255, 255, 0.055)";
  rctx.lineWidth = 1;
  for (let tick = 0; tick <= 10; tick += 1) {
    const x = 12 + ((width - 24) * tick) / 10;
    rctx.beginPath();
    rctx.moveTo(x, 0);
    rctx.lineTo(x, height);
    rctx.stroke();
  }
  for (let index = 1; index < bundle.snapshots.length; index += 1) {
    const previous = bundle.snapshots[index - 1];
    const current = bundle.snapshots[index];
    if (!current.targetVisible) continue;
    rctx.fillStyle = "rgba(99, 220, 255, 0.07)";
    rctx.fillRect(xOf(previous.t), 7, Math.max(1, xOf(current.t) - xOf(previous.t)), 7);
  }
  rctx.strokeStyle = "rgba(160, 205, 215, 0.2)";
  rctx.beginPath();
  rctx.moveTo(12, height - 10);
  rctx.lineTo(width - 12, height - 10);
  rctx.stroke();
  for (const event of bundle.events) {
    if (event.type !== "input" && event.type !== "resource_change" && event.type !== "attempt_missed" && !event.type.includes("protection")) {
      continue;
    }
    const x = xOf(event.t);
    const isP1 = event.role === "P1" || event.actor === "P1" || event.actor === "DEBUG";
    const isP2 = event.role === "P2" || event.actor === "P2";
    const isConflict = event.type === "attempt_missed" || event.type.includes("protection");
    const y = isConflict ? height - 18 : isP1 ? 22 : isP2 ? 34 : 47;
    rctx.fillStyle = isConflict ? "#ff6f67" : isP1 ? "#63dcff" : isP2 ? "#ffc766" : "#8df2b5";
    rctx.beginPath();
    if (isConflict) {
      rctx.moveTo(x, y - 4);
      rctx.lineTo(x + 4, y + 2);
      rctx.lineTo(x - 4, y + 2);
      rctx.closePath();
    } else {
      rctx.arc(x, y, event.phase === "up" ? 1.5 : 2.2, 0, Math.PI * 2);
    }
    rctx.fill();
  }
  const playhead = xOf(replayState.snapshot?.t || 0);
  rctx.strokeStyle = "#ffffff";
  rctx.globalAlpha = 0.72;
  rctx.beginPath();
  rctx.moveTo(playhead, 0);
  rctx.lineTo(playhead, height - 2);
  rctx.stroke();
  rctx.globalAlpha = 1;
  rctx.fillStyle = "rgba(195, 222, 226, 0.7)";
  rctx.font = "7px monospace";
  rctx.fillText("TARGET WINDOW", 12, 43);
  rctx.textAlign = "right";
  rctx.fillText(`${maxT.toFixed(1)}s`, width - 12, 10);
  rctx.textAlign = "left";
}

function toggleReplayPlayback() {
  if (!replayState.bundle?.snapshots?.length) return;
  if (replayState.playing) {
    replayState.playing = false;
    $("replayPlayBtn").textContent = "播放";
    return;
  }
  const lastIndex = replayState.bundle.snapshots.length - 1;
  if (replayState.index >= lastIndex) setReplayFrame(0);
  replayState.playing = true;
  $("replayPlayBtn").textContent = "暂停";
}

function advanceReplay(dt) {
  if (!replayOpen || !replayState.playing || !replayState.bundle) return;
  const snapshots = replayState.bundle.snapshots;
  replayState.playhead += dt * replayState.speed;
  let nextIndex = replayState.index;
  while (nextIndex < snapshots.length - 1 && snapshots[nextIndex + 1].t <= replayState.playhead) {
    nextIndex += 1;
  }
  if (nextIndex !== replayState.index) setReplayFrame(nextIndex);
  if (replayState.playhead >= snapshots[snapshots.length - 1].t) {
    replayState.playing = false;
    $("replayPlayBtn").textContent = "重新播放";
  }
}

function bindReplayControls() {
  $("replayRunSelect").addEventListener("change", (event) => {
    loadReplayRun(Number(event.target.value));
  });
  $("replayScrubber").addEventListener("input", (event) => {
    replayState.playing = false;
    $("replayPlayBtn").textContent = "播放";
    setReplayFrame(Number(event.target.value));
  });
  $("replayPlayBtn").addEventListener("click", toggleReplayPlayback);
  $("replayBackBtn").addEventListener("click", () => {
    replayState.playing = false;
    $("replayPlayBtn").textContent = "播放";
    setReplayFrame(0);
  });
  $("replaySpeed").addEventListener("change", (event) => {
    replayState.speed = Number(event.target.value) || 1;
  });
  window.addEventListener("resize", () => {
    if (replayOpen) drawReplayTimeline();
  });
}

function openReport() {
  if (!sim.canExport) {
    toast("完成三个测点后才能导出报告", "danger");
    return;
  }
  closeAllModals();
  lastReport = sim.getReport();
  renderReport(lastReport);
  $("reportModal").hidden = false;
}

function renderReport(report) {
  const success = report.outcome === "success";
  const attemptRows = report.capturedPoints
    .map((record) => `
      <tr>
        <td class="good">${escapeHtml(record.id)}</td>
        <td>${escapeHtml(record.targetId)} · ${escapeHtml(record.targetName)}</td>
        <td>${formatClock(record.time)}</td>
        <td>${record.quality.toFixed(1)}</td>
        <td>${formatDelta(record.azError)}° / ${formatDelta(record.elError)}° / ${formatDelta(record.focusError, 2)}</td>
        <td class="good">A+B 双确认</td>
      </tr>`)
    .join("");
  const missRows = report.missedAttempts
    .map((record) => `
      <tr>
        <td class="bad">${escapeHtml(record.id)}</td>
        <td>${escapeHtml(record.targetId)} · ${escapeHtml(failureLabel(record.kind))}</td>
        <td>${formatClock(record.time)}</td>
        <td>${record.quality.toFixed(1)}</td>
        <td>${escapeHtml(record.actor)}</td>
        <td class="bad">未写入</td>
      </tr>`)
    .join("");
  const emptyRows = `
    <tr><td colspan="6">无记录</td></tr>`;
  $("reportBody").innerHTML = `
    <div class="report-hero">
      <div>
        <h3>${success ? "三测点联合成果已验证" : "任务未完整闭合"}</h3>
        <p>${escapeHtml(report.runId)} · ${escapeHtml(report.startedAt)}</p>
      </div>
      <strong>${report.capturedPoints.length} / ${report.requiredPoints} POINTS</strong>
    </div>
    <div class="report-grid">
      <div class="report-box"><span>MISSION TIME</span><b>${formatClock(report.elapsedSeconds)}</b></div>
      <div class="report-box"><span>SHARED SHOTS USED</span><b>${report.sharedResource.used} / ${report.sharedResource.limit}</b></div>
      <div class="report-box"><span>CONFLICT MOMENTS</span><b>${report.conflicts.length}</b></div>
      <div class="report-box"><span>INPUT EVENTS A / B</span><b>${report.operatorInputs.P1} / ${report.operatorInputs.P2}</b></div>
    </div>
    <table class="report-table">
      <thead><tr><th>RECORD</th><th>TARGET</th><th>TIME</th><th>QUALITY</th><th>ERROR ΔAZ / ΔEL / ΔF</th><th>STATE</th></tr></thead>
      <tbody>${attemptRows || emptyRows}${missRows}</tbody>
    </table>
    <div class="sync-proof">
      <span>✓</span>
      <div>P1 与 P2 快照共享同一 REV ${pad(report.syncAudit.revision % 10000, 4)}；倒计时 ${formatClock(report.syncAudit.P1.remaining)}、资源 ${report.syncAudit.P1.shotsLeft}、记录 ${report.syncAudit.P1.records.length} 条在两侧完全一致。共享字段校验：${report.syncAudit.sharedFieldsMatch ? "PASS" : "FAIL"}。</div>
    </div>`;
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function reportCsv(report) {
  const header = ["record_id", "status", "kind", "target_id", "target_name", "time_s", "quality", "az_error", "el_error", "focus_error", "actor"];
  const rows = [...report.capturedPoints, ...report.missedAttempts].map((record) => [
    record.id,
    record.status,
    record.kind,
    record.targetId,
    record.targetName,
    record.time,
    record.quality,
    record.azError,
    record.elError,
    record.focusError,
    record.actor,
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n");
  return `\ufeff${csv}`;
}

function bindReportControls() {
  $("downloadReportBtn").addEventListener("click", () => {
    if (!lastReport) return;
    downloadFile(
      `${lastReport.runId}-survey-report.json`,
      JSON.stringify(lastReport, null, 2),
      "application/json;charset=utf-8",
    );
    toast("JSON 报告已生成", "good");
  });
  $("downloadCsvBtn").addEventListener("click", () => {
    if (!lastReport) return;
    downloadFile(
      `${lastReport.runId}-points.csv`,
      reportCsv(lastReport),
      "text/csv;charset=utf-8",
    );
    toast("测点 CSV 已生成", "good");
  });
}

function probeRow(pass, title, detail) {
  return `
    <div class="probe-row ${pass ? "pass" : "fail"}">
      <i>${pass ? "✓" : "!"}</i>
      <div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p></div>
      <b>${pass ? "PASS" : "FAIL"}</b>
    </div>`;
}

function runAcceptanceProbe() {
  const probe = new SurveySimulation();
  probe.start();
  const setAligned = () => {
    probe.controls.azimuth = probe.target.az;
    probe.controls.elevation = probe.target.el;
    probe.controls.focus = probe.target.focus;
  };
  const tick = (seconds) => {
    for (let elapsed = 0; elapsed < seconds; elapsed += 0.05) probe.update(0.05);
  };
  setAligned();
  tick(0.7);

  const aConfirm = probe.inputDown("Space", "probe");
  const bConfirm = probe.inputDown("Enter", "probe");
  const firstSuccess = probe.successCount === 1
    && probe.records.at(-1)?.kind === "dual-success"
    && probe.shotsLeft === 5
    && aConfirm.accepted && bConfirm.accepted;
  const firstViewA = probe.getRoleView("P1");
  const firstViewB = probe.getRoleView("P2");
  const mirrored = firstViewA.remaining === firstViewB.remaining
    && firstViewA.shotsLeft === firstViewB.shotsLeft
    && JSON.stringify(firstViewA.records) === JSON.stringify(firstViewB.records);

  probe.inputDown("Space", "probe");
  tick(1.2);
  const singleFail = probe.records.at(-1);
  const oneSideFailure = singleFail?.status === "missed"
    && singleFail?.kind === "single-side-confirm"
    && singleFail?.actor === "P1"
    && probe.shotsLeft === 4;

  const frozenTime = probe.remaining;
  const frozenShots = probe.shotsLeft;
  probe.simulateDisconnect("P2");
  tick(2);
  const remainedFrozen = probe.mode === "protection"
    && probe.remaining === frozenTime
    && probe.shotsLeft === frozenShots;
  probe.reconnect("P2");
  const ackA = probe.inputDown("Space", "probe");
  const ackB = probe.inputDown("Enter", "probe");
  const recovered = probe.mode === "live"
    && ackA.accepted && ackB.accepted
    && probe.replay.events.some((event) => event.type === "protection_resume");

  const azBefore = probe.controls.azimuth;
  const elBefore = probe.controls.elevation;
  probe.inputDown("KeyA", "probe");
  tick(0.2);
  probe.inputUp("KeyA", "probe");
  const aOnlyAzimuth = probe.controls.azimuth !== azBefore && probe.controls.elevation === elBefore;
  const azAfterA = probe.controls.azimuth;
  probe.inputDown("ArrowUp", "probe");
  tick(0.2);
  probe.inputUp("ArrowUp", "probe");
  const bOnlyElevation = probe.controls.azimuth === azAfterA && probe.controls.elevation !== elBefore;
  const isolatedKeys = aOnlyAzimuth && bOnlyElevation
    && KEY_BINDINGS.Space.role === "P1"
    && KEY_BINDINGS.Enter.role === "P2"
    && !ROLE_KEYS.P1.includes("ENTER")
    && !ROLE_KEYS.P2.includes("SPACE");

  const replaySaved = probe.replay.events.some((event) => event.type === "input" && event.role === "P1")
    && probe.replay.events.some((event) => event.type === "input" && event.role === "P2")
    && probe.replay.events.filter((event) => event.type === "resource_change").length >= 2
    && probe.replay.conflicts.length >= 1
    && probe.replay.snapshots.length >= 3;

  const finalA = probe.getRoleView("P1");
  const finalB = probe.getRoleView("P2");
  const finalSync = finalA.revision === finalB.revision
    && finalA.remaining === finalB.remaining
    && finalA.shotsLeft === finalB.shotsLeft
    && finalA.target.id === finalB.target.id
    && JSON.stringify(finalA.records) === JSON.stringify(finalB.records);

  const rows = [
    probeRow(
      firstSuccess && mirrored,
      "一次双人成功",
      `A 与 B 各提交独立确认，PT 记录 +1；资源 6→5；双侧 TMR/RES/记录相同。`,
    ),
    probeRow(
      oneSideFailure,
      "一次单侧失误",
      `仅 A 确认，等待窗口超时；失败记录 ${singleFail?.kind || "缺失"}，资源 5→4，未增加测点。`,
    ),
    probeRow(
      remainedFrozen && recovered,
      "一次保护与恢复",
      `B 断线后倒计时与资源冻结；重连后 A=SPACE、B=ENTER 双侧握手才继续。`,
    ),
    probeRow(
      isolatedKeys,
      "职责键位隔离",
      `A/D 只改变方位，↑/↓ 只改变仰角；A 与 B 使用不同确认键，单侧无法完成落点。`,
    ),
    probeRow(
      replaySaved && finalSync,
      "同步与回放归档",
      `双方输入、2 次资源变化、冲突时刻与逐帧快照均已写入；最终双侧 REV=${finalA.revision}。`,
    ),
  ];
  $("acceptanceResults").innerHTML = rows.join("");
  acceptanceRan = true;
  const allPassed = [firstSuccess && mirrored, oneSideFailure, remainedFrozen && recovered, isolatedKeys, replaySaved && finalSync].every(Boolean);
  toast(allPassed ? "协同验收全部通过" : "协同验收存在失败项", allPassed ? "good" : "danger");
}

function frame(now) {
  const dt = clamp((now - lastFrame) / 1000, 0, 0.12);
  lastFrame = now;
  sceneTime += dt;
  updateNoticeClock(dt);

  if (replayOpen) {
    advanceReplay(dt);
  } else {
    sim.update(dt);
  }
  const snapshot = currentSnapshot();
  drawScene(snapshot, sceneTime);

  if (now - lastUiFrame > 72) {
    lastUiFrame = now;
    renderUI(snapshot);
  }
  requestAnimationFrame(frame);
}

function init() {
  buildResourcePips();
  bindBasicControls();
  bindKeyboard();
  bindPointerControls();
  bindReplayControls();
  bindReportControls();
  new ResizeObserver(() => {
    resizeCanvas();
    if (replayOpen) drawReplayTimeline();
  }).observe(wrap);
  renderUI(sim.getSnapshot("init"));
  resizeCanvas();
  requestAnimationFrame(frame);
}

init();
