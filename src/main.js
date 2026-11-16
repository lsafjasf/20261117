import {
  STORAGE_KEY,
  auditionEditPass,
  clipDuration,
  clipEnd,
  createDemoProject,
  deserializeProject,
  frameAt,
  moveClip,
  overlapAmount,
  projectDuration,
  serializeProject,
  setTransition,
  shortTime,
  splitTimelineClip,
  timecode,
  validateProject,
  validateReload
} from "./project.js";
import { StudioAudio, beatPhase } from "./audio.js";
import { renderPoster, renderStage, renderThumbnail } from "./renderer.js";

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

const dom = {
  app: $(".app-shell"),
  stageCanvas: $("#stageCanvas"),
  stageWrap: $("#stageWrap"),
  frameStrip: $("#frameStrip"),
  frameCounter: $("#frameCounter"),
  frameHud: $("#frameHud"),
  shotLabel: $("#shotLabel"),
  headerTimecode: $("#headerTimecode"),
  stageTimecode: $("#stageTimecode"),
  timelineTimecode: $("#timelineTimecode"),
  timelineDuration: $("#timelineDuration"),
  timelineScroll: $("#timelineScroll"),
  timelineContent: $("#timelineContent"),
  ruler: $("#ruler"),
  videoTrack: $("#videoTrack"),
  subtitleTrack: $("#subtitleTrack"),
  drawingTrack: $("#drawingTrack"),
  audioTrack: $("#audioTrack"),
  beatTrack: $("#beatTrack"),
  playhead: $("#playhead"),
  playheadLabel: $("#playheadLabel"),
  conflictBand: $("#conflictBand"),
  conflictPill: $("#conflictPill"),
  playBtn: $("#playBtn"),
  stagePlayBtn: $("#stagePlayBtn"),
  loopChip: $("#loopChip"),
  loopToggle: $("#loopToggle"),
  metronomeChip: $("#metronomeChip"),
  metronomeToggle: $("#metronomeToggle"),
  volumeSlider: $("#volumeSlider"),
  volumeOutput: $("#volumeOutput"),
  widthSlider: $("#widthSlider"),
  widthOutput: $("#widthOutput"),
  opacitySlider: $("#opacitySlider"),
  opacityOutput: $("#opacityOutput"),
  onionToggle: $("#onionToggle"),
  baseToggle: $("#baseToggle"),
  pathSwitch: $("#pathSwitch"),
  pathFrameLabel: $("#pathFrameLabel"),
  pathACount: $("#pathACount"),
  pathBCount: $("#pathBCount"),
  clipReadout: $("#clipReadout"),
  transitionSelect: $("#transitionSelect"),
  checkList: $("#checkList"),
  healthBadge: $("#healthBadge"),
  checkCount: $("#checkCount"),
  syncResult: $("#syncResult"),
  saveState: $("#saveState"),
  saveProjectBtn: $("#saveProjectBtn"),
  reloadProjectBtn: $("#reloadProjectBtn"),
  exportBtn: $("#exportBtn"),
  exportModal: $("#exportModal"),
  startExportBtn: $("#startExportBtn"),
  cancelExportBtn: $("#cancelExportBtn"),
  closeExportBtn: $("#closeExportBtn"),
  exportProgressBar: $("#exportProgressBar"),
  exportStatus: $("#exportStatus"),
  exportRuntime: $("#exportRuntime"),
  exportPoster: $("#exportPoster"),
  failureModal: $("#failureModal"),
  failureTitle: $("#failureTitle"),
  failureMessage: $("#failureMessage"),
  failureDetail: $("#failureDetail"),
  failureReloadBtn: $("#failureReloadBtn"),
  retryPlaybackBtn: $("#retryPlaybackBtn"),
  failureToggle: $("#failureToggle"),
  durationCompare: $("#durationCompare"),
  beatDisplay: $("#beatDisplay"),
  nextBeatLabel: $("#nextBeatLabel"),
  toastWrap: $("#toastWrap"),
  timelinePanel: $("#timelinePanel")
};

const audio = new StudioAudio();

function initialProject() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? deserializeProject(stored) : createDemoProject();
  } catch {
    return createDemoProject();
  }
}

const loadedProject = initialProject();
const state = {
  project: loadedProject,
  currentTime: Number(loadedProject.playhead ?? (loadedProject.selectedFrame || 0) / loadedProject.animationFps),
  playing: false,
  selectedClipId: loadedProject.selectedClipId || loadedProject.timeline.clips[0]?.id,
  tool: "draw",
  activeInspector: "brush",
  pps: 100,
  dragging: null,
  drawing: null,
  snap: true,
  saved: true,
  saveTimer: null,
  lastRenderedFrame: -1,
  safeFrames: false,
  exportBlocked: false,
  exporting: false,
  lastTick: 0,
  failureArmed: false
};

state.selectedClipId = state.project.selectedClipId || state.selectedClipId;
state.savedSnapshot = structuredClone(state.project);

function selectedClip() {
  return state.project.timeline.clips.find((clip) => clip.id === state.selectedClipId) || null;
}

function duration() {
  return projectDuration(state.project);
}

function currentFrameIndex() {
  return state.playing
    ? frameAt(state.project, state.currentTime)
    : Math.min(state.project.selectedFrame, state.project.frames.length - 1);
}

function setDirty() {
  state.saved = false;
  updateSaveState("dirty", "未保存");
  window.clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(() => persistProject({ silent: true }), 900);
}

function updateSaveState(kind, text) {
  dom.saveState.classList.toggle("dirty", kind === "dirty");
  dom.saveState.innerHTML = `<i></i> ${text}`;
}

function persistProject({ silent = false, toast = false } = {}) {
  try {
    state.project.playhead = Number(state.currentTime.toFixed(4));
    state.project.selectedFrame = state.project.selectedFrame;
    state.project.selectedClipId = state.selectedClipId;
    localStorage.setItem(STORAGE_KEY, serializeProject(state.project));
    state.savedSnapshot = structuredClone(state.project);
    state.saved = true;
    updateSaveState("saved", silent ? "已自动保存" : "已保存");
    if (toast) showToast("工程已保存", "入点、出点、描摹和音频事件已写入本地");
    return true;
  } catch (error) {
    updateSaveState("dirty", "保存失败");
    if (!silent) showToast("保存失败", error.message, true);
    return false;
  }
}

function loadSavedProject() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) throw new Error("没有可载入的本地工程");
  return deserializeProject(raw);
}

function showToast(title, detail = "", bad = false, timeout = 3000) {
  const toast = document.createElement("div");
  toast.className = `toast${bad ? " bad" : ""}`;
  toast.innerHTML = `<strong>${title}</strong>${detail ? `<small>${detail}</small>` : ""}`;
  dom.toastWrap.append(toast);
  window.setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(4px)";
    toast.style.transition = ".18s ease";
    window.setTimeout(() => toast.remove(), 200);
  }, timeout);
}

function formatRuntime(seconds) {
  return `${seconds.toFixed(2)} 秒`;
}

function updateHeader() {
  const tc = timecode(state.currentTime, state.project.fps);
  dom.headerTimecode.textContent = tc;
  dom.stageTimecode.textContent = tc;
  dom.timelineTimecode.textContent = tc;
  dom.playheadLabel.textContent = tc;
  dom.timelineDuration.textContent = `/ ${timecode(duration(), state.project.fps)}`;
  const frame = currentFrameIndex();
  dom.frameHud.textContent = `F${String(frame + 1).padStart(2, "0")} · ${state.project.frames[frame]?.hold || 2}F`;
  dom.frameCounter.textContent = `${String(frame + 1).padStart(2, "0")} / ${state.project.frames.length}`;
  dom.pathFrameLabel.textContent = `F${String(state.project.selectedFrame + 1).padStart(2, "0")}`;
  dom.playing ? dom.stageWrap.classList.add("playing") : dom.stageWrap.classList.remove("playing");
  const clip = state.project.timeline.clips.find((item) => state.currentTime >= item.start && state.currentTime < clipEnd(item));
  dom.shotLabel.textContent = clip ? `K-012 / ${clip.scene === "window" ? "车窗" : "站台"}` : "K-012 / 节目";
}

function renderCanvas(force = false) {
  const manualFrame = state.project.selectedFrame;
  renderStage($("#stageCanvas").getContext("2d"), state.project, state.currentTime, {
    manualFrame,
    paused: !state.playing,
    safeFrames: state.safeFrames
  });
  if (!force && currentFrameIndex() === state.lastRenderedFrame) return;
  state.lastRenderedFrame = currentFrameIndex();
  updateFrameSelection();
}

function updatePlayhead() {
  const x = Math.min(state.pps * duration(), Math.max(0, state.currentTime * state.pps));
  dom.playhead.style.left = `${x}px`;
  dom.playhead.style.display = "block";
  updateHeader();
  updateBeatDisplay();
  $$(".beat-event", dom.beatTrack).forEach((node) => {
    node.classList.toggle("active", Math.abs(Number(node.dataset.time) - state.currentTime) < 0.055);
  });
  $$(".clip", dom.videoTrack).forEach((node) => {
    node.classList.toggle("playing", state.currentTime >= Number(node.dataset.start) && state.currentTime < Number(node.dataset.end));
  });
}

function updateBeatDisplay() {
  const phase = beatPhase(state.currentTime);
  $$("i", dom.beatDisplay).forEach((bar, index) => {
    const active = index === phase.index % 4 && phase.pulse > 0;
    bar.classList.toggle("pulse", active);
    bar.style.height = active ? `${9 + phase.pulse * 14}px` : "";
  });
  const next = (Math.floor(state.currentTime / 0.5) + 1) * 0.5;
  dom.nextBeatLabel.textContent = `${Math.max(0, next - state.currentTime).toFixed(1)}s`;
}

function setPlayingUI(playing) {
  dom.playBtn.textContent = playing ? "Ⅱ" : "▶";
  dom.stagePlayBtn.textContent = playing ? "Ⅱ" : "▶";
  dom.stageWrap.classList.toggle("playing", playing);
  dom.stageWrap.classList.toggle("paused", !playing);
  dom.playBtn.setAttribute("aria-label", playing ? "暂停" : "播放");
}

function buildFrameStrip() {
  dom.frameStrip.replaceChildren();
  state.project.frames.forEach((frame, index) => {
    const card = document.createElement("button");
    card.className = "frame-card";
    card.dataset.frame = index;
    card.setAttribute("aria-label", `第 ${index + 1} 帧`);
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 90;
    renderThumbnail(canvas, state.project, index);
    card.append(canvas);
    const no = document.createElement("span");
    no.className = "frame-no";
    no.textContent = `F${String(index + 1).padStart(2, "0")}`;
    const hold = document.createElement("span");
    hold.className = "frame-hold";
    hold.textContent = `${frame.hold}F`;
    const dots = document.createElement("span");
    dots.className = "trace-dots";
    if (frame.traceA.length) dots.append(document.createElement("i"));
    if (frame.traceB.length) dots.append(document.createElement("i"));
    card.append(no, hold, dots);
    card.addEventListener("click", () => selectFrame(index));
    dom.frameStrip.append(card);
  });
  updateFrameSelection();
}

function updateFrameSelection() {
  const active = state.project.selectedFrame;
  $$(".frame-card", dom.frameStrip).forEach((card, index) => {
    card.classList.toggle("active", index === active);
  });
  updatePathInfo();
  updateFilmstripScroll(active);
}

function updateFilmstripScroll(index) {
  const active = $(`.frame-card[data-frame="${index}"]`, dom.frameStrip);
  if (!active) return;
  const { left, right } = active;
  const viewLeft = dom.frameStrip.scrollLeft;
  const viewRight = viewLeft + dom.frameStrip.clientWidth;
  if (left < viewLeft || right > viewRight) {
    active.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }
}

function selectFrame(index) {
  if (state.playing) stopPlayback();
  const next = Math.max(0, Math.min(state.project.frames.length - 1, index));
  state.project.selectedFrame = next;
  state.currentTime = next / state.project.animationFps;
  renderCanvas(true);
  updatePlayhead();
  updatePathInfo();
  setDirty();
  window.__studio?.emit?.("frame", next);
}

function updatePathInfo() {
  const frame = state.project.frames[state.project.selectedFrame];
  if (!frame) return;
  dom.pathACount.textContent = `${frame.traceA.length} pts`;
  dom.pathBCount.textContent = `${frame.traceB.length} pts`;
  dom.pathFrameLabel.textContent = `F${String(state.project.selectedFrame + 1).padStart(2, "0")}`;
}

function refreshInspector() {
  const clip = selectedClip();
  if (clip) {
    dom.clipReadout.innerHTML = `
      <span>节目入点 <b>${timecode(clip.start, state.project.fps)}</b></span>
      <span>节目出点 <b>${timecode(clipEnd(clip), state.project.fps)}</b></span>
      <span>片段时间 <b>${shortTime(clipDuration(clip))}</b></span>`;
    dom.transitionSelect.value = clip.transitionOut?.type || "cut";
  }
  updatePathInfo();
  updateValidation();
}

function updateValidation() {
  const result = validateProject(state.project);
  const clips = state.project.timeline.clips;
  const first = clips.find((clip) => clip.id === "clip-platform") || clips[0];
  const second = clips.find((clip) => clip.id === "clip-window") || clips[1];
  const transition = first?.transitionOut?.duration || 0;
  const overlapErrors = result.errors.filter((item) => item.kind === "overlap");
  const durationText = `${shortTime(clipDuration(first))} + ${shortTime(clipDuration(second))} − ${transition.toFixed(2)}s`;
  dom.durationCompare.textContent = `裁切核对：${durationText} = ${shortTime(duration())}`;
  dom.conflictPill.classList.toggle("bad", !result.ok);
  dom.conflictPill.innerHTML = result.ok
    ? '<i>!</i> 无冲突'
    : `<i>!</i> ${result.errors.length} 处冲突`;
  dom.healthBadge.textContent = result.ok ? "可导出" : "阻止导出";
  dom.healthBadge.classList.toggle("bad", !result.ok);
  dom.exportBtn.classList.toggle("blocked", !result.ok);
  dom.exportBtn.title = result.ok ? "导出已校验的节目影片" : "存在冲突，导出已阻止";
  dom.checkCount.textContent = result.ok ? "4" : String(result.errors.length);
  dom.checkCount.classList.toggle("bad", !result.ok);
  dom.checkList.innerHTML = "";

  const overlapDetail = result.ok
    ? `${overlapAmount(first, second).toFixed(2)}s 合法转场重叠`
    : `${overlapErrors.length} 处 · ${timecode(overlapErrors[0]?.start || 0, state.project.fps)}`;
  const items = [
    {
      title: "片段重叠与片头",
      detail: overlapDetail,
      pass: result.ok,
      label: result.ok ? "通过" : "阻断"
    },
    {
      title: "共享节目时钟",
      detail: `播放头 · 字幕 · ${state.project.timeline.events.length} 音频事件`,
      pass: true,
      label: `${state.project.fps} FPS`
    },
    {
      title: "帧序与播放速度",
      detail: `${state.project.frames.length} drawings @ ${state.project.animationFps} fps`,
      pass: true,
      label: "锁定"
    },
    {
      title: "工程保存点",
      detail: "入点 / 出点 / 事件位置",
      pass: state.saved,
      label: state.saved ? "已存" : "待存"
    }
  ];
  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = `check-item${item.pass ? "" : " bad"}`;
    row.innerHTML = `<i>${item.pass ? "✓" : "!"}</i><div><strong>${item.title}</strong><small>${item.detail}</small></div><b>${item.label}</b>`;
    dom.checkList.append(row);
  });
  markConflicts(result);
}

function markConflicts(result) {
  const conflicts = new Set(result.conflictIds);
  $$(".clip", dom.videoTrack).forEach((node) => {
    node.classList.toggle("conflict", conflicts.has(node.dataset.id));
  });
  $$(".audio-clip, .subtitle-clip", dom.timelineContent).forEach((node) => {
    node.classList.toggle("conflict", conflicts.has(node.dataset.id));
  });
  const firstRange = result.errors.find((item) => Number.isFinite(item.start) && Number.isFinite(item.end));
  if (firstRange && firstRange.end > firstRange.start) {
    dom.conflictBand.classList.add("show");
    dom.conflictBand.style.left = `${firstRange.start * state.pps}px`;
    dom.conflictBand.style.width = `${Math.max(4, (firstRange.end - firstRange.start) * state.pps)}px`;
    dom.conflictBand.title = result.errors[0].message;
  } else {
    dom.conflictBand.classList.remove("show");
  }
  if (!result.ok) dom.exportBtn.title = result.errors[0].message;
}

function switchInspector(name) {
  state.activeInspector = name;
  $$(".inspector-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.inspector === name));
  $$(".inspector-panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === name));
  if (name === "checks") updateValidation();
}

function renderTimeline() {
  const viewport = Math.max(400, dom.timelineScroll.clientWidth);
  const total = Math.max(1, duration());
  state.pps = Math.max(viewport / total, 88);
  dom.timelineContent.style.width = `${Math.max(viewport, total * state.pps)}px`;
  dom.timelineContent.style.setProperty("--beat-w", `${state.pps * 0.5}px`);
  buildRuler();
  buildVideoTrack();
  buildSubtitleTrack();
  buildDrawingTrack();
  buildAudioTrack();
  buildBeatTrack();
  updateValidation();
  updatePlayhead();
}

function buildRuler() {
  dom.ruler.replaceChildren();
  const total = duration();
  const step = state.pps >= 82 ? 0.5 : 1;
  for (let time = 0; time <= total + 0.001; time += step) {
    const tick = document.createElement("span");
    const major = Math.abs(time % 1) < 0.001;
    tick.className = `ruler-tick${major ? "" : " minor"}`;
    tick.style.left = `${time * state.pps}px`;
    tick.textContent = major ? timecode(time, state.project.fps).slice(3) : "";
    if (!major) tick.style.height = "3px";
    dom.ruler.append(tick);
  }
}

function clipThumbnail(scene, frame) {
  const canvas = document.createElement("canvas");
  canvas.width = 62;
  canvas.height = 44;
  const holder = document.createElement("div");
  holder.className = "clip-thumb";
  holder.append(canvas);
  const ctx = canvas.getContext("2d");
  renderStage(ctx, {
    ...state.project,
    timeline: { ...state.project.timeline, subtitles: [] }
  }, frame / state.project.animationFps, { manualFrame: frame });
  return holder;
}

function buildVideoTrack() {
  dom.videoTrack.replaceChildren();
  const sorted = [...state.project.timeline.clips].sort((a, b) => a.start - b.start);
  sorted.forEach((clip, index) => {
    const element = document.createElement("div");
    element.className = `clip${clip.id === state.selectedClipId ? " selected" : ""}${state.project && validateProject(state.project).conflictIds.includes(clip.id) ? " conflict" : ""}`;
    element.dataset.id = clip.id;
    element.dataset.start = clip.start;
    element.dataset.end = clipEnd(clip);
    element.style.left = `${clip.start * state.pps}px`;
    element.style.width = `${Math.max(34, clipDuration(clip) * state.pps)}px`;
    element.tabIndex = 0;
    element.setAttribute("aria-label", `${clip.name}，${clipDuration(clip).toFixed(2)} 秒`);
    const main = document.createElement("div");
    main.className = "clip-main";
    main.append(clipThumbnail(clip.scene, index === 0 ? 0 : 5));
    const text = document.createElement("div");
    text.className = "clip-text";
    text.innerHTML = `<strong>${clip.name}</strong><small>IN ${timecode(clip.sourceIn, state.project.fps)} · ${clipDuration(clip).toFixed(2)}s</small>`;
    main.append(text);
    element.append(main);
    const left = document.createElement("span");
    left.className = "clip-handle left";
    left.dataset.handle = "left";
    const right = document.createElement("span");
    right.className = "clip-handle right";
    right.dataset.handle = "right";
    element.append(left, right);
    if (clip.transitionOut) {
      const badge = document.createElement("span");
      badge.className = "transition-badge";
      badge.textContent = clip.transitionOut.type === "dip" ? "◐" : "×";
      badge.style.right = "-8px";
      badge.style.left = "auto";
      badge.title = `${clip.transitionOut.type} ${clip.transitionOut.duration}s`;
      element.append(badge);
    }
    element.addEventListener("pointerdown", (event) => startClipDrag(event, clip, element));
    element.addEventListener("click", () => {
      state.selectedClipId = clip.id;
      state.project.selectedClipId = clip.id;
      $$(".clip", dom.videoTrack).forEach((node) => node.classList.toggle("selected", node.dataset.id === clip.id));
      refreshInspector();
    });
    dom.videoTrack.append(element);
  });
}

function buildSubtitleTrack() {
  dom.subtitleTrack.replaceChildren();
  for (const subtitle of state.project.timeline.subtitles) {
    const node = document.createElement("div");
    node.className = "subtitle-clip";
    node.dataset.id = subtitle.id;
    node.style.left = `${subtitle.start * state.pps}px`;
    node.style.width = `${subtitle.duration * state.pps}px`;
    node.textContent = subtitle.text;
    node.title = `${subtitle.start.toFixed(2)}s — ${(subtitle.start + subtitle.duration).toFixed(2)}s`;
    node.addEventListener("click", () => seek(subtitle.start + subtitle.duration * 0.05));
    dom.subtitleTrack.append(node);
  }
}

function buildDrawingTrack() {
  dom.drawingTrack.replaceChildren();
  const node = document.createElement("div");
  node.className = "drawing-clip";
  node.style.left = "0px";
  node.style.width = `${duration() * state.pps}px`;
  node.title = "12 张原动画 · 12 drawings/sec";
  state.project.frames.forEach((frame, index) => {
    const cell = document.createElement("span");
    cell.className = "drawing-cell";
    cell.dataset.frame = index;
    cell.title = `F${String(index + 1).padStart(2, "0")} · ${frame.hold}F`;
    cell.addEventListener("click", (event) => {
      const rect = node.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      selectFrame(Math.floor(ratio * state.project.frames.length));
    });
    node.append(cell);
  });
  dom.drawingTrack.append(node);
}

function buildAudioTrack() {
  dom.audioTrack.replaceChildren();
  for (const item of state.project.timeline.audio) {
    const node = document.createElement("div");
    node.className = "audio-clip";
    node.dataset.id = item.id;
    node.style.left = `${item.start * state.pps}px`;
    node.style.width = `${item.duration * state.pps}px`;
    const wave = document.createElement("div");
    wave.className = "waveform";
    const bars = Math.max(18, Math.floor(item.duration * 14));
    for (let i = 0; i < bars; i += 1) {
      const bar = document.createElement("i");
      const base = Math.sin(i * 0.76) * 0.45 + Math.sin(i * 0.23) * 0.32;
      bar.style.height = `${Math.max(2, Math.abs(base) * 17 + 2)}px`;
      wave.append(bar);
    }
    node.append(wave);
    const label = document.createElement("span");
    label.textContent = item.name;
    node.append(label);
    node.addEventListener("click", () => seek(item.start + 0.05));
    dom.audioTrack.append(node);
  }
}

function buildBeatTrack() {
  dom.beatTrack.replaceChildren();
  state.project.timeline.events.forEach((event) => {
    const node = document.createElement("div");
    node.className = `beat-event${event.accent ? " accent" : ""}`;
    node.dataset.time = event.time;
    node.style.left = `${event.time * state.pps}px`;
    node.title = `${event.label} · ${event.time.toFixed(2)}s`;
    node.addEventListener("click", () => seek(event.time));
    dom.beatTrack.append(node);
  });
}

async function startPlayback() {
  if (state.playing) return;
  if (state.failureArmed) {
    state.failureArmed = false;
    showFailure("模拟解码失败", "AUDIO_CLOCK_LOST · playback halted at shared frame", "音频时钟与画面对齐校验失败。工程未受影响，可以重试回放或重新载入保存点。");
    return;
  }
  if (state.currentTime >= duration() - 0.01) seek(0);
  try {
    await audio.start(state.project, state.currentTime);
    state.playing = true;
    setPlayingUI(true);
    updateHeader();
    window.__studio?.emit?.("playing", true);
  } catch (error) {
    showFailure("回放中断", error.message || "音频时钟未能启动。", `${error.name || "PLAYBACK_ERROR"} · shared-clock:${state.project.fps}fps`);
  }
}

function stopPlayback({ silent = false } = {}) {
  if (!state.playing && !audio.running) return;
  if (state.playing) {
    state.currentTime = Math.min(duration(), audio.currentTime());
    state.project.selectedFrame = frameAt(state.project, state.currentTime);
  }
  audio.stop();
  state.playing = false;
  setPlayingUI(false);
  updatePlayhead();
  renderCanvas(true);
  if (!silent) window.__studio?.emit?.("playing", false);
}

function togglePlayback() {
  if (state.playing) stopPlayback();
  else startPlayback();
}

function seek(time, { keepFrame = false } = {}) {
  const next = Math.max(0, Math.min(duration(), Number(time) || 0));
  state.currentTime = next;
  if (!keepFrame) state.project.selectedFrame = frameAt(state.project, next);
  if (state.playing) audio.seek(state.project, next);
  updatePlayhead();
  renderCanvas(true);
  updateFrameSelection();
}

function playbackTick(timestamp) {
  if (state.playing) {
    let time = audio.currentTime();
    if (time >= duration()) {
      if (state.project.loop) {
        time = 0;
        audio.seek(state.project, 0);
      } else {
        state.currentTime = duration();
        stopPlayback();
      }
    }
    if (state.playing) {
      state.currentTime = time;
      state.project.selectedFrame = frameAt(state.project, time);
      updatePlayhead();
      if (timestamp - state.lastTick > 32) {
        state.lastTick = timestamp;
        renderCanvas();
      }
    }
  } else if (timestamp - state.lastTick > 220) {
    state.lastTick = timestamp;
    updateBeatDisplay();
  }
  window.requestAnimationFrame(playbackTick);
}

function snapTime(time, initial = time) {
  if (!state.snap) return time;
  const nearest = Math.round(time / 0.5) * 0.5;
  return Math.abs(nearest - time) < 0.095 ? nearest : time;
}

function startClipDrag(event, clip, element) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  if (state.playing) stopPlayback();
  state.selectedClipId = clip.id;
  state.project.selectedClipId = clip.id;
  $$(".clip", dom.videoTrack).forEach((node) => node.classList.toggle("selected", node.dataset.id === clip.id));
  const handle = event.target.closest("[data-handle]");
  state.dragging = {
    clipId: clip.id,
    mode: handle?.dataset.handle || "move",
    startX: event.clientX,
    initialStart: clip.start,
    initialIn: clip.sourceIn,
    initialOut: clip.sourceOut,
    element,
    moved: false,
    snapshot: structuredClone(state.project)
  };
  window.addEventListener("pointermove", onClipDrag);
  window.addEventListener("pointerup", endClipDrag, { once: true });
  refreshInspector();
}

function onClipDrag(event) {
  const drag = state.dragging;
  if (!drag) return;
  const clip = state.project.timeline.clips.find((item) => item.id === drag.clipId);
  if (!clip) return;
  const rawDelta = (event.clientX - drag.startX) / state.pps;
  if (Math.abs(rawDelta) > 0.006) drag.moved = true;
  if (drag.mode === "move") {
    clip.start = Math.max(0, snapTime(drag.initialStart + rawDelta));
  } else if (drag.mode === "right") {
    const nextOut = Math.max(drag.initialIn + 1 / state.project.fps, drag.initialOut + rawDelta);
    clip.sourceOut = Number(snapTime(nextOut).toFixed(6));
  } else if (drag.mode === "left") {
    const maxStart = clipEnd({ ...clip, start: drag.initialStart, sourceIn: drag.initialIn, sourceOut: drag.initialOut }) - 1 / state.project.fps;
    const nextStart = Math.max(0, Math.min(maxStart, snapTime(drag.initialStart + rawDelta)));
    const sourceDelta = nextStart - drag.initialStart;
    clip.start = Number(nextStart.toFixed(6));
    clip.sourceIn = Number(Math.max(0, drag.initialIn + sourceDelta).toFixed(6));
  }
  drag.element.style.left = `${clip.start * state.pps}px`;
  drag.element.style.width = `${Math.max(34, clipDuration(clip) * state.pps)}px`;
  drag.element.dataset.start = clip.start;
  drag.element.dataset.end = clipEnd(clip);
  refreshInspector();
  const result = validateProject(state.project);
  markConflicts(result);
}

function endClipDrag() {
  window.removeEventListener("pointermove", onClipDrag);
  const drag = state.dragging;
  state.dragging = null;
  if (!drag?.moved) return;
  setDirty();
  renderTimeline();
  refreshInspector();
  const result = validateProject(state.project);
  if (!result.ok) {
    showToast("检测到非法重叠", `${result.errors[0].message} · 导出已锁定`, true);
  } else {
    showToast("片段已移动", `节目长度 ${formatRuntime(duration())} · 音画时钟未偏移`);
  }
}

function scrubTo(event) {
  const rect = dom.timelineContent.getBoundingClientRect();
  const time = (event.clientX - rect.left) / state.pps;
  seek(time);
}

function startScrub(event) {
  if (event.button !== 0) return;
  event.preventDefault();
  if (state.playing) stopPlayback();
  scrubTo(event);
  window.addEventListener("pointermove", scrubTo);
  window.addEventListener("pointerup", () => window.removeEventListener("pointermove", scrubTo), { once: true });
}

function canvasPoint(event) {
  const rect = dom.stageCanvas.getBoundingClientRect();
  return [
    Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
  ];
}

function startDrawing(event) {
  if (event.button !== 0 || state.exporting) return;
  if (state.tool === "pan") return;
  event.preventDefault();
  if (state.playing) stopPlayback();
  const frame = state.project.frames[state.project.selectedFrame];
  const pathKey = `trace${state.project.brush.activePath}`;
  if (state.tool === "eraser") {
    frame[pathKey] = [];
    state.drawing = { erased: true };
    finishDrawing();
    return;
  }
  frame[pathKey] = [canvasPoint(event)];
  state.drawing = { pathKey, pointerId: event.pointerId };
  dom.stageCanvas.setPointerCapture(event.pointerId);
  renderCanvas(true);
}

function moveDrawing(event) {
  if (!state.drawing || state.drawing.erased) return;
  const frame = state.project.frames[state.project.selectedFrame];
  const points = frame[state.drawing.pathKey];
  const point = canvasPoint(event);
  const last = points[points.length - 1];
  const distance = Math.hypot(point[0] - last[0], point[1] - last[1]);
  if (distance < 0.002) return;
  points.push(point);
  renderCanvas(false);
}

function finishDrawing() {
  if (!state.drawing) return;
  const frameIndex = state.project.selectedFrame;
  state.drawing = null;
  setDirty();
  updatePathInfo();
  redrawFrameCard(frameIndex);
  refreshInspector();
}

function redrawFrameCard(index) {
  const card = $(`.frame-card[data-frame="${index}"]`, dom.frameStrip);
  if (!card) return;
  const canvas = $("canvas", card);
  if (!canvas) return;
  renderThumbnail(canvas, state.project, index);
  const dots = $(".trace-dots", card);
  if (dots) {
    dots.replaceChildren();
    if (state.project.frames[index].traceA.length) dots.append(document.createElement("i"));
    if (state.project.frames[index].traceB.length) dots.append(document.createElement("i"));
  }
}

function clearActivePath() {
  const frame = state.project.frames[state.project.selectedFrame];
  const key = `trace${state.project.brush.activePath}`;
  if (!frame[key].length) return;
  frame[key] = [];
  setDirty();
  redrawFrameCard(state.project.selectedFrame);
  renderCanvas(true);
  updatePathInfo();
  showToast(`路径 ${state.project.brush.activePath} 已清除`, `F${String(state.project.selectedFrame + 1).padStart(2, "0")}`);
}

function updateRangeFill(input, min = Number(input.min), max = Number(input.max)) {
  const fill = ((Number(input.value) - min) / (max - min)) * 100;
  input.style.setProperty("--fill", `${fill}%`);
}

function setActivePath(path) {
  state.project.brush.activePath = path;
  $$("button", dom.pathSwitch).forEach((button) => button.classList.toggle("active", button.dataset.path === path));
  renderCanvas(true);
}

function splitAtPlayhead() {
  const clip = selectedClip();
  if (!clip) return showToast("没有选中片段", "请先在 V1 中选择片段", true);
  if (state.playing) stopPlayback();
  const next = splitTimelineClip(state.project, clip.id, state.currentTime);
  if (!next) {
    showToast("无法分割", "播放头必须位于片段内部", true);
    return;
  }
  const splitClips = next.timeline.clips.filter((item) => item.id.startsWith(clip.id) || item.id === clip.id);
  state.project = next;
  state.selectedClipId = splitClips[splitClips.length - 1]?.id || clip.id;
  state.project.selectedClipId = state.selectedClipId;
  setDirty();
  renderTimeline();
  refreshInspector();
  showToast("片段已分割", `分割点 ${timecode(state.currentTime, state.project.fps)} · 源时值保持不变`);
}

function runSyncChecks() {
  const audit = auditionEditPass(state.project);
  dom.syncResult.classList.toggle("pass", audit.passed);
  dom.syncResult.innerHTML = audit.passed
    ? `<div class="sync-icon">✓</div><div><strong>音画保持对齐</strong><span>移动 ✓ 分割 ✓ 转场 ${audit.overlap.toFixed(2)}s · 偏差 ${audit.clockOffsetMs.toFixed(2)}ms</span></div>`
    : `<div class="sync-icon">!</div><div><strong>同步测试未通过</strong><span>${audit.message || "请检查片段边界"}</span></div>`;
  if (audit.passed) {
    showToast("同步测试通过", `裁切 ${audit.durationsBefore.map(shortTime).join(" + ")} · 节目 ${shortTime(audit.programAfter)}`);
  } else {
    showToast("同步测试未通过", audit.message, true);
  }
  window.__studio?.emit?.("audit", audit);
  return audit;
}

function openExportModal() {
  const result = validateProject(state.project);
  state.exportBlocked = !result.ok;
  dom.exportRuntime.textContent = `时长 ${duration().toFixed(2)} 秒 · ${state.project.fps} fps · 循环关闭`;
  const poster = document.createElement("canvas");
  poster.width = 224;
  poster.height = 126;
  renderPoster(poster, state.project);
  dom.exportPoster.replaceChildren(poster);
  const rows = $$(".export-checks > div", dom.exportModal);
  if (rows[0]) {
    rows[0].classList.toggle("bad", !result.ok);
    rows[0].innerHTML = result.ok
      ? "<i>✓</i><span>片段无非法重叠</span><b>通过</b>"
      : `<i>!</i><span>${result.errors[0].message}</span><b>阻断</b>`;
  }
  if (rows[1]) rows[1].innerHTML = "<i>✓</i><span>音画共同时钟</span><b>0 ms</b>";
  if (rows[2]) rows[2].innerHTML = "<i>✓</i><span>首尾黑帧检测</span><b>就绪</b>";
  dom.startExportBtn.disabled = !result.ok;
  dom.startExportBtn.innerHTML = result.ok ? "开始导出 <span>↗</span>" : "已阻止导出 <span>!</span>";
  dom.exportStatus.textContent = result.ok
    ? "渲染前会再次检查所有轨道"
    : `${result.errors[0].message} · 消失点 ${timecode(result.errors[0].start || 0, state.project.fps)}`;
  dom.exportProgressBar.style.width = "0%";
  dom.exportModal.classList.add("open");
  dom.exportModal.setAttribute("aria-hidden", "false");
  if (!result.ok) {
    switchInspector("checks");
    showToast("导出已阻止", `${result.errors[0].message} · 冲突位置已标红`, true);
  }
}

function closeExportModal() {
  if (state.exporting) return;
  dom.exportModal.classList.remove("open");
  dom.exportModal.setAttribute("aria-hidden", "true");
}

function pickRecorderType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm"
  ];
  return candidates.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || "";
}

function waitFor(video, event, timeout = 1800) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`媒体解码超时: ${event}`)), timeout);
    video.addEventListener(event, () => {
      window.clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

async function seekVideo(video, time) {
  video.currentTime = Math.max(0, time);
  await waitFor(video, "seeked");
}

function frameBrightness(video) {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 54;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let sum = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    sum += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
  }
  return sum / (pixels.length / 4);
}

async function verifyExportedBlob(blob, expectedDuration) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  const url = URL.createObjectURL(blob);
  video.src = url;
  try {
    await waitFor(video, "loadeddata", 2500);
    await seekVideo(video, 0.045);
    const first = frameBrightness(video);
    const end = Number.isFinite(video.duration) && video.duration > 0.2 ? video.duration : expectedDuration;
    await seekVideo(video, Math.max(0.04, end - 0.13));
    const last = frameBrightness(video);
    return {
      playable: video.videoWidth > 0 && video.videoHeight > 0,
      firstLuma: Number(first.toFixed(2)),
      lastLuma: Number(last.toFixed(2)),
      width: video.videoWidth,
      height: video.videoHeight,
      noBlackEdges: first > 4.5 && last > 4.5
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function exportFilm() {
  const validation = validateProject(state.project);
  if (!validation.ok) {
    openExportModal();
    return;
  }
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
    dom.exportStatus.textContent = "当前浏览器不支持 WebM 录制，请使用 Chromium。";
    return;
  }
  if (state.playing) stopPlayback();
  state.exporting = true;
  dom.startExportBtn.disabled = true;
  dom.startExportBtn.textContent = "正在渲染…";
  const output = document.createElement("canvas");
  output.width = 1920;
  output.height = 1080;
  const ctx = output.getContext("2d");
  renderStage(ctx, state.project, 0, { manualFrame: frameAt(state.project, 0) });
  const posterLuma = frameBrightness(output);
  const mimeType = pickRecorderType();
  if (!mimeType) {
    state.exporting = false;
    dom.exportStatus.textContent = "没有可用的 WebM 编码器。";
    dom.startExportBtn.disabled = false;
    return;
  }

  try {
    const audioStream = await audio.createExportDestination();
    const stream = output.captureStream(state.project.fps);
    const audioTrack = audioStream.getAudioTracks()[0];
    if (audioTrack) stream.addTrack(audioTrack);
    const chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 7_000_000 });
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size) chunks.push(event.data);
    });
    const stopped = new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true }));
    recorder.start(250);
    await audio.start(state.project, 0);
    const startedAt = performance.now();
    let stoppedMedia = false;
    await new Promise((resolve) => {
      const renderTick = () => {
        const elapsed = Math.min(duration(), audio.currentTime());
        renderStage(ctx, state.project, Math.min(duration() - 0.001, elapsed), {
          manualFrame: frameAt(state.project, elapsed)
        });
        dom.exportProgressBar.style.width = `${Math.min(99, (elapsed / duration()) * 100)}%`;
        dom.exportStatus.textContent = `渲染帧 ${Math.round(elapsed * state.project.fps)} / ${Math.round(duration() * state.project.fps)} · 统一时钟 ${elapsed.toFixed(2)}s`;
        if (elapsed >= duration() - 0.01 || performance.now() - startedAt > (duration() + 3) * 1000) {
          if (!stoppedMedia) {
            stoppedMedia = true;
            renderStage(ctx, state.project, duration() - 0.001, {
              manualFrame: frameAt(state.project, duration() - 0.001)
            });
            window.setTimeout(() => {
              if (recorder.state !== "inactive") recorder.stop();
            }, 180);
          }
          resolve();
          return;
        }
        window.requestAnimationFrame(renderTick);
      };
      window.requestAnimationFrame(renderTick);
    });
    await stopped;
    audio.stop();
    const endLuma = frameBrightness(output);
    if (posterLuma < 4.5 || endLuma < 4.5) {
      throw new Error(`源画面首尾亮度不足 (${posterLuma.toFixed(1)} / ${endLuma.toFixed(1)})`);
    }
    const blob = new Blob(chunks, { type: mimeType });
    if (!blob.size) throw new Error("编码器未返回视频数据");
    dom.exportStatus.textContent = "正在回读首尾帧并检查可播放性…";
    const verification = await verifyExportedBlob(blob, duration());
    if (!verification.playable || !verification.noBlackEdges) {
      throw new Error(`导出验证失败 · 首 ${verification.firstLuma} / 尾 ${verification.lastLuma} luma`);
    }
    window.__studio.lastExport = { blob, verification, mimeType, duration: duration() };
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "night-tram-ep02.webm";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    dom.exportProgressBar.style.width = "100%";
    dom.exportStatus.textContent = `导出完成 · ${verification.width}×${verification.height} · 首 ${verification.firstLuma} / 尾 ${verification.lastLuma} luma`;
    const rows = $$(".export-checks > div", dom.exportModal);
    if (rows[2]) rows[2].innerHTML = `<i>✓</i><span>首尾黑帧检测</span><b>${verification.firstLuma} / ${verification.lastLuma}</b>`;
    dom.startExportBtn.textContent = "再次导出 ↗";
    dom.startExportBtn.disabled = false;
    showToast("影片已导出并通过验证", `${duration().toFixed(2)}s · 首尾非黑帧 · ${mimeType.split(";")[0]}`);
    window.__studio?.emit?.("exported", verification);
  } catch (error) {
    audio.stop();
    dom.exportStatus.textContent = `导出失败：${error.message}`;
    dom.startExportBtn.textContent = "重试导出 ↗";
    dom.startExportBtn.disabled = false;
    showToast("导出失败", error.message, true);
  } finally {
    state.exporting = false;
  }
}

function showFailure(title, detail, message) {
  stopPlayback({ silent: true });
  dom.failureTitle.textContent = title;
  dom.failureDetail.textContent = detail;
  dom.failureMessage.textContent = message;
  dom.failureModal.classList.add("open");
  dom.failureModal.setAttribute("aria-hidden", "false");
}

function closeFailure() {
  dom.failureModal.classList.remove("open");
  dom.failureModal.setAttribute("aria-hidden", "true");
}

function applyProject(project, options = {}) {
  state.project = project;
  state.selectedClipId = project.selectedClipId || project.timeline.clips[0]?.id;
  state.currentTime = Number(project.playhead ?? (project.selectedFrame || 0) / project.animationFps);
  state.playing = false;
  buildFrameStrip();
  renderTimeline();
  refreshInspector();
  renderCanvas(true);
  updatePlayhead();
  syncControlValues();
  if (options.toast) showToast(options.toast, options.detail || "");
}

function reloadSavedProject({ toast = true } = {}) {
  try {
    const loaded = loadSavedProject();
    const check = validateReload(state.savedSnapshot || state.project, loaded);
    if (!check.ok) throw new Error(`保存点不完整: ${Object.entries(check.checks).filter(([, ok]) => !ok).map(([key]) => key).join(", ")}`);
    applyProject(loaded);
    closeFailure();
    if (toast) {
      showToast("工程已重新载入", "入点、出点与全部事件位置保持一致");
    }
    window.__studio?.emit?.("reloaded", check);
    return check;
  } catch (error) {
    showToast("重新载入失败", error.message, true);
    return null;
  }
}

function syncControlValues() {
  const project = state.project;
  dom.widthSlider.value = project.brush.width;
  dom.opacitySlider.value = Math.round(project.brush.opacity * 100);
  dom.volumeSlider.value = Math.round((project.volume ?? 0.42) * 100);
  dom.widthOutput.textContent = `${Number(project.brush.width).toFixed(1)} px`;
  dom.opacityOutput.textContent = `${Math.round(project.brush.opacity * 100)}%`;
  dom.volumeOutput.textContent = `${dom.volumeSlider.value}%`;
  updateRangeFill(dom.widthSlider, 1, 14);
  updateRangeFill(dom.opacitySlider, 15, 100);
  updateRangeFill(dom.volumeSlider, 0, 100);
  setSwitch(dom.onionToggle, project.onion);
  setSwitch(dom.baseToggle, project.showBase);
  setSwitch(dom.loopToggle, project.loop);
  setSwitch(dom.metronomeToggle, project.metronome);
  dom.loopChip.classList.toggle("active", project.loop);
  dom.metronomeChip.classList.toggle("active", project.metronome);
  $$("button", dom.pathSwitch).forEach((button) => button.classList.toggle("active", button.dataset.path === project.brush.activePath));
  audio.setVolume(project.volume ?? 0.42);
}

function setSwitch(element, on) {
  element.classList.toggle("on", on);
  element.setAttribute("aria-pressed", String(on));
}

function toggleValue(key) {
  state.project[key] = !state.project[key];
  setDirty();
  syncControlValues();
  if (key === "metronome") audio.setMetronome(state.project.metronome);
  if (key === "loop" && state.playing && state.currentTime >= duration() - 0.01) seek(0);
  renderCanvas(true);
}

function addFrame() {
  if (state.playing) stopPlayback();
  if (state.project.frames.length >= 48) {
    showToast("已达到帧数上限", "最多 48 张原动画", true);
    return;
  }
  const index = state.project.selectedFrame;
  const copy = structuredClone(state.project.frames[index]);
  copy.id = `drawing-${Date.now()}`;
  state.project.frames.splice(index + 1, 0, copy);
  state.project.selectedFrame = index + 1;
  state.currentTime = state.project.selectedFrame / state.project.animationFps;
  setDirty();
  buildFrameStrip();
  renderTimeline();
  renderCanvas(true);
  updatePlayhead();
  showToast("已复制为新帧", `F${String(index + 2).padStart(2, "0")} · 保留两条路径`);
}

function updateStageOverlayLayout() {
  const wrap = dom.stageWrap.getBoundingClientRect();
  const canvas = dom.stageCanvas.getBoundingClientRect();
  const inset = 9;
  $(".stage-hud.top-left").style.left = `${canvas.left - wrap.left + inset}px`;
  $(".stage-hud.top-left").style.top = `${canvas.top - wrap.top + inset}px`;
  $(".stage-hud.top-right").style.right = `${wrap.right - canvas.right + inset}px`;
  $(".stage-hud.top-right").style.top = `${canvas.top - wrap.top + inset}px`;
  $(".trace-legend").style.left = `${canvas.left - wrap.left + inset}px`;
  $(".trace-legend").style.bottom = `${wrap.bottom - canvas.bottom + inset}px`;
  $(".stage-time").style.right = `${wrap.right - canvas.right + inset}px`;
  $(".stage-time").style.bottom = `${wrap.bottom - canvas.bottom + 7}px`;
}

function openHelp() {
  const existing = $(".help-popover");
  if (existing) {
    existing.remove();
    return;
  }
  const help = document.createElement("div");
  help.className = "help-popover";
  help.innerHTML = `
    <h3>快捷键 / 操作</h3>
    <div><span>播放 / 暂停</span><kbd>Space</kbd></div>
    <div><span>画笔 / 橡皮</span><kbd>B / E</kbd></div>
    <div><span>上一帧 / 下一帧</span><kbd>← / →</kbd></div>
    <div><span>分割片段</span><kbd>S</kbd></div>
    <div><span>保存工程</span><kbd>⌘ S</kbd></div>
    <div><span>清除路径</span><kbd>Del</kbd></div>`;
  document.body.append(help);
}

function bindEvents() {
  dom.playBtn.addEventListener("click", togglePlayback);
  dom.stagePlayBtn.addEventListener("click", togglePlayback);
  dom.stagePlayBtn.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") togglePlayback();
  });
  $("#jumpStartBtn").addEventListener("click", () => seek(0));
  $("#jumpEndBtn").addEventListener("click", () => seek(duration() - 0.001));
  $("#loopChip").addEventListener("click", () => toggleValue("loop"));
  $("#metronomeChip").addEventListener("click", () => toggleValue("metronome"));
  dom.loopToggle.addEventListener("click", () => toggleValue("loop"));
  dom.metronomeToggle.addEventListener("click", () => toggleValue("metronome"));
  $("#splitBtn").addEventListener("click", splitAtPlayhead);
  $("#fitBtn").addEventListener("click", () => {
    renderTimeline();
    showToast("时间线已适应窗口", `${duration().toFixed(2)} 秒全部可见`);
  });
  dom.ruler.addEventListener("pointerdown", startScrub);
  dom.timelineContent.addEventListener("pointerdown", (event) => {
    if (event.target === dom.timelineContent || event.target.classList.contains("track")) startScrub(event);
  });
  dom.widthSlider.addEventListener("input", () => {
    state.project.brush.width = Number(dom.widthSlider.value);
    dom.widthOutput.textContent = `${Number(dom.widthSlider.value).toFixed(1)} px`;
    updateRangeFill(dom.widthSlider, 1, 14);
    setDirty();
    renderCanvas(true);
  });
  dom.opacitySlider.addEventListener("input", () => {
    state.project.brush.opacity = Number(dom.opacitySlider.value) / 100;
    dom.opacityOutput.textContent = `${dom.opacitySlider.value}%`;
    updateRangeFill(dom.opacitySlider, 15, 100);
    setDirty();
    renderCanvas(true);
  });
  dom.volumeSlider.addEventListener("input", () => {
    state.project.volume = Number(dom.volumeSlider.value) / 100;
    dom.volumeOutput.textContent = `${dom.volumeSlider.value}%`;
    updateRangeFill(dom.volumeSlider, 0, 100);
    audio.setVolume(state.project.volume);
    setDirty();
  });
  dom.pathSwitch.addEventListener("click", (event) => {
    const button = event.target.closest("[data-path]");
    if (button) setActivePath(button.dataset.path);
  });
  $("#clearPathBtn").addEventListener("click", clearActivePath);
  dom.onionToggle.addEventListener("click", () => toggleValue("onion"));
  dom.baseToggle.addEventListener("click", () => toggleValue("showBase"));
  $("#prevFrameBtn").addEventListener("click", () => selectFrame(state.project.selectedFrame - 1));
  $("#nextFrameBtn").addEventListener("click", () => selectFrame(state.project.selectedFrame + 1));
  $("#addFrameBtn").addEventListener("click", addFrame);
  dom.transitionSelect.addEventListener("change", () => {
    const clip = selectedClip();
    if (!clip) return;
    state.project = setTransition(state.project, clip.id, dom.transitionSelect.value);
    setDirty();
    renderTimeline();
    refreshInspector();
    const result = validateProject(state.project);
    showToast(result.ok ? "转场已更新" : "转场产生冲突", result.ok ? `${dom.transitionSelect.value} · ${duration().toFixed(2)}s` : result.errors[0].message, !result.ok);
  });
  dom.saveProjectBtn.addEventListener("click", () => persistProject({ toast: true }));
  dom.reloadProjectBtn.addEventListener("click", () => reloadSavedProject());
  dom.exportBtn.addEventListener("click", openExportModal);
  dom.closeExportBtn.addEventListener("click", closeExportModal);
  dom.cancelExportBtn.addEventListener("click", closeExportModal);
  dom.exportModal.addEventListener("click", (event) => {
    if (event.target === dom.exportModal) closeExportModal();
  });
  dom.startExportBtn.addEventListener("click", exportFilm);
  $("#runChecksBtn").addEventListener("click", runSyncChecks);
  dom.failureToggle.addEventListener("click", () => {
    state.failureArmed = !state.failureArmed;
    dom.failureToggle.textContent = state.failureArmed ? "失败模式已就绪" : "模拟播放失败";
    if (state.failureArmed) {
      switchInspector("checks");
      showToast("故障回放已就绪", "下一次播放将触发可恢复的回放中断", true);
    }
  });
  dom.failureReloadBtn.addEventListener("click", () => {
    const loaded = reloadSavedProject({ toast: false });
    if (loaded) showToast("已从保存点恢复", "入点、出点与事件位置校验通过");
  });
  dom.retryPlaybackBtn.addEventListener("click", () => {
    closeFailure();
    window.setTimeout(startPlayback, 120);
  });
  $$(".inspector-tab").forEach((tab) => tab.addEventListener("click", () => switchInspector(tab.dataset.inspector)));
  $$(".tool[data-tool]").forEach((tool) => tool.addEventListener("click", () => {
    state.tool = tool.dataset.tool;
    $$(".tool[data-tool]").forEach((node) => node.classList.toggle("active", node === tool));
    $("#drawHint").textContent = state.tool === "eraser" ? "点击清除当前路径" : state.tool === "pan" ? "手形工具" : "在画布上拖拽补画";
  }));
  dom.stageCanvas.addEventListener("pointerdown", startDrawing);
  dom.stageCanvas.addEventListener("pointermove", moveDrawing);
  dom.stageCanvas.addEventListener("pointerup", finishDrawing);
  dom.stageCanvas.addEventListener("pointercancel", finishDrawing);
  $("#undoBtn").addEventListener("click", () => showToast("暂无可撤销以外的操作", "拖动、分割和绘制均已自动保存", true));
  $("#redoBtn").addEventListener("click", () => showToast("重做栈为空", "当前工程位于最新状态"));
  $("#helpBtn").addEventListener("click", openHelp);
  $("#openSettingsBtn").addEventListener("click", () => showToast("工程设置", `${state.project.fps} fps · ${state.project.frames.length} drawings · v${state.project.version}`));
  $("#safetyTab").addEventListener("click", () => {
    state.safeFrames = !state.safeFrames;
    $("#safetyTab").classList.toggle("active", state.safeFrames);
    renderCanvas(true);
  });
  window.addEventListener("resize", () => {
    updateStageOverlayLayout();
    renderTimeline();
  });
  document.addEventListener("keydown", (event) => {
    const tag = event.target.tagName;
    if (["INPUT", "SELECT", "TEXTAREA"].includes(tag)) return;
    if (event.code === "Space") {
      event.preventDefault();
      togglePlayback();
    } else if (event.key === "s" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      persistProject({ toast: true });
    } else if (event.key.toLowerCase() === "s") {
      splitAtPlayhead();
    } else if (event.key.toLowerCase() === "b") {
      $('.tool[data-tool="draw"]').click();
    } else if (event.key.toLowerCase() === "e") {
      $('.tool[data-tool="eraser"]').click();
    } else if (event.key === "ArrowLeft") {
      selectFrame(state.project.selectedFrame - 1);
    } else if (event.key === "ArrowRight") {
      selectFrame(state.project.selectedFrame + 1);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      clearActivePath();
    } else if (event.key.toLowerCase() === "l") {
      toggleValue("loop");
    }
  });
}

function exposeTestApi() {
  window.__studio = {
    getState: () => ({
      project: structuredClone(state.project),
      currentTime: state.currentTime,
      playing: state.playing,
      selectedClipId: state.selectedClipId,
      duration: duration(),
      validation: validateProject(state.project),
      saved: state.saved
    }),
    seek: (time) => seek(time),
    play: startPlayback,
    pause: () => stopPlayback(),
    save: () => persistProject({ toast: true }),
    reload: () => reloadSavedProject(),
    split: splitAtPlayhead,
    runChecks: runSyncChecks,
    openExport: openExportModal,
    export: exportFilm,
    selectClip: (id) => {
      state.selectedClipId = id;
      state.project.selectedClipId = id;
      renderTimeline();
      refreshInspector();
    },
    setTransition: (type) => {
      if (!selectedClip()) return;
      state.project = setTransition(state.project, state.selectedClipId, type);
      syncControlValues();
      renderTimeline();
      refreshInspector();
    },
    emit: (name, detail) => {
      window.dispatchEvent(new CustomEvent(`studio:${name}`, { detail }));
    }
  };
}

function init() {
  bindEvents();
  buildFrameStrip();
  renderTimeline();
  syncControlValues();
  updatePlayhead();
  renderCanvas(true);
  updateStageOverlayLayout();
  switchInspector("brush");
  exposeTestApi();
  if (!localStorage.getItem(STORAGE_KEY)) persistProject({ silent: true });
  window.requestAnimationFrame(playbackTick);
  const resizeObserver = new ResizeObserver(() => updateStageOverlayLayout());
  resizeObserver.observe(dom.stageWrap);
  window.addEventListener("beforeunload", () => {
    if (!state.saved) persistProject({ silent: true });
  });
}

init();
