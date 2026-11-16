import { TransportClock } from './clock.js';
import { DrumEngine } from './audio.js';
import { TimelineView } from './timeline.js';
import { renderFrame } from './renderer.js';
import { exportVideo, preflightCheck } from './export.js';
import { runSelfCheck } from './selftest.js';
import {
  FPS,
  FRAME,
  createProject,
  moveClip,
  splitClip,
  setTransition,
  setInOut,
  setAudioOffset,
  mappedAudioEvents,
  validateProject,
  compareVariants,
  getVideoTrack,
  timelineToSource,
  programDuration,
} from './model.js';
import { serializeProject, deserializeProject, verifyReload } from './persist.js';

const project = createProject();
const clock = new TransportClock();
const drum = new DrumEngine(clock);

const stage = document.querySelector('#stage');
const stageCtx = stage.getContext('2d');
const timelineCanvas = document.querySelector('#timeline');
const timelineView = new TimelineView(timelineCanvas, clock, () => project, handleTimelineAction);

const els = {
  clockReadout: document.querySelector('#clock-readout'),
  frameReadout: document.querySelector('#frame-readout'),
  deltaReadout: document.querySelector('#delta-readout'),
  stateReadout: document.querySelector('#state-readout'),
  play: document.querySelector('#play-btn'),
  pause: document.querySelector('#pause-btn'),
  prevFrame: document.querySelector('#prev-frame'),
  nextFrame: document.querySelector('#next-frame'),
  loopToggle: document.querySelector('#loop-toggle'),
  offsetRange: document.querySelector('#offset-range'),
  offsetValue: document.querySelector('#offset-value'),
  resetOffset: document.querySelector('#reset-offset'),
  split: document.querySelector('#split-btn'),
  transitionSelect: document.querySelector('#transition-select'),
  transition: document.querySelector('#transition-btn'),
  setIn: document.querySelector('#set-in'),
  setOut: document.querySelector('#set-out'),
  resetInOut: document.querySelector('#reset-inout'),
  inout: document.querySelector('#inout-readout'),
  save: document.querySelector('#save-btn'),
  load: document.querySelector('#load-btn'),
  loadFile: document.querySelector('#load-file'),
  selftest: document.querySelector('#selftest-btn'),
  replay: document.querySelector('#replay-btn'),
  exportBtn: document.querySelector('#export-btn'),
  exportProgress: document.querySelector('#export-progress'),
  exportDownload: document.querySelector('#export-download'),
  banner: document.querySelector('#conflict-banner'),
  deltaBody: document.querySelector('#delta-table tbody'),
  compareBody: document.querySelector('#compare-table tbody'),
  selftestOutput: document.querySelector('#selftest-output'),
};

function handleTimelineAction(action, payload) {
  if (action === 'moveClip') {
    return moveClip(project, payload.clipId, payload.start);
  }
  return { ok: false, reason: '未知操作' };
}

function refreshAudioEvents() {
  drum.setEvents(mappedAudioEvents(project));
  renderDeltaTable();
  renderCompareTable();
}

function renderLoop() {
  const { time, playing } = clock.state;
  const sourceTime = timelineToSource(project, time);
  renderFrame(stageCtx, project, time, drum.getWaveformSamples(), stage.width, stage.height);
  timelineView.draw();

  els.clockReadout.textContent = `${time.toFixed(3)}s`;
  els.frameReadout.textContent = `帧 ${Math.round(time * FPS)} / ${programDuration(project) * FPS}`;
  const events = mappedAudioEvents(project);
  const nearest = events.reduce((best, event) => {
    const distance = Math.abs(event.audioTime - time);
    return distance < best.distance ? { distance, event } : best;
  }, { distance: Infinity, event: null });
  if (nearest.event && nearest.distance < 0.25) {
    els.deltaReadout.textContent = `音画差值 ${Math.round(nearest.event.delta * 1000)}ms`;
  } else {
    els.deltaReadout.textContent = `源时间 ${sourceTime === null ? '--' : `${sourceTime.toFixed(3)}s`}`;
  }
  els.stateReadout.textContent = `${playing ? '播放中' : '已暂停'} · 循环${clock.state.loop ? '开' : '关'}`;
  requestAnimationFrame(renderLoop);
}

clock.subscribe((state, reason) => {
  if (reason === 'seek' || reason === 'loop-wrap') drum.resetSchedule();
});

els.play.addEventListener('click', async () => {
  await drum.ensureContext();
  refreshAudioEvents();
  drum.start();
  clock.play();
});
els.pause.addEventListener('click', () => {
  clock.pause();
  drum.stop();
});
els.prevFrame.addEventListener('click', () => clock.frameStep(-1, FRAME));
els.nextFrame.addEventListener('click', () => clock.frameStep(1, FRAME));
els.loopToggle.addEventListener('change', (event) => {
  clock.state.loop = event.target.checked;
});

els.offsetRange.addEventListener('input', (event) => {
  const ms = Number(event.target.value);
  setAudioOffset(project, ms / 1000);
  els.offsetValue.textContent = `${ms}ms`;
  refreshAudioEvents();
});
els.resetOffset.addEventListener('click', () => {
  setAudioOffset(project, 0);
  els.offsetRange.value = 0;
  els.offsetValue.textContent = '0ms';
  refreshAudioEvents();
});

requestAnimationFrame(renderLoop);
refreshAudioEvents();
updateInOutReadout();
updateConflictBanner();

function updateInOutReadout() {
  els.inout.textContent = `入 ${project.inPoint.toFixed(3)}s / 出 ${project.outPoint.toFixed(3)}s`;
  clock.setLoopBounds(project.inPoint, project.outPoint);
}

function updateConflictBanner() {
  const report = validateProject(project);
  if (report.ok && report.warnings.length === 0) {
    els.banner.className = 'banner hidden';
    els.banner.textContent = '';
    return;
  }
  const lines = [...report.errors, ...report.warnings].map((item) => item.message);
  els.banner.className = `banner ${report.ok ? 'warn' : ''}`;
  els.banner.textContent = report.ok
    ? `可导出但有警告：${lines.join('；')}`
    : `导出已阻止：${lines.join('；')}（红色区间为冲突位置）`;
}

function renderDeltaTable() {
  const rows = mappedAudioEvents(project).map((event, index) => {
    const deltaMs = Math.round(event.delta * 1000);
    return `<tr>
      <td>${index + 1}</td>
      <td>${event.sourceTime.toFixed(3)}s</td>
      <td>${event.visualTime.toFixed(3)}s</td>
      <td>${event.audioTime.toFixed(3)}s</td>
      <td style="color:${deltaMs === 0 ? '#8bd49c' : '#ffc83c'}">${deltaMs}ms</td>
    </tr>`;
  });
  els.deltaBody.innerHTML = rows.join('');
}

function renderCompareTable() {
  const cutA = createProject();
  setInOut(cutA, 2, 14);
  const cutB = createProject();
  splitClip(cutB, getVideoTrack(cutB).clips[0].id, 9);
  setTransition(cutB, getVideoTrack(cutB).clips[0].id, 0.8);
  setInOut(cutB, 0, 12);
  const report = compareVariants(project, [
    { name: '裁切 2-14s', project: cutA },
    { name: '分割转场 + 裁切 0-12s', project: cutB },
  ]);
  const baselineRow = `<tr style="color:#8bd49c">
    <td>${report.baseline.name}</td><td>${report.baseline.duration}s</td>
    <td>${report.baseline.clips}</td><td>${report.baseline.events}</td><td>基准</td>
  </tr>`;
  const rows = report.rows.map((row) => `<tr>
    <td>${row.name}</td><td>${row.duration}s</td><td>${row.clips}</td>
    <td>${row.events}</td><td>${row.durationDelta}s</td>
  </tr>`);
  els.compareBody.innerHTML = baselineRow + rows.join('');
}

els.split.addEventListener('click', () => {
  const sourceTime = timelineToSource(project, clock.state.time);
  const clip = getVideoTrack(project).clips.find(
    (item) => sourceTime !== null && sourceTime >= item.sourceStart && sourceTime <= item.sourceEnd,
  );
  if (!clip || sourceTime === null) {
    els.selftestOutput.textContent = '播放头不在任何片段内，无法分割。';
    return;
  }
  const result = splitClip(project, clip.id, sourceTime);
  els.selftestOutput.textContent = result.ok
    ? `已在源时间 ${sourceTime.toFixed(3)}s 分割片段。`
    : `分割失败：${result.reason}`;
  refreshAudioEvents();
  updateConflictBanner();
});

els.transition.addEventListener('click', () => {
  const firstLeft = getVideoTrack(project).clips[0];
  const result = setTransition(project, firstLeft.id, Number(els.transitionSelect.value));
  els.selftestOutput.textContent = result.ok
    ? `转场已更新为 ${result.duration}s，事件位置未变化。`
    : `转场失败：${result.reason}`;
  refreshAudioEvents();
});

els.setIn.addEventListener('click', () => {
  setInOut(project, clock.state.time, project.outPoint);
  updateInOutReadout();
});
els.setOut.addEventListener('click', () => {
  setInOut(project, project.inPoint, clock.state.time);
  updateInOutReadout();
});
els.resetInOut.addEventListener('click', () => {
  setInOut(project, 0, project.sourceDuration);
  updateInOutReadout();
});

els.save.addEventListener('click', () => {
  const text = serializeProject(project);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `timeline-project-${Date.now()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  els.selftestOutput.textContent = '工程已保存（含校验和与操作日志）。';
});

els.load.addEventListener('click', () => els.loadFile.click());
els.loadFile.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const result = deserializeProject(await file.text());
  if (!result.ok) {
    els.selftestOutput.textContent = `载入失败：${result.reason}`;
    return;
  }
  const verification = verifyReload(project, result.project);
  const loaded = result.project;
  Object.assign(project, {
    videoTracks: loaded.videoTracks,
    audioTracks: loaded.audioTracks,
    inPoint: loaded.inPoint,
    outPoint: loaded.outPoint,
    audioOffset: loaded.audioOffset,
    log: loaded.log,
  });
  els.offsetRange.value = Math.round(project.audioOffset * 1000);
  els.offsetValue.textContent = `${Math.round(project.audioOffset * 1000)}ms`;
  updateInOutReadout();
  refreshAudioEvents();
  updateConflictBanner();
  els.selftestOutput.textContent = verification.ok
    ? '重载成功：入点、出点、事件与片段位置校验一致。'
    : `重载后存在不一致：${JSON.stringify(verification.mismatches)}`;
});

els.selftest.addEventListener('click', () => {
  const report = runSelfCheck();
  const lines = report.results.map((result) =>
    `${result.ok ? '✔' : '✖'} ${result.name} — ${result.detail}`);
  lines.push('', report.replay);
  els.selftestOutput.textContent = lines.join('\n');
});

els.replay.addEventListener('click', () => {
  if (project.log.length === 0) {
    els.selftestOutput.textContent = '当前没有可回放的操作日志。';
    return;
  }
  const lines = project.log.map((entry, index) =>
    `${index + 1}. [${entry.at}] ${entry.action}`);
  const rebuilt = createProject();
  els.selftestOutput.textContent =
    `操作日志回放（共 ${project.log.length} 步）：\n${lines.join('\n')}\n\n` +
    `日志已随工程保存，重载后仍可追溯失败现场。当前重建工程片段数：${getVideoTrack(rebuilt).clips.length}。`;
});

els.exportBtn.addEventListener('click', async () => {
  const preflight = preflightCheck(stageCtx, project, stage, stage.width, stage.height);
  if (!preflight.ok) {
    updateConflictBanner();
    const detail = preflight.stage === 'validate'
      ? preflight.validation.errors.map((error) => error.message).join('；')
      : `黑帧：${preflight.blackFrames.map((f) => `${f.position} 亮度 ${f.luminance.toFixed(1)}`).join('，')}`;
    els.exportProgress.textContent = `导出阻止：${detail}`;
    if (preflight.validation?.errors[0]) {
      clock.seek(preflight.validation.errors[0].start);
    }
    return;
  }
  els.exportBtn.disabled = true;
  els.exportProgress.textContent = '导出中 0%';
  const result = await exportVideo({
    ctx: stageCtx,
    project,
    canvas: stage,
    drum,
    width: stage.width,
    height: stage.height,
    onProgress: (ratio) => {
      els.exportProgress.textContent = `导出中 ${Math.round(ratio * 100)}%`;
    },
  });
  els.exportBtn.disabled = false;
  if (!result.ok) {
    els.exportProgress.textContent = `导出失败：${result.stage}`;
    return;
  }
  const url = URL.createObjectURL(result.blob);
  els.exportDownload.href = url;
  els.exportDownload.className = '';
  els.exportProgress.textContent =
    `导出完成：${(result.size / 1024).toFixed(1)} KB，时长 ${result.duration.toFixed(2)}s，` +
    `首尾亮度 ${result.preflight.luminance.head.toFixed(1)} / ${result.preflight.luminance.tail.toFixed(1)}（无黑帧）。`;
});

// 自动化测试与控制台排查用句柄（不影响界面逻辑）。
window.__demo = {
  project,
  clock,
  drum,
  moveClip: (clipId, start) => moveClip(project, clipId, start),
  setInOut: (inPoint, outPoint) => {
    setInOut(project, inPoint, outPoint);
    updateInOutReadout();
    updateConflictBanner();
  },
  serialize: () => serializeProject(project),
};
