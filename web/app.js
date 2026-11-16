// Browser editor controller. All UI mutations are recorded as events on the
// shared Project; the rAF loop reads the single TransportClock and paints the
// shared render plan, keeping program timeline, canvas playhead and audio on
// one timebase.

import { Project } from '../src/core/project.js';
import { buildDemoProject, applyEditPass } from '../src/core/scenario.js';
import { buildRenderPlan, drawPlan } from '../src/core/render.js';
import { EVENT_TYPES, FRAME_MS } from '../src/core/constants.js';
import { WebAudioEngine } from './audio-engine.js';
import { CanvasRecorder, downloadBlob, downloadText } from './recorder.js';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const readout = document.getElementById('clock-readout');
const eventList = document.getElementById('event-list');
const validationBox = document.getElementById('validation');
const replayReport = document.getElementById('replay-report');
const exportMessage = document.getElementById('export-message');
const timelineView = document.getElementById('timeline-view');

const built = buildDemoProject();
let project = built.project;
project.setInOut(0, project.durationMs);
const audio = new WebAudioEngine(project.clock);
const recorder = new CanvasRecorder(canvas, project.meta.fps);
let selectedId = project.scene.shapeOrder[0] ?? null;
let dragging = false;
let savedJson = null;

// Canvas2D adapter matching the subset used by the shared drawPlan helper.
const canvasAdapter = {
  setAlpha(value) { ctx.globalAlpha = value; },
  fillRect(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  },
  fillText(text, x, y, color) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.font = '600 18px system-ui, sans-serif';
    ctx.fillText(String(text), x, y);
  }
};

function paint() {
  const plan = buildRenderPlan({
    scene: project.scene,
    timeline: project.timeline,
    timeMs: project.clock.time,
    width: project.meta.width,
    height: project.meta.height,
    frameWindowMs: FRAME_MS
  });
  drawPlan(canvasAdapter, plan);
  if (selectedId) drawSelection();
  readout.textContent = `t=${Math.round(project.clock.time)}ms`;
}

function drawSelection() {
  const shape = project.scene.shapes[selectedId];
  if (!shape) return;
  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(shape.x - 3, shape.y - 3, shape.w + 6, shape.h + 6);
  ctx.restore();
}

let lastFrame = performance.now();
function frame(now) {
  const delta = now - lastFrame;
  lastFrame = now;
  if (project.clock.playing) {
    project.clock._now = () => now;
    project.clock._lastTick = now - delta;
    project.clock.tick();
    if (!project.clock.playing) audio.stop();
  }
  paint();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height)
  };
}

canvas.addEventListener('pointerdown', (event) => {
  const point = pointerPosition(event);
  const hit = project.scene.shapeOrder
    .map((id) => project.scene.shapes[id])
    .reverse()
    .find((shape) => point.x >= shape.x && point.x <= shape.x + shape.w &&
      point.y >= shape.y && point.y <= shape.y + shape.h);
  if (hit) {
    selectedId = hit.id;
    dragging = true;
    canvas.setPointerCapture(event.pointerId);
  }
});

canvas.addEventListener('pointermove', (event) => {
  if (!dragging || !selectedId) return;
  const point = pointerPosition(event);
  const shape = project.scene.shapes[selectedId];
  project.record(EVENT_TYPES.SHAPE_DRAG, {
    t: project.clock.time,
    targetId: selectedId,
    payload: {
      x: Math.round(point.x - shape.w / 2),
      y: Math.round(point.y - shape.h / 2)
    }
  });
  refreshSidebar();
});

canvas.addEventListener('pointerup', () => { dragging = false; });

document.getElementById('shape-text').addEventListener('input', (event) => {
  if (!selectedId) return;
  project.record(EVENT_TYPES.SHAPE_INPUT, {
    t: project.clock.time,
    targetId: selectedId,
    payload: { text: event.target.value }
  });
  refreshSidebar();
});

function refreshSidebar() {
  eventList.innerHTML = '';
  for (const event of project.events.events) {
    const item = document.createElement('li');
    item.textContent = `${event.t}ms · ${event.type}` +
      (event.targetId ? ` → ${event.targetId}` : '');
    eventList.appendChild(item);
  }
  renderTimeline();
  renderValidation();
}

function renderValidation() {
  const report = project.validateForExport();
  if (report.ok) {
    validationBox.className = 'validation ok';
    validationBox.textContent = `可导出：时长 ${project.clock.duration}ms，无非法重叠`;
  } else {
    validationBox.className = 'validation bad';
    validationBox.innerHTML = report.errors.map((error) =>
      error.kind === 'OVERLAP'
        ? `冲突 ${error.clipIds.join(' / ')} @ ${error.start}-${error.end}ms`
        : error.message).join('<br>');
  }
}

function renderTimeline() {
  const maxEnd = Math.max(1, project.timeline.durationMs);
  timelineView.innerHTML = '';
  for (const track of project.timeline.tracks) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;margin-bottom:6px';
    for (const clip of track.clips) {
      const chip = document.createElement('div');
      const left = (clip.start / maxEnd) * 100;
      const width = ((clip.end - clip.start) / maxEnd) * 100;
      chip.style.cssText =
        `position:absolute;left:${left}%;width:${width}%;height:34px;` +
        `background:${clip.color};border-radius:6px;color:#0b1220;` +
        `font-size:12px;display:flex;align-items:center;padding:0 8px;` +
        `border:1px solid rgba(0,0,0,.3)`;
      chip.textContent = clip.label;
      row.appendChild(chip);
    }
    row.style.cssText += ';position:relative;height:40px;background:#0f1828;' +
      'border:1px solid #24324d;border-radius:8px';
    timelineView.appendChild(row);
  }
  const conflicts = project.timeline.validate();
  if (conflicts.length > 0) {
    const marker = document.createElement('p');
    marker.style.color = 'var(--danger)';
    marker.textContent = `非法重叠已标记：${conflicts
      .map((c) => `${c.start}-${c.end}ms`).join('，')}`;
    timelineView.appendChild(marker);
  }
}

function showReplayReport() {
  const result = project.replayWindow();
  if (result.failed.length === 0) {
    replayReport.textContent = `回放成功：${result.appliedCount} 个事件全部应用`;
  } else {
    replayReport.style.color = 'var(--danger)';
    replayReport.innerHTML = result.failed.map((failure) =>
      `${failure.t}ms ${failure.type}：${failure.error}`).join('<br>');
  }
}

document.getElementById('btn-play').addEventListener('click', async () => {
  await audio.ensureContext();
  project.clock.play();
  audio.start(project.scene.audioPulses);
});

document.getElementById('btn-pause').addEventListener('click', () => {
  project.clock.pause();
  audio.stop();
});

document.getElementById('btn-loop').addEventListener('click', (event) => {
  project.clock.loop = !project.clock.loop;
  event.target.classList.toggle('on', project.clock.loop);
});

document.getElementById('btn-restart').addEventListener('click', () => {
  project.clock.seek(project.clock.inPoint);
  project.record(EVENT_TYPES.PLAYHEAD_SEEK, { t: project.clock.time });
  refreshSidebar();
});

document.getElementById('btn-add-shape').addEventListener('click', () => {
  const id = `shape_${project.scene.shapeOrder.length + 1}`;
  project.record(EVENT_TYPES.SHAPE_ADD, {
    t: project.clock.time, targetId: id,
    payload: { x: 90 + project.scene.shapeOrder.length * 18,
      y: 90, w: 120, h: 90, color: '#9d7bff', text: '' }
  });
  selectedId = id;
  refreshSidebar();
});

document.getElementById('btn-sound').addEventListener('click', async () => {
  await audio.ensureContext();
  const note = project.scene.audioPulses.length % 6;
  const pulse = project.record(EVENT_TYPES.AUDIO_TRIGGER, {
    t: project.clock.time, targetId: selectedId,
    payload: { note, durationMs: 200 }
  }).payload;
  audio.trigger({ note, durationMs: pulse.durationMs, t: project.clock.time },
    audio.context.currentTime);
  refreshSidebar();
});

function clipIds() {
  return project.timeline.tracks[0].clips.map((clip) => clip.id);
}

document.getElementById('btn-move').addEventListener('click', () => {
  const clips = project.timeline.tracks[0].clips
    .slice().sort((a, b) => b.start - a.start);
  if (clips.length === 0) return;
  const target = clips[0];
  try {
    project.record(EVENT_TYPES.CLIP_MOVE, {
      t: project.clock.time, targetId: target.id,
      payload: { start: target.start + 200 }
    });
    exportMessage.textContent = `片段 ${target.label || target.id} 已后移 200ms`;
  } catch (error) {
    exportMessage.textContent = `移动被阻止：${error.message}`;
  }
  refreshSidebar();
});

document.getElementById('btn-split').addEventListener('click', () => {
  const ids = clipIds();
  const newClipId = project.timeline.mintClipId();
  const target = project.timeline.findClip(ids[1]);
  if (!target) {
    exportMessage.textContent = '分割失败：找不到片段 B';
    return;
  }
  const splitAt = Math.round((target.start + target.end) / 2);
  project.record(EVENT_TYPES.CLIP_SPLIT, {
    t: project.clock.time, targetId: ids[1],
    payload: { at: splitAt, newClipId }
  });
  exportMessage.textContent = `片段在 ${splitAt}ms 分割（新片段 ${newClipId}）`;
  refreshSidebar();
});

document.getElementById('btn-transition').addEventListener('click', () => {
  const clips = project.timeline.tracks[0].clips
    .slice().sort((a, b) => a.start - b.start);
  if (clips.length < 2) {
    exportMessage.textContent = '转场失败：至少需要两个相邻片段';
    return;
  }
  const transitionId = project.timeline.mintTransitionId();
  try {
    project.record(EVENT_TYPES.TRANSITION_ADD, {
      t: project.clock.time,
      payload: { clipAId: clips[0].id, clipBId: clips[1].id,
        durationMs: 250, transitionId }
    });
    exportMessage.textContent = '已添加 250ms 交叉淡化转场';
  } catch (error) {
    exportMessage.textContent = `转场被阻止：${error.message}`;
  }
  refreshSidebar();
});

document.getElementById('btn-seek-in').addEventListener('click', () => {
  project.clock.setRange(project.clock.time, project.clock.outPoint ||
    project.durationMs);
  exportMessage.textContent = `入点 ${project.clock.inPoint}ms`;
});

document.getElementById('btn-seek-out').addEventListener('click', () => {
  project.clock.setRange(project.clock.inPoint, project.clock.time);
  exportMessage.textContent = `出点 ${project.clock.outPoint}ms`;
});

document.getElementById('btn-record').addEventListener('click', async (event) => {
  const button = event.target;
  if (button.dataset.recording === 'true') {
    project.clock.pause();
    audio.stop();
    paint();
    const blob = await recorder.stop();
    button.dataset.recording = 'false';
    button.textContent = '开始录制视频';
    if (blob) downloadBlob(blob, `studio-${Date.now()}.webm`);
    exportMessage.textContent = '视频已导出（WebM，与事件共用同一时钟）';
    return;
  }
  await audio.ensureContext();
  recorder.start();
  button.dataset.recording = 'true';
  button.textContent = '停止并导出 WebM';
  project.clock.seek(project.clock.inPoint);
  project.clock.play();
  audio.start(project.scene.audioPulses);
});

document.getElementById('btn-save').addEventListener('click', () => {
  savedJson = JSON.stringify(project.toJSON(), null, 2);
  downloadText(savedJson, 'studio-project.json');
  exportMessage.textContent = '工程已保存（事件 JSON + 入点/出点）';
});

document.getElementById('btn-reload').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      project = Project.fromJSON(text);
      project.clock.loop = false;
      audio.clock = project.clock;
      exportMessage.textContent =
        `工程已重载：入点 ${project.clock.inPoint} / 出点 ${project.clock.outPoint}ms`;
      showReplayReport();
      refreshSidebar();
      paint();
    } catch (error) {
      exportMessage.textContent = `重载失败：${error.message}`;
    }
  });
  input.click();
});

document.getElementById('btn-export').addEventListener('click', () => {
  const report = project.validateForExport();
  renderValidation();
  if (!report.ok) {
    exportMessage.style.color = 'var(--danger)';
    exportMessage.textContent = '导出已阻止：存在非法重叠或空范围，冲突已在侧栏标出';
    return;
  }
  exportMessage.style.color = 'var(--ok)';
  downloadText(JSON.stringify(project.toJSON(), null, 2),
    'studio-export.events.json');
  exportMessage.textContent =
    `校验通过，已导出事件 JSON（时长 ${project.clock.duration}ms）；` +
    '视频请用录制按钮生成 WebM';
  showReplayReport();
});

refreshSidebar();
showReplayReport();
