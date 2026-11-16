/*
 * audio.js — Web Audio 背景声。
 * 音频事件与画面共用 Transport 时间基准：
 * 播放/拖动时按 audioCtx.currentTime 与时间线的偏移重新调度，
 * 暂停时全部停止。导出时改接 MediaStreamDestination 以混流进视频。
 */
(function (root) {
  "use strict";

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.recDest = null;      // 导出用旁路
      this._nodes = [];         // 当前发声节点
      this._timer = null;
    }

    ensureContext() {
      if (!this.ctx) {
        const AC = root.AudioContext || root.webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.9;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
      return this.ctx;
    }

    /** 导出时调用：返回可混入 MediaRecorder 的流 */
    attachRecordingTap() {
      this.ensureContext();
      this.recDest = this.ctx.createMediaStreamDestination();
      this.master.connect(this.recDest);
      return this.recDest.stream;
    }

    detachRecordingTap() {
      if (this.recDest) {
        try { this.master.disconnect(this.recDest); } catch (e) { /* 已断开 */ }
        this.recDest = null;
      }
    }

    /**
     * 从时间线 fromTime 起调度所有音频事件。
     * 映射：audioTime = ctx.currentTime + (eventTime - fromTime)
     */
    scheduleFrom(events, fromTime) {
      this.ensureContext();
      this.stopAll();
      const now = this.ctx.currentTime;
      for (const ev of events) {
        const evEnd = ev.start + ev.duration;
        if (evEnd <= fromTime) continue; // 已结束的事件跳过
        const offset = Math.max(0, fromTime - ev.start); // 事件内偏移
        const when = now + Math.max(0, ev.start - fromTime);
        const remain = evEnd - Math.max(fromTime, ev.start);
        this._spawn(ev, when, remain, offset);
      }
    }

    _spawn(ev, when, duration, offset) {
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = ev.type === "pad" ? "sine" : "triangle";
      osc.frequency.value = ev.freq;
      const peak = ev.gain;
      const g = gain.gain;
      g.setValueAtTime(0.0001, when);
      g.exponentialRampToValueAtTime(Math.max(peak, 0.0001), when + 0.05);
      g.setValueAtTime(Math.max(peak, 0.0001), when + Math.max(0.05, duration - 0.1));
      g.exponentialRampToValueAtTime(0.0001, when + duration);
      osc.connect(gain).connect(this.master);
      osc.start(when, offset);
      osc.stop(when + duration + 0.05);
      this._nodes.push(osc, gain);
    }

    stopAll() {
      for (const n of this._nodes) {
        try { if (n.stop) n.stop(); } catch (e) { /* 已停止 */ }
        try { n.disconnect(); } catch (e) { /* 已断开 */ }
      }
      this._nodes = [];
    }
  }

  root.AudioEngine = AudioEngine;
})(typeof self !== "undefined" ? self : this);
