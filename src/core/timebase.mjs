// 全工程唯一的时间基准：视频帧、字幕轨道、动画时钟、音频事件都以这里的
// programTime（秒，浮点）为准，不允许各模块各自维护一份“当前时间”。

export const FPS = 30;
export const BEAT_INTERVAL = 0.5; // 120 BPM，每拍 0.5 秒

export const PLAYBACK = Object.freeze({
  IDLE: "idle",
  PLAYING: "playing",
  PAUSED: "paused",
  LOOPING: "looping"
});

export function frameToTime(frame, fps = FPS) {
  return frame / fps;
}

export function timeToFrame(time, fps = FPS) {
  return Math.round(time * fps);
}

export function snapTimeToFrame(time, fps = FPS) {
  return Math.round(time * fps) / fps;
}

export function nextBeat(time, interval = BEAT_INTERVAL) {
  return Math.ceil(time / interval - 1e-9) * interval;
}

export function prevBeat(time, interval = BEAT_INTERVAL) {
  return Math.floor(time / interval + 1e-9) * interval;
}

export function nearestBeat(time, interval = BEAT_INTERVAL) {
  const n = Math.round(time / interval);
  return snapTimeToFrame(n * interval);
}

export function isOnBeat(time, interval = BEAT_INTERVAL, epsilon = 1e-6) {
  return Math.abs(time / interval - Math.round(time / interval)) < epsilon;
}

// 节拍事件列表：音频引擎与“切点必须在拍上”的校验共用同一份数据。
export function beatEvents(duration, interval = BEAT_INTERVAL) {
  const count = Math.floor(duration / interval + 1e-9) + 1;
  return Array.from({ length: count }, (_, i) =>
    snapTimeToFrame(i * interval)
  );
}

// 共享时间状态机。perfNow 注入便于测试；UI 传入 performance.now。
export class TimelineClock {
  constructor({ duration = 0, loop = true, perfNow = () => Date.now() } = {}) {
    this.duration = duration;
    this.loop = loop;
    this.perfNow = perfNow;
    this.state = PLAYBACK.IDLE;
    this._time = 0;
    this._anchorPerf = 0;
    this._anchorTime = 0;
    this._lastBeatIndex = -1;
    this.onBeat = null;
    this.onLoop = null;
    this.onEnd = null;
  }

  setDuration(duration) {
    this.duration = Math.max(0, duration);
    if (this._time > this.duration) this.seek(this.duration);
  }

  get time() {
    if (this.state !== PLAYBACK.PLAYING && this.state !== PLAYBACK.LOOPING) {
      return this._time;
    }
    return this._anchorTime + (this.perfNow() - this._anchorPerf) / 1000;
  }

  play() {
    if (this.state === PLAYBACK.PLAYING || this.state === PLAYBACK.LOOPING) return;
    if (this._time >= this.duration - 1e-9) this._time = 0;
    this._anchorPerf = this.perfNow();
    this._anchorTime = this._time;
    this.state = this.loop ? PLAYBACK.LOOPING : PLAYBACK.PLAYING;
    this._lastBeatIndex = Math.floor(this._time / BEAT_INTERVAL);
  }

  pause() {
    if (this.state === PLAYBACK.PLAYING || this.state === PLAYBACK.LOOPING) {
      this._time = this.time;
    }
    this.state = PLAYBACK.PAUSED;
  }

  seek(time) {
    const t = Math.min(Math.max(0, time), this.duration);
    this._time = t;
    this._anchorPerf = this.perfNow();
    this._anchorTime = t;
    this._lastBeatIndex = Math.floor(t / BEAT_INTERVAL) - 1;
  }

  // 每帧调用，返回当前节目时间；处理循环与节拍回调。
  tick() {
    let t = this.time;
    if (t >= this.duration) {
      if (this.loop) {
        const wraps = Math.floor(t / this.duration);
        t = t % this.duration;
        this.seek(t);
        this._lastBeatIndex = -1;
        this.onLoop?.(wraps);
      } else {
        t = this.duration;
        this.seek(t);
        this.state = PLAYBACK.PAUSED;
        this.onEnd?.();
      }
    }
    const beatIndex = Math.floor(t / BEAT_INTERVAL + 1e-9);
    if (beatIndex !== this._lastBeatIndex) {
      this._lastBeatIndex = beatIndex;
      this.onBeat?.(snapTimeToFrame(beatIndex * BEAT_INTERVAL), beatIndex);
    }
    return t;
  }
}
