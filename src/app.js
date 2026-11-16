import {
  EASINGS,
  PROJECT_KEY,
  buildKeyframeExport,
  clamp,
  clone,
  createDefaultProject,
  durationReport,
  hydrateProject,
  moveGroup,
  roundTime,
  runEditSelfTest,
  serializeProject,
  setKeyframe,
  setTimelineRange,
  splitGroupAt,
  validateProject,
} from "./model.js";
import { AudioEngine } from "./audio.js";
import { renderComposite, renderOverview, timecode } from "./render.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  previewCanvas: $("#previewCanvas"),
  overviewCanvas: $("#overviewCanvas"),
  keyframeList: $("#keyframeList"),
  keyframeCount: $("#keyframeCount"),
  selectedKeyframeTime: $("#selectedKeyframeTime"),
  kfX: $("#kfX"),
  kfY: $("#kfY"),
  kfRotation: $("#kfRotation"),
  kfZoom: $("#kfZoom"),
  kfEasing: $("#kfEasing"),
  pathWarning: $("#pathWarning"),
  pathWarningText: $("#pathWarningText"),
  pathCanvasWarning: $("#pathCanvasWarning"),
  currentCameraMeta: $("#currentCameraMeta"),
  programDuration: $("#programDuration"),
  durationA: $("#durationA"),
  durationB: $("#durationB"),
  durationTransition: $("#durationTransition"),
  durationAText: $("#durationAText"),
  durationBText: $("#durationBText"),
  transitionText: $("#transitionText"),
  videoRange: $("#videoRange"),
  audioRange: $("#audioRange"),
  avDelta: $("#avDelta"),
  assembledDuration: $("#assembledDuration"),
  syncPill: $("#syncPill"),
  validationDot: $("#validationDot"),
  validationCopy: $("#validationCopy"),
  conflictList: $("#conflictList"),
  testScore: $("#testScore"),
  testResults: $("#testResults"),
  runSelfTestBtn: $("#runSelfTestBtn"),
  playButton: $("#playButton"),
  playGlyph: $("#playGlyph"),
  scrubber: $("#scrubber"),
  loopToggle: $("#loopToggle"),
  transportTimecode: $("#transportTimecode"),
  canvasTimecode: $("#canvasTimecode"),
  canvasFrameLabel: $("#canvasFrameLabel"),
  transportStatus: $("#transportStatus"),
  timelineBody: $("#timelineBody"),
  rulerLane: $("#rulerLane"),
  videoLane: $("#videoLane"),
  subtitleLane: $("#subtitleLane"),
  animationLane: $("#animationLane"),
  audioLane: $("#audioLane"),
  conflictLayer: $("#conflictLayer"),
  playhead: $("#playhead"),
  playheadLabel: $("#playheadLabel"),
  selectionReadout: $("#selectionReadout"),
  inPointInput: $("#inPointInput"),
  outPointInput: $("#outPointInput"),
  splitClipBtn: $("#splitClipBtn"),
  nudgeLeftBtn: $("#nudgeLeftBtn"),
  nudgeRightBtn: $("#nudgeRightBtn"),
  saveProjectBtn: $("#saveProjectBtn"),
  loadProjectBtn: $("#loadProjectBtn"),
  exportJsonBtn: $("#exportJsonBtn"),
  exportVideoBtn: $("#exportVideoBtn"),
  resetDemoBtn: $("#resetDemoBtn"),
  saveState: $("#saveState"),
  binaryStatus: $("#binaryStatus"),
  projectName: $("#projectName"),
  overviewScale: $("#overviewScale"),
  toast: $("#toast"),
  exportOverlay: $("#exportOverlay"),
  exportStepLabel: $("#exportStepLabel"),
  exportTitle: $("#exportTitle"),
  exportDescription: $("#exportDescription"),
  exportProgressBar: $("#exportProgressBar"),
  exportPercent: $("#exportPercent"),
  exportPreview: $("#exportPreview"),
  exportResult: $("#exportResult"),
  exportResultDetail: $("#exportResultDetail"),
  downloadVideoLink: $("#downloadVideoLink"),
  cancelExportBtn: $("#cancelExportBtn"),
  closeExportBtn: $("#closeExportBtn"),
};

let project;
let restoredFromSave = false;
try {
  const saved = localStorage.getItem(PROJECT_KEY);
  if (saved) {
    project = hydrateProject(saved);
    restoredFromSave = true;
  }
} catch (error) {
  console.warn("Saved project could not be restored", error);
}
project ??= createDefaultProject();

const state = {
  selectedKeyframeId: project.camera.keyframes[0]?.id,
  selectedGroupId: project.timeline.videoClips[0]?.groupId,
  validation: null,
  report: null,
  savedSnapshot: restoredFromSave ? JSON.stringify(project) : null,
  playing: false,
  raf: 0,
  lastTick: 0,
  audio: new AudioEngine(),
  audioFailed: false,
  toastTimer: 0,
  exportAbort: false,
  exportUrl: "",
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fmt(value, digits = 2) {
  return Number(value).toFixed(digits);
}

function showToast(message, variant = "") {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.className = `toast show ${variant}`.trim();
  state.toastTimer = setTimeout(() => {
    elements.toast.className = "toast";
  }, 3800);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function markDirty() {
  const snapshot = JSON.stringify(project);
  if (snapshot !== state.savedSnapshot) {
    elements.saveState.textContent = "未保存更改";
    elements.saveState.classList.remove("saved");
  }
}

function markSaved() {
  state.savedSnapshot = JSON.stringify(project);
  elements.saveState.textContent = "已保存到本地";
  elements.saveState.classList.add("saved");
}

function pausePlayback() {
  if (!state.playing) return;
  state.playing = false;
  cancelAnimationFrame(state.raf);
  state.audio.stop();
  elements.playButton.classList.remove("playing");
  elements.playButton.setAttribute("aria-label", "播放");
  elements.transportStatus.textContent = "PAUSED";
}

function checkSavedState() {
  if (state.savedSnapshot && JSON.stringify(project) === state.savedSnapshot) markSaved();
  else markDirty();
}

function refreshState({ preserveTest = false } = {}) {
  state.validation = validateProject(project);
  state.report = durationReport(project);
  elements.inPointInput.value = fmt(project.timeline.inPoint, 2);
  elements.outPointInput.value = fmt(project.timeline.outPoint, 2);
  elements.loopToggle.checked = project.timeline.loop;
  elements.scrubber.min = project.timeline.inPoint;
  elements.scrubber.max = project.timeline.outPoint;
  elements.scrubber.value = project.timeline.playhead;
  elements.projectName.textContent = project.meta.name;
  renderKeyframes();
  renderInspector();
  renderDuration();
  renderValidation();
  renderTimeline();
  if (!preserveTest) {
    elements.testResults.classList.add("hidden");
    elements.testScore.textContent = "—";
    elements.testScore.className = "test-score";
  }
  checkSavedState();
  drawFrame();
}

function replaceProject(next, message) {
  pausePlayback();
  project = next;
  const firstKeyframe = project.camera.keyframes[0]?.id;
  if (!project.camera.keyframes.some((item) => item.id === state.selectedKeyframeId)) {
    state.selectedKeyframeId = firstKeyframe;
  }
  if (!project.timeline.videoClips.some((clip) => clip.groupId === state.selectedGroupId)) {
    state.selectedGroupId = project.timeline.videoClips[0]?.groupId;
  }
  refreshState();
  if (message) showToast(message, "success");
}

function saveProject() {
  try {
    localStorage.setItem(PROJECT_KEY, serializeProject(project));
    markSaved();
    showToast("工程已保存。入点、出点和事件位置已写入本地工程。", "success");
  } catch (error) {
    showToast(`保存失败：${error.message}`, "error");
  }
}

function loadProject() {
  try {
    const saved = localStorage.getItem(PROJECT_KEY);
    if (!saved) {
      showToast("本地还没有保存的工程，请先点击“保存工程”。", "warning");
      return;
    }
    replaceProject(hydrateProject(saved), "已重新载入保存工程，时间锚点保持不变。");
    state.savedSnapshot = JSON.stringify(project);
    markSaved();
  } catch (error) {
    showToast(`载入失败：${error.message}`, "error");
  }
}

function renderKeyframes() {
  const frames = [...project.camera.keyframes].sort((a, b) => a.time - b.time);
  elements.keyframeCount.textContent = String(frames.length).padStart(2, "0");
  elements.keyframeList.innerHTML = frames
    .map((frame, index) => {
      const active = frame.id === state.selectedKeyframeId ? " active" : "";
      return `
        <button class="keyframe-item${active}" type="button" data-keyframe-id="${frame.id}">
          <span class="keyframe-index">0${index + 1}</span>
          <span class="keyframe-meta">
            <strong>${fmt(frame.x, 0)} / ${fmt(frame.y, 0)}</strong>
            <small>${EASINGS[frame.easing] || frame.easing} · ZOOM ${fmt(frame.zoom, 2)}×</small>
          </span>
          <span class="keyframe-time">${timecode(frame.time)}</span>
        </button>
      `;
    })
    .join("");
}

function renderInspector() {
  const frame = project.camera.keyframes.find((item) => item.id === state.selectedKeyframeId)
    ?? project.camera.keyframes[0];
  if (!frame) return;
  state.selectedKeyframeId = frame.id;
  elements.selectedKeyframeTime.textContent = timecode(frame.time);
  elements.kfX.value = fmt(frame.x, 0);
  elements.kfY.value = fmt(frame.y, 0);
  elements.kfRotation.value = fmt(frame.rotation, 1);
  elements.kfZoom.value = fmt(frame.zoom, 2);
  elements.kfEasing.value = frame.easing;
  const pathConflicts = state.validation.conflicts.filter((item) => item.id === "path-out-of-stage");
  elements.pathWarning.classList.toggle("hidden", !pathConflicts.length);
  elements.pathCanvasWarning.classList.toggle("hidden", !pathConflicts.length);
  if (pathConflicts.length) {
    elements.pathWarningText.textContent =
      `${fmt(pathConflicts[0].start, 2)}–${fmt(pathConflicts[0].end, 2)}s 的取景框超出 1200×675 舞台。`;
  }
}

function renderDuration() {
  const report = state.report;
  const firstClips = report.clips.filter((clip) => clip.groupId.startsWith("shot-a"));
  const secondClips = report.clips.filter((clip) => clip.groupId.startsWith("shot-b"));
  const durationA = firstClips.reduce((total, clip) => total + clip.duration, 0);
  const durationB = secondClips.reduce((total, clip) => total + clip.duration, 0);
  elements.programDuration.textContent = fmt(report.programDuration, 3);
  elements.durationA.style.flex = String(Math.max(0.01, durationA));
  elements.durationB.style.flex = String(Math.max(0.01, durationB));
  elements.durationTransition.style.flex = String(Math.max(0.01, report.transitionDuration));
  elements.durationAText.textContent = `${fmt(durationA, 2)}s`;
  elements.durationBText.textContent = `${fmt(durationB, 2)}s`;
  elements.transitionText.textContent = `${fmt(report.transitionDuration, 2)}s`;
  elements.videoRange.textContent = `${fmt(report.videoStart)}–${fmt(report.videoEnd)}`;
  elements.audioRange.textContent = `${fmt(report.audioStart)}–${fmt(report.audioEnd)}`;
  elements.avDelta.textContent = `${Math.round(report.delta * 1000)} ms`;
  elements.assembledDuration.textContent = `${fmt(report.assembledVideoDuration)} s`;
  elements.syncPill.textContent = report.aligned ? "SYNC" : "DRIFT";
  elements.syncPill.classList.toggle("bad", !report.aligned);
}

function renderValidation() {
  const { errors, warnings, exportable } = state.validation;
  const all = [...errors, ...warnings];
  elements.validationDot.className = `status-dot ${exportable ? "ok" : "bad"}`;
  elements.validationCopy.className = `validation-copy${exportable ? "" : " bad"}`;
  if (exportable && warnings.length) {
    elements.validationCopy.innerHTML =
      `<strong>可导出 · ${warnings.length} 条提醒</strong><p>软警告不会阻止导出；非法重叠会立即锁定导出。</p>`;
  } else if (exportable) {
    elements.validationCopy.innerHTML =
      "<strong>可以导出</strong><p>8 秒节目、音画范围和转场覆盖均有效。</p>";
  } else {
    elements.validationCopy.innerHTML =
      `<strong>导出已阻止 · ${errors.length} 处冲突</strong><p>请修正时间线中标红的非法重叠或音画偏移。</p>`;
  }
  elements.conflictList.innerHTML = all
    .map(
      (conflict) => `
        <div class="conflict-item ${conflict.severity === "warning" ? "warning" : ""}">
          <span class="conflict-time">${timecode(conflict.start)}</span>
          <p>${escapeHtml(conflict.message)}</p>
        </div>
      `,
    )
    .join("");
  elements.exportJsonBtn.disabled = !exportable;
  elements.exportVideoBtn.disabled = !exportable;
  elements.exportJsonBtn.title = exportable ? "导出关键帧 JSON" : "存在冲突，导出已阻止";
  elements.exportVideoBtn.title = exportable ? "导出 8 秒 WebM" : "存在冲突，导出已阻止";
  elements.binaryStatus.textContent =
    `${exportable ? "EXPORT ARMED" : "EXPORT BLOCKED"} / ${Math.round(state.report.programDuration * project.stage.fps)} FRAMES`;
}

function timelinePercent(time) {
  const start = project.timeline.inPoint;
  const duration = Math.max(0.001, project.timeline.outPoint - start);
  return ((time - start) / duration) * 100;
}

function renderTimeline() {
  const range = Math.max(0.001, project.timeline.outPoint - project.timeline.inPoint);
  const ticks = Math.round(range * 2);
  elements.rulerLane.innerHTML = "";
  for (let index = 0; index <= ticks; index += 1) {
    const value = project.timeline.inPoint + index * 0.5;
    const percent = ((value - project.timeline.inPoint) / range) * 100;
    const major = Math.abs(value - Math.round(value)) < 0.001;
    const tick = document.createElement("span");
    tick.className = `ruler-tick${major ? " major" : ""}`;
    tick.style.left = `${percent}%`;
    elements.rulerLane.append(tick);
    if (major) {
      const label = document.createElement("span");
      label.className = "ruler-label-text";
      label.style.left = `${percent}%`;
      label.textContent = `${Math.round(value)}s`;
      elements.rulerLane.append(label);
    }
  }

  elements.videoLane.innerHTML = project.timeline.videoClips
    .map((clip) => {
      const left = timelinePercent(clip.start);
      const width = (clip.duration / range) * 100;
      const selected = clip.groupId === state.selectedGroupId ? " selected" : "";
      const variant = clip.variant === "flow" || clip.groupId.startsWith("shot-b") ? " b" : "";
      const letter = clip.variant === "flow" || clip.groupId.startsWith("shot-b") ? "B" : "A";
      return `
        <div class="lane-item video-clip${variant}${selected}" style="left:${left}%;width:${width}%"
          data-group-id="${clip.groupId}" title="${escapeHtml(clip.name)} · ${fmt(clip.duration)}s">
          <span class="clip-letter">${letter}</span>
          <span class="clip-copy">
            <strong>${escapeHtml(clip.name)}</strong>
            <small>${fmt(clip.start)} → ${fmt(clip.start + clip.duration)}s</small>
          </span>
          <span class="clip-links">V↔A</span>
        </div>
      `;
    })
    .join("");

  elements.videoLane.insertAdjacentHTML(
    "beforeend",
    project.timeline.transitions
      .map(
        (transition) => `
          <div class="lane-item transition-clip" style="left:${timelinePercent(transition.start)}%;width:${(transition.duration / range) * 100}%"
            title="${escapeHtml(transition.label)} ${fmt(transition.duration)}s">
            <span>XFADE ${fmt(transition.duration)}s</span>
          </div>
        `,
      )
      .join(""),
  );

  elements.subtitleLane.innerHTML = project.timeline.subtitleClips
    .map(
      (clip) => `
        <div class="lane-item subtitle-clip" style="left:${timelinePercent(clip.start)}%;width:${(clip.duration / range) * 100}%"
          title="${escapeHtml(clip.text)}">
          <b>${escapeHtml(clip.kicker)}</b>${escapeHtml(clip.text)}
        </div>
      `,
    )
    .join("");

  const frames = [...project.camera.keyframes].sort((a, b) => a.time - b.time);
  const start = frames[0]?.time ?? project.timeline.inPoint;
  const end = frames.at(-1)?.time ?? project.timeline.outPoint;
  elements.animationLane.innerHTML = `
    <span class="animation-line" style="left:${timelinePercent(start)}%;width:${Math.max(0, timelinePercent(end) - timelinePercent(start))}%"></span>
    ${frames
      .map(
        (frame, index) => `
          <span class="keyframe-stem" style="left:${timelinePercent(frame.time)}%"></span>
          <button class="keyframe-marker${frame.id === state.selectedKeyframeId ? " active" : ""}"
            style="left:${timelinePercent(frame.time)}%"
            data-timeline-keyframe="${frame.id}" type="button"
            aria-label="关键帧 ${index + 1}"></button>
        `,
      )
      .join("")}
  `;

  const wavePattern = [8, 15, 22, 12, 29, 18, 10, 24, 32, 17, 11, 20, 28, 14, 23, 9, 26, 18, 31, 13, 21, 16, 27, 10, 19, 30, 14, 22, 11, 25, 17, 8];
  elements.audioLane.innerHTML = project.timeline.audioClips
    .map((clip) => {
      const selected = clip.groupId === state.selectedGroupId ? " selected" : "";
      const variant = clip.groupId.startsWith("shot-b") ? " b" : "";
      const bars = wavePattern
        .map(
          (height, index) =>
            `<i class="wave-bar" style="height:${Math.max(2, height * (0.4 + ((index + clip.id.length) % 7) / 10))}px"></i>`,
        )
        .join("");
      return `
        <div class="lane-item audio-clip${variant}${selected}" style="left:${timelinePercent(clip.start)}%;width:${(clip.duration / range) * 100}%"
          data-group-id="${clip.groupId}" title="${escapeHtml(clip.name)} · ${fmt(clip.duration)}s">
          <span class="audio-clip-label">${escapeHtml(clip.name)} / ${clip.tone.toUpperCase()}</span>
          ${bars}
        </div>
      `;
    })
    .join("");
  elements.audioLane.insertAdjacentHTML(
    "beforeend",
    project.timeline.audioEvents
      .map(
        (event) => `
          <span class="audio-event" style="left:${timelinePercent(event.at)}%" title="${escapeHtml(event.label)} @ ${fmt(event.at, 3)}s">
            <span>${escapeHtml(event.label)}</span>
          </span>
        `,
      )
      .join(""),
  );

  elements.conflictLayer.innerHTML = state.validation.conflicts
    .map((conflict) => {
      const left = timelinePercent(conflict.start);
      const width = Math.max(
        0.16,
        timelinePercent(conflict.end) - timelinePercent(conflict.start),
      );
      return `<span class="conflict-region${conflict.severity === "warning" ? " warning" : ""}"
        style="left:${left}%;width:${width}%" title="${escapeHtml(conflict.message)}"></span>`;
    })
    .join("");

  const selectedVideo = project.timeline.videoClips.find(
    (clip) => clip.groupId === state.selectedGroupId,
  );
  elements.selectionReadout.textContent = selectedVideo
    ? `${selectedVideo.name} · ${state.selectedGroupId}`
    : "未选择片段";
  updatePlayheadUI();
}

function updatePlayheadUI() {
  const time = project.timeline.playhead;
  const percent = clamp(timelinePercent(time), -1, 101);
  elements.playhead.style.left = `calc(102px + ((100% - 102px) * ${percent / 100}))`;
  elements.playheadLabel.textContent = fmt(time, 3);
  elements.scrubber.value = time;
  elements.transportTimecode.textContent = timecode(time);
  elements.canvasTimecode.textContent = timecode(time);
  const frame = Math.max(1, Math.round(time * project.stage.fps) + 1);
  elements.canvasFrameLabel.textContent =
    `FRAME ${String(frame).padStart(3, "0")} / ${Math.round(state.report.programDuration * project.stage.fps)}`;
  $$(".keyframe-marker").forEach((marker) => {
    marker.classList.toggle(
      "active",
      marker.dataset.timelineKeyframe === state.selectedKeyframeId,
    );
  });
}

function drawFrame() {
  const time = project.timeline.playhead;
  const result = renderComposite(elements.previewCanvas, project, time);
  renderOverview(
    elements.overviewCanvas,
    project,
    time,
    state.selectedKeyframeId,
  );
  elements.currentCameraMeta.textContent =
    `CAM 01 · X ${Math.round(result.camera.x)} · Y ${Math.round(result.camera.y)} · R ${fmt(result.camera.rotation, 1)}°`;
  elements.overviewScale.textContent = `${Math.round(result.camera.zoom * 100)}%`;
  updatePlayheadUI();
}

function seekTo(time, options = {}) {
  const wasPlaying = state.playing;
  if (!options.keepPlaying) pausePlayback();
  project.timeline.playhead = roundTime(
    clamp(time, project.timeline.inPoint, project.timeline.outPoint),
  );
  drawFrame();
  if (wasPlaying && options.keepPlaying) {
    state.audio.start(project, project.timeline.playhead, {
      until: project.timeline.outPoint,
    }).catch(() => {});
  }
  if (!state.playing) {
    elements.transportStatus.textContent = "SEEK";
    setTimeout(() => {
      if (!state.playing) elements.transportStatus.textContent = "READY";
    }, 650);
  }
}

function startPlayback() {
  if (project.timeline.playhead >= project.timeline.outPoint - 0.001) {
    project.timeline.playhead = project.timeline.inPoint;
  }
  state.playing = true;
  state.audioFailed = false;
  state.lastTick = performance.now();
  elements.playButton.classList.add("playing");
  elements.playButton.setAttribute("aria-label", "暂停");
  elements.transportStatus.textContent = "PLAY";
  state.audio.start(project, project.timeline.playhead, {
    until: project.timeline.outPoint,
  }).catch((error) => {
    state.audioFailed = true;
    elements.transportStatus.textContent = "SILENT";
    elements.transportStatus.title = `音频回放失败：${error.message}；画面仍可继续预览。`;
    showToast(`音频回放失败，已降级为静音预览：${error.message}`, "warning");
  });
  cancelAnimationFrame(state.raf);
  state.raf = requestAnimationFrame(tickPlayback);
}

function tickPlayback(now) {
  if (!state.playing) return;
  const delta = Math.min(0.12, (now - state.lastTick) / 1000);
  state.lastTick = now;
  let next = project.timeline.playhead + delta;
  if (next >= project.timeline.outPoint) {
    if (project.timeline.loop) {
      next = project.timeline.inPoint;
      state.audio.stop();
      state.audio.start(project, next, {
        until: project.timeline.outPoint,
      }).catch(() => {
        state.audioFailed = true;
        elements.transportStatus.textContent = "SILENT";
      });
    } else {
      project.timeline.playhead = project.timeline.outPoint;
      drawFrame();
      pausePlayback();
      elements.transportStatus.textContent = "END";
      return;
    }
  }
  project.timeline.playhead = roundTime(next);
  drawFrame();
  state.raf = requestAnimationFrame(tickPlayback);
}

function togglePlayback() {
  if (state.playing) {
    pausePlayback();
    elements.transportStatus.textContent = "PAUSED";
  } else {
    startPlayback();
  }
}

function commitKeyframeField(key, rawValue) {
  const frame = project.camera.keyframes.find((item) => item.id === state.selectedKeyframeId);
  if (!frame) return;
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return;
  let next = value;
  if (key === "zoom") next = clamp(value, 0.55, 2.6);
  if (key === "rotation") next = clamp(value, -45, 45);
  setKeyframe(project, frame.id, { [key]: next });
  refreshState();
}

function selectKeyframe(id, seek = false) {
  state.selectedKeyframeId = id;
  const frame = project.camera.keyframes.find((item) => item.id === id);
  if (frame && seek) seekTo(frame.time);
  renderKeyframes();
  renderInspector();
  renderTimeline();
  drawFrame();
}

function selectGroup(groupId) {
  state.selectedGroupId = groupId;
  renderTimeline();
}

function setRangeFromInputs() {
  const inPoint = Number(elements.inPointInput.value);
  const outPoint = Number(elements.outPointInput.value);
  if (!Number.isFinite(inPoint) || !Number.isFinite(outPoint)) {
    showToast("入点和出点必须是有效数字。", "error");
    return;
  }
  pausePlayback();
  setTimelineRange(project, inPoint, outPoint);
  if (project.timeline.playhead < inPoint) project.timeline.playhead = inPoint;
  refreshState();
}

function exportKeyframeJson() {
  if (!state.validation.exportable) {
    showToast("存在非法重叠或音画冲突，关键帧 JSON 导出已阻止。", "error");
    return;
  }
  const payload = buildKeyframeExport(project, state.validation);
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  downloadBlob(blob, "frame08-camera-keyframes.json");
  showToast("关键帧 JSON 已导出，包含入点、出点、事件位置与时长核算。", "success");
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function waitForEvent(target, event, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`等待 ${event} 超时`));
    }, timeout);
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("视频解码失败"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(event, onEvent);
      target.removeEventListener("error", onError);
    };
    target.addEventListener(event, onEvent, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}

function sampleVideoFrame(video) {
  const canvas = document.createElement("canvas");
  canvas.width = 80;
  canvas.height = 45;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let total = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    total += pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722;
  }
  return total / (pixels.length / 4);
}

async function inspectExportedVideo(blob) {
  const video = elements.exportPreview;
  const url = URL.createObjectURL(blob);
  video.src = url;
  video.muted = true;
  video.load();
  await waitForEvent(video, "loadeddata", 7000);
  const knownDuration = Number.isFinite(video.duration) && video.duration > 0
    ? video.duration
    : state.report.programDuration;

  video.currentTime = 0.04;
  await waitForEvent(video, "seeked", 4000);
  const startLuma = sampleVideoFrame(video);

  const endSeek = Math.max(0.1, Math.min(knownDuration - 0.06, state.report.programDuration - 0.06));
  video.currentTime = endSeek;
  await waitForEvent(video, "seeked", 4000);
  const endLuma = sampleVideoFrame(video);
  const noBlackFrames = startLuma > 7 && endLuma > 7;
  return {
    url,
    duration: knownDuration,
    startLuma,
    endLuma,
    noBlackFrames,
    playable: true,
  };
}

function setExportProgress(progress, step, description) {
  const percent = clamp(progress, 0, 1);
  elements.exportProgressBar.style.width = `${percent * 100}%`;
  elements.exportPercent.textContent = `${Math.round(percent * 100)}%`;
  if (step) elements.exportStepLabel.textContent = step;
  if (description) elements.exportDescription.textContent = description;
}

function cleanupExportRuntime() {
  const runtime = state.exportRuntime;
  if (!runtime) return;
  try {
    runtime.engine?.stop();
  } catch {
    // Audio nodes may already be stopped.
  }
  for (const track of runtime.combinedStream?.getTracks() ?? []) track.stop();
  for (const track of runtime.captureStream?.getTracks() ?? []) track.stop();
  runtime.audioContext?.close().catch(() => {});
  state.exportRuntime = null;
}

function cancelExport() {
  if (!state.exportRuntime) return;
  state.exportAbort = true;
  try {
    if (state.exportRuntime.recorder?.state !== "inactive") {
      state.exportRuntime.recorder.stop();
    }
  } catch {
    // Recorder can already be inactive after a decode error.
  }
  elements.exportOverlay.classList.add("hidden");
  showToast("已取消导出。工程与播放头状态未被修改。", "warning");
}

async function exportVideo() {
  if (!state.validation.exportable) {
    showToast("存在非法重叠，已阻止 WebM 导出。红色标记即为冲突位置。", "error");
    return;
  }
  if (state.exportRuntime) return;
  pausePlayback();
  state.exportAbort = false;
  elements.exportOverlay.classList.remove("hidden");
  elements.exportResult.classList.add("hidden");
  elements.exportPreview.classList.add("hidden");
  elements.exportPreview.removeAttribute("src");
  elements.exportTitle.textContent = "正在渲染 8 秒节目";
  elements.exportDescription.textContent = "从第 0 帧开始捕获画面与音轨，不做静音降级。";
  elements.downloadVideoLink.removeAttribute("href");
  setExportProgress(0, "PREPARING", "从第 0 帧开始捕获画面与音轨，不做静音降级。");

  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = 1280;
  exportCanvas.height = 720;
  const inPoint = project.timeline.inPoint;
  const duration = project.timeline.outPoint - inPoint;
  const context = exportCanvas.getContext("2d", { alpha: false });
  renderComposite(exportCanvas, project, inPoint, { exportMode: true });

  try {
    if (!exportCanvas.captureStream || !window.MediaRecorder) {
      throw new Error("当前浏览器不支持 Canvas WebM 导出");
    }
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) throw new Error("当前浏览器不支持音轨导出");

    const captureStream = exportCanvas.captureStream(project.stage.fps);
    const audioContext = new Context({ latencyHint: "interactive" });
    await audioContext.resume();
    const destination = audioContext.createMediaStreamDestination();
    const engine = new AudioEngine();
    const combinedStream = new MediaStream([
      ...captureStream.getVideoTracks(),
      ...destination.stream.getAudioTracks(),
    ]);
    if (!combinedStream.getAudioTracks().length) {
      throw new Error("无法建立导出音轨");
    }

    const mimeCandidates = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    const mimeType = mimeCandidates.find((item) => MediaRecorder.isTypeSupported(item));
    if (!mimeType) throw new Error("没有可用的 WebM 编码器");
    const recorder = new MediaRecorder(combinedStream, {
      mimeType,
      videoBitsPerSecond: 5_000_000,
      audioBitsPerSecond: 128_000,
    });
    const chunks = [];
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) chunks.push(event.data);
    });
    const stopped = new Promise((resolve) => {
      recorder.addEventListener("stop", resolve, { once: true });
    });

    state.exportRuntime = {
      recorder,
      captureStream,
      combinedStream,
      audioContext,
      destination,
      engine,
    };
    setExportProgress(0.01, "RECORDING", "画面与音频同时开始，播放头使用同一时间基准。");
    recorder.start(250);
    await engine.start(project, inPoint, {
      context: audioContext,
      destination,
      until: project.timeline.outPoint,
    });

    await new Promise((resolve, reject) => {
      const startedAt = performance.now();
      function renderTick() {
        if (state.exportAbort) {
          reject(new Error("导出已取消"));
          return;
        }
        const elapsed = (performance.now() - startedAt) / 1000;
        const time = inPoint + Math.min(duration, elapsed);
        renderComposite(exportCanvas, project, time, { exportMode: true });
        const progress = Math.min(1, elapsed / duration);
        if (progress > 0.015) {
          setExportProgress(
            progress,
            progress > 0.94 ? "FINALIZING" : "RECORDING",
            progress > 0.94
              ? "正在写入尾帧并封装 WebM。"
              : "画面、字幕、动画和音频事件共用播放头时间。",
          );
        }
        if (elapsed >= duration) {
          renderComposite(exportCanvas, project, project.timeline.outPoint, { exportMode: true });
          resolve();
          return;
        }
        requestAnimationFrame(renderTick);
      }
      requestAnimationFrame(renderTick);
    });

    if (recorder.state !== "inactive") recorder.stop();
    await stopped;
    setExportProgress(0.97, "VERIFYING", "检查 WebM 可播放性与首尾画面亮度。");
    const blob = new Blob(chunks, { type: mimeType.split(";")[0] });
    if (blob.size < 1000) throw new Error("导出的 WebM 数据为空");

    const inspection = await inspectExportedVideo(blob);
    const detail = inspection.noBlackFrames
      ? `可播放 · 首尾亮度 ${Math.round(inspection.startLuma)} / ${Math.round(inspection.endLuma)} · 无黑帧`
      : `可播放，但首尾亮度异常（${Math.round(inspection.startLuma)} / ${Math.round(inspection.endLuma)}）`;
    elements.exportStepLabel.textContent = inspection.noBlackFrames ? "COMPLETE / VERIFIED" : "COMPLETE / WARNING";
    elements.exportTitle.textContent = "节目导出完成";
    elements.exportDescription.textContent = "WebM 与音频轨已封装。关键帧 JSON 可从顶栏单独导出。";
    elements.exportPreview.classList.remove("hidden");
    elements.exportPreview.controls = true;
    elements.exportResult.classList.remove("hidden");
    elements.exportResultDetail.textContent = detail;
    elements.downloadVideoLink.href = inspection.url;
    elements.downloadVideoLink.download = "frame08-program.webm";
    setExportProgress(1, elements.exportStepLabel.textContent, elements.exportDescription.textContent);
    downloadBlob(blob, "frame08-program.webm");
    if (!inspection.noBlackFrames) {
      showToast("WebM 已生成，但首尾亮度检测未通过。", "warning");
    } else {
      showToast("8 秒 WebM 已导出，并已验证可播放、首尾无黑帧。", "success");
    }
  } catch (error) {
    elements.exportOverlay.classList.add("hidden");
    showToast(`导出失败：${error.message}`, "error");
  } finally {
    cleanupExportRuntime();
    state.exportAbort = false;
  }
}

function runAlignmentSelfTest() {
  pausePlayback();
  const result = runEditSelfTest(project);
  elements.testResults.classList.remove("hidden");
  elements.testScore.textContent = result.pass ? "PASS" : "FAIL";
  elements.testScore.className = `test-score ${result.pass ? "pass" : "fail"}`;
  elements.testResults.innerHTML = result.results
    .map(
      (item) => `
        <div class="test-result ${item.pass ? "" : "fail"}">
          <i>${item.pass ? "✓" : "!"}</i>
          <div>
            <strong>${escapeHtml(item.label)}</strong>
            <small>${escapeHtml(item.detail)}</small>
          </div>
        </div>
      `,
    )
    .join("");
  showToast(
    result.pass
      ? "移动、分割、转场与事件锚定自检全部通过。"
      : "自检发现音画或时长不一致，请查看结果。",
    result.pass ? "success" : "error",
  );
}

function handleTimelineScrub(event, lane) {
  const rect = lane.getBoundingClientRect();
  const percent = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  const time = project.timeline.inPoint + percent * (project.timeline.outPoint - project.timeline.inPoint);
  seekTo(time);
}

function bindScrubber(lane) {
  lane.addEventListener("pointerdown", (event) => {
    if (event.target.closest("[data-group-id]")) return;
    if (event.target.closest("[data-timeline-keyframe]")) return;
    if (event.button !== 0) return;
    pausePlayback();
    handleTimelineScrub(event, lane);
    lane.setPointerCapture?.(event.pointerId);
    const move = (moveEvent) => handleTimelineScrub(moveEvent, lane);
    const up = () => {
      lane.removeEventListener("pointermove", move);
      lane.removeEventListener("pointerup", up);
      lane.removeEventListener("pointercancel", up);
    };
    lane.addEventListener("pointermove", move);
    lane.addEventListener("pointerup", up);
    lane.addEventListener("pointercancel", up);
  });
}

function bindTimelineSelection() {
  [elements.videoLane, elements.audioLane].forEach((lane) => {
    lane.addEventListener("click", (event) => {
      const clip = event.target.closest("[data-group-id]");
      if (clip) {
        pausePlayback();
        selectGroup(clip.dataset.groupId);
      }
    });
  });
  elements.animationLane.addEventListener("click", (event) => {
    const marker = event.target.closest("[data-timeline-keyframe]");
    if (marker) {
      pausePlayback();
      selectKeyframe(marker.dataset.timelineKeyframe, true);
    }
  });
  elements.keyframeList.addEventListener("click", (event) => {
    const item = event.target.closest("[data-keyframe-id]");
    if (item) {
      pausePlayback();
      selectKeyframe(item.dataset.keyframeId, true);
    }
  });
}

function bindKeyframeEditing() {
  elements.kfEasing.innerHTML = Object.entries(EASINGS)
    .map(([key, label]) => `<option value="${key}">${label} · ${key}</option>`)
    .join("");
  [
    [elements.kfX, "x"],
    [elements.kfY, "y"],
    [elements.kfRotation, "rotation"],
    [elements.kfZoom, "zoom"],
  ].forEach(([input, key]) => {
    input.addEventListener("change", () => {
      pausePlayback();
      commitKeyframeField(key, input.value);
    });
  });
  elements.kfEasing.addEventListener("change", () => {
    const frame = project.camera.keyframes.find((item) => item.id === state.selectedKeyframeId);
    if (!frame) return;
    setKeyframe(project, frame.id, { easing: elements.kfEasing.value });
    refreshState();
  });

  let dragging = false;
  let pendingEvent = null;
  function updateFromPointer(event) {
    const rect = elements.overviewCanvas.getBoundingClientRect();
    const x = clamp(
      ((event.clientX - rect.left) / rect.width) * project.stage.width,
      -180,
      project.stage.width + 180,
    );
    const y = clamp(
      ((event.clientY - rect.top) / rect.height) * project.stage.height,
      -180,
      project.stage.height + 180,
    );
    setKeyframe(project, state.selectedKeyframeId, { x: Math.round(x), y: Math.round(y) });
    refreshState();
  }
  elements.overviewCanvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    pausePlayback();
    dragging = true;
    elements.overviewCanvas.setPointerCapture?.(event.pointerId);
    updateFromPointer(event);
  });
  elements.overviewCanvas.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    pendingEvent = event;
    if (pendingEvent.__queued) return;
    pendingEvent.__queued = true;
    requestAnimationFrame(() => {
      if (pendingEvent) updateFromPointer(pendingEvent);
      pendingEvent = null;
    });
  });
  const stopDragging = () => {
    dragging = false;
    pendingEvent = null;
  };
  elements.overviewCanvas.addEventListener("pointerup", stopDragging);
  elements.overviewCanvas.addEventListener("pointercancel", stopDragging);
  elements.overviewCanvas.addEventListener("lostpointercapture", stopDragging);
}

function bindActions() {
  elements.playButton.addEventListener("click", togglePlayback);
  elements.scrubber.addEventListener("input", () => {
    pausePlayback();
    seekTo(Number(elements.scrubber.value));
  });
  elements.loopToggle.addEventListener("change", () => {
    project.timeline.loop = elements.loopToggle.checked;
    markDirty();
    showToast(
      project.timeline.loop ? "循环已开启，播放到出点后回到入点。" : "循环已关闭。",
    );
  });
  elements.saveProjectBtn.addEventListener("click", saveProject);
  elements.loadProjectBtn.addEventListener("click", loadProject);
  elements.exportJsonBtn.addEventListener("click", exportKeyframeJson);
  elements.exportVideoBtn.addEventListener("click", exportVideo);
  elements.resetDemoBtn.addEventListener("click", () => {
    replaceProject(createDefaultProject(), "示例工程已恢复。");
  });
  elements.runSelfTestBtn.addEventListener("click", runAlignmentSelfTest);
  elements.inPointInput.addEventListener("change", setRangeFromInputs);
  elements.outPointInput.addEventListener("change", setRangeFromInputs);
  elements.splitClipBtn.addEventListener("click", () => {
    if (!state.selectedGroupId) {
      showToast("请先在视频轨或音频轨选择一个联动片段。", "warning");
      return;
    }
    pausePlayback();
    try {
      splitGroupAt(project, state.selectedGroupId, project.timeline.playhead);
      refreshState();
      showToast("已在播放头处分割视频、音频与联动组。", "success");
    } catch (error) {
      showToast(`无法分割：${error.message}`, "error");
    }
  });
  const nudge = (delta) => {
    if (!state.selectedGroupId) {
      showToast("请先选择一个联动片段。", "warning");
      return;
    }
    pausePlayback();
    moveGroup(project, state.selectedGroupId, delta);
    refreshState();
    if (state.validation.errors.length) {
      showToast(
        `片段已移动，产生 ${state.validation.errors.length} 处冲突，导出已阻止。红色区域即冲突位置。`,
        "error",
      );
    } else {
      showToast(`所选片段整体移动 ${delta > 0 ? "+" : ""}${delta.toFixed(2)}s，音频同步。`, "success");
    }
  };
  elements.nudgeLeftBtn.addEventListener("click", () => nudge(-0.1));
  elements.nudgeRightBtn.addEventListener("click", () => nudge(0.1));
  elements.cancelExportBtn.addEventListener("click", cancelExport);
  elements.closeExportBtn.addEventListener("click", () => {
    elements.exportOverlay.classList.add("hidden");
  });

  $$(".ruler-lane, .track-lane").forEach(bindScrubber);
  bindTimelineSelection();

  window.addEventListener("keydown", (event) => {
    const target = event.target;
    const interactive = target instanceof HTMLElement &&
      target.closest("input, select, textarea, button, a");
    if (interactive) return;
    if (event.code === "Space") {
      event.preventDefault();
      togglePlayback();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      seekTo(project.timeline.playhead - (event.shiftKey ? 0.5 : 1 / project.stage.fps));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      seekTo(project.timeline.playhead + (event.shiftKey ? 0.5 : 1 / project.stage.fps));
    }
  });
}

function exposeTestApi() {
  window.studio = {
    getProject: () => clone(project),
    getState: () => ({
      playing: state.playing,
      playhead: project.timeline.playhead,
      validation: clone(state.validation),
      report: clone(state.report),
      saved: JSON.stringify(project) === state.savedSnapshot,
    }),
    seek: (time) => seekTo(time),
    save: saveProject,
    load: loadProject,
    splitAtPlayhead: () => {
      splitGroupAt(project, state.selectedGroupId, project.timeline.playhead);
      refreshState();
    },
    moveSelected: (delta) => {
      moveGroup(project, state.selectedGroupId, delta);
      refreshState();
    },
    exportKeyframeJson,
    exportVideo,
    selfTest: runAlignmentSelfTest,
  };
}

bindKeyframeEditing();
bindActions();
refreshState();
exposeTestApi();
elements.saveState.textContent = restoredFromSave ? "已恢复保存工程" : "未保存更改";
if (restoredFromSave) {
  elements.saveState.classList.add("saved");
  showToast("已自动载入上次保存的工程。", "success");
}
