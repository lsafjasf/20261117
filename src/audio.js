// Web Audio 鼓点合成 + 前瞻调度。调度只读取共享时钟的时间，
// 事件时间线来自 model.mappedAudioEvents（含用户整体音频偏移）。

const LOOKAHEAD = 0.1; // 秒：提前调度窗口
const INTERVAL = 25; // 毫秒：调度轮询

export class DrumEngine {
  constructor(clock) {
    this.clock = clock;
    this.ctx = null;
    this.master = null;
    this.analyser = null;
    this.timer = 0;
    this.scheduled = new Set();
    this.events = [];
    this.lastClockTime = 0;
  }

  async ensureContext() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.master.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  setEvents(events) {
    this.events = events;
    this.scheduled.clear();
  }

  start() {
    if (this.timer) return;
    this.lastClockTime = this.clock.state.time;
    this.scheduled.clear();
    this.timer = window.setInterval(() => this.schedule(), INTERVAL);
  }

  stop() {
    window.clearInterval(this.timer);
    this.timer = 0;
    this.scheduled.clear();
  }

  // 循环或拖动后，已经“过去”的事件需要重新允许触发。
  resetSchedule() {
    this.scheduled.clear();
  }

  schedule() {
    if (!this.ctx) return;
    const { time, playing, loopIn, loopOut } = this.clock.state;
    if (!playing) {
      this.resetSchedule();
      return;
    }
    const span = loopOut - loopIn;
    const horizon = time + LOOKAHEAD;
    for (const event of this.events) {
      if (event.audioTime < loopIn - 1e-9 || event.audioTime > loopOut + 1e-9) continue;
      const wrappedNow = ((time - loopIn) % span + span) % span + loopIn;
      const wrappedEvent = ((event.audioTime - loopIn) % span + span) % span + loopIn;
      let delta = wrappedEvent - wrappedNow;
      if (delta < -0.05) delta += span; // 事件在下一轮循环
      if (delta > LOOKAHEAD || delta < -0.05) continue;
      const generation = Math.floor((time - loopIn) / span + (delta < 0 ? 1 : 0));
      const key = `${event.id}:${generation}`;
      if (this.scheduled.has(key)) continue;
      this.scheduled.add(key);
      this.playKick(this.ctx.currentTime + Math.max(0, delta));
    }
  }

  // 单个底鼓：频率下滑的正弦 + 短噪声点击 + 快速包络。
  playKick(when) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, when);
    osc.frequency.exponentialRampToValueAtTime(45, when + 0.12);
    gain.gain.setValueAtTime(0.9, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.22);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(when);
    osc.stop(when + 0.24);

    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.03, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.25, when);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, when + 0.03);
    noise.connect(noiseGain);
    noiseGain.connect(this.master);
    noise.start(when);
  }

  // 导出时按绝对 AudioContext 时间排鼓，不走播放调度器。
  playKickAt(when) {
    this.playKick(when);
  }

  getWaveformSamples(target = 64) {
    if (!this.analyser) return new Uint8Array(target);
    const bins = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(bins);
    const out = new Uint8Array(target);
    const block = Math.floor(bins.length / target) || 1;
    for (let i = 0; i < target; i += 1) {
      let sum = 0;
      for (let j = 0; j < block; j += 1) sum += bins[i * block + j] || 0;
      out[i] = sum / block;
    }
    return out;
  }

  createMediaStreamDestination() {
    const destination = this.ctx.createMediaStreamDestination();
    this.master.connect(destination);
    return destination;
  }
}
