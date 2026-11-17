import {
  DiveGame,
  GAME_CONFIG,
  TARGETS,
  clamp,
  formatClock,
} from "./game-engine.js";
import { SceneRenderer } from "./renderer.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const dom = {
  canvas: $("#scene"),
  startOverlay: $("#startOverlay"),
  pauseOverlay: $("#pauseOverlay"),
  protectOverlay: $("#protectOverlay"),
  resultOverlay: $("#resultOverlay"),
  pauseButton: $("#pauseButton"),
  restartButton: $("#restartButton"),
  soloButton: $("#soloButton"),
  saveReplayButton: $("#saveReplayButton"),
  startButton: $("#startButton"),
  resumeButton: $("#resumeButton"),
  reconnectButton: $("#reconnectButton"),
  restartResultButton: $("#restartResultButton"),
  reviewReplayButton: $("#reviewReplayButton"),
  shutterButton: $("#shutterButton"),
  stageToast: $("#stageToast"),
  composeTip: $("#composeTip"),
  missionName: $("#missionName"),
  targetCards: $("#targetCards"),
  runBadge: $("#runBadge"),
  topClock: $("#topClock"),
  linkSignal: $("#linkSignal"),
  pilotLink: $("#pilotLink"),
  photoLink: $("#photoLink"),
  pilotStatus: $("#pilotStatus"),
  photoStatus: $("#photoStatus"),
  pilotDistance: $("#pilotDistance"),
  pilotIdealZone: $("#pilotIdealZone"),
  pilotNeedle: $("#pilotNeedle"),
  lightIdealZone: $("#lightIdealZone"),
  lightNeedle: $("#lightNeedle"),
  lightHint: $("#lightHint"),
  lampIcon: $("#lampIcon"),
  lampReadout: $("#lampReadout"),
  lampMeter: $("#lampMeter"),
  depthReadout: $("#depthReadout"),
  turbidityChip: $("#turbidityChip"),
  turbidityReadout: $("#turbidityReadout"),
  calmReadout: $("#calmReadout"),
  modeNote: $("#modeNote"),
  protectTitle: $("#protectTitle"),
  protectCopy: $("#protectCopy"),
  resultKicker: $("#resultKicker"),
  resultTitle: $("#resultTitle"),
  resultCopy: $("#resultCopy"),
  resultStats: $("#resultStats"),
  replayToggle: $("#replayToggle"),
  replaySpeed: $("#replaySpeed"),
  replayTime: $("#replayTime"),
  replayPhase: $("#replayPhase"),
  replayScrubber: $("#replayScrubber"),
  timelineEvents: $("#timelineEvents"),
  eventList: $("#eventList"),
  filterConflicts: $("#filterConflicts"),
  syncVerdict: $("#syncVerdict"),
  syncRows: $("#syncRows"),
  syncNote: $("#syncNote"),
};

const game = new DiveGame();
const renderer = new SceneRenderer(dom.canvas);
const NOW = () => performance.now();
window.__bluehole = { game, renderer };

const keyMap = new Map([
  ["KeyW", { role: "pilot", action: "up" }],
  ["KeyA", { role: "pilot", action: "left" }],
  ["KeyS", { role: "pilot", action: "down" }],
  ["KeyD", { role: "pilot", action: "right" }],
  ["ShiftLeft", { role: "pilot", action: "boost" }],
  ["ShiftRight", { role: "pilot", action: "boost" }],
  ["ArrowUp", { role: "photo", action: "lampUp" }],
  ["ArrowDown", { role: "photo", action: "lampDown" }],
  ["ArrowLeft", { role: "photo", action: "aimLeft" }],
  ["ArrowRight", { role: "photo", action: "aimRight" }],
  ["Enter", { role: "photo", action: "shutter" }],
]);

const heldCodes = new Set();
const silentRoles = new Set();
const heartbeatTimers = { pilot: null, photo: null };
const replay = {
  active: false,
  playing: false,
  time: 0,
  speed: 1,
  filterConflicts: false,
};

let lastFrameAt = NOW();
let lastUiAt = 0;
let lastPhase = game.state.phase;
let lastEventCount = -1;
let lastTimelineKey = "";
let toastTimer = null;
let resultSaved = false;

function showToast(message, kind = "info", duration = 2600) {
  dom.stageToast.textContent = message;
  dom.stageToast.className = `stage-toast show ${kind === "info" ? "" : kind}`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    dom.stageToast.className = "stage-toast";
  }, duration);
}

function startHeartbeat(role) {
  stopHeartbeat(role);
  if (silentRoles.has(role)) return;
  heartbeatTimers[role] = window.setInterval(() => {
    game.heartbeat(role, NOW());
  }, 900);
  game.heartbeat(role, NOW());
}

function stopHeartbeat(role) {
  if (heartbeatTimers[role]) {
    window.clearInterval(heartbeatTimers[role]);
    heartbeatTimers[role] = null;
  }
}

function startHeartbeats() {
  startHeartbeat("pilot");
  startHeartbeat("photo");
}

function restartHeartbeats() {
  silentRoles.clear();
  startHeartbeats();
  $$(".sim-link").forEach((button) => {
    button.textContent = `模拟 ${button.dataset.disconnect === "pilot" ? "A" : "B"} 侧断线`;
  });
}

function mappedActionHeld(role, action) {
  for (const code of heldCodes) {
    const mapped = keyMap.get(code);
    if (mapped?.role === role && mapped.action === action) return true;
  }
  return false;
}

function handleKeyDown(event) {
  const interactive = event.target.closest("button, select, input");
  if (event.code === "Tab") {
    event.preventDefault();
    if (!event.repeat) toggleSoloMode();
    return;
  }
  if (event.code === "KeyP" || event.code === "Escape") {
    event.preventDefault();
    if (!event.repeat) togglePause();
    return;
  }
  if (event.code === "KeyR") {
    event.preventDefault();
    if (!event.repeat) resetRun(false);
    return;
  }
  if (interactive && event.code === "Enter") return;
  const mapping = keyMap.get(event.code);
  if (!mapping) return;
  event.preventDefault();
  if (event.repeat) return;
  heldCodes.add(event.code);
  const result = game.setControl(mapping.role, mapping.action, true, NOW());
  if (!result.ok && result.message && result.message !== "忽略重复输入") {
    if (result.message.includes("不属于")) showToast(result.message, "bad");
  }
}

function handleKeyUp(event) {
  const mapping = keyMap.get(event.code);
  if (!mapping) return;
  heldCodes.delete(event.code);
  if (!mappedActionHeld(mapping.role, mapping.action)) {
    game.setControl(mapping.role, mapping.action, false, NOW());
  }
}

function releaseAllKeys() {
  const active = new Map();
  heldCodes.forEach((code) => {
    const mapping = keyMap.get(code);
    if (mapping) active.set(`${mapping.role}:${mapping.action}`, mapping);
  });
  heldCodes.clear();
  active.forEach((mapping) => {
    game.setControl(mapping.role, mapping.action, false, NOW());
  });
}

document.addEventListener("keydown", handleKeyDown);
document.addEventListener("keyup", handleKeyUp);
window.addEventListener("blur", releaseAllKeys);

dom.canvas.addEventListener("pointerdown", () => dom.canvas.focus());
dom.canvas.setAttribute("tabindex", "0");

function beginRun() {
  restartHeartbeats();
  game.start(NOW());
  replay.active = false;
  replay.playing = false;
  replay.time = 0;
  resultSaved = false;
  dom.startOverlay.hidden = true;
  dom.canvas.focus();
  renderer.time = 0;
  showToast("共享计时已启动 · A 负责距离，B 负责灯光与快门");
}

function togglePause() {
  if (replay.active) {
    replay.active = false;
    replay.playing = false;
  }
  if (game.state.phase === "running") {
    game.pause("任一侧触发暂停");
    releaseAllKeys();
  } else if (game.state.phase === "paused") {
    game.resume();
    if (!silentRoles.size) startHeartbeats();
  }
}

function resetRun(autoStart = false) {
  releaseAllKeys();
  window.clearTimeout(toastTimer);
  game.restart({ autoStart: false });
  silentRoles.clear();
  if (heartbeatTimers.pilot) stopHeartbeat("pilot");
  if (heartbeatTimers.photo) stopHeartbeat("photo");
  restartHeartbeats();
  replay.active = false;
  replay.playing = false;
  replay.time = 0;
  replay.filterConflicts = false;
  resultSaved = false;
  lastEventCount = -1;
  lastTimelineKey = "";
  dom.filterConflicts.classList.remove("active");
  dom.eventList.innerHTML = '<p class="empty-state">下潜后，两侧输入会实时记录在这里。</p>';
  dom.timelineEvents.innerHTML = "";
  dom.replayScrubber.max = "0";
  dom.replayScrubber.value = "0";
  if (autoStart) {
    game.start(NOW());
    dom.startOverlay.hidden = true;
    showToast("仪表、目标与计时已同时复位，新一局开始");
  } else {
    dom.startOverlay.hidden = false;
    showToast("已完全复位：计时 01:30 · 浊度 18% · 电量 100% · 底片 6");
  }
}

function toggleSoloMode() {
  if (game.state.phase === "protected") return;
  const enabled = !game.soloMode;
  game.setSoloMode(enabled);
  document.body.classList.toggle("solo-mode", enabled);
  dom.soloButton.classList.toggle("active", enabled);
  dom.modeNote.textContent = enabled
    ? "单人调试模式 · 双方键位由一人操作，回放标记 DEBUG"
    : "双人正式模式 · 键位隔离已开启";
  showToast(
    enabled
      ? "单人调试已开启：仍须分别完成 A / B 的动作，不能替代角色逻辑"
      : "已回到双人正式模式，两侧键位继续隔离",
    enabled ? "warn" : "info",
  );
}

function triggerShutter() {
  if (game.state.phase !== "running") {
    showToast("当前不能拍摄：请先开始或恢复链路", "warn");
    return;
  }
  game.setControl("photo", "shutter", true, NOW());
  game.setControl("photo", "shutter", false, NOW());
  dom.canvas.focus();
}

function simulateLinkLoss(role) {
  const label = role === "pilot" ? "A 领航员" : "B 摄影师";
  if (silentRoles.has(role)) {
    silentRoles.delete(role);
    startHeartbeat(role);
    game.heartbeat(role, NOW());
    if (game.state.phase === "protected") game.reconnect(role);
    buttonForRole(role).textContent = `模拟 ${role === "pilot" ? "A" : "B"} 侧断线`;
    showToast(`${label}链路已恢复，双方仪表从同一快照续接`, "info");
    return;
  }
  silentRoles.add(role);
  stopHeartbeat(role);
  buttonForRole(role).textContent = `恢复 ${role === "pilot" ? "A" : "B"} 侧链路`;
  showToast(`${label}心跳已中断，3.5 秒内无恢复将自动冻结`, "bad");
}

function buttonForRole(role) {
  return $(`.sim-link[data-disconnect="${role}"]`);
}

function reconnectProtectedRole() {
  const roles = [...silentRoles];
  if (game.state.protectedRole && !roles.includes(game.state.protectedRole)) {
    roles.push(game.state.protectedRole);
  }
  if (!roles.length) roles.push("pilot", "photo");
  roles.forEach((role) => {
    silentRoles.delete(role);
    startHeartbeat(role);
    game.heartbeat(role, NOW());
    game.reconnect(role);
    buttonForRole(role).textContent = `模拟 ${role === "pilot" ? "A" : "B"} 侧断线`;
  });
  showToast("链路恢复 · 计时从冻结值继续，双方镜像重新校验", "info");
}

dom.startButton.addEventListener("click", beginRun);
dom.pauseButton.addEventListener("click", togglePause);
dom.resumeButton.addEventListener("click", togglePause);
dom.restartButton.addEventListener("click", () => resetRun(false));
dom.restartResultButton.addEventListener("click", () => resetRun(true));
dom.soloButton.addEventListener("click", toggleSoloMode);
dom.shutterButton.addEventListener("click", triggerShutter);
dom.reconnectButton.addEventListener("click", reconnectProtectedRole);
$$(".sim-link").forEach((button) => {
  button.addEventListener("click", () => simulateLinkLoss(button.dataset.disconnect));
});

let targetCardsKey = "";

function syncText(value) {
  $$("[data-sync]").forEach((node) => {
    node.textContent = value;
  });
}

function setMirrorValues(values) {
  $$("[data-sync]").forEach((node) => {
    const key = node.dataset.sync;
    if (values[key] !== undefined) node.textContent = values[key];
  });
}

function mirrorSnapshot(consoleId) {
  const root = document.getElementById(consoleId);
  return Object.fromEntries(
    [...root.querySelectorAll("[data-sync]")].map((node) => [
      node.dataset.sync,
      node.textContent.trim(),
    ]),
  );
}

function directionHint(evaluation) {
  const target = game.target();
  if (!target) return "三个目标已完成";
  const point = evaluation.point || game.screenPoint(target.x, target.y);
  if (point.x < GAME_CONFIG.frame.left) return "主体在左侧，向左靠近";
  if (point.x > GAME_CONFIG.frame.right) return "主体在右侧，向右靠近";
  if (point.y < GAME_CONFIG.frame.top) return "主体偏上，向上游";
  if (point.y > GAME_CONFIG.frame.bottom) return "主体偏下，向下游";
  if (evaluation.distance < target.minDistance) return "距离过近，向后拉开";
  if (evaluation.distance > target.maxDistance) return "距离偏远，继续靠近";
  return "主体已在框内，保持距离";
}

function photoStatusText(evaluation) {
  const target = game.target();
  if (!target) return "三张目标照片已完成";
  const light = Math.round(game.state.lamp.intensity * 100);
  const aim = evaluation.aimError;
  if (light < target.lightMin) return `柔光不足 ${light}% · 按 ↑ 提亮`;
  if (light > target.lightMax) return `灯光过强 ${light}% · 按 ↓ 降低，避免惊鱼`;
  if (aim > 0.18) return `光束偏离 ${Math.round(aim * 180 / Math.PI)}° · 用 ← → 对准`;
  if (evaluation.fishCount < target.fishRequired) {
    return `鱼群未入框 ${evaluation.fishCount}/${target.fishRequired} · 等待回游`;
  }
  return `构图达标 · 柔光 ${light}% · 可按下快门`;
}

function updateTargetCards(view = game.state) {
  const currentFailure = game.lastFailure?.targetIndex;
  const key = `${view.targetIndex}:${currentFailure}:${game.state.phase}:${view.phase}`;
  if (key === targetCardsKey) return;
  targetCardsKey = key;
  dom.targetCards.innerHTML = TARGETS.map((target, index) => {
    const done = index < view.targetIndex;
    const active = index === view.targetIndex;
    const failed = currentFailure === index;
    return `
      <div class="target-card ${active ? "active" : ""} ${done ? "done" : ""} ${failed ? "failed" : ""}">
        <span class="target-index">${done ? "✓" : `0${index + 1}`}</span>
        <div class="target-info">
          <b>${target.short}</b>
          <span>${done ? "已记录" : `${target.fishRequired}+ 鱼 · ${target.minDistance}–${target.maxDistance}`}</span>
        </div>
        <span class="target-check">${done ? "✓" : active ? "●" : ""}</span>
      </div>
    `;
  }).join("");
}

function updateRanges(evaluation, view = game.state) {
  const target = TARGETS[view.targetIndex] || TARGETS.at(-1);
  const distance = target
    ? Math.hypot(target.x - view.camera.x, target.y - view.camera.y)
    : 0;
  dom.pilotDistance.textContent = `${Math.round(distance)} m`;
  const maxScale = 600;
  dom.pilotIdealZone.style.left = `${clamp(target.minDistance / maxScale, 0, 1) * 100}%`;
  dom.pilotIdealZone.style.width = `${(target.maxDistance - target.minDistance) / maxScale * 100}%`;
  dom.pilotNeedle.style.left = `${clamp(distance / maxScale, 0, 1) * 100}%`;

  const light = view.lamp.intensity;
  dom.lightHint.textContent = `${Math.round(target.lightMin * 100)}–${Math.round(target.lightMax * 100)}%`;
  dom.lightIdealZone.style.left = `${target.lightMin * 100}%`;
  dom.lightIdealZone.style.width = `${(target.lightMax - target.lightMin) * 100}%`;
  dom.lightNeedle.style.left = `${light * 100}%`;
}

function updateOverlays() {
  const phase = game.state.phase;
  dom.startOverlay.hidden = phase !== "ready";
  dom.pauseOverlay.hidden = phase !== "paused" || replay.active;
  dom.protectOverlay.hidden = phase !== "protected";
  dom.resultOverlay.hidden = !["success", "failed"].includes(phase) || replay.active;

  if (phase === "protected") {
    const role = game.state.protectedRole;
    const label = role === "pilot" ? "A 领航员" : role === "photo" ? "B 摄影师" : "单侧操作台";
    dom.protectTitle.textContent = `${label}链路中断`;
    dom.protectCopy.textContent = `共享计时与资源已冻结在 ${formatClock(game.state.remaining)}。恢复链路后，两侧仪表会从同一快照继续。`;
  }
}

function updateStatusPanel(evaluation) {
  const phase = game.state.phase;
  const target = game.target();
  dom.pilotStatus.className = "role-status";
  dom.photoStatus.className = "role-status";

  if (replay.active) {
    dom.pilotStatus.textContent = "回放检查 · A 游动与距离输入按时间轴重放";
    dom.photoStatus.textContent = "回放检查 · B 灯光、快门与冲突时刻同步显示";
    return;
  }
  if (phase === "ready") {
    dom.pilotStatus.textContent = "WASD 控制游动，不能触发快门";
    dom.photoStatus.textContent = "方向键控制柔光与光束，不能移动相机";
    return;
  }
  if (phase === "paused") {
    dom.pilotStatus.textContent = "共享暂停 · 游动与距离已锁定";
    dom.photoStatus.textContent = "共享暂停 · 灯光与快门已锁定";
    return;
  }
  if (phase === "protected") {
    dom.pilotStatus.textContent = "链路保护 · 双方输入与计时冻结";
    dom.photoStatus.textContent = "链路保护 · 仪表从最后快照保留";
    dom.pilotStatus.classList.add("danger");
    dom.photoStatus.classList.add("danger");
    return;
  }
  if (["success", "failed"].includes(phase)) {
    dom.pilotStatus.textContent = `${game.state.accepted}/3 目标 · 距离控制记录完成`;
    dom.photoStatus.textContent = `${game.photoAttempts} 次快门 · ${game.state.recoveries} 次恢复`;
    return;
  }

  const pilotChecks = evaluation.checks.filter((check) => check.role === "pilot");
  const photoChecks = evaluation.checks.filter((check) => check.role === "photo");
  const pilotFails = pilotChecks.filter((check) => !check.ok);
  const photoFails = photoChecks.filter((check) => !check.ok);
  dom.pilotStatus.textContent = pilotFails.length ? directionHint(evaluation) : "距离与构图保持稳定";
  if (pilotFails.length) dom.pilotStatus.classList.add("alert");

  dom.photoStatus.textContent = photoStatusText(evaluation);
  if (photoFails.length) dom.photoStatus.classList.add("alert");
  if (game.calmLevel() < 0.55) {
    dom.photoStatus.textContent = "鱼群受惊散开 · 降低灯光并等待回游";
    dom.photoStatus.classList.add("danger");
  }
  if (game.state.battery < 18) {
    dom.photoStatus.textContent = "共享电量低 · 关灯可减少仪表消耗";
    dom.photoStatus.classList.add("danger");
  }
  if (!target) {
    dom.pilotStatus.textContent = "三张照片已经完成";
    dom.photoStatus.textContent = "快门已锁定";
  }
}

function updateComposeTip(evaluation) {
  const phase = game.state.phase;
  dom.composeTip.className = "compose-tip";
  if (replay.active) {
    dom.composeTip.textContent = `回放 ${formatClock(replay.time, true)} · 共享状态快照`;
    return;
  }
  if (phase === "ready") {
    dom.composeTip.textContent = "A 找准距离 · B 调柔光并对准主体";
    return;
  }
  if (phase === "paused") {
    dom.composeTip.textContent = "共享暂停 · 倒计时与水体状态已冻结";
    return;
  }
  if (phase === "protected") {
    dom.composeTip.textContent = "单侧链路中断 · 另一侧仍可看到完整共享状态";
    dom.composeTip.classList.add("bad");
    return;
  }
  if (phase === "success") {
    dom.composeTip.textContent = "三张目标照片达成 · 双人任务完成";
    dom.composeTip.classList.add("good");
    return;
  }
  if (phase === "failed") {
    dom.composeTip.textContent = `任务结束 · ${game.state.endReason}`;
    dom.composeTip.classList.add("bad");
    return;
  }
  const failed = evaluation.checks.filter((check) => !check.ok);
  if (!failed.length) {
    dom.composeTip.textContent = "构图、距离、柔光全部就绪 · B 可按 Enter 快门";
    dom.composeTip.classList.add("good");
  } else {
    const messages = failed.slice(0, 2).map((check) => {
      const owner = check.role === "pilot" ? "A" : check.role === "photo" ? "B" : "共享";
      return `${owner} · ${check.label}`;
    });
    dom.composeTip.textContent = messages.join("   /   ");
    dom.composeTip.classList.add(game.calmLevel() < 0.55 ? "bad" : "warn");
  }
}

function updateSyncPanel() {
  const pilot = mirrorSnapshot("pilotConsole");
  const photo = mirrorSnapshot("photoConsole");
  const groups = [
    { keys: ["time"], label: "倒计时" },
    { keys: ["turbidity", "battery"], label: "共享资源 / 浊度" },
    { keys: ["shots"], label: "快门底片" },
    { keys: ["objective"], label: "任务记录" },
  ];
  const rows = [...dom.syncRows.children];
  let allOk = true;
  groups.forEach((group, index) => {
    const ok = group.keys.every((key) => pilot[key] === photo[key]);
    allOk = allOk && ok;
    rows[index].querySelector("span").textContent = group.label;
    const value = rows[index].querySelector("b");
    value.textContent = ok ? "A / B 同步" : "镜像不一致";
    value.className = ok ? "ok" : "bad";
  });
  dom.syncVerdict.textContent = allOk ? "两侧一致 ✓" : "发现差异";
  dom.syncVerdict.className = allOk ? "ok" : "bad";
  dom.syncNote.textContent = game.soloMode
    ? `DEBUG 单人调试 · 冲突 ${game.conflicts.length} · 恢复 ${game.state.recoveries} · 同步仍逐帧校验`
    : `A / B 各 5 项镜像一致 · 冲突 ${game.conflicts.length} · 单侧恢复 ${game.state.recoveries}`;
}

function updateResultOverlay() {
  const phase = game.state.phase;
  if (!["success", "failed"].includes(phase)) return;
  const success = phase === "success";
  dom.resultKicker.textContent = success ? "MISSION COMPLETE / 03 FRAMES" : "MISSION END / REVIEW";
  dom.resultTitle.textContent = success ? "三帧到手" : game.state.endReason || "任务中止";
  dom.resultCopy.textContent = success
    ? `你们用 ${Math.round(game.elapsed)} 秒守住距离与柔光，两次职责没有互相替代。`
    : `本次记录包含双方完整输入、资源变化与冲突时刻，可从回放核对责任侧。`;
  dom.resultOverlay.querySelector(".result-card").classList.toggle("failed", !success);
  const stats = [
    ["目标照片", `${game.state.accepted}/3`],
    ["按下快门", `${game.photoAttempts}`],
    ["单侧失误", `${game.state.failures}`],
    ["恢复记录", `${game.state.recoveries}`],
    ["冲突时刻", `${game.conflicts.length}`],
    ["共享浊度", `${Math.round(game.state.turbidity)}%`],
  ];
  dom.resultStats.innerHTML = stats
    .map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`)
    .join("");
}

function updateUI(now) {
  const state = game.state;
  const phase = state.phase;
  const snapshot = replay.active ? game.snapshotAt(replay.time) : null;
  const view = snapshot || state;
  const activeTarget = TARGETS[view.targetIndex] || null;
  const evaluation = game.evaluation();
  const timeText = formatClock(view.remaining);
  const turbidity = Math.round(view.turbidity);
  const battery = Math.round(view.battery);
  const objectiveText = `${view.accepted} / 3 目标`;
  const syncValues = {
    time: timeText,
    turbidity: `${turbidity}%`,
    battery: `${battery}%`,
    shots: `${view.shotsRemaining} / ${GAME_CONFIG.maxShots}`,
    objective: objectiveText,
  };

  setMirrorValues(syncValues);
  dom.topClock.textContent = timeText;
  dom.missionName.textContent = activeTarget?.name || "三目标已完成";
  dom.depthReadout.textContent = `${(18.4 + view.camera.y * 0.015).toFixed(1)} m`;
  dom.turbidityReadout.textContent = `${turbidity}%`;
  dom.turbidityChip.classList.toggle("warning", turbidity >= 55 && turbidity < 76);
  dom.turbidityChip.classList.toggle("danger", turbidity >= 76);
  const calm = snapshot ? snapshot.calm : game.calmLevel();
  dom.calmReadout.textContent = calm > 0.75 ? "稳定" : calm > 0.42 ? "紧张" : "惊散";
  dom.calmReadout.style.color = calm > 0.75 ? "" : calm > 0.42 ? "#f6b85d" : "#ff826d";
  dom.lampIcon.classList.toggle("on", view.lamp.on);
  dom.lampReadout.textContent = view.lamp.on
    ? `${Math.round(view.lamp.intensity * 100)}% · ${view.lamp.intensity > 0.7 ? "强" : "柔"}`
    : "OFF";
  dom.lampMeter.style.width = `${view.lamp.intensity * 100}%`;

  const badgeMap = {
    ready: ["待下潜", ""],
    running: ["双人协作中", ""],
    paused: ["共享暂停", "warning"],
    protected: ["链路保护", "danger"],
    success: ["任务成功", ""],
    failed: ["任务失败", "danger"],
  };
  const [badgeText, badgeClass] = badgeMap[phase] || ["未知", ""];
  dom.runBadge.textContent = replay.active ? "回放检查" : badgeText;
  dom.runBadge.className = `run-badge ${replay.active ? "warning" : badgeClass}`;
  const offline = phase === "protected" || silentRoles.size > 0;
  dom.linkSignal.innerHTML = `<i></i> ${offline ? "单侧链路保护" : "双人链路同步"}`;
  dom.linkSignal.style.color = offline ? "#ff826d" : "";
  const protectedRole = phase === "protected" ? state.protectedRole : null;
  ["pilot", "photo"].forEach((role) => {
    const entry = role === "pilot" ? dom.pilotLink : dom.photoLink;
    const isOffline = silentRoles.has(role) || protectedRole === role;
    entry.className = `link-dot ${isOffline ? "offline" : "online"}`;
    entry.title = isOffline ? "链路保护 / 已冻结" : "链路正常";
  });

  updateTargetCards(view);
  updateRanges(evaluation, view);
  updateStatusPanel(evaluation);
  updateComposeTip(evaluation);
  updateOverlays();
  updateResultOverlay();
  updateSyncPanel();

  if (phase !== lastPhase) {
    if (["success", "failed"].includes(phase) && !replay.active) {
      saveReplay(false);
    }
    if (phase === "protected" && state.protectedRole) {
      showToast("单侧链路中断：共享计时、资源与另一侧仪表已冻结", "bad", 3600);
    }
    if (phase === "success") showToast("任务成功：三张目标照片已写入回放", "info", 3600);
    if (phase === "failed") showToast(`任务结束：${state.endReason}`, "bad", 3600);
    lastPhase = phase;
  }

  if (now - lastUiAt > 180) {
    updateReplayPanel();
    lastUiAt = now;
  }
}

function replayDuration() {
  return Math.max(game.elapsed, 0.1);
}

function enterReplay(startPlaying = true) {
  if (game.elapsed <= 0.05) {
    showToast("还没有可回放的输入记录", "warn");
    return;
  }
  if (game.state.phase === "running") {
    game.pause("进入回放核对共享状态");
    releaseAllKeys();
  }
  replay.active = true;
  replay.playing = startPlaying;
  replay.time = 0;
  dom.replayToggle.textContent = "■ 退出回放";
  dom.replayToggle.classList.add("active");
  updateOverlays();
}

function exitReplay() {
  replay.active = false;
  replay.playing = false;
  dom.replayToggle.textContent = "▶ 回放";
  dom.replayToggle.classList.remove("active");
  updateOverlays();
}

function toggleReplay() {
  if (!replay.active) {
    enterReplay(true);
    return;
  }
  if (replay.time >= replayDuration() - 0.02) {
    replay.time = 0;
    replay.playing = true;
    dom.replayToggle.textContent = "■ 退出回放";
    return;
  }
  exitReplay();
}

function updateReplayPanel() {
  const duration = replayDuration();
  dom.replayScrubber.max = String(duration);
  if (!replay.active) {
    dom.replayScrubber.value = String(Math.min(game.elapsed, duration));
  } else {
    dom.replayScrubber.value = String(Math.min(replay.time, duration));
  }
  const displayTime = replay.active ? replay.time : game.elapsed;
  dom.replayTime.textContent = `${formatClock(displayTime, true)} / ${formatClock(duration, true)}`;
  dom.replayPhase.textContent = replay.active
    ? `回放 · ${phaseLabel(game.snapshotAt(replay.time)?.phase)}`
    : phaseLabel(game.state.phase);

  const eventKey = `${game.events.length}:${game.conflicts.length}:${replay.filterConflicts}`;
  if (eventKey !== lastEventCount) {
    lastEventCount = eventKey;
    renderEventList();
  }
  const timelineKey = `${game.events.length}:${game.conflicts.length}:${duration.toFixed(2)}`;
  if (timelineKey !== lastTimelineKey) {
    lastTimelineKey = timelineKey;
    renderTimeline(duration);
  }
}

function phaseLabel(phase) {
  const labels = {
    ready: "准备",
    running: "实时录制",
    paused: "已暂停",
    protected: "链路保护",
    success: "任务成功",
    failed: "任务失败",
  };
  return labels[phase] || "回放";
}

function renderEventList() {
  const events = game.events.filter((event) => {
    if (!replay.filterConflicts) return true;
    return event.type === "conflict" || event.state === "conflict";
  });
  const shown = events.slice(-90);
  if (!shown.length) {
    dom.eventList.innerHTML = `<p class="empty-state">${replay.filterConflicts ? "本局尚未出现双侧同时输入冲突。" : "下潜后，两侧输入会实时记录在这里。"}</p>`;
    return;
  }
  dom.eventList.innerHTML = shown.map((event) => {
    const role = event.role === "pilot" ? "A" : event.role === "photo" ? "B" : "S";
    const roleClass = event.role === "photo" ? "b" : event.role === "system" ? "sys" : "a";
    const stateClass = event.state === "bad" ? "bad" : event.state === "ok" ? "ok" : "";
    const conflictClass = event.state === "conflict" ? "conflict" : "";
    return `
      <div class="event-item" title="${escapeHtml(event.detail || "")}">
        <span class="event-time">${formatClock(event.t, true)}</span>
        <span class="event-role ${roleClass}">${role}</span>
        <span class="event-action ${conflictClass}">${escapeHtml(event.action)}</span>
        <span class="event-state ${stateClass}">${escapeHtml(event.detail || "")}</span>
      </div>
    `;
  }).join("");
  dom.eventList.scrollTop = dom.eventList.scrollHeight;
}

function renderTimeline(duration) {
  const ticks = [];
  const seen = new Set();
  game.events.forEach((event) => {
    if (event.role === "system" && event.type !== "conflict" && event.type !== "photo") return;
    const unique = `${event.role}:${event.t}:${event.type}`;
    if (seen.has(unique)) return;
    seen.add(unique);
    const left = clamp(event.t / duration, 0, 1) * 100;
    let className = event.role === "pilot" ? "a" : event.role === "photo" ? "b" : "";
    if (event.type === "conflict" || event.type === "failed-photo") {
      className = "conflict";
    } else if (event.type === "photo") {
      className = "success";
    }
    if (!className) return;
    ticks.push(`<span class="tick ${className}" style="left:${left}%" title="${escapeHtml(`${formatClock(event.t, true)} ${event.action}`)}"></span>`);
  });
  game.conflicts.forEach((conflict) => {
    const left = clamp(conflict.t / duration, 0, 1) * 100;
    ticks.push(`<span class="tick conflict" style="left:${left}%;top:33px" title="${escapeHtml(conflict.label)}"></span>`);
  });
  dom.timelineEvents.innerHTML = ticks.join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function saveReplay(download = true) {
  const data = game.replayData();
  try {
    localStorage.setItem("bluehole.replay.last", JSON.stringify(data));
  } catch (error) {
    console.warn("回放本地存档失败", error);
  }
  if (!download) {
    resultSaved = true;
    return;
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `bluehole-replay-${Date.now()}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`回放已保存：${data.events.length} 条事件 / ${data.conflicts.length} 个冲突时刻`);
}

dom.replayToggle.addEventListener("click", toggleReplay);
dom.reviewReplayButton.addEventListener("click", () => enterReplay(true));
dom.replaySpeed.addEventListener("change", () => {
  replay.speed = Number(dom.replaySpeed.value);
});
dom.replayScrubber.addEventListener("input", () => {
  if (!replay.active) enterReplay(false);
  replay.playing = false;
  replay.time = Number(dom.replayScrubber.value);
  updateReplayPanel();
});
dom.filterConflicts.addEventListener("click", () => {
  replay.filterConflicts = !replay.filterConflicts;
  dom.filterConflicts.classList.toggle("active", replay.filterConflicts);
  dom.filterConflicts.textContent = replay.filterConflicts ? "显示全部" : "只看冲突";
  lastEventCount = -1;
  updateReplayPanel();
});
dom.saveReplayButton.addEventListener("click", () => saveReplay(true));
$$(".toolbar button, .shutter").forEach((button) => {
  button.addEventListener("click", () => window.setTimeout(() => dom.canvas.focus(), 0));
});

function frame(now) {
  const delta = clamp((now - lastFrameAt) / 1000, 0, 0.1);
  lastFrameAt = now;

  if (["running", "paused", "ready"].includes(game.state.phase)) {
    const advancing = game.state.phase === "running" && !replay.active;
    game.update(advancing ? delta : 0.001, now);
  }

  if (replay.active) {
    const duration = replayDuration();
    if (replay.playing) {
      replay.time = Math.min(duration, replay.time + delta * replay.speed);
      if (replay.time >= duration) {
        replay.playing = false;
        dom.replayToggle.textContent = "▶ 重播";
      }
    }
    const snapshot = game.snapshotAt(replay.time);
    renderer.draw(game.state, {
      snapshot: snapshot || undefined,
      time: replay.time,
    });
  } else {
    renderer.time = game.elapsed;
    renderer.draw(game.state, { time: game.elapsed });
  }

  updateUI(now);
  requestAnimationFrame(frame);
}

updateReplayPanel();
updateUI(NOW());
requestAnimationFrame(frame);
