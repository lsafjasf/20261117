// 音频引擎：实时合成、监听路由（主输出/旁路/静音）、节点登记防泄漏

export const EVENT_TYPES = ['success', 'warning', 'error'];

export const EVENT_META = {
  success: { label: '成功', color: '#4ade80', defaultPan: -0.7 },
  warning: { label: '警告', color: '#facc15', defaultPan: 0.0 },
  error:   { label: '错误', color: '#f87171', defaultPan: 0.7 },
};

export function defaultParams() {
  return {
    masterVolume: 0.8,
    stepInterval: 280, // ms
    success: { pitch: 880, decay: 0.35, pan: -0.7 },
    warning: { pitch: 620, decay: 0.25, pan: 0.0 },
    error:   { pitch: 220, decay: 0.50, pan: 0.7 },
  };
}

// 在任意 BaseAudioContext 上构建一个事件音色（在线与离线渲染共用）
// 返回 { nodes, stopAt }，onEnded 在全部节点停止后回调用于回收
export function buildVoice(ctx, out, type, when, p, onEnded) {
  const env = ctx.createGain();
  const panner = ctx.createStereoPanner();
  panner.pan.setValueAtTime(p.pan, when);
  env.connect(panner);
  panner.connect(out);
  const nodes = [env, panner];
  const oscs = [];
  const peak = 0.5;
  const atk = 0.006;
  const dec = Math.max(0.05, p.decay);

  function addOsc(wave, freqFn) {
    const o = ctx.createOscillator();
    o.type = wave;
    freqFn(o.frequency);
    oscs.push(o);
    nodes.push(o);
    return o;
  }

  if (type === 'success') {
    // 上行双音琶音 + 高八度泛音
    const o1 = addOsc('sine', (f) => {
      f.setValueAtTime(p.pitch, when);
      f.setValueAtTime(p.pitch * 1.335, when + 0.09);
    });
    const o2 = addOsc('triangle', (f) => {
      f.setValueAtTime(p.pitch * 2, when);
      f.setValueAtTime(p.pitch * 2.67, when + 0.09);
    });
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    o1.connect(env);
    o2.connect(g2);
    g2.connect(env);
    nodes.push(g2);
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(peak, when + atk);
    env.gain.exponentialRampToValueAtTime(0.0001, when + dec);
  } else if (type === 'warning') {
    // 双脉冲方波 + 低通
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = p.pitch * 4;
    lp.connect(env);
    nodes.push(lp);
    const o = addOsc('square', (f) => f.setValueAtTime(p.pitch, when));
    o.connect(lp);
    const g = env.gain;
    g.setValueAtTime(0, when);
    g.linearRampToValueAtTime(peak * 0.7, when + atk);
    g.linearRampToValueAtTime(0.02, when + 0.09);
    g.linearRampToValueAtTime(peak * 0.7, when + 0.12);
    g.exponentialRampToValueAtTime(0.0001, when + dec + 0.12);
  } else {
    // 错误：下滑锯齿波 + 低通
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1200;
    lp.connect(env);
    nodes.push(lp);
    const o = addOsc('sawtooth', (f) => {
      f.setValueAtTime(p.pitch, when);
      f.exponentialRampToValueAtTime(Math.max(40, p.pitch * 0.5), when + dec);
    });
    o.connect(lp);
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(peak * 0.8, when + atk);
    env.gain.exponentialRampToValueAtTime(0.0001, when + dec);
  }

  const stopAt = when + dec + 0.25;
  for (const o of oscs) {
    o.start(when);
    o.stop(stopAt);
  }
  oscs[0].onended = () => {
    for (const n of nodes) {
      try { n.disconnect(); } catch (_) { /* 已断开 */ }
    }
    if (onEnded) onEnded();
  };
  return { nodes, oscs, env, stopAt };
}

export class Engine {
  constructor() {
    this.ctx = null;
    this.params = defaultParams();
    this.monitor = 'master'; // master | bypass | mute
    this.voices = new Set();
    this.maxVoices = 24; // 连发时限制并发，旧声音快速淡出防遮蔽
    this.activeNodes = 0;
    this.onVoiceChange = null;
  }

  ensure() {
    if (this.ctx && this.ctx.state !== 'closed') return;
    const ctx = (this.ctx = new AudioContext());
    this.bus = ctx.createGain();
    // 主输出链路：总线 → 压缩 → 主增益 → 电平总线
    this.procGain = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.masterGain = ctx.createGain();
    // 旁路链路：总线直连
    this.directGain = ctx.createGain();
    this.meterBus = ctx.createGain();
    this.bus.connect(this.procGain);
    this.procGain.connect(this.comp);
    this.comp.connect(this.masterGain);
    this.masterGain.connect(this.meterBus);
    this.bus.connect(this.directGain);
    this.directGain.connect(this.meterBus);
    this.meterBus.connect(ctx.destination);
    // 声道电平分析
    this.splitter = ctx.createChannelSplitter(2);
    this.meterBus.connect(this.splitter);
    this.analyserL = ctx.createAnalyser();
    this.analyserR = ctx.createAnalyser();
    this.analyserL.fftSize = 2048;
    this.analyserR.fftSize = 2048;
    this.splitter.connect(this.analyserL, 0);
    this.splitter.connect(this.analyserR, 1);
    this.applyMonitor();
    this.masterGain.gain.value = this.params.masterVolume;
  }

  applyMonitor() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const set = (g, v) => g.gain.setTargetAtTime(v, t, 0.01);
    set(this.procGain, this.monitor === 'master' ? 1 : 0);
    set(this.directGain, this.monitor === 'bypass' ? 1 : 0);
    // mute：两路都为 0
  }

  setMonitor(mode) {
    this.monitor = mode;
    this.applyMonitor();
  }

  setMasterVolume(v) {
    this.params.masterVolume = v;
    if (this.ctx) this.masterGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01);
  }

  trigger(type, when) {
    this.ensure();
    const t = when !== undefined ? when : this.ctx.currentTime + 0.02;
    // 并发上限：偷走最旧的声音，快速淡出避免爆音与遮蔽
    if (this.voices.size >= this.maxVoices) {
      const oldest = this.voices.values().next().value;
      this.releaseVoice(oldest, 0.02);
    }
    const voice = { type, startTime: t };
    const handle = buildVoice(this.ctx, this.bus, type, t, this.params[type], () => {
      this.activeNodes -= handle.nodes.length;
      this.voices.delete(voice);
      if (this.onVoiceChange) this.onVoiceChange();
    });
    voice.handle = handle;
    this.voices.add(voice);
    this.activeNodes += handle.nodes.length;
    if (this.onVoiceChange) this.onVoiceChange();
    return voice;
  }

  releaseVoice(voice, fade = 0.015) {
    if (!voice || !voice.handle) return;
    const now = this.ctx.currentTime;
    const { env, oscs } = voice.handle;
    try {
      env.gain.cancelScheduledValues(now);
      env.gain.setTargetAtTime(0, now, fade / 3);
      for (const o of oscs) o.stop(now + fade + 0.05);
    } catch (_) { /* 已停止 */ }
  }

  // 立即停止所有声音（暂停/关闭用），不留尾音
  stopAll() {
    if (!this.ctx) return;
    for (const v of [...this.voices]) this.releaseVoice(v);
  }

  async shutdown() {
    this.stopAll();
    if (!this.ctx) return;
    const ctx = this.ctx;
    await new Promise((r) => setTimeout(r, 120)); // 等淡出与 onended 回收
    this.stopAll();
    if (ctx.state !== 'closed') await ctx.close();
    if (this.ctx === ctx) this.ctx = null;
    this.voices.clear();
    this.activeNodes = 0;
    if (this.onVoiceChange) this.onVoiceChange();
  }

  getLevels() {
    if (!this.ctx || this.ctx.state !== 'running') return { l: 0, r: 0 };
    const bufL = new Float32Array(this.analyserL.fftSize);
    const bufR = new Float32Array(this.analyserR.fftSize);
    this.analyserL.getFloatTimeDomainData(bufL);
    this.analyserR.getFloatTimeDomainData(bufR);
    const rms = (b) => Math.sqrt(b.reduce((s, x) => s + x * x, 0) / b.length);
    return { l: rms(bufL), r: rms(bufR), bufL, bufR };
  }
}
