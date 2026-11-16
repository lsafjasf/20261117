import { createStore } from "../src/core/store.js";
import { createInitialState, reducer, selectConflicts } from "../src/core/reducer.js";
import { createTicker, setPlayhead, play, pause, setLoop } from "../src/core/clock.js";
import { buildSampleProject } from "../src/core/sampleProject.js";
import { ThumbnailScheduler, buildVisibleThumbEntries, thumbKey } from "../src/core/thumbnails.js";
import { createCanvasFrameProvider } from "./canvas-frame.js";
import { renderTimeline, hitTestClip } from "./timeline-view.js";
import { renderFrame } from "../src/core/compositor.js";
import { saveProject, loadProject } from "../src/core/project.js";
import { downloadSelectedFrame, downloadProgram } from "./downloads.js";
import { compareDurations } from "../src/core/exporter.js";

const store = createStore(reducer, createInitialState(buildSampleProject()));
const ticker = createTicker(store);
ticker.start();

const els = {
  timeline: document.getElementById("timeline"),
  preview: document.getElementById("preview"),
  scroller: document.getElementById("scroller"),
  status: document.getElementById("status"),
  conflicts: document.getElementById("conflicts"),
  clock: document.getElementById("clock-readout"),
  thumbLog: document.getElementById("thumb-log"),
  report: document.getElementById("duration-report")
};

let selectedId = null;
let baselineExport = null;
let dragState = null;

const provider = createCanvasFrameProvider(store.getState().sources, {
  // 每一代第一次请求故意失败一次，用于演示失败回放与重试按钮。
  failPattern: (() => {
    let used = false;
    return (entry) => {
      if (!used && entry.srcTime > 6) { used = true; return true; }
      return false;
    };
  })()
});
const scheduler = new ThumbnailScheduler(store, provider);

function refreshThumbnails() {
  const state = store.getState();
  const entries = buildVisibleThumbEntries(state.timeline, state.view, els.scroller.clientWidth);
  scheduler.requestVisible(entries);
  renderThumbLog(entries);
}

function renderThumbLog(entries) {
  const state = store.getState();
  const fragment = document.createDocumentFragment();
  for (const entry of entries.slice(0, 12)) {
    const wrap = document.createElement("span");
    wrap.className = "thumb-item";
    const key = thumbKey(entry);
    const result = state.thumbnails.results[key];
    const job = state.thumbnails.jobs[key];
    if (result) wrap.appendChild(result.bitmap);
    else {
      const tag = document.createElement("span");
      tag.textContent = job?.status === "failed" ? "失败,待回放" : "加载中…";
      if (job?.status === "failed") tag.className = "failed";
      wrap.appendChild(tag);
    }
    const cap = document.createElement("div");
    cap.textContent = `${entry.srcTime.toFixed(1)}s ${entry.crop}`;
    wrap.appendChild(cap);
    fragment.appendChild(wrap);
  }
  els.thumbLog.replaceChildren(fragment);
}

function renderPreview() {
  const state = store.getState();
  const rgba = renderFrame(state.timeline, state.sources, state.clock.time, state.view.crop,
    els.preview.width, els.preview.height);
  const ctx = els.preview.getContext("2d");
  const image = ctx.createImageData(els.preview.width, els.preview.height);
  image.data.set(rgba);
  ctx.putImageData(image, 0, 0);
  els.clock.textContent = `${state.clock.time.toFixed(2)} s`;
}

function renderConflictPanel() {
  const conflicts = selectConflicts(store.getState());
  els.conflicts.textContent = conflicts.length
    ? `导出被阻止，冲突位置：\n${conflicts.map((item) =>
      `轨道 ${item.track} · ${item.start.toFixed(2)}s–${item.end.toFixed(2)}s · ${item.aId} × ${item.bId}`).join("\n")}`
    : "";
}

function renderAll() {
  renderTimeline(els.timeline, store.getState(), selectedId);
  renderPreview();
  renderConflictPanel();
  renderThumbLog(buildVisibleThumbEntries(store.getState().timeline, store.getState().view, els.scroller.clientWidth));
}

store.subscribe(() => renderAll());
refreshThumbnails();
renderAll();

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.style.color = isError ? "#ff8a8a" : "#7fd6a3";
}

els.timeline.addEventListener("click", (event) => {
  const rect = els.timeline.getBoundingClientRect();
  const clip = hitTestClip(store.getState(), event.clientX - rect.left);
  selectedId = clip ? clip.id : selectedId;
  if (!clip) {
    const t = (event.clientX - rect.left) / store.getState().view.pxPerSecond;
    store.dispatch(setPlayhead(t));
  }
  renderAll();
});

els.timeline.addEventListener("dblclick", (event) => {
  const rect = els.timeline.getBoundingClientRect();
  const clip = hitTestClip(store.getState(), event.clientX - rect.left);
  if (!clip) return;
  const t = (event.clientX - rect.left) / store.getState().view.pxPerSecond;
  store.dispatch({ type: "SPLIT_CLIP", clipId: clip.id, atTime: t });
  setStatus(store.getState().lastError ?? `已在 ${t.toFixed(2)}s 分割 ${clip.id}`, !!store.getState().lastError);
});

els.timeline.addEventListener("pointerdown", (event) => {
  const rect = els.timeline.getBoundingClientRect();
  const clip = hitTestClip(store.getState(), event.clientX - rect.left);
  if (!clip) return;
  selectedId = clip.id;
  dragState = { clipId: clip.id, startX: event.clientX, originalStart: clip.start };
  els.timeline.setPointerCapture(event.pointerId);
});

els.timeline.addEventListener("pointermove", (event) => {
  if (!dragState) return;
  const delta = (event.clientX - dragState.startX) / store.getState().view.pxPerSecond;
  const target = Math.round((dragState.originalStart + delta) * 100) / 100;
  const clip = store.getState().timeline.videos.find((item) => item.id === dragState.clipId);
  if (clip && Math.abs(target - clip.start) > 1e-6) {
    store.dispatch({ type: "MOVE_CLIP", clipId: dragState.clipId, newStart: target });
    if (store.getState().lastError) setStatus(store.getState().lastError, true);
  }
});

els.timeline.addEventListener("pointerup", () => { dragState = null; });

els.scroller.addEventListener("scroll", () => {
  store.dispatch({ type: "SET_SCROLL", scrollLeft: els.scroller.scrollLeft });
  refreshThumbnails();
});

document.getElementById("zoom").addEventListener("input", (event) => {
  store.dispatch({ type: "SET_ZOOM", pxPerSecond: Number(event.target.value) });
  refreshThumbnails();
});

document.getElementById("crop").addEventListener("change", (event) => {
  store.dispatch({ type: "SET_CROP", crop: event.target.value });
  refreshThumbnails();
});

document.getElementById("play").addEventListener("click", () => store.dispatch(play()));
document.getElementById("pause").addEventListener("click", () => store.dispatch(pause()));
document.getElementById("loop").addEventListener("change", (event) => store.dispatch(setLoop(event.target.checked)));

document.getElementById("split").addEventListener("click", () => {
  if (!selectedId) return setStatus("请先选中一个片段", true);
  const t = store.getState().clock.time;
  store.dispatch({ type: "SPLIT_CLIP", clipId: selectedId, atTime: t });
  setStatus(store.getState().lastError ?? `已在播放头 ${t.toFixed(2)}s 分割`, !!store.getState().lastError);
});

document.getElementById("transition").addEventListener("click", () => {
  const clips = store.getState().timeline.videos;
  const index = clips.findIndex((item) => item.id === selectedId);
  if (index < 0 || index >= clips.length - 1) return setStatus("请选中转场的前一个片段", true);
  const durations = Object.fromEntries(Object.entries(store.getState().sources).map(([id, s]) => [id, s.duration]));
  store.dispatch({
    type: "ADD_TRANSITION",
    fromClipId: clips[index].id,
    toClipId: clips[index + 1].id,
    duration: 1.5,
    sourceDurations: durations
  });
  setStatus(store.getState().lastError ?? "已添加 1.5s 交叉淡化转场", !!store.getState().lastError);
});

document.getElementById("retry").addEventListener("click", () => {
  const entries = buildVisibleThumbEntries(store.getState().timeline, store.getState().view, els.scroller.clientWidth);
  const retried = scheduler.retryFailed(entries);
  setStatus(retried.length ? `已重新排队 ${retried.length} 个失败缩略图` : "没有待回放的失败任务");
});

document.getElementById("save").addEventListener("click", () => {
  saveProject(store, "timeline-project");
  setStatus("工程已保存到 localStorage（入点/出点/事件位置）");
});

document.getElementById("load").addEventListener("click", () => {
  const ok = loadProject(store, "timeline-project");
  setStatus(ok ? "工程已重新载入，位置保持不变" : "没有已保存的工程", !ok);
  refreshThumbnails();
});

document.getElementById("break").addEventListener("click", () => {
  const videos = store.getState().timeline.videos;
  const broken = {
    ...store.getState().timeline,
    videos: videos.map((clip, i) => (i === 1 ? { ...clip, start: videos[0].start + 1 } : clip))
  };
  store.dispatch({ type: "REPLACE_TIMELINE", timeline: broken });
  setStatus("已注入非法重叠，导出将被阻止", true);
});

document.getElementById("export-png").addEventListener("click", async () => {
  try {
    await downloadSelectedFrame(store);
    setStatus("选帧 PNG 已导出（非黑帧校验通过）");
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.getElementById("export-program").addEventListener("click", async () => {
  try {
    const result = await downloadProgram(store);
    if (!baselineExport) {
      baselineExport = result;
      els.report.textContent = `基准节目：${result.durationSeconds}s / ${result.frameCount} 帧；再次裁切或加转场后导出可对比时长`;
    } else {
      els.report.textContent = `时长对比：${JSON.stringify(compareDurations(baselineExport, result), null, 0)}`;
    }
    setStatus("APNG + WAV 已导出，首尾无黑帧");
  } catch (error) {
    setStatus(`${error.message}${error.conflicts ? "（见冲突列表）" : ""}`, true);
  }
});
