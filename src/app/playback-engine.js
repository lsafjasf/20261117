import { clamp, msToSec } from '../core/time.js';
import { localTime } from '../core/model.js';
import { SCENE_RENDERERS } from './scenes.js';
import { renderTransition } from './transitions.js';

// 单一共享状态：播放头、播放/暂停、循环、时间线模型全部集中于此。
export class PlaybackEngine {
  constructor(model, canvas, audioEngine) {
    this.model = model;
    this.canvas = canvas;
    this.audio = audioEngine;
    this.ctx = canvas.getContext('2d');
    this.state = {
      playheadMs: 0,
      playing: false,
      loop: true,
      durationMs: model.durationMs,
    };
    this.rafId = 0;
    this.lastWall = 0;
    this._tick = this._tick.bind(this);
    this.onFrame = null;
  }

  get playheadMs() { return this.state.playheadMs; }

  play() {
    if (this.state.playing) return;
    this.audio.ensureContext();
    if (this.state.playheadMs >= this.state.durationMs) this.seek(0);
    this.state.playing = true;
    this.lastWall = performance.now();
    this.rafId = requestAnimationFrame(this._tick);
    this._emit();
  }

  pause() {
    this.state.playing = false;
    cancelAnimationFrame(this.rafId);
    this.audio.suspend();
    this._emit();
  }

  toggle() { this.state.playing ? this.pause() : this.play(); }

  setLoop(v) { this.state.loop = v; this._emit(); }

  // 拖动：重建画面与音频，音频不保留旧调度，确保拖动后音画仍对齐。
  seek(ms) {
    const target = clamp(ms, 0, this.state.durationMs);
    this.state.playheadMs = target;
    this.audio.stopAll();
    if (this.state.playing) {
      this.audio.ensureContext();
      this.audio.update(target, this.model.audioEvents, true);
      this.lastWall = performance.now();
    }
    this.render();
    this._emit();
  }

  syncDuration() {
    this.state.durationMs = this.model.durationMs;
    this.state.playheadMs = clamp(this.state.playheadMs, 0, this.state.durationMs);
    this.render();
    this._emit();
  }

  _tick(now) {
    if (!this.state.playing) return;
    const delta = now - this.lastWall;
    this.lastWall = now;
    let next = this.state.playheadMs + delta;
    if (next >= this.state.durationMs) {
      if (this.state.loop) {
        next = next % this.state.durationMs;
        this.audio.stopAll();
      } else {
        next = this.state.durationMs;
        this.pause();
      }
    }
    this.state.playheadMs = next;
    this.audio.update(next, this.model.audioEvents, this.state.playing);
    this.render();
    this._emit();
    if (this.state.playing) this.rafId = requestAnimationFrame(this._tick);
  }

  render() {
    const t = this.state.playheadMs;
    const active = this.model.activeAt(t);
    const { width: w, height: h } = this.canvas;
    this.ctx.clearRect(0, 0, w, h);

    if (active.transition && active.clips.length >= 2) {
      const tr = active.transition;
      const from = active.clips.find((c) => c.id === tr.fromClip);
      const to = active.clips.find((c) => c.id === tr.toClip);
      const p = clamp((t - tr.startMs) / tr.durationMs, 0, 1);
      renderTransition(
        this.canvas, from, to,
        localTime(from, t), localTime(to, t), tr.type, p);
    } else if (active.clips.length) {
      const clip = active.clips[0];
      SCENE_RENDERERS[clip.source](this.ctx, w, h, localTime(clip, t));
    } else {
      this.ctx.fillStyle = '#000';
      this.ctx.fillRect(0, 0, w, h);
    }

    const sub = active.subtitles[active.subtitles.length - 1];
    if (sub) this._drawSubtitle(sub.text, w, h);
  }

  _drawSubtitle(text, w, h) {
    this.ctx.font = '600 26px system-ui, sans-serif';
    const metrics = this.ctx.measureText(text);
    const padX = 18;
    const boxW = metrics.width + padX * 2;
    const boxH = 46;
    const x = (w - boxW) / 2;
    const y = h - 78;
    this.ctx.fillStyle = 'rgba(0,0,0,0.55)';
    this.ctx.fillRect(x, y, boxW, boxH);
    this.ctx.fillStyle = '#fff';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(text, w / 2, y + boxH / 2);
    this.ctx.textBaseline = 'alphabetic';
  }

  _emit() {
    if (this.onFrame) this.onFrame({ ...this.state, t: msToSec(this.state.playheadMs) });
  }
}
