import { buildDemoProject, measureDurations, diffDurations } from '../core/factory.js';
import { ActionJournal } from '../core/journal.js';
import { AudioEngine } from './audio-engine.js';
import { PlaybackEngine } from './playback-engine.js';
import { TimelineView } from './timeline-view.js';
import { Exporter } from './exporter.js';
import { ProjectStore, serializeProject, deserializeProject } from './project-store.js';
import { msToSec } from '../core/time.js';
import { localTime } from '../core/model.js';

const $ = (id) => document.getElementById(id);
const els = {
  canvas: $('stage'), timeline: $('timeline'), ruler: $('ruler'),
  videoTrack: $('videoTrack'), subTrack: $('subTrack'), audioTrack: $('audioTrack'),
  playhead: $('playhead'), conflictBox: $('conflictBox'),
  durationReport: $('durationReport'), journalBox: $('journalBox'),
  clock: $('clock'), stateBadge: $('stateBadge'), durationBadge: $('durationBadge'),
};

let model = buildDemoProject();
const journal = new ActionJournal();
const audio = new AudioEngine();
const engine = new PlaybackEngine(model, els.canvas, audio);
const view = new TimelineView(model, els, (ms) => engine.seek(ms), (id, to) => doMove(id, to));
const exporter = new Exporter(model, engine, audio);
let lastMeasure = measureDurations(model);

function refresh(conflictErrors = []) {
  engine.syncDuration();
  const ids = new Set();
  for (const err of conflictErrors) (err.clipIds || []).forEach((id) => ids.add(id));
  view.render(ids);
  view.setPlayhead(engine.playheadMs);
  renderConflicts(conflictErrors);
  renderJournal();
  els.durationBadge.textContent = `节目时长: ${(model.durationMs / 1000).toFixed(2)}s`;
}

function validateAndRefresh() {
  const result = model.validate();
  refresh(result.ok ? [] : result.errors);
  return result;
}

function renderConflicts(errors) {
  if (!errors.length) {
    els.conflictBox.className = 'conflict hidden';
    els.conflictBox.innerHTML = '';
    return;
  }
  els.conflictBox.className = 'conflict';
  els.conflictBox.innerHTML = '<strong>已阻止导出，冲突位置：</strong>' + errors.map((e) =>
    `<div class="pos">${e.message}${e.startMs != null ? `（区间 ${e.startMs}–${e.endMs}ms）` : ''}</div>`).join('');
}

function renderJournal() {
  const last = journal.entries.slice(-8).reverse();
  els.journalBox.innerHTML = '<strong>操作日志（失败回放）</strong>' + last.map((e) =>
    `<div class="${e.ok ? 'ok' : 'fail'}">#${e.seq} ${e.name} ${e.ok ? '✓' : `✗ ${e.error}`}</div>`).join('');
}

function recordDurationChange(label) {
  const report = diffDurations(lastMeasure, measureDurations(model));
  lastMeasure = measureDurations(model);
  const rows = report.clips.map((c) =>
    `<tr><td>${c.id}</td><td>${c.beforeMs}</td><td>${c.afterMs}</td><td>${c.deltaMs}</td></tr>`).join('');
  els.durationReport.innerHTML = `<strong>时长对比 · ${label}</strong>
    <div>节目 ${report.programBeforeMs}ms → ${report.programAfterMs}ms（Δ ${report.programDeltaMs}ms）</div>
    <table><tr><th>片段</th><th>前</th><th>后</th><th>差值</th></tr>${rows}</table>`;
}

function doMove(id, to) {
  try {
    journal.apply('move', { id, to }, () => model.moveClip(id, to));
    validateAndRefresh();
  } catch (e) { validateAndRefresh(); }
}

engine.onFrame = (s) => {
  view.setPlayhead(s.playheadMs);
  els.clock.textContent = `${s.t.toFixed(3)}s / ${(s.durationMs / 1000).toFixed(3)}s`;
  els.stateBadge.textContent = s.playing ? '播放中' : '已暂停';
};

$('playBtn').onclick = () => engine.play();
$('pauseBtn').onclick = () => engine.pause();
$('loopChk').onchange = (e) => engine.setLoop(e.target.checked);
$('transitionDur').oninput = (e) => { $('transitionDurVal').textContent = e.target.value; };

function adjacentPair() {
  const sorted = [...model.clips].sort((a, b) => a.inPoint - b.inPoint);
  return [sorted[0], sorted[1]];
}

$('applyTransitionBtn').onclick = () => {
  const type = $('transitionType').value;
  const dur = Number($('transitionDur').value);
  const [from, to] = adjacentPair();
  try {
    journal.apply('addTransition', { from: from.id, to: to.id, type, durationMs: dur },
      () => model.addTransition(from.id, to.id, type, dur));
    recordDurationChange(`转场 ${type}`);
    validateAndRefresh();
  } catch (e) { validateAndRefresh(); }
};

$('removeTransitionBtn').onclick = () => {
  const tr = model.transitions[model.transitions.length - 1];
  if (!tr) return;
  journal.apply('removeTransition', { id: tr.id }, () => model.removeTransition(tr.id));
  recordDurationChange('移除转场');
  validateAndRefresh();
};

$('splitBtn').onclick = () => {
  const clip = model.clips.find((c) => c.id === 'clipA') || model.clips[0];
  const at = Math.min(clip.inPoint + 2000, clip.outPoint - 100);
  try {
    journal.apply('split', { id: clip.id, atMs: at }, () => model.splitClip(clip.id, at));
    recordDurationChange('分割');
    validateAndRefresh();
  } catch (e) { validateAndRefresh(); }
};

$('moveBtn').onclick = () => doMove('clipB', model.clips.find((c) => c.id === 'clipB').inPoint + 800);

$('overlapBtn').onclick = () => {
  const clipB = model.clips.find((c) => c.id === 'clipB');
  doMove(clipB.id, clipB.inPoint - 1200); // 与前一片段非法重叠
};

$('resetBtn').onclick = () => {
  ProjectStore.clearLocal();
  location.reload();
};

$('saveBtn').onclick = () => {
  ProjectStore.saveLocal(model, journal);
  $('exportProgress').textContent = '工程已保存到 localStorage';
};

$('loadBtn').onclick = loadProject;
$('downloadBtn').onclick = () => ProjectStore.download(model, journal);
$('importBtn').onclick = () => $('fileInput').click();
$('fileInput').onchange = async (e) => {
  const text = await e.target.files[0].text();
  try {
    const loaded = deserializeProject(text);
    ProjectStore.saveLocal(loaded.model, loaded.journal);
    location.reload();
  } catch (err) {
    $('exportProgress').textContent = `导入失败: ${err.message}`;
  }
};

function loadProject() {
  const loaded = ProjectStore.loadLocal();
  if (!loaded) { $('exportProgress').textContent = '没有已保存工程'; return; }
  $('exportProgress').textContent = '已重新载入，入点/出点/事件位置保持不变';
  location.reload();
}

$('exportBtn').onclick = async () => {
  const result = model.validate();
  if (!result.ok) {
    refresh(result.errors);
    $('exportProgress').textContent = '导出被阻止：存在非法重叠';
    return;
  }
  $('exportProgress').textContent = '导出中… 0%';
  try {
    const realTime = $('realtimeChk').checked;
    const out = await exporter.exportVideo({
      realTime,
      onProgress: (p) => { $('exportProgress').textContent = `导出中… ${(p * 100).toFixed(0)}%`; },
    });
    const link = $('downloadVideo');
    link.href = out.url;
    link.download = `timeline-${Date.now()}.webm`;
    link.hidden = false;
    link.textContent = `下载视频 (${(out.bytes / 1024).toFixed(1)} KB)`;
    const black = out.blackFrames.first || out.blackFrames.last ? '存在黑帧!' : '首尾无黑帧';
    $('exportProgress').textContent =
      `导出完成 ${out.durationMs}ms · ${black} · 首黑帧=${out.blackFrames.first} 末黑帧=${out.blackFrames.last}`;
  } catch (err) {
    $('exportProgress').textContent = `导出失败: ${err.message}`;
    if (err.conflicts) refresh(err.conflicts);
  }
};

// 启动时优先恢复已保存工程，验证重新载入后位置不变。
(function boot() {
  const saved = ProjectStore.loadLocal();
  if (saved) {
    model = saved.model;
    engine.model = model;
    exporter.model = model;
    view.model = model;
  }
  lastMeasure = measureDurations(model);
  engine.syncDuration();
  validateAndRefresh();
  window.__app = {
    get model() { return model; }, engine, journal, view, exporter, audio,
    localTime,
    serialize: () => serializeProject(model, journal),
  };
})();
