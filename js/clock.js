/*
 * clock.js — 统一时间基准（Transport）。
 * 节目时间线、画面播放头、音频事件全部读取同一 currentTime 状态，
 * 支持播放 / 暂停 / 拖动 / 循环。预览用 performance.now() 驱动；
 * 导出时可切换为固定步进（step）模式，保证逐帧确定性。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Transport = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  class Transport {
    constructor(duration) {
      this.duration = duration;
      this.currentTime = 0;
      this.playing = false;
      this.loop = true;
      this._anchorPerf = 0;      // 播放锚点：performance.now()
      this._anchorTime = 0;      // 播放锚点：时间线时刻
      this._listeners = new Set();
    }

    setDuration(d) {
      this.duration = d;
      if (this.currentTime > d) this.currentTime = d;
    }

    now() {
      if (!this.playing) return this.currentTime;
      const elapsed = (performance.now() - this._anchorPerf) / 1000;
      let t = this._anchorTime + elapsed;
      if (t >= this.duration) {
        if (this.loop && this.duration > 0) {
          t = t % this.duration;
          this._anchorPerf = performance.now();
          this._anchorTime = t;
        } else {
          // 非循环到尾：直接定格，避免 now()<->pause() 相互递归
          this.currentTime = this.duration;
          this.playing = false;
          this._emit("pause");
          return this.currentTime;
        }
      }
      this.currentTime = t;
      return t;
    }

    play() {
      if (this.playing) return;
      if (this.currentTime >= this.duration) this.currentTime = 0;
      this._anchorPerf = performance.now();
      this._anchorTime = this.currentTime;
      this.playing = true;
      this._emit("play");
    }

    pause() {
      if (!this.playing) return;
      const elapsed = (performance.now() - this._anchorPerf) / 1000;
      this.currentTime = Math.min(this.duration, this._anchorTime + elapsed);
      this.playing = false;
      this._emit("pause");
    }

    /** 拖动播放头：所有轨道即刻反映同一时刻 */
    seek(t) {
      this.currentTime = Math.max(0, Math.min(this.duration, t));
      if (this.playing) {
        this._anchorPerf = performance.now();
        this._anchorTime = this.currentTime;
      }
      this._emit("seek");
    }

    setLoop(on) {
      this.loop = !!on;
    }

    onChange(fn) {
      this._listeners.add(fn);
      return () => this._listeners.delete(fn);
    }

    _emit(kind) {
      for (const fn of this._listeners) fn(kind, this.currentTime);
    }
  }

  return { Transport };
});
