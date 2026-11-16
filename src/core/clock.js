// TransportClock is the single source of truth shared by the program timeline,
// the canvas playhead and the audio engine. It is intentionally free of DOM
// and audio APIs so the exact same state machine runs in Node tests and in
// the browser.

export class TransportClock {
  constructor({ inPoint = 0, outPoint = 0, loop = false, now } = {}) {
    this.time = inPoint;
    this.inPoint = inPoint;
    this.outPoint = outPoint;
    this.playing = false;
    this.loop = loop;
    // Optional platform clock; tests inject a controllable one.
    this._now = now || (typeof performance !== 'undefined'
      ? () => performance.now()
      : () => Date.now());
    this._lastTick = this._now();
  }

  get duration() {
    return Math.max(0, this.outPoint - this.inPoint);
  }

  play() {
    if (this.playing) return;
    if (this.outPoint > 0 && this.time >= this.outPoint) {
      this.time = this.inPoint;
    }
    this.playing = true;
    this._lastTick = this._now();
  }

  pause() {
    this.playing = false;
  }

  seek(time) {
    const next = this._clamp(time);
    this.time = next;
    this._lastTick = this._now();
    return next;
  }

  setRange(inPoint, outPoint) {
    if (outPoint < inPoint) {
      throw new Error(`Invalid range: out (${outPoint}) < in (${inPoint})`);
    }
    this.inPoint = inPoint;
    this.outPoint = outPoint;
    if (this.time < inPoint) this.time = inPoint;
    if (this.time > outPoint) this.time = outPoint;
  }

  // Advance using wall-clock delta. Returns the current time after advancing
  // and a flag indicating the transport stopped (or wrapped while looping).
  tick() {
    const wallNow = this._now();
    const delta = wallNow - this._lastTick;
    this._lastTick = wallNow;
    if (!this.playing) return { time: this.time, wrapped: false, ended: false };

    let wrapped = false;
    this.time += delta;
    if (this.outPoint > 0 && this.time >= this.outPoint) {
      if (this.loop) {
        this.time = this.inPoint + (this.time - this.outPoint) % this.duration;
        wrapped = true;
      } else {
        this.time = this.outPoint;
        this.playing = false;
        return { time: this.time, wrapped, ended: true };
      }
    }
    return { time: this.time, wrapped, ended: false };
  }

  // Deterministic variant used by offline exporters/tests: jump by a fixed
  // number of milliseconds without touching a platform clock.
  advance(deltaMs) {
    let wrapped = false;
    this.time += deltaMs;
    if (this.outPoint > 0 && this.time >= this.outPoint) {
      if (this.loop) {
        this.time = this.inPoint + (this.time - this.outPoint) % this.duration;
        wrapped = true;
      } else {
        this.time = this.outPoint;
        this.playing = false;
        return { time: this.time, wrapped, ended: true };
      }
    }
    return { time: this.time, wrapped, ended: false };
  }

  _clamp(time) {
    let value = time;
    if (this.outPoint > 0) value = Math.min(value, this.outPoint);
    value = Math.max(value, this.inPoint);
    return value;
  }

  snapshot() {
    return {
      time: this.time,
      inPoint: this.inPoint,
      outPoint: this.outPoint,
      playing: this.playing,
      loop: this.loop
    };
  }
}
