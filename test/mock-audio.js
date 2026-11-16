// 轻量 AudioContext mock：用于无音频设备环境下测试引擎调度与节点生命周期。
// 真实 DSP 行为由 node-web-audio-api 的 OfflineAudioContext 测试覆盖。

class MockParam {
  constructor(value = 0) { this.value = value; }
  setValueAtTime(v) { this.value = v; }
  linearRampToValueAtTime(v) { this.value = v; }
  setTargetAtTime(v, _t, tc) { this.value = this.value + (v - this.value) * Math.min(1, 0.2 / (tc + 0.2)); }
  cancelScheduledValues() { /* no-op */ }
}

class MockNode {
  constructor(ctx) {
    this.ctx = ctx;
    this.connections = new Set();
    this.state = "running";
  }
  connect(dest) { this.connections.add(dest); return dest; }
  disconnect() { this.connections.clear(); this.state = "closed"; }
}

class MockOscillator extends MockNode {
  constructor(ctx) {
    super(ctx);
    this.frequency = new MockParam(440);
    this.detune = new MockParam(0);
    this.type = "sine";
    this.state = "unscheduled";
    this.onended = null;
  }
  start() {
    this.state = "scheduled";
    this.ctx._active.add(this);
  }
  stop(when) {
    if (this.state === "closed") return;
    this.state = "closed";
    this._closed = true;
    this.ctx._active.delete(this);
    const cb = this.onended;
    this.onended = null;
    if (cb) cb();
  }
}

class MockAnalyser extends MockNode {
  constructor(ctx) {
    super(ctx);
    this.fftSize = 2048;
  }
  getFloatTimeDomainData(buf) { buf.fill(0); }
}

export class MockAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 48000;
    this.destination = new MockNode(this);
    this._timers = [];
    this._active = new Set();
    this._clock = setInterval(() => { this.currentTime += 0.025; }, 25);
    this._clock.unref();
  }
  createGain() { const n = new MockNode(this); n.gain = new MockParam(1); return n; }
  createOscillator() { return new MockOscillator(this); }
  createBiquadFilter() {
    const n = new MockNode(this);
    n.frequency = new MockParam(1000);
    n.gain = new MockParam(0);
    n.Q = new MockParam(1);
    n.type = "peaking";
    return n;
  }
  createDelay() { const n = new MockNode(this); n.delayTime = new MockParam(0); return n; }
  createStereoPanner() { const n = new MockNode(this); n.pan = new MockParam(0); return n; }
  createAnalyser() { return new MockAnalyser(this); }
  createChannelSplitter() { return new MockNode(this); }
  createChannelMerger() { return new MockNode(this); }
  async resume() { this.state = "running"; }
  async close() {
    clearInterval(this._clock);
    for (const t of this._timers) clearTimeout(t);
    this.state = "closed";
  }
}
