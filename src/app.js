import { CraneMission, CARGO, MISSION_SECONDS, TOTAL_CARGO } from "./core.js";
import { renderScene } from "./renderer.js";

const $ = (id) => document.getElementById(id);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const STORAGE_KEY = "twinlift.replays.v1";
const MAX_SAVED_REPLAYS = 8;

const elements = {
  canvas: $("gameCanvas"),
  canvasShell: $("canvasShell"),
  topStateLight: $("topStateLight"),
  topStateLabel: $("topStateLabel"),
  missionClock: $("missionClock"),
  clockState: $("clockState"),
  missionMode: $("missionMode"),
  phaseTag: $("phaseTag"),
  phaseGuide: $("phaseGuide"),
  deckGuide: $("deckGuide"),
  swayValue: $("swayValue"),
  swayFill: $("swayFill"),
  jointP1: $("jointP1"),
  jointP2: $("jointP2"),
  jointProgressFill: $("jointProgressFill"),
  toast: $("toast"),
  startOverlay: $("startOverlay"),
  pauseOverlay: $("pauseOverlay"),
  protectionOverlay: $("protectionOverlay"),
  protectionTitle: $("protectionTitle"),
  protectionText: $("protectionText"),
  endOverlay: $("endOverlay"),
  startButton: $("startButton"),
  resumeButton: $("resumeButton"),
  pauseButton: $("pauseButton"),
  pauseLabel: $("pauseLabel"),
  pauseIcon: $("pauseIcon"),
  restartButton: $("restartButton"),
  replayButton: $("replayButton"),
  modeButton: $("modeButton"),
  modeLabel: $("modeLabel"),
  p1Disconnect: $("p1Disconnect"),
  p2Disconnect: $("p2Disconnect"),
  reconnectButton: $("reconnectButton"),
  endReplayButton: $("endReplayButton"),
  endRestartButton: $("endRestartButton"),
};

const playerElements = {
  p1: {
    link: $("p1Link"),
    linkText: $("p1Link").querySelector(".link-text"),
    angle: $("p1AngleValue"),
    speed: $("p1SpeedValue"),
    target: $("p1TargetValue"),
    needle: $("p1DialNeedle"),
    targetMarker: $("p1DialTarget"),
    sharedClock: $("p1SharedClock"),
    hydraulicFill: $("p1HydraulicFill"),
    hydraulicValue: $("p1HydraulicValue"),
    integrityFill: $("p1IntegrityFill"),
    integrityValue: $("p1IntegrityValue"),
    linkCountdown: $("p1LinkCountdown"),
  },
  p2: {
    link: $("p2Link"),
    linkText: $("p2Link").querySelector(".link-text"),
    height: $("p2HeightValue"),
    heightBand: $("p2HeightBand"),
    heightFill: $("p2HeightFill"),
    heightMarker: $("p2HeightMarker"),
    speed: $("p2SpeedValue"),
    load: $("p2LoadValue"),
    sharedClock: $("p2SharedClock"),
    hydraulicFill: $("p2HydraulicFill"),
    hydraulicValue: $("p2HydraulicValue"),
    integrityFill: $("p2IntegrityFill"),
    integrityValue: $("p2IntegrityValue"),
    linkCountdown: $("p2LinkCountdown"),
  },
};

const game = new CraneMission({ onEvent: handleCoreEvent });
let lastFrame = performance.now();
let toastTimer = null;
let impactFlash = 0;
let shake = 0;
let previousIntegrity = 100;
let previousStatus = game.status;
let previousCargoIndex = 0;
let savedReplays = loadStoredReplays();
let savedThisSession = false;
let replayOpen = false;
let replayResumeAfterClose = false;
let activeReplay = null;
let replayPlayback = {
  playing: false,
  time: 0,
  speed: 1,
  lastFrame: performance.now(),
};
let audioContext = null;

function loadStoredReplays() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_SAVED_REPLAYS) : [];
  } catch {
    return [];
  }
}

function persistReplays() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(savedReplays.slice(0, MAX_SAVED_REPLAYS)),
    );
  } catch {
    showToast("本地回放空间不可用，当前记录仍保留在本次会话");
  }
}

function saveReplay(replay, alternateResult = null) {
  if (!replay || replay.snapshots.length < 2) return null;
  const normalized = {
    ...replay,
    id: replay.id || `lift-${Date.now()}`,
    result: alternateResult || replay.result,
  };
  savedReplays = [
    normalized,
    ...savedReplays.filter((item) => item.id !== normalized.id),
  ].slice(0, MAX_SAVED_REPLAYS);
  persistReplays();
  savedThisSession = true;
  return normalized;
}

function formatClock(seconds) {
  const value = Math.max(0, seconds);
  const minutes = Math.floor(value / 60);
  const secs = Math.floor(value % 60);
  const tenths = Math.floor((value % 1) * 10);
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${tenths}`;
}

function formatShortTime(seconds) {
  const value = Math.max(0, seconds || 0);
  const minutes = Math.floor(value / 60);
  const secs = Math.floor(value % 60);
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function showToast(message, duration = 2500) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), duration);
}

function ensureAudio() {
  if (!audioContext) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (Context) audioContext = new Context();
  }
  if (audioContext?.state === "suspended") audioContext.resume();
}

function tone(frequency, duration = 0.08, gainValue = 0.045, type = "sine") {
  if (!audioContext) return;
  const now = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  gain.gain.setValueAtTime(gainValue, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + duration);
}

function setBar(fill, valueElement, value, suffix = "") {
  if (valueElement) valueElement.textContent = `${Math.round(value)}${suffix}`;
  if (!fill) return;
  fill.style.width = `${clamp(value, 0, 100)}%`;
  if (value < 30) {
    fill.style.background = "var(--red)";
  } else if (value < 58) {
    fill.style.background = "var(--amber)";
  } else {
    fill.style.background = "";
  }
}

function updateUI(state) {
  const player = state.links;
  const isFinal = ["success", "failed"].includes(state.status);
  const statusLabels = {
    ready: "系统待命",
    playing: "任务进行中",
    paused: "系统暂停",
    protected: "安全保护",
    success: "任务完成",
    failed: "任务中止",
  };
  elements.topStateLabel.textContent = statusLabels[state.status] || "系统状态未知";
  elements.topStateLight.className = `state-light ${
    state.status === "playing"
      ? "running"
      : ["protected", "failed"].includes(state.status)
        ? "danger"
        : ""
  }`;

  const clock = formatClock(state.remaining);
  elements.missionClock.textContent = clock;
  playerElements.p1.sharedClock.textContent = clock;
  playerElements.p2.sharedClock.textContent = clock;
  const clockWrap = elements.missionClock.closest(".mission-clock");
  clockWrap.classList.toggle("is-warning", state.remaining <= 45 && state.remaining > 20);
  clockWrap.classList.toggle("is-critical", state.remaining <= 20);
  elements.clockState.textContent =
    state.status === "playing"
      ? "计时中 / SYNC"
      : state.status === "ready"
        ? "计时未开始"
        : state.status === "paused"
          ? "计时冻结"
          : state.status === "protected"
            ? "保护冻结"
            : isFinal
              ? "计时停止"
              : "待命";

  const cargo = state.cargo;
  const targetAngle =
    state.phase === "pickup" ? cargo.pickupAngle : cargo.targetAngle;
  const displayAngle = ((state.slewAngle % 360) + 360) % 360;
  playerElements.p1.angle.textContent = `${displayAngle.toFixed(1)}°`;
  playerElements.p1.speed.innerHTML = `${Math.abs(state.slewSpeed).toFixed(1)}<small>°/s</small>`;
  playerElements.p1.target.textContent =
    targetAngle == null ? "—" : `${targetAngle.toFixed(0)}°`;
  playerElements.p1.needle.style.transform = `rotate(${displayAngle + 90}deg)`;
  playerElements.p1.targetMarker.setAttribute(
    "transform",
    `rotate(${(targetAngle ?? displayAngle) + 90} 100 100)`,
  );

  playerElements.p2.height.innerHTML = `${state.hoistHeight.toFixed(0)}<small>%</small>`;
  playerElements.p2.heightFill.style.height = `${state.hoistHeight}%`;
  playerElements.p2.heightMarker.style.bottom = `${state.hoistHeight}%`;
  playerElements.p2.speed.innerHTML = `${Math.abs(state.hoistSpeed).toFixed(1)}<small>%/s</small>`;
  playerElements.p2.load.innerHTML = state.cargoAttached
    ? `${cargo.weight.toFixed(1)}<small>t</small>`
    : `0.0<small>t</small>`;
  if (state.hoistHeight < 15) {
    playerElements.p2.heightBand.textContent = "低位 · 可取放";
    playerElements.p2.heightBand.style.color = "var(--amber)";
  } else if (state.hoistHeight < 24 && state.cargoAttached) {
    playerElements.p2.heightBand.textContent = "提升互锁区";
    playerElements.p2.heightBand.style.color = "var(--red)";
  } else if (state.hoistHeight > 70) {
    playerElements.p2.heightBand.textContent = "安全提升区";
    playerElements.p2.heightBand.style.color = "var(--green)";
  } else {
    playerElements.p2.heightBand.textContent = "转运高度";
    playerElements.p2.heightBand.style.color = "var(--cyan)";
  }

  for (const side of ["p1", "p2"]) {
    const item = playerElements[side];
    setBar(item.hydraulicFill, item.hydraulicValue, state.hydraulic);
    setBar(item.integrityFill, item.integrityValue, state.integrity);
    const link = player[side];
    item.link.classList.toggle("offline", !link.connected);
    item.link.classList.toggle(
      "timeout",
      link.connected && Boolean(link.timedOut),
    );
    item.linkText.textContent = !link.connected
      ? "断开"
      : link.timedOut
        ? "超时"
        : "在线";
    const countdown = link.remaining;
    item.linkCountdown.classList.toggle(
      "is-warning",
      countdown != null && countdown < 5,
    );
    item.linkCountdown.querySelector("strong").textContent =
      countdown == null ? "冻结" : `${countdown.toFixed(1)}s`;
  }

  setBar($("deckHydraulicFill"), $("deckHydraulicValue"), state.hydraulic, "%");
  setBar($("deckIntegrityFill"), $("deckIntegrityValue"), state.integrity, "%");
  elements.swayValue.textContent = state.sway.toFixed(1);
  elements.swayFill.style.width = `${clamp((state.sway / 69) * 100, 0, 100)}%`;
  elements.swayFill.style.background =
    state.sway > 52 ? "var(--red)" : state.sway > 30 ? "var(--amber)" : "var(--green)";

  elements.jointP1.classList.toggle("is-held", state.steadyP1);
  elements.jointP2.classList.toggle("is-held", state.steadyP2);
  elements.jointProgressFill.style.width = `${state.stabilityProgress * 100}%`;
  elements.phaseGuide.textContent = state.hint;
  elements.deckGuide.textContent = state.hint;
  const phaseLabels = {
    carry: "吊运转运",
    pickup: "货箱挂载",
    settle: "入位确认",
  };
  elements.phaseTag.textContent = isFinal
    ? state.status === "success"
      ? "任务完成"
      : "任务中止"
    : state.status === "protected"
      ? "安全保护"
      : state.status === "paused"
        ? "暂停"
        : state.status === "ready"
          ? "待命"
          : phaseLabels[state.phase] || "吊运转运";

  document.querySelectorAll(".key-unit").forEach((unit) => {
    const side = unit.dataset.player;
    const action = unit.dataset.action;
    unit.classList.toggle("is-held", Boolean(state.keys[side]?.[action]));
  });

  document.querySelectorAll(".cargo-chip").forEach((chip, index) => {
    const done = index < state.placed;
    const active = index === state.cargoIndex && !done;
    chip.classList.toggle("done", done);
    chip.classList.toggle("active", active);
    const stateLabel = chip.querySelector(".cargo-state");
    if (done) stateLabel.textContent = "✓ 已落位";
    else if (active && state.phase === "settle") stateLabel.textContent = "入位确认";
    else if (active && state.phase === "pickup") stateLabel.textContent = "待挂载";
    else if (active && !state.cargoAttached) stateLabel.textContent = "待挂载";
    else if (active) stateLabel.textContent = "吊运中";
    else stateLabel.textContent = "等待";
  });

  elements.startOverlay.classList.toggle("hidden", state.status !== "ready");
  elements.pauseOverlay.classList.toggle("hidden", state.status !== "paused");
  elements.protectionOverlay.classList.toggle("hidden", state.status !== "protected");
  elements.endOverlay.classList.toggle(
    "hidden",
    !["success", "failed"].includes(state.status),
  );

  elements.pauseLabel.textContent = state.status === "paused" ? "继续" : "暂停";
  elements.pauseIcon.textContent = state.status === "paused" ? "▶" : "II";
  elements.missionMode.textContent = game.mode === "solo" ? "单人调试" : "双人协作";
  elements.modeButton.classList.toggle("is-active", game.mode === "solo");
  elements.modeLabel.textContent =
    game.mode === "solo" ? "双人协作" : "单人调试";

  if (state.status === "protected" && state.protection) {
    const side = state.protection.player.toUpperCase();
    elements.protectionTitle.textContent =
      state.protection.kind === "disconnect"
        ? `${side} 链路断开`
        : `${side} 操作超时`;
    elements.protectionText.textContent =
      state.protection.kind === "disconnect"
        ? "该侧已失去控制信号，安全制动已接管，任务计时冻结。"
        : "该侧连续 14 秒无输入，系统已执行单侧保护制动。";
    $("protectP1Dot").classList.toggle("offline", !state.links.p1.connected);
    $("protectP2Dot").classList.toggle("offline", !state.links.p2.connected);
    elements.reconnectButton.textContent = `${side} 重新接入并恢复`;
  }
}

function renderResult(state) {
  if (!state.result) return;
  const success = state.result.outcome === "success";
  const card = $("endCard");
  card.classList.toggle("failed", !success);
  $("endKicker").textContent = success ? "MISSION COMPLETE" : "MISSION ABORTED";
  $("endTitle").textContent = success ? "三箱全部落位" : "任务已中止";
  $("endText").textContent = success
    ? "双方同步完成 3 次稳定落箱。完整输入、共享资源与冲突记录已写入回放。"
    : `${state.result.label}。系统已保存双方输入和冲突时刻，可回放复盘。`;
  $("endTime").textContent = formatShortTime(state.result.elapsed);
  $("endIntegrity").textContent = `${Math.round(state.result.integrity)}%`;
  $("endCollisions").textContent = String(state.result.collisions);
}

function startMission() {
  ensureAudio();
  if (game.start()) {
    savedThisSession = false;
    previousIntegrity = game.integrity;
    previousStatus = game.status;
    tone(440, 0.09, 0.035, "triangle");
    setTimeout(() => tone(660, 0.12, 0.03, "triangle"), 100);
    showToast("任务开始 · 两组键位可同时输入");
  }
}

function archiveLiveSession() {
  if (
    savedThisSession ||
    !["playing", "paused", "protected"].includes(game.status) ||
    game.snapshots.length < 2
  ) {
    return;
  }
  saveReplay(game.getReplay(), {
    outcome: "open",
    label: "未完成 · 重开前自动存档",
    elapsed: Number(game.elapsed.toFixed(2)),
    integrity: Number(game.integrity.toFixed(1)),
    collisions: game.collisions,
  });
}

function restartMission({ announce = true } = {}) {
  archiveLiveSession();
  game.reset();
  savedThisSession = false;
  previousIntegrity = game.integrity;
  previousStatus = game.status;
  previousCargoIndex = 0;
  impactFlash = 0;
  shake = 0;
  game.start();
  previousStatus = game.status;
  elements.endOverlay.classList.add("hidden");
  ensureAudio();
  tone(330, 0.08, 0.03, "square");
  if (announce) showToast("任务已重开 · 双人仪表、目标与计时同步复位");
}

function togglePause() {
  if (!["playing", "paused"].includes(game.status)) {
    if (game.status === "ready") showToast("请先开始任务");
    return;
  }
  const status = game.togglePause();
  ensureAudio();
  if (status === "paused") {
    tone(260, 0.07, 0.025, "triangle");
  } else {
    tone(420, 0.07, 0.025, "triangle");
  }
}

function toggleMode() {
  const nextMode = game.mode === "solo" ? "coop" : "solo";
  const wasActive = ["playing", "paused", "protected"].includes(game.status);
  if (wasActive) archiveLiveSession();
  game.setMode(nextMode);
  if (wasActive) {
    restartMission({ announce: false });
    showToast(
      nextMode === "solo"
        ? "单人调试已启用 · 一人可操作两组，但键位与职责仍完全分离"
        : "已恢复双人协作模式 · 双方控制域保持不变",
      3500,
    );
  } else {
    updateUI(game.telemetry());
  }
}

function handleCoreEvent({ type, detail }) {
  if (type === "collision") {
    impactFlash = 0.85;
    shake = 1;
    tone(92, 0.24, 0.09, "sawtooth");
    setTimeout(() => tone(72, 0.2, 0.05, "square"), 60);
    showToast(detail.message, 3000);
  } else if (type === "task") {
    tone(detail.message.includes("落位") ? 720 : 540, 0.11, 0.035, "sine");
  } else if (type === "protection") {
    tone(180, 0.2, 0.06, "square");
    showToast(detail.message, 3200);
  } else if (type === "recovery") {
    tone(560, 0.08, 0.03, "triangle");
    showToast("链路已恢复 · 任务计时继续，共享状态一致");
  } else if (type === "finish") {
    const result = detail.result;
    const replay = savedThisSession ? null : saveReplay(detail);
    savedThisSession = true;
    renderResult(detail.telemetry);
    if (replay) {
      setTimeout(
        () =>
          showToast(
            result.outcome === "success"
              ? "任务成功 · 回放已保存，可检查双方输入与共享资源"
              : "任务中止 · 单侧失误与冲突时刻已保存",
            4200,
          ),
        850,
      );
    }
    if (result.outcome === "success") {
      setTimeout(() => tuneSuccess(), 240);
    }
  }
}

function tuneSuccess() {
  [523, 659, 784].forEach((frequency, index) => {
    setTimeout(() => tone(frequency, 0.13, 0.035, "triangle"), index * 120);
  });
}

const keyBindings = {
  KeyA: ["p1", "left"],
  KeyD: ["p1", "right"],
  KeyF: ["p1", "steady"],
  KeyW: ["p2", "up"],
  KeyS: ["p2", "down"],
  KeyJ: ["p2", "steady"],
};

function shouldIgnoreGameKeys(event) {
  if (replayOpen) return true;
  const tag = event.target?.tagName?.toLowerCase();
  return ["input", "select", "textarea"].includes(tag);
}

window.addEventListener("keydown", (event) => {
  if (event.code === "Escape" && replayOpen) {
    event.preventDefault();
    closeReplay();
    return;
  }
  if (shouldIgnoreGameKeys(event)) return;
  if (event.repeat) return;

  if (event.code === "KeyP") {
    event.preventDefault();
    togglePause();
    return;
  }
  if (event.code === "KeyR") {
    event.preventDefault();
    restartMission();
    return;
  }

  const binding = keyBindings[event.code];
  if (!binding) return;
  event.preventDefault();
  ensureAudio();
  const [player, action] = binding;
  if (game.status === "playing") {
    game.setInput(player, action, true);
  } else if (game.status === "protected") {
    showToast("安全保护中 · 请先在画面中央重新接入");
  } else if (game.status === "ready") {
    showToast("系统待命 · 点击“开始吊装”后开放控制");
  }
});

window.addEventListener("keyup", (event) => {
  const binding = keyBindings[event.code];
  if (!binding) return;
  event.preventDefault();
  const [player, action] = binding;
  game.setInput(player, action, false);
});

window.addEventListener("blur", () => {
  game.releaseAllInputs();
  if (game.status === "playing") {
    game.togglePause();
    showToast("窗口失焦 · 已自动暂停并冻结共享计时");
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && game.status === "playing") {
    game.releaseAllInputs();
    game.togglePause();
  }
});

elements.startButton.addEventListener("click", startMission);
elements.pauseButton.addEventListener("click", togglePause);
elements.resumeButton.addEventListener("click", togglePause);
elements.restartButton.addEventListener("click", () => restartMission());
elements.modeButton.addEventListener("click", toggleMode);
elements.replayButton.addEventListener("click", openReplay);
elements.endReplayButton.addEventListener("click", openReplay);
elements.endRestartButton.addEventListener("click", () => restartMission());

elements.p1Disconnect.addEventListener("click", () => {
  if (game.status !== "playing") {
    showToast("仅任务进行中可模拟链路断开");
    return;
  }
  game.simulateDisconnect("p1");
});

elements.p2Disconnect.addEventListener("click", () => {
  if (game.status !== "playing") {
    showToast("仅任务进行中可模拟链路断开");
    return;
  }
  game.simulateDisconnect("p2");
});

elements.reconnectButton.addEventListener("click", () => {
  const side = game.protection?.player;
  if (!side) return;
  ensureAudio();
  if (game.reconnect(side)) {
    tone(520, 0.1, 0.03, "triangle");
  }
});

function updateEffects(dt) {
  impactFlash = Math.max(0, impactFlash - dt * 1.65);
  shake = Math.max(0, shake - dt * 2.4);
}

function frame(now) {
  const dt = clamp((now - lastFrame) / 1000, 0, 0.05);
  lastFrame = now;

  game.tick(dt);
  updateEffects(dt);
  const state = game.telemetry();
  updateUI(state);
  renderScene(elements.canvas.getContext("2d"), elements.canvas, state, {
    time: now / 1000,
    impactFlash,
    shake,
  });

  if (replayOpen) {
    renderReplayFrame(now);
  }

  requestAnimationFrame(frame);
}

function drawIdleScene() {
  const state = game.telemetry();
  updateUI(state);
  renderScene(elements.canvas.getContext("2d"), elements.canvas, state, {
    time: performance.now() / 1000,
    impactFlash: 0,
    shake: 0,
  });
}

window.__TWIN_LIFT__ = {
  game,
  startMission,
  restartMission,
  togglePause,
  toggleMode,
  getState: () => game.telemetry(),
  getReplay: () => game.getReplay(),
  getSavedReplays: () => savedReplays.map((replay) => ({ ...replay })),
  simulateDisconnect: (player) => game.simulateDisconnect(player),
  reconnect: (player) => game.reconnect(player),
  setInput: (player, action, pressed) =>
    game.setInput(player, action, Boolean(pressed)),
  step: (seconds) => {
    const steps = Math.max(1, Math.ceil(seconds * 60));
    for (let index = 0; index < steps; index += 1) game.tick(1 / 60);
    drawIdleScene();
    return game.telemetry();
  },
  openReplay,
};

function getReplayLibrary() {
  const records = savedReplays.slice();
  if (
    !savedThisSession &&
    game.snapshots.length > 1 &&
    ["playing", "paused", "protected"].includes(game.status)
  ) {
    records.unshift(game.getReplay());
  }
  return records;
}

function replayDuration(replay) {
  if (!replay) return 1;
  const snapshotEnd = replay.snapshots?.at(-1)?.t || 0;
  const eventEnd = replay.events?.at(-1)?.t || 0;
  const resultEnd = replay.result?.elapsed || 0;
  return Math.max(1, snapshotEnd, eventEnd, resultEnd);
}

function outcomeText(replay) {
  if (!replay?.result) return "进行中";
  if (replay.result.outcome === "success") return "成功";
  if (replay.result.outcome === "failure") return "中止";
  return "未完成";
}

function outcomeClass(replay) {
  if (!replay?.result) return "open";
  return replay.result.outcome === "failure" ? "failure" : "success";
}

function auditEvents(replay) {
  return (replay.events || []).filter((event) => event.type !== "input");
}

function renderSessionList() {
  const list = $("replaySessionList");
  const records = getReplayLibrary();
  list.replaceChildren();
  if (!records.length) {
    const empty = document.createElement("div");
    empty.className = "empty-note";
    empty.textContent = "还没有任务记录。完成或中止一次吊装后会自动存档。";
    list.append(empty);
    return records;
  }

  records.forEach((replay, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "replay-session";
    if (activeReplay && replay.id === activeReplay.id) button.classList.add("active");
    const top = document.createElement("div");
    top.className = "replay-session-top";
    const date = document.createElement("span");
    date.textContent = formatDate(replay.startedAt);
    const tag = document.createElement("span");
    tag.className = `outcome-tag ${outcomeClass(replay)}`;
    tag.textContent = outcomeText(replay);
    top.append(date, tag);
    const title = document.createElement("strong");
    title.textContent =
      replay.result?.label ||
      (replay.mode === "solo" ? "单人调试 · 进行中" : "双人协作 · 进行中");
    const meta = document.createElement("small");
    meta.textContent = `${formatShortTime(replayDuration(replay))} · ${
      auditEvents(replay).length
    } 审计事件 · ${replay.conflicts?.length || 0} 冲突`;
    button.append(top, title, meta);
    button.addEventListener("click", () => selectReplay(replay));
    list.append(button);
  });
  return records;
}

function selectReplay(replay) {
  activeReplay = replay;
  replayPlayback.time = 0;
  replayPlayback.playing = true;
  replayPlayback.lastFrame = performance.now();
  renderSessionList();
  renderReplayAudit(replay);
  $("replayRange").value = "0";
}

function buildInputSegments(replay, predicate) {
  const duration = replayDuration(replay);
  const snapshots = replay.snapshots || [];
  const segments = [];
  let start = null;
  for (const snapshot of snapshots) {
    const active = predicate(snapshot);
    if (active && start == null) start = snapshot.t;
    if (!active && start != null) {
      segments.push({ start, end: snapshot.t });
      start = null;
    }
  }
  if (start != null) segments.push({ start, end: duration });
  return segments;
}

function drawInputLane(container, label, className, segments, duration) {
  const row = document.createElement("div");
  row.className = `input-lane ${className}`;
  const name = document.createElement("span");
  name.textContent = label;
  const track = document.createElement("div");
  track.className = "input-lane-track";
  for (const segment of segments) {
    const bar = document.createElement("i");
    bar.className = "input-segment";
    bar.style.left = `${(segment.start / duration) * 100}%`;
    bar.style.width = `${Math.max(
      0.18,
      ((segment.end - segment.start) / duration) * 100,
    )}%`;
    track.append(bar);
  }
  row.append(name, track);
  container.append(row);
}

function renderInputLanes(replay) {
  const container = $("inputLanes");
  container.replaceChildren();
  const duration = replayDuration(replay);
  const lanes = [
    {
      label: "P1 · 回转",
      className: "p1",
      predicate: (snapshot) => snapshot.keys?.p1?.left || snapshot.keys?.p1?.right,
    },
    {
      label: "P1 · 稳定",
      className: "p1",
      predicate: (snapshot) => snapshot.keys?.p1?.steady,
    },
    {
      label: "P2 · 升降",
      className: "p2",
      predicate: (snapshot) => snapshot.keys?.p2?.up || snapshot.keys?.p2?.down,
    },
    {
      label: "P2 · 稳定",
      className: "p2",
      predicate: (snapshot) => snapshot.keys?.p2?.steady,
    },
  ];
  lanes.forEach((lane) =>
    drawInputLane(
      container,
      lane.label,
      lane.className,
      buildInputSegments(replay, lane.predicate),
      duration,
    ),
  );
}

const eventTypeLabels = {
  state: "STATE",
  input: "INPUT",
  collision: "IMPACT",
  conflict: "CONFLICT",
  protection: "SAFETY",
  recovery: "RECOVERY",
  task: "TASK",
  result: "RESULT",
};

function renderEventList(replay) {
  const list = $("replayEventList");
  list.replaceChildren();
  const events = auditEvents(replay);
  const inputEvents = replay.inputs?.filter((input) => input.pressed).length || 0;
  $("replayEventCount").textContent = `${events.length} events · ${inputEvents} inputs`;
  if (!events.length) {
    const empty = document.createElement("div");
    empty.className = "empty-note";
    empty.textContent = "该记录没有可审计事件。";
    list.append(empty);
    return;
  }
  for (const event of events) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `event-row ${event.severity || "info"}`;
    row.style.width = "100%";
    row.style.borderLeft = "0";
    row.style.borderRight = "0";
    row.style.borderTop = "0";
    row.style.background = "transparent";
    row.style.cursor = "pointer";
    row.addEventListener("click", () => {
      replayPlayback.time = clamp(event.t, 0, replayDuration(replay));
      replayPlayback.playing = false;
      renderReplayFrame(performance.now());
    });
    const time = document.createElement("time");
    time.textContent = formatClock(event.t);
    const kind = document.createElement("span");
    kind.className = "event-type";
    kind.textContent = eventTypeLabels[event.type] || event.type.toUpperCase();
    const message = document.createElement("span");
    message.className = "event-message";
    message.textContent = event.message;
    const actor = document.createElement("span");
    actor.className = `event-actor ${event.actor}`;
    actor.textContent = ["p1", "p2", "both"].includes(event.actor)
      ? event.actor.toUpperCase()
      : "";
    row.append(time, kind, message, actor);
    list.append(row);
  }
}

function renderReplaySummary(replay) {
  const summary = $("replaySummary");
  summary.replaceChildren();
  const verdict = document.createElement("div");
  verdict.className = `summary-verdict ${
    replay.result?.outcome === "failure" ? "failed" : ""
  }`;
  const verdictLabel = document.createElement("span");
  verdictLabel.textContent =
    replay.result?.outcome === "success"
      ? "MISSION COMPLETE"
      : replay.result?.outcome === "failure"
        ? "MISSION ABORTED"
        : "SESSION OPEN";
  const verdictText = document.createElement("strong");
  verdictText.textContent =
    replay.result?.label ||
    (replay.result?.outcome === "success" ? "三箱全部落位" : "任务记录");
  verdict.append(verdictLabel, verdictText);
  summary.append(verdict);

  const inputCount = { p1: 0, p2: 0 };
  replay.inputs?.forEach((input) => {
    if (input.pressed && inputCount[input.player] != null) inputCount[input.player] += 1;
  });
  const finalTelemetry = replay.telemetry || {};
  const values = [
    ["模式", replay.mode === "solo" ? "单人调试" : "双人协作"],
    ["总时长", formatClock(replayDuration(replay))],
    ["P1 输入", `${inputCount.p1} 次`],
    ["P2 输入", `${inputCount.p2} 次`],
    ["结构完整", `${Math.round(replay.result?.integrity ?? finalTelemetry.integrity ?? 0)}%`],
    ["护栏碰撞", `${replay.result?.collisions ?? finalTelemetry.collisions ?? 0} 次`],
    ["快照", `${replay.snapshots?.length || 0} 帧`],
    ["冲突", `${replay.conflicts?.length || 0} 次`],
  ];
  const grid = document.createElement("div");
  grid.className = "summary-grid";
  values.forEach(([label, value]) => {
    const cell = document.createElement("div");
    const key = document.createElement("span");
    key.textContent = label;
    const strong = document.createElement("strong");
    strong.textContent = value;
    cell.append(key, strong);
    grid.append(cell);
  });
  summary.append(grid);

  const conflicts = replay.conflicts || [];
  $("conflictCount").textContent = String(conflicts.length);
  const conflictList = $("conflictList");
  conflictList.replaceChildren();
  if (!conflicts.length) {
    const empty = document.createElement("div");
    empty.className = "empty-note";
    empty.textContent = "本局没有记录到冲突或护栏冲击。";
    conflictList.append(empty);
  } else {
    conflicts.forEach((conflict) => {
      const item = document.createElement("div");
      item.className = "conflict-item";
      const time = document.createElement("time");
      time.textContent = `${formatClock(conflict.t)} · ${String(
        conflict.actor || "",
      ).toUpperCase()}`;
      const message = document.createElement("span");
      message.textContent = conflict.message;
      item.append(time, message);
      conflictList.append(item);
    });
  }
}

function renderReplayAudit(replay) {
  renderInputLanes(replay);
  renderEventList(replay);
  renderReplaySummary(replay);
  const duration = replayDuration(replay);
  $("replayRange").max = "1000";
  $("replayRange").value = "0";
  $("replayTime").textContent = `${formatClock(0)} / ${formatClock(duration)}`;
}

function snapshotAt(replay, time) {
  const snapshots = replay?.snapshots || [];
  if (!snapshots.length) return {};
  let low = 0;
  let high = snapshots.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (snapshots[middle].t <= time) low = middle + 1;
    else high = middle - 1;
  }
  return snapshots[Math.max(0, high)] || snapshots[0];
}

function renderReplayFrame(now) {
  if (!replayOpen || !activeReplay) return;
  const duration = replayDuration(activeReplay);
  const delta = clamp((now - replayPlayback.lastFrame) / 1000, 0, 0.05);
  replayPlayback.lastFrame = now;
  if (replayPlayback.playing) {
    replayPlayback.time = Math.min(
      duration,
      replayPlayback.time + delta * replayPlayback.speed,
    );
    if (replayPlayback.time >= duration) replayPlayback.playing = false;
  }
  const snapshot = snapshotAt(activeReplay, replayPlayback.time);
  const nearImpact = (activeReplay.events || []).some(
    (event) =>
      event.type === "collision" &&
      Math.abs(event.t - replayPlayback.time) < 0.22,
  );
  renderScene(
    $("replayCanvas").getContext("2d"),
    $("replayCanvas"),
    snapshot,
    {
    replay: true,
    time: now / 1000,
    impactFlash: nearImpact ? 0.7 : 0,
    },
  );
  const ratio = clamp(replayPlayback.time / duration, 0, 1);
  $("replayRange").value = String(Math.round(ratio * 1000));
  $("replayTime").textContent = `${formatClock(replayPlayback.time)} / ${formatClock(
    duration,
  )}`;
  $("replayPlayButton").textContent = replayPlayback.playing ? "II" : "▶";
  $("replayBadge").textContent = replayPlayback.playing ? "回放中" : "已暂停";
  $("replaySyncClock").textContent = formatClock(snapshot.remaining ?? 0);
  $("replaySyncHydraulic").textContent = `${Math.round(snapshot.hydraulic ?? 0)}%`;
  $("replaySyncIntegrity").textContent = `${Math.round(snapshot.integrity ?? 0)}%`;
  $("replaySyncP1").classList.toggle("p1-active", Boolean(snapshot.steadyP1));
  $("replaySyncP2").classList.toggle("p2-active", Boolean(snapshot.steadyP2));
}

function openReplay() {
  if (replayOpen) return;
  replayResumeAfterClose = game.status === "playing";
  if (replayResumeAfterClose) {
    game.togglePause();
  }
  replayOpen = true;
  replayPlayback.playing = false;
  $("replayModal").classList.remove("hidden");
  const records = renderSessionList();
  if (records.length) {
    selectReplay(records[0]);
  } else {
    activeReplay = null;
    $("inputLanes").replaceChildren();
    $("replayEventList").replaceChildren();
    $("conflictList").replaceChildren();
    $("replaySummary").replaceChildren(
      Object.assign(document.createElement("div"), {
        className: "empty-note",
        textContent: "暂无记录。完成、中止或重开一次任务后即可回放。",
      }),
    );
    const context = $("replayCanvas").getContext("2d");
    context.clearRect(0, 0, $("replayCanvas").width, $("replayCanvas").height);
  }
}

function closeReplay() {
  if (!replayOpen) return;
  replayOpen = false;
  replayPlayback.playing = false;
  $("replayModal").classList.add("hidden");
  if (replayResumeAfterClose && game.status === "paused") {
    game.togglePause();
    showToast("回放已关闭 · 任务继续");
  }
  replayResumeAfterClose = false;
}

document.querySelectorAll("[data-close-replay]").forEach((element) => {
  element.addEventListener("click", closeReplay);
});

$("replayPlayButton").addEventListener("click", () => {
  if (!activeReplay) return;
  const duration = replayDuration(activeReplay);
  if (replayPlayback.time >= duration) replayPlayback.time = 0;
  replayPlayback.playing = !replayPlayback.playing;
  replayPlayback.lastFrame = performance.now();
});

$("replayRange").addEventListener("input", (event) => {
  if (!activeReplay) return;
  replayPlayback.time =
    (Number(event.target.value) / 1000) * replayDuration(activeReplay);
  replayPlayback.lastFrame = performance.now();
});

$("replaySpeed").addEventListener("change", (event) => {
  replayPlayback.speed = Number(event.target.value) || 1;
});

$("exportReplayButton").addEventListener("click", () => {
  if (!activeReplay) {
    showToast("没有可导出的回放记录");
    return;
  }
  const payload = JSON.stringify(activeReplay, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `twinlift-replay-${activeReplay.id || Date.now()}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("回放 JSON 已导出 · 含双方输入、共享资源与冲突");
});
drawIdleScene();
requestAnimationFrame(frame);
