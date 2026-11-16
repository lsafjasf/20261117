import { createDefaultProject } from './default-project.js';
import { renderFrame } from './chart-renderer.js';
import { LiveBeatPlayer } from './audio-engine.js';
import { Transport } from './transport.js';
import { TimelineUI } from './timeline-ui.js';
import { exportWebM } from './exporter.js';
import {
  moveClip,
  setTransitionDuration,
  setTrim,
  splitClip,
  trackDuration,
  clipDuration,
  validateProject,
  serializeProject,
  deserializeProject,
} from './engine.js';

const $ = (selector) => document.querySelector(selector);

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

class App {
  constructor() {
    this.project = createDefaultProject();
    this.canvas = $('#stage');
    this.ctx = this.canvas.getContext('2d', { desynchronized: false, willReadFrequently: true });
    this.canvas.width = this.project.settings.width;
    this.canvas.height = this.project.settings.height;
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.livePlayer = new LiveBeatPlayer(this.audioContext);
    this.exportResult = null;
    this.durationChecks = [];

    this.transport = new Transport(this.project, {
      canvas: this.canvas,
      ctx: this.ctx,
      renderFrame,
      audioContext: this.audioContext,
      livePlayer: this.livePlayer,
      onState: (state) => this.onState(state),
    });
    this.timeline = new TimelineUI($('#timeline'), this.transport, {
      onChange: (action) => this.handleTimelineAction(action),
      onSelect: (selection) => this.showInspector(selection),
    });
    this.bindControls();
    const restored = this.restoreIfSaved();
    if (!restored) this.recordDurationCheck('初始（2s 转场）');
    this.renderDataEditor();
    this.transport.draw();
    this.timeline.render();
    this.transport.emit();
    this.transport.markHydrated();
  }

  applyProject(nextProject, reason) {
    this.project = nextProject;
    this.transport.replaceProject(nextProject);
    this.timeline.render();
    this.renderDataEditor();
    this.showInspector(this.timeline.selected);
    if (reason) this.flashStatus(reason);
  }

  handleTimelineAction(action) {
    if (action.type === 'move') {
      this.applyProject(moveClip(this.project, action.id, action.start, action.track));
    }
  }

  bindControls() {
    $('#play-pause').addEventListener('click', () => this.transport.toggle());
    $('#loop-toggle').addEventListener('change', (e) => this.transport.setLoop(e.target.checked));
    $('#seek-zero').addEventListener('click', () => this.transport.seek(0));
    $('#split-btn').addEventListener('click', () => this.splitSelected());
    $('#trim-apply').addEventListener('click', () => this.trimSelected());
    $('#transition-apply').addEventListener('click', () => this.changeTransition());

    $('#save-btn').addEventListener('click', () => this.saveProjectFile());
    $('#reload-btn').addEventListener('click', () => this.reloadFromStorage());
    $('#load-file').addEventListener('change', (e) => this.loadProjectFile(e));
    $('#reset-btn').addEventListener('click', () => {
      Transport.clearSavedProject();
      this.applyProject(createDefaultProject(), '已恢复内置工程');
      this.durationChecks = [];
      this.recordDurationCheck('重置后（2s 转场）');
    });

    $('#export-btn').addEventListener('click', () => this.runExport(0));
    $('#export-fail-btn').addEventListener('click', () => this.runExport(1));
    $('#retry-export').addEventListener('click', () => this.runExport(0));
    $('#download-webm').addEventListener('click', () => {
      if (this.exportResult) download(this.exportResult.blob, 'chart-program.webm');
    });
  }

  selectedClip() {
    const selection = this.timeline.selected;
    if (!selection) return null;
    return this.project.tracks[selection.track].find((c) => c.id === selection.id) || null;
  }

  splitSelected() {
    const selection = this.timeline.selected;
    if (!selection || selection.track !== 'video') {
      return this.flashStatus('请先在视频轨选择一个图表片段');
    }
    const at = this.transport.time;
    const clip = this.selectedClip();
    if (at <= clip.start || at >= clip.start + clipDuration(clip)) {
      return this.flashStatus('播放头不在所选片段内，无法分割');
    }
    const { project: nextProject, newClipId } = splitClip(this.project, clip.id, at, 'video');
    this.applyProject(nextProject, `已在 ${at.toFixed(2)}s 分割，新片段 ${newClipId}`);
    this.recordDurationCheck(`分割 ${clip.id} @${at.toFixed(1)}s`);
  }

  trimSelected() {
    const selection = this.timeline.selected;
    if (!selection) return;
    const start = Number($('#trim-in').value);
    const end = Number($('#trim-out').value);
    this.applyProject(
      setTrim(this.project, selection.id, start, end, selection.track),
      `已设置入点 ${start.toFixed(2)}s / 出点 ${end.toFixed(2)}s`,
    );
    this.recordDurationCheck(`裁切 ${selection.id}`);
  }

  changeTransition() {
    const selection = this.timeline.selected;
    if (!selection || selection.track !== 'video') return;
    const duration = Number($('#transition-duration').value);
    this.applyProject(
      setTransitionDuration(this.project, selection.id, duration, 'video'),
      `转场时长改为 ${duration.toFixed(2)}s`,
    );
    this.recordDurationCheck(`转场 ${duration.toFixed(1)}s`);
  }

  renderDataEditor() {
    const clip = this.project.tracks.video[0];
    $('#bar-grow').value = clip.animation.barGrow;
    $('#number-roll').value = clip.animation.numberRoll;
    $('#bar-grow-val').textContent = clip.animation.barGrow.toFixed(2);
    $('#number-roll-val').textContent = clip.animation.numberRoll.toFixed(2);
    const rows = clip.data.labels.map((label, i) => {
      const value = clip.data.series[0].values[i];
      return `<label class="data-row">
        <input data-i="${i}" data-field="label" value="${label}" aria-label="标签">
        <input data-i="${i}" data-field="value" type="number" value="${value}" aria-label="数值">
      </label>`;
    }).join('');
    $('#data-rows').innerHTML = rows;
    $('#data-rows').querySelectorAll('input').forEach((input) => {
      input.addEventListener('input', () => this.editData(input));
    });
    $('#bar-grow').oninput = (e) => {
      const next = structuredClone(this.project);
      next.tracks.video.forEach((c) => { c.animation.barGrow = Number(e.target.value); });
      $('#bar-grow-val').textContent = Number(e.target.value).toFixed(2);
      this.applyProject(next);
    };
    $('#number-roll').oninput = (e) => {
      const next = structuredClone(this.project);
      next.tracks.video.forEach((c) => { c.animation.numberRoll = Number(e.target.value); });
      $('#number-roll-val').textContent = Number(e.target.value).toFixed(2);
      this.applyProject(next);
    };
  }

  editData(input) {
    const index = Number(input.dataset.i);
    const field = input.dataset.field;
    const next = structuredClone(this.project);
    const series = next.tracks.video[0].data;
    if (field === 'label') series.labels[index] = input.value || `项${index + 1}`;
    else series.series[0].values[index] = Math.max(0, Number(input.value) || 0);
    this.applyProject(next);
  }

  showInspector(selection) {
    const clip = selection
      ? this.project.tracks[selection.track].find((c) => c.id === selection.id)
      : null;
    if (!clip) return;
    $('#inspector-title').textContent = clip.type === 'subtitle' ? clip.text : clip.title;
    $('#trim-in').value = (clip.sourceIn ?? 0).toFixed(2);
    $('#trim-out').value = (clip.sourceOut ?? clip.sourceDuration ?? clipDuration(clip)).toFixed(2);
    $('#transition-duration').value = clip.transition?.duration || 0;
  }

  onState(state) {
    $('#time-readout').textContent =
      `${state.time.toFixed(2)}s / ${this.project.duration}s · 帧 ${state.frame}`;
    $('#play-pause').textContent = state.playing ? '暂停' : '播放';
    $('#loop-toggle').checked = state.loop;
    this.timeline.setConflicts(state.validation.conflicts);
    this.timeline.render();
    const blocked = !state.validation.valid;
    $('#export-btn').disabled = blocked;
    $('#export-fail-btn').disabled = blocked;
    $('#conflict-list').innerHTML = state.validation.conflicts.map((c) =>
      `<li><code>${c.track}</code> · ${c.clipId} @ ${c.at.toFixed(2)}s — ${c.reason}</li>`).join('');
    $('#conflict-box').hidden = !blocked;
  }

  flashStatus(message) {
    $('#status').textContent = message;
    clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => { $('#status').textContent = '就绪'; }, 3500);
  }

  recordDurationCheck(label) {
    const clips = this.project.tracks.video;
    this.durationChecks.push({
      label,
      rawSum: clips.reduce((sum, c) => sum + clipDuration(c), 0),
      programSpan: trackDuration(clips),
    });
    $('#duration-checks').innerHTML = this.durationChecks.map((check) =>
      `<li>${check.label}: 源片段合计 ${check.rawSum.toFixed(2)}s →
      节目覆盖 ${check.programSpan.toFixed(2)}s（差值即转场重叠）</li>`).join('');
  }

  saveProjectFile() {
    this.transport.saveToStorage();
    download(new Blob([serializeProject(this.project)], { type: 'application/json' }), 'chart-project.json');
    this.flashStatus('工程已保存（本地存储 + JSON 文件），入点/出点/事件随工程持久化');
  }

  reloadFromStorage() {
    const loaded = Transport.loadSavedProject();
    if (!loaded) return this.flashStatus('本地没有已保存工程');
    this.applyProject(loaded.project, '已从本地存储重新载入，时间点与事件保持不变');
  }

  loadProjectFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { project: loaded } = deserializeProject(String(reader.result));
        this.applyProject(loaded, '工程文件已载入');
      } catch (error) {
        this.flashStatus(`载入失败：${error.message}`);
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  restoreIfSaved() {
    const loaded = Transport.loadSavedProject();
    if (loaded) {
      this.project = loaded.project;
      this.transport.replaceProject(loaded.project);
      this.flashStatus('检测到自动保存，已恢复上次工程');
    }
    const pending = Transport.pendingExport();
    if (pending) {
      $('#replay-panel').hidden = false;
      $('#replay-info').textContent =
        `上次导出在 ${new Date(pending.at).toLocaleTimeString()} 中断（播放头 ${pending.time.toFixed(2)}s），可重试导出。`;
    }
    return Boolean(loaded);
  }

  async runExport(failOnAttempt) {
    if (!validateProject(this.project).valid) {
      return this.flashStatus('存在非法重叠，导出已阻止');
    }
    $('#export-progress').hidden = false;
    $('#export-bar').style.width = '0%';
    $('#replay-panel').hidden = true;
    this.transport.markPendingExport();
    try {
      const result = await exportWebM(this.project, this.canvas, {
        failOnAttempt,
        onProgress: (ratio) => {
          $('#export-bar').style.width = `${(ratio * 100).toFixed(1)}%`;
        },
      });
      this.exportResult = result;
      this.transport.clearPendingExport();
      $('#export-result').hidden = false;
      $('#export-summary').textContent =
        `${result.frameCount} 帧全部请求成功，无丢帧；首/尾亮度 ${result.luma.first.toFixed(1)}/${result.luma.last.toFixed(1)}；音频 ${result.audioDurationSec.toFixed(2)}s`;
      window.__lastExport = result;
      this.flashStatus('WebM 导出完成，音画共用同一时间基准');
    } catch (error) {
      $('#replay-panel').hidden = false;
      $('#replay-info').textContent = `导出失败：${error.message}；工程仍在，可修正后重试或重新载入。`;
      this.flashStatus('导出失败，已保留现场用于回放与重试');
    } finally {
      $('#export-progress').hidden = true;
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.__app = new App();
});
