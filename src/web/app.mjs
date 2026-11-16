import { TimelineClock, nearestBeat, BEAT_INTERVAL } from "../core/timebase.mjs";
import {
  applyOp,
  validateProject,
  sortedClips,
  clipEnd,
  projectDuration,
  buildShotList,
  CAMERAS,
} from "../core/project.mjs";
import { buildDemoProject } from "../core/demo.mjs";
import { drawFrame } from "../core/scene.mjs";
import { composeFrame } from "../core/composer.mjs";
import { checkCutBeatSync } from "../core/audio.mjs";
import { Journal } from "../core/journal.mjs";
import { saveProject, loadProject, serializeSave, parseSave, diffPositions } from "../core/persistence.mjs";
import { verifyExport } from "../core/exporter.mjs";
import { AudioEngine } from "./audio-engine.mjs";
import { exportVideo, downloadText } from "./video-export.mjs";

const $ = (id) => document.getElementById(id);

const state = {
  project: null,
  journal: null,
  clock: null,
  audio: new AudioEngine(),
  selectedId: null,
  validation: null
};

function fmt(time) {
  const m = Math.floor(time / 60);
  const s = time % 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
}

function setStatus(text, tone = "info") {
  const el = $("status");
  el.textContent = text;
  el.style.color = tone === "error" ? "#ff9db0" : tone === "ok" ? "#93e6ab" : "#8fb3ff";
}

function dispatch(operation) {
  const result = applyOp(state.project, operation);
  state.journal.record(operation, result);
  if (!result.ok) {
    setStatus(`操作被阻止：${result.error}`, "error");
    refreshPanels();
    return false;
  }
  state.project = result.project;
  state.clock.setDuration(projectDuration(state.project));
  state.audio.setProgram(state.project, projectDuration(state.project));
  refreshPanels();
  return true;
}

function refreshPanels() {
  state.validation = validateProject(state.project);
  renderConflictList();
  renderShotList();
  renderJournal();
  drawTimeline();
}

function renderConflictList() {
  const ul = $("conflictList");
  ul.innerHTML = "";
  if (state.validation.conflicts.length === 0) {
    const li = document.createElement("li");
    li.className = "ok";
    li.textContent = "无冲突，时间线连续且全部切点对齐节拍";
    ul.appendChild(li);
  }
  for (const conflict of state.validation.conflicts) {
    const li = document.createElement("li");
    li.className = conflict.severity;
    li.textContent = `[${conflict.type}] t=${conflict.at.toFixed(2)}s — ${conflict.message}`;
    ul.appendChild(li);
  }
  const sync = checkCutBeatSync(state.project);
  const li = document.createElement("li");
  li.className = sync.synced ? "ok" : "error";
  li.textContent = sync.synced
    ? `音画同步：${sync.rows.length} 个切点全部落在节拍上，最大漂移 0s`
    : `音画失步：最大漂移 ${sync.maxDrift.toFixed(3)}s`;
  ul.appendChild(li);
}

function renderShotList() {
  const host = $("shotList");
  host.innerHTML = "";
  for (const shot of buildShotList(state.project)) {
    const row = document.createElement("div");
    row.className = "shot-row";
    row.innerHTML =
      `<span>#${shot.shot}</span><span>${shot.camera}</span>` +
      `<span>${fmt(shot.inPoint)}→${fmt(shot.outPoint)} · ${shot.transition}</span>`;
    host.appendChild(row);
  }
}

function renderJournal() {
  const host = $("journal");
  host.innerHTML = "";
  for (const entry of state.journal.entries.slice(-30)) {
    const row = document.createElement("div");
    row.className = `journal-row ${entry.ok ? "ok" : "fail"}`;
    row.textContent = `#${entry.seq} ${entry.operation.type} ${
      entry.ok ? "✓" : `✗ ${entry.error}`
    }`;
    host.appendChild(row);
  }
}

const TL = { padX: 70, rulerH: 34, trackY: 52, trackH: 54, audioY: 132, subY: 190 };

function timelineGeometry(canvas) {
  const duration = Math.max(projectDuration(state.project), 1);
  const usable = canvas.width - TL.padX * 2;
  return {
    duration,
    xOf: (t) => TL.padX + (t / duration) * usable,
    timeAt: (x) => Math.max(0, ((x - TL.padX) / usable) * duration),
    usable
  };
}

function drawTimeline() {
  const canvas = $("timeline");
  const ctx = canvas.getContext("2d");
  const geo = timelineGeometry(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 节拍刻度（与音频事件同一网格）
  ctx.font = "11px monospace";
  for (let t = 0; t <= geo.duration + 1e-9; t += BEAT_INTERVAL) {
    const x = geo.xOf(t);
    ctx.strokeStyle = t % 1 < 1e-9 ? "#3a445a" : "#242c3c";
    ctx.beginPath();
    ctx.moveTo(x, 10);
    ctx.lineTo(x, canvas.height - 10);
    ctx.stroke();
    if (t % 1 < 1e-9) {
      ctx.fillStyle = "#7d869a";
      ctx.fillText(`${t}s`, x + 3, 22);
    }
  }

  // 视频轨道片段
  for (const clip of sortedClips(state.project)) {
    const x = geo.xOf(clip.start);
    const w = Math.max(2, geo.xOf(clipEnd(clip)) - x);
    const camera = CAMERAS.find((c) => c.id === clip.cameraId);
    const selected = clip.id === state.selectedId;
    ctx.fillStyle = `hsl(${camera.hue} 60% ${selected ? 42 : 30}%)`;
    ctx.fillRect(x, TL.trackY, w, TL.trackH);
    ctx.strokeStyle = selected ? "#ffffff" : "#00000066";
    ctx.strokeRect(x, TL.trackY, w, TL.trackH);
    ctx.fillStyle = "#fff";
    ctx.font = "12px sans-serif";
    ctx.fillText(camera.label, x + 8, TL.trackY + 22);
    ctx.font = "10px monospace";
    ctx.fillText(
      `${clip.start.toFixed(2)}–${clipEnd(clip).toFixed(2)} ${clip.transition.type}`,
      x + 8,
      TL.trackY + 40
    );
    if (clip.transition.type !== "cut") {
      const tx = geo.xOf(clip.start);
      ctx.fillStyle = "#ffd54a";
      ctx.beginPath();
      ctx.moveTo(tx, TL.trackY - 8);
      ctx.lineTo(tx - 6, TL.trackY - 18);
      ctx.lineTo(tx + 6, TL.trackY - 18);
      ctx.closePath();
      ctx.fill();
    }
  }

  // 音频事件轨道
  ctx.fillStyle = "#7d869a";
  ctx.fillText("音频", 18, TL.audioY + 14);
  for (const event of state.audio.events) {
    const x = geo.xOf(event.time);
    ctx.fillStyle = event.kind === "cue" ? "#ffd54a" : event.kind === "kick" ? "#57b8ff" : "#6d7a96";
    ctx.beginPath();
    ctx.arc(x, TL.audioY + 12, event.kind === "cue" ? 6 : 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // 字幕轨道
  ctx.fillStyle = "#7d869a";
  ctx.fillText("字幕", 18, TL.subY + 14);
  for (const sub of state.project.subtitles) {
    const x = geo.xOf(sub.start);
    const w = geo.xOf(sub.end) - x;
    ctx.fillStyle = "#2c4a35";
    ctx.fillRect(x, TL.subY, w, 30);
    ctx.fillStyle = "#bfe8c8";
    ctx.font = "11px sans-serif";
    ctx.fillText(sub.text, x + 6, TL.subY + 19);
  }

  // 冲突位置红色标记
  for (const conflict of state.validation?.conflicts ?? []) {
    if (conflict.severity !== "error" || conflict.at === undefined) continue;
    const x = geo.xOf(conflict.at);
    ctx.fillStyle = "#ff4d6a";
    ctx.beginPath();
    ctx.moveTo(x, TL.trackY + TL.trackH + 4);
    ctx.lineTo(x - 7, TL.trackY + TL.trackH + 18);
    ctx.lineTo(x + 7, TL.trackY + TL.trackH + 18);
    ctx.closePath();
    ctx.fill();
  }

  // 播放头（节目时间线、画面、音频共用的唯一时间）
  const px = geo.xOf(state.clock.time);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(px, 8);
  ctx.lineTo(px, canvas.height - 8);
  ctx.stroke();
  ctx.lineWidth = 1;
}

function drawPreviews(time) {
  for (const camera of CAMERAS) {
    const ctx = $(camera.id).getContext("2d");
    // 三路机位使用同一个节目时间 -> 场景动画连续，切镜不重置
    drawFrame(ctx, {
      time,
      cameraId: camera.id,
      width: 320,
      height: 180
    });
  }
  const programCtx = $("program").getContext("2d");
  const resolution = composeFrame(programCtx, state.project, time, { width: 320, height: 180 });
  const active = resolution.layers.at(-1)?.clip;
  $("programLabel").textContent = active
    ? `· ${CAMERAS.find((c) => c.id === active.cameraId).label}`
    : "· 无画面";
  $("timecode").textContent = `${fmt(time)} / ${fmt(projectDuration(state.project))}`;
}

function frameLoop() {
  const time = state.clock.tick();
  state.audio.update(time);
  drawPreviews(time);
  drawTimeline();
  requestAnimationFrame(frameLoop);
}

function selectedClip() {
  return state.project.clips.find((c) => c.id === state.selectedId) ?? null;
}

function bindControls() {
  $("playBtn").addEventListener("click", () => {
    state.clock.play();
    state.audio.start(state.clock.time);
    setStatus(`播放中（${state.clock.loop ? "循环" : "单次"}）`);
  });
  $("pauseBtn").addEventListener("click", () => {
    state.clock.pause();
    state.audio.stop();
    setStatus("已暂停");
  });
  $("loopBtn").addEventListener("click", (e) => {
    state.clock.loop = !state.clock.loop;
    e.target.textContent = `循环：${state.clock.loop ? "开" : "关"}`;
  });

  $("splitBtn").addEventListener("click", () => {
    const clip = selectedClip();
    if (!clip) return setStatus("请先在时间线上选择一个片段", "error");
    const at = state.clock.time;
    if (at <= clip.start || at >= clipEnd(clip)) {
      return setStatus("播放头不在选中片段内部，无法分割", "error");
    }
    dispatch({ type: "splitClip", id: clip.id, at });
  });

  const setTransition = (type) => {
    const clip = selectedClip();
    if (!clip) return setStatus("请先选择切点后的片段", "error");
    dispatch({ type: "setTransition", id: clip.id, transition: type });
  };
  $("cutBtn").addEventListener("click", () => setTransition("cut"));
  $("dissolveBtn").addEventListener("click", () => setTransition("dissolve"));
  $("dipBtn").addEventListener("click", () => setTransition("dip"));

  $("overlapBtn").addEventListener("click", () => {
    const clip = selectedClip() ?? sortedClips(state.project).at(-1);
    // 故意前移 1.5s 制造超出转场允许范围的重叠
    dispatch({ type: "overlapClip", id: clip.id, start: Math.max(0, clip.start - 1.5) });
  });

  $("verifyBtn").addEventListener("click", () => {
    const report = verifyExport(state.project);
    if (report.exportable) {
      setStatus(
        `校验通过：${report.frameCount} 帧，黑帧 ${report.blackFrames.length}，首尾无黑帧`,
        "ok"
      );
    } else {
      setStatus(`导出被阻止：${report.conflicts.filter((c) => c.severity === "error").length} 处错误`, "error");
    }
    refreshPanels();
  });

  $("exportBtn").addEventListener("click", async (e) => {
    e.target.disabled = true;
    setStatus("正在逐帧录制 WebM 并生成镜头表…");
    const result = await exportVideo(state.project, {
      onProgress: (p) => setStatus(`导出进度 ${(p * 100).toFixed(0)}%`)
    });
    e.target.disabled = false;
    if (!result.ok) {
      setStatus("导出被阻止：请先消除时间线上标出的冲突", "error");
    } else {
      setStatus(`导出完成：${result.bytes} 字节 WebM + shot-list.csv，首尾无黑帧`, "ok");
    }
  });

  $("saveBtn").addEventListener("click", () => {
    const info = saveProject(localStorage, state.project, state.journal);
    setStatus(`工程已保存到 localStorage（${info.bytes} 字节）`, "ok");
  });

  $("loadBtn").addEventListener("click", () => {
    const loaded = loadProject(localStorage);
    if (!loaded) return setStatus("没有已保存的工程", "error");
    const diff = diffPositions(state.project, loaded.project);
    applyLoaded(loaded);
    setStatus(diff.identical
      ? "重载成功：入点/出点/事件位置与保存前完全一致"
      : "重载成功，但点位与当前工程存在差异",
      diff.identical ? "ok" : "error");
  });

  $("downloadBtn").addEventListener("click", () => {
    downloadText(serializeSave(state.project, state.journal), "project.json", "application/json");
  });
  $("importBtn").addEventListener("click", () => $("fileInput").click());
  $("fileInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const loaded = parseSave(await file.text());
      applyLoaded(loaded);
      setStatus("工程文件导入成功", "ok");
    } catch (error) {
      setStatus(`导入失败：${error.message}`, "error");
    }
  });

  $("replayBtn").addEventListener("click", () => {
    const replay = state.journal.replay();
    const failed = replay.trace.filter((t) => !t.ok);
    state.project = replay.project;
    state.clock.setDuration(projectDuration(state.project));
    state.audio.setProgram(state.project, projectDuration(state.project));
    refreshPanels();
    setStatus(`操作回放完成：${replay.trace.length} 条，其中 ${failed.length} 条被拦截`,
      failed.length ? "error" : "ok");
  });
}

function applyLoaded(loaded) {
  state.project = loaded.project;
  state.journal = loaded.journal;
  state.selectedId = null;
  state.clock.setDuration(projectDuration(state.project));
  state.clock.seek(0);
  state.audio.setProgram(state.project, projectDuration(state.project));
  refreshPanels();
}

function bindTimeline() {
  const canvas = $("timeline");
  let dragging = null;

  const pickClip = (offsetX) => {
    const geo = timelineGeometry(canvas);
    return sortedClips(state.project).find((clip) => {
      const x = geo.xOf(clip.start);
      const w = geo.xOf(clipEnd(clip)) - x;
      return offsetX >= x && offsetX <= x + w;
    }) ?? null;
  };

  canvas.addEventListener("mousedown", (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const geo = timelineGeometry(canvas);
    const clip = pickClip(x);
    if (clip) {
      state.selectedId = clip.id;
      dragging = { id: clip.id, startX: x, originalStart: clip.start };
    } else {
      state.clock.seek(geo.timeAt(x));
      state.audio.stop();
      state.clock.pause();
    }
    drawTimeline();
  });

  canvas.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const geo = timelineGeometry(canvas);
    const delta = geo.timeAt(x) - geo.timeAt(dragging.startX);
    const target = nearestBeat(dragging.originalStart + delta, state.project.beatInterval);
    const clip = state.project.clips.find((c) => c.id === dragging.id);
    if (clip && Math.abs(target - clip.start) > 1e-9) {
      if (dispatch({ type: "moveClip", id: dragging.id, start: target })) {
        dragging.originalStart = target;
        dragging.startX = x;
      }
    }
  });

  window.addEventListener("mouseup", () => { dragging = null; });
}

function boot() {
  const demo = buildDemoProject();
  state.project = demo.project;
  state.journal = demo.journal;
  const duration = projectDuration(state.project);
  state.clock = new TimelineClock({
    duration,
    loop: true,
    perfNow: () => performance.now()
  });
  state.clock.onLoop = () => state.audio.loop(0);
  state.audio.setProgram(state.project, duration);
  bindControls();
  bindTimeline();
  refreshPanels();
  drawPreviews(0);
  requestAnimationFrame(frameLoop);
}

boot();
