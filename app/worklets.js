// AudioWorklet 处理器源码（运行时通过 Blob URL 注册，在线/离线上下文共用）
const WORKLET_SOURCE = `
class NoiseGen extends AudioWorkletProcessor {
  static get parameterDescriptors() { return []; }
  process(inputs, outputs) {
    const out = outputs[0];
    for (let ch = 0; ch < out.length; ch++) {
      const buf = out[ch];
      for (let i = 0; i < buf.length; i++) buf[i] = Math.random() * 2 - 1;
    }
    return true;
  }
}
registerProcessor('noise-gen', NoiseGen);

// 按调度消息输出分段包络，通过 gainParam 控制外部 GainNode
class EnvelopeGen extends AudioWorkletProcessor {
  constructor() {
    super();
    this.events = [];
    this.active = null;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'schedule') this.events.push({ t: d.t, dur: d.dur, amp: d.amp });
      if (d.type === 'clear') this.events.length = 0;
    };
  }
  process(inputs, outputs, params) {
    const out = outputs[0][0];
    const sr = sampleRate;
    for (let i = 0; i < out.length; i++) {
      const now = currentTime + i / sr;
      while (this.events.length && this.events[0].t <= now) {
        if (this.active) this.events.push(this.active);
        this.active = this.events.shift();
        this.active.env = 0;
      }
      let v = 0;
      if (this.active) {
        const ev = this.active;
        const dt = now - ev.t;
        const atk = Math.max(1 / sr, ev.dur * 0.08);
        const relStart = ev.dur * 0.45;
        if (dt >= ev.dur) { this.active = null; }
        else if (dt < atk) { ev.env = dt / atk; v = ev.amp * ev.env; }
        else if (dt < relStart) { v = ev.amp; }
        else { v = ev.amp * Math.max(0, 1 - (dt - relStart)) / (ev.dur - relStart); }
      }
      out[i] = v;
    }
    return true;
  }
}
registerProcessor('envelope-gen', EnvelopeGen);

// 频段门限：每通道独立包络跟随 + 阈值门，bypass=1 时直通
class GateWorklet extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: 0.1, minValue: 0, maxValue: 1 },
      { name: 'bypass', defaultValue: 0, minValue: 0, maxValue: 1 },
      { name: 'closedGain', defaultValue: 0.0008, minValue: 0, maxValue: 1 }
    ];
  }
  process(inputs, outputs, params) {
    const inp = inputs[0];
    if (!inp || !inp.length) return true;
    const out = outputs[0];
    const sr = sampleRate;
    const atk = Math.exp(-1 / (0.003 * sr));
    const rel = Math.exp(-1 / (0.09 * sr));
    const thr = params.threshold[0];
    const bp = params.bypass[0];
    const cg = params.closedGain[0];
    if (!this.env) this.env = new Array(inp.length).fill(0);
    for (let ch = 0; ch < inp.length; ch++) {
      const ib = inp[ch], ob = out[ch];
      let e = this.env[ch] || 0;
      for (let i = 0; i < ib.length; i++) {
        const x = ib[i];
        const sq = x * x;
        e = sq > e ? atk * e + (1 - atk) * sq : rel * e + (1 - rel) * sq;
        const open = e >= thr * thr;
        const g = bp > 0.5 ? 1 : (open ? 1 : cg);
        ob[i] = x * g;
      }
      this.env[ch] = e;
    }
    return true;
  }
}
registerProcessor('gate-worklet', GateWorklet);

// 电平表：透传音频，定期上报每通道 RMS（在线/离线均可用，替代 AnalyserNode）
class MeterWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.acc = null;
    this.n = 0;
    this.period = 256;
  }
  process(inputs, outputs) {
    const inp = inputs[0];
    if (!inp || !inp.length) return true;
    if (!this.acc) this.acc = new Array(inp.length).fill(0);
    for (let ch = 0; ch < inp.length; ch++) {
      const ib = inp[ch], ob = outputs[0][ch];
      let s = 0;
      for (let i = 0; i < ib.length; i++) { ob[i] = ib[i]; s += ib[i] * ib[i]; }
      this.acc[ch] += s;
    }
    this.n += inp[0].length;
    if (this.n >= this.period) {
      const rms = this.acc.map((s) => Math.sqrt(s / this.n));
      this.port.postMessage({ rms });
      this.acc.fill(0);
      this.n = 0;
    }
    return true;
  }
}
registerProcessor('meter-worklet', MeterWorklet);
`;
