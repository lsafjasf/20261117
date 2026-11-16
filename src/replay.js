/* global DBEngine */
/** 回放查看器：基于输入日志确定性重放，支持时间轴拖动与 JSON 导出。 */
(function () {
  'use strict';

  function ReplayViewer(els) {
    this.els = els;
    this.timeline = [];
    this.replay = null;
    this.playing = false;
    this.index = 0;
  }

  ReplayViewer.prototype.open = function (engine, renderFn) {
    this.replay = engine.exportReplay();
    const result = DBEngine.replay(this.replay, engine.state.mode);
    this.timeline = result.timeline;
    this.renderFn = renderFn;
    this.els.bar.hidden = false;
    this.els.scrub.max = String(Math.max(0, this.timeline.length - 1));
    this.els.scrub.value = '0';
    this.index = 0;
    this.playing = true;
    this.els.play.textContent = '暂停';
    this._render();
  };

  ReplayViewer.prototype.close = function () {
    this.els.bar.hidden = true;
    this.playing = false;
    this.timeline = [];
  };

  ReplayViewer.prototype.togglePlay = function () {
    if (!this.timeline.length) return;
    this.playing = !this.playing;
    this.els.play.textContent = this.playing ? '暂停' : '播放';
  };

  ReplayViewer.prototype.scrub = function (value) {
    this.index = Number(value);
    this.playing = false;
    this.els.play.textContent = '播放';
    this._render();
  };

  ReplayViewer.prototype.tick = function () {
    if (!this.playing || !this.timeline.length) return;
    this.index += 1;
    if (this.index >= this.timeline.length) {
      this.index = this.timeline.length - 1;
      this.playing = false;
      this.els.play.textContent = '播放';
    }
    this.els.scrub.value = String(this.index);
    this._render();
  };

  ReplayViewer.prototype._render = function () {
    const snap = this.timeline[this.index];
    if (snap && this.renderFn) this.renderFn(snap);
    const tick = snap ? snap.tick : 0;
    this.els.label.textContent = tick + ' / ' +
      (this.replay ? this.replay.finalTick : 0) + ' tick' +
      (this.replay && this.replay.conflicts.length
        ? ' · 冲突 ' + this.replay.conflicts.length : '');
  };

  ReplayViewer.prototype.exportJson = function () {
    if (!this.replay) return;
    const blob = new Blob([JSON.stringify(this.replay, null, 2)],
      { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'diving-bell-replay.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  window.DBReplayViewer = ReplayViewer;
})();
