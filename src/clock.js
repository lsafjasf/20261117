// 节目时间线、画面播放头与音频事件共用的唯一时钟。
// 所有模块只订阅这个状态，不各自维护“当前时间”。

import { SOURCE_DURATION } from './model.js';

export class TransportClock {
  constructor() {
    this.state = {
      time: 0,
      playing: false,
      loop: true,
      loopIn: 0,
      loopOut: SOURCE_DURATION,
      rate: 1,
    };
    this.listeners = new Set();
    this.rafId = 0;
    this.lastNow = 0;
    this.tick = this.tick.bind(this);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.state, 'subscribe');
    return () => this.listeners.delete(listener);
  }

  emit(reason) {
    for (const listener of this.listeners) listener(this.state, reason);
  }

  setLoopBounds(loopIn, loopOut) {
    this.state.loopIn = loopIn;
    this.state.loopOut = loopOut;
    if (this.state.time < loopIn || this.state.time > loopOut) {
      this.seek(loopIn);
    }
    this.emit('bounds');
  }

  seek(time) {
    const clamped = Math.min(
      Math.max(time, this.state.loopIn),
      this.state.loopOut,
    );
    this.state.time = clamped;
    this.emit('seek');
  }

  frameStep(frames, frameDuration) {
    this.pause();
    this.seek(this.state.time + frames * frameDuration);
  }

  play() {
    if (this.state.playing) return;
    if (this.state.time >= this.state.loopOut - 1e-9) {
      this.state.time = this.state.loopIn;
    }
    this.state.playing = true;
    this.lastNow = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
    this.emit('play');
  }

  pause() {
    if (!this.state.playing) return;
    this.state.playing = false;
    cancelAnimationFrame(this.rafId);
    this.emit('pause');
  }

  toggle() {
    if (this.state.playing) this.pause();
    else this.play();
  }

  tick(now) {
    if (!this.state.playing) return;
    const delta = (now - this.lastNow) / 1000;
    this.lastNow = now;
    let next = this.state.time + delta * this.state.rate;
    if (next >= this.state.loopOut) {
      if (this.state.loop) {
        const span = this.state.loopOut - this.state.loopIn;
        next = this.state.loopIn + ((next - this.state.loopIn) % span);
        this.emit('loop-wrap');
      } else {
        next = this.state.loopOut;
        this.state.playing = false;
        this.state.time = next;
        this.emit('end');
        return;
      }
    }
    this.state.time = next;
    this.emit('tick');
    this.rafId = requestAnimationFrame(this.tick);
  }
}
