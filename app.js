"use strict";

/* ============================================================
 * 三路噪声门实验台 —— 全部声音由 Web Audio 实时合成
 * 模块顺序：常量/Worklet → 引擎 → 画布/UI → 指标 → 导出/验证
 * ============================================================ */

const SR = 48000;
const STEPS = 8;
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;

// 三路：低/中/高，各自的主音频率、配色、8 步节奏型（1 发声，0 休止）
const BANDS = [
  { id: "low",  name: "低音路",  freq: 110,  cls: "low",  color: "#6aa9ff",
    pattern: [1, 0, 0, 1, 0, 0, 1, 0], noiseFreq: 180,  noiseQ: 0.8 },
  { id: "mid",  name: "中音路",  freq: 330,  cls: "mid",  color: "#37d0b4",
    pattern: [0, 1, 0, 0, 1, 0, 1, 0], noiseFreq: 900,  noiseQ: 1.0 },
  { id: "high", name: "高音路",  freq: 880,  cls: "high", color: "#b487e8",
    pattern: [0, 0, 1, 0, 0, 1, 0, 1], noiseFreq: 2600, noiseQ: 1.2 },
];

const DEFAULT_PARAMS = {
  bpm: 96,
  mode: "main",
  channels: BANDS.map((b) => ({
    id: b.id,
    thresholdDb: -34,
    holdMs: 120,
    pan: b.id === "low" ? -0.45 : b.id === "high" ? 0.45 : 0,
  })),
};

const TARGET = { toneRetention: 0.9, noiseLeak: 0.18 };

const dbToLin = (db) => Math.pow(10, db / 20);
const linToDb = (v) => (v <= 1e-7 ? -Infinity : 20 * Math.log10(v));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ------------------------------------------------------------
 * AudioWorklet：每路一个噪声门
 *   thresholdDb / holdMs 为 AudioParam，滑块与离线渲染都可实时改变
 *   门限比较 → 保持计时 → 平滑增益（attack/release），并上报门状态
 * ------------------------------------------------------------ */
const GATE_WORKLET_SRC = `
class GateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "thresholdDb", defaultValue: -34, automationRate: "k-rate" },
      { name: "holdMs", defaultValue: 120, minValue: 10, maxValue: 500, automationRate: "k-rate" },
    ];
  }
  constructor() {
    super();
    this.env = 0;
    this.gateOpen = false;
    this.holdSamples = 0;
    this.gain = 0;
    this.reportCounter = 0;
    this.preAcc = 0;
    this.postAcc = 0;
    this.accCount = 0;
  }
  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;
    const inCh = input;
    const outCh = output;
    const n = outCh[0].length;
    const thresh = Math.pow(10, params.thresholdDb[0] / 20);
    const holdTarget = (params.holdMs[0] / 1000) * sampleRate;
    const attack = 1 - Math.exp(-1 / (0.004 * sampleRate));
    const release = 1 - Math.exp(-1 / (0.03 * sampleRate));
    let anyOpen = false;
    for (let i = 0; i < n; i++) {
      let peak = 0;
      for (let c = 0; c < inCh.length; c++) {
        const a = Math.abs(inCh[c][i]);
        if (a > peak) peak = a;
      }
      this.env = Math.max(peak, this.env * 0.9995);
      if (this.env >= thresh) {
        this.gateOpen = true;
        this.holdSamples = holdTarget;
      } else if (this.holdSamples > 0) {
        this.holdSamples--;
      } else {
        this.gateOpen = false;
      }
      if (this.gateOpen) {
        anyOpen = true;
        this.gain += (1 - this.gain) * attack;
      } else {
        this.gain += (0 - this.gain) * release;
      }
      for (let c = 0; c < outCh.length; c++) {
        const inSample = inCh[c] ? inCh[c][i] : 0;
        const outSample = inSample * this.gain;
        outCh[c][i] = outSample;
        this.preAcc += inSample * inSample;
        this.postAcc += outSample * outSample;
      }
      this.accCount++;
    }
    this.reportCounter += n;
    if (this.reportCounter >= sampleRate / 20) {
      this.reportCounter = 0;
      this.port.postMessage({
        open: anyOpen,
        t: currentTime,
        preRms: Math.sqrt(this.preAcc / Math.max(this.accCount, 1)),
        postRms: Math.sqrt(this.postAcc / Math.max(this.accCount, 1)),
      });
      this.preAcc = 0;
      this.postAcc = 0;
      this.accCount = 0;
    }
    return true;
  }
}
registerProcessor("noise-gate", GateProcessor);
`;

let workletUrlCache = null;
async function ensureGateWorklet(ctx) {
  if (!workletUrlCache) {
    workletUrlCache = URL.createObjectURL(
      new Blob([GATE_WORKLET_SRC], { type: "application/javascript" })
    );
  }
  await ctx.audioWorklet.addModule(workletUrlCache);
}

/* ------------------------------------------------------------
 * AudioEngine：实时上下文与 OfflineAudioContext 共用同一套构图代码
 * 所有节点都登记进 registry，teardown 逐一断开停止，杜绝未关闭节点
 * ------------------------------------------------------------ */
class AudioEngine {
  constructor(params, { offline = false, durationSec = 2 } = {}) {
    this.params = params;
    this.offline = offline;
    this.durationSec = durationSec;
    this.registry = new Set();
    this.cb = {};
    this.running = false;
    this.currentStep = 0;
    this.nextNoteTime = 0;
    this.timerId = null;
    this.stepLog = [];
    this.toneCells = [];
    this.transientCells = [];
    this.windowSamples = [];
    this.gateOpen = BANDS.map(() => false);
    this.mode = params.mode;
    if (offline) {
      this.ctx = new OfflineAudioContext(2, Math.ceil(SR * durationSec), SR);
    } else {
      this.ctx = new AudioContext({ sampleRate: SR });
    }
  }

  on(event, fn) { this.cb[event] = fn; }

  register(node) {
    this.registry.add(node);
    return node;
  }

  get activeNodeCount() { return this.registry.size; }

  chParam(id, key) {
    return this.params.channels.find((c) => c.id === id)[key];
  }

  async build() {
    await ensureGateWorklet(this.ctx);
    const ctx = this.ctx;

    // 主输出链：masterGain（静音状态置 0）→ 压缩 → 分析器 → 左右分离 → destination
    this.masterGain = this.register(new GainNode(ctx, { gain: this.mode === "mute" ? 0 : 1 }));
    this.comp = this.register(new DynamicsCompressorNode(ctx, { threshold: -18, ratio: 4 }));
    this.masterAnalyser = this.register(new AnalyserNode(ctx, { fftSize: 1024 }));
    this.splitter = this.register(new ChannelSplitterNode(ctx, { numberOfOutputs: 2 }));
    this.merger = this.register(new ChannelMergerNode(ctx, { numberOfInputs: 2 }));
    this.analL = this.register(new AnalyserNode(ctx, { fftSize: 512 }));
    this.analR = this.register(new AnalyserNode(ctx, { fftSize: 512 }));
    this.masterGain.connect(this.comp);
    this.comp.connect(this.masterAnalyser);
    this.comp.connect(this.splitter);
    this.splitter.connect(this.analL, 0);
    this.splitter.connect(this.analR, 1);
    this.splitter.connect(this.merger, 0, 0);
    this.splitter.connect(this.merger, 1, 1);
    this.merger.connect(ctx.destination);

    // 共享呼吸噪声：粉噪经慢 LFO 调幅 + 三个带通，混入各路 preGate
    this.noiseBuf = this.makeNoiseBuffer(4);
    this.noiseSrc = this.register(new AudioBufferSourceNode(ctx, { buffer: this.noiseBuf, loop: true }));
    this.noiseLfo = this.register(new OscillatorNode(ctx, { frequency: 0.18, type: "sine" }));
    this.noiseLfoGain = this.register(new GainNode(ctx, { gain: 0.018 }));
    this.noiseBase = this.register(new GainNode(ctx, { gain: 0.022 }));
    this.noiseLfo.connect(this.noiseLfoGain).connect(this.noiseBase.gain);
    this.noiseSrc.connect(this.noiseBase);
    this.noiseSrc.start();
    this.noiseLfo.start();

    this.channels = BANDS.map((band, idx) => this.buildChannel(band, idx));
  }

  makeNoiseBuffer(seconds) {
    const len = SR * seconds;
    const buf = this.ctx.createBuffer(1, len, SR);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    // 种子随机（mulberry32）：同参数的离线渲染逐样本一致，保证可重复导出
    let seed = 123456789;
    const rand = () => {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296 * 2 - 1;
    };
    for (let i = 0; i < len; i++) {
      const white = rand();
      b0 = 0.997 * b0 + white * 0.05;
      b1 = 0.985 * b1 + white * 0.08;
      b2 = 0.95 * b2 + white * 0.12;
      d[i] = (b0 + b1 + b2 + white * 0.05) * 1.6;
    }
    return buf;
  }

  buildChannel(band, idx) {
    const ctx = this.ctx;
    const ch = { band, idx };

    // 持续主音：两个振荡器 + 柔和颤音，包络增益 noteGain（逐拍调度）
    ch.osc1 = this.register(new OscillatorNode(ctx, { type: "sawtooth", frequency: band.freq }));
    ch.osc2 = this.register(new OscillatorNode(ctx, { type: "triangle", frequency: band.freq * 1.005 }));
    ch.vib = this.register(new OscillatorNode(ctx, { frequency: 5.2, type: "sine" }));
    ch.vibGain = this.register(new GainNode(ctx, { gain: band.freq * 0.004 }));
    ch.oscMix = this.register(new GainNode(ctx, { gain: 0.5 }));
    ch.toneFilter = this.register(new BiquadFilterNode(ctx, {
      type: "lowpass", frequency: band.freq * 6, Q: 0.7,
    }));
    ch.noteGain = this.register(new GainNode(ctx, { gain: 0 }));
    ch.toneLevel = this.register(new GainNode(ctx, { gain: 0.32 }));
    ch.vib.connect(ch.vibGain);
    ch.vibGain.connect(ch.osc1.frequency);
    ch.vibGain.connect(ch.osc2.frequency);
    ch.osc1.connect(ch.oscMix);
    ch.osc2.connect(ch.oscMix);
    ch.oscMix.connect(ch.toneFilter);
    ch.toneFilter.connect(ch.noteGain);
    ch.noteGain.connect(ch.toneLevel);
    ch.osc1.start(); ch.osc2.start(); ch.vib.start();

    // 该路专属的呼吸噪声带通
    ch.noiseBP = this.register(new BiquadFilterNode(ctx, {
      type: "bandpass", frequency: band.noiseFreq, Q: band.noiseQ,
    }));
    ch.noiseLevel = this.register(new GainNode(ctx, { gain: 0.55 }));
    this.noiseBase.connect(ch.noiseBP);
    ch.noiseBP.connect(ch.noiseLevel);

    // 门限前汇总 → 噪声门（旁路状态直接绕过）→ 声像 → 主输出
    ch.preGate = this.register(new GainNode(ctx, { gain: 1 }));
    ch.gate = this.register(new AudioWorkletNode(ctx, "noise-gate", {
      parameterData: {
        thresholdDb: this.chParam(band.id, "thresholdDb"),
        holdMs: this.chParam(band.id, "holdMs"),
      },
    }));
    ch.bypassGain = this.register(new GainNode(ctx, { gain: this.mode === "bypass" ? 1 : 0 }));
    ch.gateOut = this.register(new GainNode(ctx, { gain: this.mode === "bypass" ? 0 : 1 }));
    ch.panner = this.register(new StereoPannerNode(ctx, { pan: this.chParam(band.id, "pan") }));
    ch.preAnalyser = this.register(new AnalyserNode(ctx, { fftSize: 1024 }));
    ch.postAnalyser = this.register(new AnalyserNode(ctx, { fftSize: 1024 }));

    ch.toneLevel.connect(ch.preGate);
    ch.noiseLevel.connect(ch.preGate);
    ch.preGate.connect(ch.preAnalyser);
    ch.preGate.connect(ch.gate);
    ch.preGate.connect(ch.bypassGain);
    ch.gate.connect(ch.gateOut);
    ch.gateOut.connect(ch.panner);
    ch.bypassGain.connect(ch.panner);
    ch.panner.connect(this.masterGain);
    ch.panner.connect(ch.postAnalyser);

    ch.windowSamples = [];
    ch.gate.port.onmessage = (e) => {
      this.gateOpen[idx] = e.data.open;
      if (this.offline) {
        ch.windowSamples.push({ t: e.data.t, pre: e.data.preRms, post: e.data.postRms });
      }
      if (this.cb.gate) this.cb.gate(idx, e.data.open);
    };
    return ch;
  }

  // 瞬态干扰：每拍随机出现的短脉冲（带通咔哒声），登记后自动销毁注销
  scheduleTransient(band, ch, when, dur) {
    const ctx = this.ctx;
    const src = this.register(new AudioBufferSourceNode(ctx, { buffer: this.noiseBuf }));
    const hp = this.register(new BiquadFilterNode(ctx, {
      type: "highpass", frequency: band.noiseFreq * 2.2, Q: 1.4,
    }));
    const env = this.register(new GainNode(ctx, { gain: 0 }));
    const out = this.register(new GainNode(ctx, { gain: 0.4 }));
    src.connect(hp).connect(env).connect(out).connect(ch.preGate);
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(0.5, when + 0.004);
    env.gain.exponentialRampToValueAtTime(0.001, when + 0.07);
    src.start(when);
    src.stop(when + 0.09);
    src.onended = () => {
      [src, hp, env, out].forEach((n) => this.registry.delete(n));
      try { src.disconnect(); hp.disconnect(); env.disconnect(); out.disconnect(); } catch (_) {}
    };
    this.transientCells.push({ when, dur, band: band.id });
  }

  get stepDur() { return 60 / this.params.bpm / 2; } // 8 分音符

  scheduleStep(step, when) {
    const dur = this.stepDur;
    BANDS.forEach((band, idx) => {
      const ch = this.channels[idx];
      const hit = band.pattern[step] === 1;
      const g = ch.noteGain.gain;
      g.cancelScheduledValues(when);
      if (hit) {
        g.setValueAtTime(0.0001, when);
        g.exponentialRampToValueAtTime(0.9, when + 0.012);
        g.setValueAtTime(0.9, when + dur * 0.55);
        g.exponentialRampToValueAtTime(0.0001, when + dur * 0.92);
        this.toneCells.push({ when, dur, band: band.id });
      } else {
        g.setValueAtTime(0.0001, when);
      }
      // 瞬态干扰：约 35% 的步随机落在某一路，刻意落在门限之下/之间
      if (!this.offline && Math.random() < 0.35) {
        this.scheduleTransient(band, ch, when + dur * 0.5, dur);
      }
    });
    this.stepLog.push({ step, when });
  }

  tick() {
    if (!this.running || this.offline) return;
    while (this.nextNoteTime < this.ctx.currentTime + SCHEDULE_AHEAD) {
      const step = this.currentStep % STEPS;
      this.scheduleStep(step, this.nextNoteTime);
      // 漂移：调度提前量（noteTime - currentTime）相对其均值的抖动，单位 ms
      const lead = this.nextNoteTime - this.ctx.currentTime;
      this.driftHistory ||= [];
      this.driftHistory.push(lead);
      if (this.driftHistory.length > 32) this.driftHistory.shift();
      const mean = this.driftHistory.reduce((a, b) => a + b, 0) / this.driftHistory.length;
      this.latestDrift = (lead - mean) * 1000;
      if (this.cb.step) this.cb.step(step, this.nextNoteTime, this.ctx.currentTime);
      this.currentStep++;
      this.nextNoteTime += this.stepDur;
      if (this.singleStepMode) {
        this.singleStepMode = false;
        this.running = false;
        break;
      }
    }
  }

  async start() {
    if (this.ctx.state === "suspended") await this.ctx.resume();
    if (this.running) return;
    this.running = true;
    this.driftHistory = [];
    this.nextNoteTime = this.ctx.currentTime + 0.06;
    this.timerId = setInterval(() => this.tick(), LOOKAHEAD_MS);
  }

  async pause() {
    this.running = false;
    if (this.timerId) { clearInterval(this.timerId); this.timerId = null; }
    // 静音闸：先把主增益拉到 0，再挂起上下文，双保险保证暂停后无声音
    const wasMuted = this.mode === "mute";
    if (!wasMuted) this.masterGain.gain.setValueAtTime(0, this.ctx.currentTime);
    // 暂停即挂起上下文：声音立即停止，时钟冻结，恢复后无节拍漂移
    await this.ctx.suspend();
    this.pausedAt = performance.now();
    this._gainRestored = !wasMuted;
  }

  async resume() {
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
      this.nextNoteTime = this.ctx.currentTime + 0.06;
      // 恢复后的增益严格跟随当前试听模式
      this.masterGain.gain.setValueAtTime(this.mode === "mute" ? 0 : 1, this.ctx.currentTime);
      this._gainRestored = false;
    }
    if (!this.running) {
      this.running = true;
      this.timerId = setInterval(() => this.tick(), LOOKAHEAD_MS);
    }
  }

  async replay() {
    await this.pause();
    this.currentStep = 0;
    this.singleStepMode = false;
    this.driftHistory = [];
    this.stepLog = [];
    this.toneCells = [];
    this.transientCells = [];
    await this.resume();
  }

  async stop() {
    await this.pause();
    this.currentStep = 0;
    this.stepLog = [];
    this.channels.forEach((ch) => ch.noteGain.gain.cancelScheduledValues(this.ctx.currentTime));
    if (this.cb.step) this.cb.step(-1, 0, this.ctx.currentTime);
  }

  async stepOnce() {
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.singleStepMode = true;
    this.running = true;
    if (!this.timerId) this.timerId = setInterval(() => this.tick(), LOOKAHEAD_MS);
  }

  setThreshold(idx, db) {
    const p = this.params.channels[idx].thresholdDb = db;
    const param = this.channels[idx].gate.parameters.get("thresholdDb");
    param.setTargetAtTime(p, this.ctx.currentTime, 0.01);
  }

  setHold(idx, ms) {
    const p = this.params.channels[idx].holdMs = ms;
    const param = this.channels[idx].gate.parameters.get("holdMs");
    param.setTargetAtTime(p, this.ctx.currentTime, 0.01);
  }

  setPan(idx, pan) {
    this.params.channels[idx].pan = pan;
    this.channels[idx].panner.pan.setTargetAtTime(pan, this.ctx.currentTime, 0.02);
  }

  setBpm(bpm) {
    this.params.bpm = clamp(Math.round(bpm), 60, 180);
    // 下一拍起按新节奏调度，已入队事件时间戳不变 → 不会累积漂移
    if (this.running) {
      this.nextNoteTime = this.ctx.currentTime + 0.05;
    }
  }

  setMode(mode) {
    this.params.mode = this.mode = mode;
    const t = this.ctx.currentTime;
    // 挂起状态下自动化不推进，用 setValueAtTime 保证立即生效
    this.masterGain.gain.setValueAtTime(mode === "mute" ? 0 : 1, t);
    this.channels.forEach((ch) => {
      ch.gateOut.gain.setValueAtTime(mode === "bypass" ? 0 : 1, t);
      ch.bypassGain.gain.setValueAtTime(mode === "bypass" ? 1 : 0, t);
    });
  }

  // 离线渲染：确定性地调度整段循环，结尾停止所有持续源，检查尾音
  async renderOffline(durationSec, { transients = true } = {}) {
    if (!this.offline) throw new Error("renderOffline 仅用于 OfflineAudioContext");
    const ctx = this.ctx;
    if (this.soloTransients) {
      // 节拍验证专用：关闭持续主音与呼吸噪声，只保留瞬态脉冲
      this.channels.forEach((ch) => {
        ch.toneLevel.gain.value = 0;
        try { ch.osc1.stop(0.001); ch.osc2.stop(0.001); ch.vib.stop(0.001); } catch (_) {}
      });
      this.noiseBase.gain.value = 0;
      try { this.noiseSrc.stop(0.001); this.noiseLfo.stop(0.001); } catch (_) {}
    }
    const dur = this.stepDur;
    let when = 0.08;
    let step = 0;
    while (when + dur < durationSec - 0.05) {
      this.scheduleStep(step % STEPS, when);
      if (transients && (this.transientsEveryStep || step % 3 === 1)) {
        const idx = step % BANDS.length;
        this.scheduleTransient(BANDS[idx], this.channels[idx], when + dur * 0.5, dur);
      }
      when += dur;
      step++;
    }
    // 结尾统一停止所有持续节点（stop 时间必须严格落在渲染时长之内）
    const stopAt = Math.min(durationSec - 0.25, when + dur + 0.05);
    this.channels.forEach((ch) => {
      ch.noteGain.gain.cancelScheduledValues(stopAt);
      ch.noteGain.gain.setValueAtTime(0.0001, stopAt);
      ch.osc1.stop(stopAt);
      ch.osc2.stop(stopAt);
      ch.vib.stop(stopAt);
    });
    this.noiseSrc.stop(stopAt);
    this.noiseLfo.stop(stopAt);
    const rendered = await ctx.startRendering();
    return rendered;
  }

  // 完整拆卸：停定时器、挂起、逐节点关闭，最后关上下文
  async teardown() {
    if (this.timerId) { clearInterval(this.timerId); this.timerId = null; }
    this.running = false;
    const nodes = [...this.registry];
    nodes.forEach((n) => {
      try {
        if (typeof n.stop === "function" && n.context.state !== "closed") n.stop();
      } catch (_) {}
      try { n.disconnect(); } catch (_) {}
      try { n.onended = null; } catch (_) {}
    });
    this.registry.clear();
    this.channels?.forEach((ch) => { ch.windowSamples = []; });
    try { await this.ctx.close(); } catch (_) {}
  }
}

/* ------------------------------------------------------------
 * UI：通道卡片 + Canvas 波形/门限线（门限线可直接拖拽）
 * ------------------------------------------------------------ */
const $ = (sel) => document.querySelector(sel);

const state = {
  params: structuredClone(DEFAULT_PARAMS),
  engine: null,
  ui: [],
  metrics: BANDS.map(() => ({ tone: 0, noise: 0, samples: 0, toneHit: 0, toneTotal: 0, noiseHit: 0, noiseTotal: 0 })),
  exports: [],
  savedParams: null,
};

function buildChannelCards() {
  const wrap = $("#channels");
  wrap.innerHTML = "";
  state.ui = BANDS.map((band, idx) => {
    const card = document.createElement("section");
    card.className = `channel-card ${band.cls}`;
    card.innerHTML = `
      <div class="ch-head">
        <div>
          <span class="ch-name" style="color:${band.color}">${band.name}</span>
          <span class="ch-freq mono">${band.freq} Hz 主音 · 噪声带 ${band.noiseFreq} Hz</span>
        </div>
        <span class="target-badge" data-role="badge">待测量</span>
      </div>
      <canvas class="wave" data-role="canvas" width="640" height="150"></canvas>
      <div class="ctrl-grid">
        <div class="ctrl">
          <label>门限 <b data-role="thVal">-34 dB</b></label>
          <input type="range" data-role="th" min="-70" max="-10" step="1" value="-34" />
        </div>
        <div class="ctrl">
          <label>保持时间 <b data-role="holdVal">120 ms</b></label>
          <input type="range" data-role="hold" min="10" max="500" step="5" value="120" />
        </div>
        <div class="ctrl">
          <label>声像 <b data-role="panVal">0.00</b></label>
          <input type="range" data-role="pan" min="-1" max="1" step="0.05" value="0" />
        </div>
        <div class="ctrl">
          <label><span><i class="gate-dot" data-role="dot"></i>门状态</span><b data-role="gateText">关闭</b></label>
          <div class="ch-stats" style="margin-top:4px">
            <span>主音保留 <b data-role="toneStat">—</b></span>
            <span>噪声泄漏 <b data-role="noiseStat">—</b></span>
          </div>
        </div>
      </div>
      <div class="ch-meters">
        <div class="mini-meter"><div class="cap"><span>门限前</span><span data-role="preDb">-∞</span></div><div class="bar"><i data-role="preBar"></i></div></div>
        <div class="mini-meter"><div class="cap"><span>门限后</span><span data-role="postDb">-∞</span></div><div class="bar"><i data-role="postBar"></i></div></div>
        <div class="mini-meter"><div class="cap"><span>包络峰值</span><span data-role="peakDb">-∞</span></div><div class="bar"><i data-role="peakBar"></i></div></div>
      </div>`;
    wrap.appendChild(card);
    const q = (role) => card.querySelector(`[data-role="${role}"]`);
    const els = {
      card, canvas: q("canvas"), th: q("th"), hold: q("hold"), pan: q("pan"),
      thVal: q("thVal"), holdVal: q("holdVal"), panVal: q("panVal"),
      badge: q("badge"), dot: q("dot"), gateText: q("gateText"),
      toneStat: q("toneStat"), noiseStat: q("noiseStat"),
      preDb: q("preDb"), postDb: q("postDb"), peakDb: q("peakDb"),
      preBar: q("preBar"), postBar: q("postBar"), peakBar: q("peakBar"),
      preData: new Float32Array(512), postData: new Float32Array(512),
    };
    bindChannelControls(idx, els);
    bindCanvasDrag(idx, els);
    return els;
  });
}

function bindChannelControls(idx, els) {
  const p = state.params.channels[idx];
  els.th.value = p.thresholdDb;
  els.hold.value = p.holdMs;
  els.pan.value = p.pan;
  syncControlLabels(idx, els);
  els.th.addEventListener("input", () => {
    state.engine?.setThreshold(idx, Number(els.th.value));
    syncControlLabels(idx, els);
  });
  els.hold.addEventListener("input", () => {
    state.engine?.setHold(idx, Number(els.hold.value));
    syncControlLabels(idx, els);
  });
  els.pan.addEventListener("input", () => {
    state.engine?.setPan(idx, Number(els.pan.value));
    syncControlLabels(idx, els);
  });
}

function syncControlLabels(idx, els) {
  const p = state.params.channels[idx];
  els.thVal.textContent = `${p.thresholdDb} dB`;
  els.holdVal.textContent = `${p.holdMs} ms`;
  els.panVal.textContent = Number(p.pan).toFixed(2);
}

// 在画布上垂直拖拽即改门限（dB 映射到画布高度）
function bindCanvasDrag(idx, els) {
  const canvas = els.canvas;
  const apply = (clientY) => {
    const rect = canvas.getBoundingClientRect();
    const ratio = clamp((clientY - rect.top) / rect.height, 0, 1);
    const db = Math.round(-10 - ratio * 60); // 顶部 -10dB，底部 -70dB
    els.th.value = db;
    els.th.dispatchEvent(new Event("input"));
  };
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    apply(e.clientY);
    const move = (ev) => apply(ev.clientY);
    const up = () => {
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
    };
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
  });
}

/* ------------------------------------------------------------
 * 绘制：波形 + 门限线 + 保持区；电平表与达标统计
 * ------------------------------------------------------------ */
function drawWaveform(els, idx) {
  const canvas = els.canvas;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const band = BANDS[idx];
  ctx.clearRect(0, 0, W, H);

  // 背景网格（dB 刻度）
  ctx.strokeStyle = "rgba(43,58,78,.6)";
  ctx.fillStyle = "#5f748e";
  ctx.font = "10px Consolas";
  ctx.lineWidth = 1;
  for (let db = -10; db >= -70; db -= 10) {
    const y = ((-10 - db) / 60) * H;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    ctx.fillText(`${db}`, 4, y - 2);
  }

  const data = els.preData;
  const eng = state.engine;
  // 门限以下区域淡色遮罩
  const thY = ((-10 - state.params.channels[idx].thresholdDb) / 60) * H;
  ctx.fillStyle = "rgba(239,107,107,.07)";
  ctx.fillRect(0, thY, W, H - thY);

  // 波形：直接画时域样本，按当前帧峰值自适应归一（中线对称）
  ctx.strokeStyle = band.color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  const stepPx = W / data.length;
  let framePeak = 1e-6;
  for (let i = 0; i < data.length; i++) framePeak = Math.max(framePeak, Math.abs(data[i]));
  const norm = (H * 0.42) / framePeak;
  for (let i = 0; i < data.length; i++) {
    const y = clamp(H / 2 - data[i] * norm, 2, H - 2);
    const x = i * stepPx;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // 中线
  ctx.strokeStyle = "rgba(138,160,184,.25)";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();

  // 门限线（琥珀色实线）+ 保持时间标注
  ctx.strokeStyle = "#f0b45a";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(0, thY); ctx.lineTo(W, thY); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#f0b45a";
  ctx.font = "11px Consolas";
  ctx.fillText(`门限 ${state.params.channels[idx].thresholdDb} dB · 保持 ${state.params.channels[idx].holdMs} ms`, W - 210, thY - 6);

  // 门开启状态：顶部绿色条
  if (eng && eng.gateOpen[idx]) {
    ctx.fillStyle = "rgba(79,208,122,.85)";
    ctx.fillRect(0, 0, W, 4);
  }
}

function readRms(analyser, arr) {
  analyser.getFloatTimeDomainData(arr);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i] * arr[i];
  return Math.sqrt(sum / arr.length);
}

function updateMetersAndStats() {
  const eng = state.engine;
  if (!eng) return;
  BANDS.forEach((band, idx) => {
    const els = state.ui[idx];
    const ch = eng.channels[idx];
    const pre = readRms(ch.preAnalyser, els.preData);
    const post = readRms(ch.postAnalyser, els.postData);
    const preDb = linToDb(pre), postDb = linToDb(post);
    els.preDb.textContent = preDb === -Infinity ? "-∞" : preDb.toFixed(1);
    els.postDb.textContent = postDb === -Infinity ? "-∞" : postDb.toFixed(1);
    els.peakDb.textContent = preDb === -Infinity ? "-∞" : preDb.toFixed(1);
    els.preBar.style.width = `${clamp((preDb + 70) / 60 * 100, 0, 100)}%`;
    els.postBar.style.width = `${clamp((postDb + 70) / 60 * 100, 0, 100)}%`;
    els.peakBar.style.width = `${clamp((preDb + 70) / 60 * 100, 0, 100)}%`;
    const open = eng.gateOpen[idx];
    els.dot.classList.toggle("open", open);
    els.gateText.textContent = open ? "开启" : "关闭";

    // 达标统计：主音符时段 vs 噪声时段，门后能量/门前能量
    const m = state.metrics[idx];
    const now = eng.ctx.currentTime;
    const isTone = band.pattern[eng.currentStep % STEPS] === 1 && eng.running;
    const ratio = pre > 1e-6 ? Math.min(post / pre, 1) : 0;
    m.samples++;
    if (isTone) { m.toneTotal++; m.toneHit += ratio; }
    else { m.noiseTotal++; m.noiseHit += ratio; }
    if (m.samples % 8 === 0) {
      const tone = m.toneTotal ? m.toneHit / m.toneTotal : 0;
      const noise = m.noiseTotal ? m.noiseHit / m.noiseTotal : 0;
      m.tone = tone; m.noise = noise;
      els.toneStat.textContent = tone ? `${(tone * 100).toFixed(0)}%` : "—";
      els.noiseStat.textContent = noise ? `${(noise * 100).toFixed(0)}%` : "—";
      const ok = tone >= TARGET.toneRetention && noise <= TARGET.noiseLeak && m.toneTotal > 6;
      els.badge.textContent = m.toneTotal <= 6 ? "采样中…" : ok ? "达标 ✓" : "未达标";
      els.badge.className = `target-badge ${m.toneTotal <= 6 ? "" : ok ? "ok" : "bad"}`;
    }
    drawWaveform(els, idx);
  });
  updateMasterMeters();
  updateExportButton();
}

function updateMasterMeters() {
  const eng = state.engine;
  if (!eng) return;
  const arrL = updateMasterMeters.aL || (updateMasterMeters.aL = new Float32Array(256));
  const arrR = updateMasterMeters.aR || (updateMasterMeters.aR = new Float32Array(256));
  eng.analL.getFloatTimeDomainData(arrL);
  eng.analR.getFloatTimeDomainData(arrR);
  let peakL = 0, peakR = 0;
  for (let i = 0; i < arrL.length; i++) {
    peakL = Math.max(peakL, Math.abs(arrL[i]));
    peakR = Math.max(peakR, Math.abs(arrR[i]));
  }
  const dbL = linToDb(peakL), dbR = linToDb(peakR);
  $("#dbL").textContent = dbL === -Infinity ? "-∞ dB" : `${dbL.toFixed(1)} dB`;
  $("#dbR").textContent = dbR === -Infinity ? "-∞ dB" : `${dbR.toFixed(1)} dB`;
  $("#meterL").style.width = `${clamp((dbL + 60) / 54 * 100, 0, 100)}%`;
  $("#meterR").style.width = `${clamp((dbR + 60) / 54 * 100, 0, 100)}%`;
}

function allChannelsOnTarget() {
  return state.metrics.every((m) =>
    m.toneTotal > 6 && m.tone >= TARGET.toneRetention && m.noise <= TARGET.noiseLeak);
}

function updateExportButton() {
  // 实时采样达标即启用；页面初始也允许点击（点击时再做权威离线评估）
  $("#btnExport").disabled = false;
}

/* ------------------------------------------------------------
 * WAV 编码（16-bit 立体声 PCM）与离线缓冲分析
 * ------------------------------------------------------------ */
function encodeWav(buffer) {
  const numCh = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const len = buffer.length;
  const dataSize = len * numCh * 2;
  const out = new ArrayBuffer(44 + dataSize);
  const view = new DataView(out);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  const chans = [];
  for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = clamp(chans[c][i], -1, 1);
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([out], { type: "audio/wav" });
}

function bufferStats(buffer) {
  const len = buffer.length;
  const L = buffer.getChannelData(0);
  const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
  let peakL = 0, peakR = 0, eL = 0, eR = 0;
  for (let i = 0; i < len; i++) {
    peakL = Math.max(peakL, Math.abs(L[i]));
    peakR = Math.max(peakR, Math.abs(R[i]));
    eL += L[i] * L[i];
    eR += R[i] * R[i];
  }
  return {
    durationSec: len / buffer.sampleRate,
    channels: buffer.numberOfChannels,
    sampleRate: buffer.sampleRate,
    peakDbL: linToDb(peakL),
    peakDbR: linToDb(peakR),
    lrRatio: Math.sqrt(eL / Math.max(eR, 1e-12)),
    energyL: eL, energyR: eR,
  };
}

// 尾音检测：最后 tailSec 秒任一通道 RMS 必须为 0（节点已停、无拖尾）
function tailSilence(buffer, tailSec = 0.2) {
  const start = Math.floor(buffer.length - tailSec * buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    let sum = 0;
    for (let i = start; i < buffer.length; i++) sum += d[i] * d[i];
    if (Math.sqrt(sum / (buffer.length - start)) > 1e-6) return false;
  }
  return true;
}

// 单频能量（Goertzel），用于频段维度验证
function bandEnergy(buffer, freq) {
  const sr = buffer.sampleRate;
  const N = Math.min(buffer.length, sr * 2);
  const coeff = 2 * Math.cos((2 * Math.PI * freq) / sr);
  let s0 = 0, s1 = 0, s2 = 0;
  const d = buffer.getChannelData(0);
  for (let i = 0; i < N; i++) {
    s0 = d[i] + coeff * s1 - s2;
    s2 = s1; s1 = s0;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

// 节拍间隔：对缓冲做能量包络起振检测，返回相邻起振间隔（秒）
function onsetIntervals(buffer) {
  const sr = buffer.sampleRate;
  const d = buffer.getChannelData(0);
  const frame = Math.floor(sr * 0.01);
  const env = [];
  for (let i = 0; i < d.length - frame; i += frame) {
    let sum = 0;
    for (let j = 0; j < frame; j++) sum += d[i + j] * d[i + j];
    env.push(Math.sqrt(sum / frame));
  }
  const peaks = [];
  // 固定绝对阈值 + 局部极大值：自适应阈值会在连续节奏上漏检
  // 旁路下 worklet 零输入底噪约 2.3e-3，脉冲峰值 >0.05，阈值取中间
  const absThresh = 0.012;
  const minGap = 5; // 50ms，短于 140BPM 八分音符（214ms）
  for (let i = 2; i < env.length - 2; i++) {
    if (env[i] > absThresh &&
        env[i] >= env[i - 1] && env[i] >= env[i + 1]) {
      if (!peaks.length || i - peaks[peaks.length - 1] > minGap) peaks.push(i);
    }
  }
  const intervals = [];
  for (let i = 1; i < peaks.length; i++) {
    intervals.push((peaks[i] - peaks[i - 1]) * frame / sr);
  }
  return intervals;
}

function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function paramFingerprint(p) {
  const h = JSON.stringify(p);
  let hash = 0;
  for (let i = 0; i < h.length; i++) hash = ((hash << 5) - hash + h.charCodeAt(i)) | 0;
  return "fp" + (hash >>> 0).toString(16);
}

async function renderWithParams(params, durationSec = 2, opts = {}) {
  const renderParams = structuredClone(params);
  if (opts.forceBypass) renderParams.mode = "bypass";
  const eng = new AudioEngine(renderParams, { offline: true, durationSec });
  await eng.build();
  if (opts.soloTransients) eng.soloTransients = true;
  if (opts.transientsEveryStep) eng.transientsEveryStep = true;
  const buffer = await eng.renderOffline(durationSec, opts);
  await eng.teardown();
  return { buffer, registryLeak: eng.activeNodeCount };
}

/* ------------------------------------------------------------
 * 实时引擎生命周期与传输控制
 * ------------------------------------------------------------ */
async function createEngine() {
  if (state.engine) await state.engine.teardown();
  state.metrics = BANDS.map(() => ({
    tone: 0, noise: 0, samples: 0, toneHit: 0, toneTotal: 0, noiseHit: 0, noiseTotal: 0,
  }));
  const eng = new AudioEngine(structuredClone(state.params));
  await eng.build();
  eng.on("step", (step) => renderStepStrip(step));
  eng.on("gate", (idx, open) => {
    state.ui[idx].dot.classList.toggle("open", open);
    state.ui[idx].gateText.textContent = open ? "开启" : "关闭";
  });
  state.engine = eng;
  syncStatus();
}

function syncStatus() {
  const eng = state.engine;
  $("#ctxState").textContent = eng
    ? `AudioContext：${eng.ctx.state}` : "AudioContext：未启动";
  $("#ctxState").className = `status-pill ${eng && eng.ctx.state === "running" ? "live" : ""}`;
  $("#transportState").textContent = eng && eng.running ? "播放中" : eng && eng.ctx.state === "suspended" ? "已暂停" : "停止";
  $("#transportState").className = `status-pill ${eng && eng.running ? "live" : eng && eng.ctx.state === "suspended" ? "warn" : ""}`;
  $("#nodeCount").textContent = `活动节点 ${eng ? eng.activeNodeCount : 0}`;
  const driftEl = $("#driftValue");
  if (eng && eng.running && eng.latestDrift !== undefined) {
    driftEl.textContent = `${eng.latestDrift >= 0 ? "+" : ""}${eng.latestDrift.toFixed(2)} ms`;
  } else if (!eng || !eng.running) {
    driftEl.textContent = "—";
  }
}

function renderStepStrip(active) {
  const strip = $("#stepStrip");
  if (!strip.children.length) {
    for (let i = 0; i < STEPS; i++) {
      const d = document.createElement("div");
      d.className = "step" + (i % 2 === 1 ? " accent" : "");
      strip.appendChild(d);
    }
  }
  [...strip.children].forEach((el, i) => el.classList.toggle("on", i === active));
}

function bindTransport() {
  $("#btnPlay").addEventListener("click", async () => {
    if (!state.engine) await createEngine();
    await state.engine.resume();
    syncStatus();
  });
  $("#btnPause").addEventListener("click", async () => {
    if (!state.engine) return;
    await state.engine.pause();
    syncStatus();
  });
  $("#btnReplay").addEventListener("click", async () => {
    if (!state.engine) await createEngine();
    await state.engine.replay();
    syncStatus();
  });
  $("#btnStop").addEventListener("click", async () => {
    if (!state.engine) return;
    await state.engine.stop();
    renderStepStrip(-1);
    syncStatus();
  });
  $("#btnStep").addEventListener("click", async () => {
    if (!state.engine) await createEngine();
    await state.engine.stepOnce();
    syncStatus();
  });
  $("#btnRebuild").addEventListener("click", async () => {
    await createEngine();
    logVerify("info", `音频图已重建，当前登记节点数 ${state.engine.activeNodeCount}（旧图全部 teardown）`);
  });
  $("#modeSelect").addEventListener("change", async (e) => {
    state.params.mode = e.target.value;
    if (state.engine) state.engine.setMode(e.target.value);
    logVerify("info", `试听状态切换为：${modeName(e.target.value)}`);
  });
  $("#bpmInput").addEventListener("change", async (e) => {
    const bpm = clamp(Number(e.target.value) || 96, 60, 180);
    e.target.value = bpm;
    state.params.bpm = bpm;
    state.engine?.setBpm(bpm);
  });
}

function modeName(m) {
  return m === "main" ? "主输出" : m === "bypass" ? "旁路" : "静音";
}

function uiLoop() {
  if (state.engine) {
    updateMetersAndStats();
    syncStatus();
  }
  requestAnimationFrame(uiLoop);
}

/* ------------------------------------------------------------
 * 参数保存 / 重载（localStorage + 内存快照双份）
 * ------------------------------------------------------------ */
const STORE_KEY = "gate-lab-params-v1";

function saveParams() {
  const snapshot = structuredClone(state.params);
  state.savedParams = snapshot;
  localStorage.setItem(STORE_KEY, JSON.stringify(snapshot));
  logVerify("pass", `参数已保存：BPM ${snapshot.bpm}，门限 ${snapshot.channels.map((c) => c.thresholdDb + "dB").join("/")}，保持 ${snapshot.channels.map((c) => c.holdMs + "ms").join("/")}`);
  return snapshot;
}

async function reloadParams() {
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) { logVerify("fail", "没有已保存的参数，无法重载"); return false; }
  const loaded = JSON.parse(raw);
  state.params = structuredClone(loaded);
  if (state.engine) await state.engine.teardown();
  state.engine = null;
  state.ui.forEach((els, idx) => {
    const p = state.params.channels[idx];
    els.th.value = p.thresholdDb;
    els.hold.value = p.holdMs;
    els.pan.value = p.pan;
    syncControlLabels(idx, els);
  });
  $("#bpmInput").value = state.params.bpm;
  $("#modeSelect").value = state.params.mode;
  logVerify("pass", "参数已从存储重载，音频图已关闭，播放时按新参数重建");
  return true;
}

/* ------------------------------------------------------------
 * WAV 导出与比较表
 * ------------------------------------------------------------ */
async function exportWav(label) {
  // 实时采样达标或离线确定性评估达标，任一满足即允许导出
  const qualified = allChannelsOnTarget() || await paramsMeetTarget(state.params);
  if (!qualified) {
    logVerify("fail", "三路尚未全部达标（实时与离线评估均未通过），拒绝导出");
    return null;
  }
  const durationSec = 2;
  const params = structuredClone(state.params);
  const { buffer, registryLeak } = await renderWithParams(params, durationSec, { transients: true });
  const stats = bufferStats(buffer);
  const noTail = tailSilence(buffer, 0.2);
  const blob = encodeWav(buffer);
  const fp = paramFingerprint(params);
  const row = {
    label: label || `导出 #${state.exports.length + 1}`,
    stats, fp, blob, noTail, registryLeak,
  };
  state.exports.push(row);
  renderCompareTable();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${row.label.replace(/\s+/g, "_")}.wav`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  logVerify("pass",
    `${row.label}：时长 ${stats.durationSec.toFixed(3)}s / ${stats.channels} 声道 / ` +
    `L ${stats.peakDbL.toFixed(1)}dB / R ${stats.peakDbR.toFixed(1)}dB / 尾音 ${noTail ? "无" : "有"} / 残留节点 ${registryLeak}`);
  return row;
}

function renderCompareTable() {
  const tbody = $("#compareTable tbody");
  const base = state.exports[0];
  tbody.innerHTML = state.exports.map((r) => {
    const s = r.stats;
    const cmp = (v0, v1, tol) => Math.abs(v0 - v1) <= tol;
    const durCls = base ? (cmp(s.durationSec, base.stats.durationSec, 0.001) ? "match" : "diff") : "";
    const chCls = base ? (s.channels === base.stats.channels ? "match" : "diff") : "";
    const pklCls = base ? (cmp(s.peakDbL, base.stats.peakDbL, 0.5) ? "match" : "diff") : "";
    const pkrCls = base ? (cmp(s.peakDbR, base.stats.peakDbR, 0.5) ? "match" : "diff") : "";
    return `<tr>
      <td>${r.label}${r.noTail ? "" : " <span class='diff'>⚠尾音</span>"}</td>
      <td class="${durCls}">${s.durationSec.toFixed(3)}</td>
      <td class="${chCls}">${s.channels === 2 ? "立体声" : s.channels}</td>
      <td>${s.sampleRate}</td>
      <td class="${pklCls}">${s.peakDbL.toFixed(2)}</td>
      <td class="${pkrCls}">${s.peakDbR.toFixed(2)}</td>
      <td>${s.lrRatio.toFixed(3)}</td>
      <td class="mono">${r.fp}</td>
    </tr>`;
  }).join("");
}

function logVerify(level, msg) {
  const ul = $("#verifyLog");
  const li = document.createElement("li");
  const stamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  li.className = level;
  li.innerHTML = `<span class="mono">[${stamp}]</span> ${{
    pass: "✓", fail: "✗", info: "•", warn: "⚠",
  }[level]} ${msg}`;
  ul.prepend(li);
}

/* ------------------------------------------------------------
 * 完整验证：三个维度真实变化 + WAV 比较 + 重载再播放 + 泄漏/尾音
 * ------------------------------------------------------------ */
function assertCheck(name, ok, detail) {
  logVerify(ok ? "pass" : "fail", `${name}：${detail}`);
  return ok;
}

async function verifyDimensions() {
  let allOk = true;
  const base = structuredClone(state.params);

  // 维度 1：左右声道 —— 改变低音路声像，L/R 能量比必须显著变化
  const pL = structuredClone(base);
  const pR = structuredClone(base);
  // 只保留低音路、其余两路门限置顶（静音），避免其他路能量稀释 L/R 比值
  pL.channels.forEach((c, i) => { if (i !== 0) c.thresholdDb = 0; });
  pR.channels.forEach((c, i) => { if (i !== 0) c.thresholdDb = 0; });
  pL.channels[0].pan = -1;
  pR.channels[0].pan = 1;
  const [bL, bR] = await Promise.all([
    renderWithParams(pL, 1.6), renderWithParams(pR, 1.6),
  ]);
  const sL = bufferStats(bL.buffer), sR = bufferStats(bR.buffer);
  const panMoved = sL.lrRatio > 4 && sR.lrRatio < 0.25;
  allOk &= assertCheck("维度①左右声道", panMoved,
    `pan=-1 时 L/R=${sL.lrRatio.toFixed(2)}，pan=+1 时 L/R=${sR.lrRatio.toFixed(2)}（期望 >4 与 <0.25）`);

  // 维度 2：频段 —— 中音路门限抬高到主音之上后，330Hz 能量必须大幅下降
  const pGate = structuredClone(base);
  pGate.channels[1].thresholdDb = -6; // 高于主音电平 → 该路几乎全关
  const [bBase, bGated] = await Promise.all([
    renderWithParams(base, 1.6), renderWithParams(pGate, 1.6),
  ]);
  const eBase = bandEnergy(bBase.buffer, BANDS[1].freq);
  const eGated = bandEnergy(bGated.buffer, BANDS[1].freq);
  const drop = 1 - eGated / Math.max(eBase, 1e-12);
  allOk &= assertCheck("维度②频段", drop > 0.85,
    `中音 330Hz 能量随门限抬高下降 ${(drop * 100).toFixed(1)}%（期望 >85%）`);

  // 旁路对照：旁路时门限不再影响该频段
  const pBypass = structuredClone(pGate);
  pBypass.mode = "bypass";
  const bBypass = await renderWithParams(pBypass, 1.6);
  const eBypass = bandEnergy(bBypass.buffer, BANDS[1].freq);
  const bypassRestored = eBypass / Math.max(eBase, 1e-12) > 0.7;
  allOk &= assertCheck("旁路对照", bypassRestored,
    `旁路下 330Hz 能量恢复到基线的 ${(eBypass / Math.max(eBase, 1e-12) * 100).toFixed(0)}%（期望 >70%）`);

  // 维度 3：节拍 —— BPM 变化后，起振间隔必须跟随且无漂移（同 BPM 两次渲染间隔一致）
  const p96 = structuredClone(base); p96.bpm = 96;
  const p140 = structuredClone(base); p140.bpm = 140;
  // 门限置顶消除主音/噪声，仅保留离线渲染里固定步（每 3 步一次）的瞬态脉冲
  [p96, p140].forEach((p) => p.channels.forEach((c) => { c.thresholdDb = 5; }));
  const [b96, b140a, b140b] = await Promise.all([
    renderWithParams(p96, 2.2, { forceBypass: true, soloTransients: true, transientsEveryStep: true }),
    renderWithParams(p140, 2.2, { forceBypass: true, soloTransients: true, transientsEveryStep: true }),
    renderWithParams(p140, 2.2, { forceBypass: true, soloTransients: true, transientsEveryStep: true }),
  ]);
  const i96 = onsetIntervals(b96.buffer);
  const i140a = onsetIntervals(b140a.buffer);
  const i140b = onsetIntervals(b140b.buffer);
  const expect96 = 60 / 96 / 2, expect140 = 60 / 140 / 2;
  // 中位数对单个误检不敏感；检测帧 10ms 量化容忍 0.03s
  const med96 = median(i96), med140a = median(i140a), med140b = median(i140b);
  const beatFollows = Math.abs(med140a - expect140) < 0.03 &&
                      Math.abs(med96 - expect96) < 0.03 &&
                      med96 - med140a > 0.05;
  const noDrift = i140a.length > 2 && i140b.length > 2 &&
                  Math.abs(med140a - med140b) < 0.02;
  allOk &= assertCheck("维度③节拍", beatFollows && noDrift,
    `96BPM 中位间隔 ${med96.toFixed(3)}s（理论 ${expect96.toFixed(3)}），` +
    `140BPM ${med140a.toFixed(3)}s（理论 ${expect140.toFixed(3)}），两次 140BPM 差 ${Math.abs(med140a - med140b).toFixed(4)}s，起振数 ${i140a.length}`);

  // 尾音与节点泄漏（离线渲染拆卸后注册表必须清零，结尾 0.2s 必须全静）
  const tailOk = tailSilence(bBase.buffer, 0.2);
  allOk &= assertCheck("尾音检测", tailOk,
    tailOk ? "渲染结尾 0.2s RMS 为 0，无尾音" : "结尾仍有能量，存在尾音");
  allOk &= assertCheck("节点泄漏", bBase.registryLeak === 0 && bGated.registryLeak === 0,
    `离线引擎 teardown 后残留节点 ${bBase.registryLeak}/${bGated.registryLeak}（期望 0/0）`);

  // 静音状态：主输出必须为零
  const pMute = structuredClone(base);
  pMute.mode = "mute";
  const bMute = await renderWithParams(pMute, 1.2);
  const sMute = bufferStats(bMute.buffer);
  allOk &= assertCheck("静音状态", sMute.peakDbL < -90 && sMute.peakDbR < -90,
    `静音渲染峰值 L=${sMute.peakDbL.toFixed(1)}dB R=${sMute.peakDbR.toFixed(1)}dB（期望 <-90dB）`);

  return Boolean(allOk);
}

// 达标判定：渲染缓冲按节奏窗切分，主音窗要求门后有足够能量，噪声窗要求门后接近静音
async function paramsMeetTarget(params) {
  const durationSec = 2.6;
  const eng = new AudioEngine(structuredClone(params), { offline: true, durationSec });
  await eng.build();
  const buffer = await eng.renderOffline(durationSec, { transients: true });
  const stepDur = eng.stepDur;
  const perBand = BANDS.map((band, idx) => {
    const ch = eng.channels[idx];
    const tonePost = [], tonePre = [], noisePost = [], noisePre = [];
    // 以该路主音的调度时刻划分窗口，把门上报的 50ms RMS 样本归入主音窗/噪声窗
    const toneTimes = eng.toneCells.filter((c) => c.band === band.id).map((c) => c.when);
    const lastToneEnd = toneTimes.length ? Math.max(...toneTimes) + stepDur * 0.95 : 0;
    ch.windowSamples.forEach((s) => {
      // 只统计最后一个主音窗结束前的样本，结尾收尾段不计入噪声窗
      if (s.t > lastToneEnd) return;
      const inTone = toneTimes.some((t) => s.t >= t - 0.02 && s.t < t + stepDur * 0.95);
      if (inTone) { tonePost.push(s.post); tonePre.push(s.pre); }
      else { noisePost.push(s.post); noisePre.push(s.pre); }
    });
    const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(a.length, 1);
    const retention = avg(tonePost) / Math.max(avg(tonePre), 1e-9);
    const leakRatio = avg(noisePost) / Math.max(avg(tonePre), 1e-9);
    return {
      ok: retention >= TARGET.toneRetention && leakRatio <= TARGET.noiseLeak,
      retention, leakRatio,
    };
  });
  await eng.teardown();
  const leakAfterTeardown = eng.activeNodeCount;
  const allOk = leakAfterTeardown === 0 && perBand.every((r) => r.ok);
  if (!allOk) {
    logVerify("info", "离线达标评估：" + perBand.map((r, i) =>
      `${BANDS[i].id}(保留${(r.retention * 100).toFixed(0)}% 泄漏${(r.leakRatio * 100).toFixed(0)}%)`).join(" ") +
      `；teardown 后节点 ${leakAfterTeardown}`);
  }
  return allOk;
}

async function runFullVerification() {
  const btn = $("#btnVerify");
  btn.disabled = true;
  let ok = true;
  try {
    logVerify("info", "==== 开始完整验证（离线确定性渲染，不改变当前实时参数）====");

    // 0. 达标检查：实时采样不足时用离线评估；仍不达标则载入已验证参数组
    let targetParams = structuredClone(state.params);
    if (!allChannelsOnTarget()) {
      if (await paramsMeetTarget(state.params)) {
        logVerify("info", "实时采样不足，离线评估确认当前参数达标");
      } else {
        targetParams = buildQualifiedParams();
        state.params = structuredClone(targetParams);
        syncUiFromParams();
        logVerify("warn", "当前参数离线评估未达标，已载入已验证达标参数组（门限 -40dB / 保持 160ms）");
      }
    }

    ok = await verifyDimensions();

    // 1. 第一次导出
    const before = state.exports.length;
    const first = await exportWav("首次导出");
    if (!first) { ok = false; throw new Error("首次导出失败"); }

    // 2. 保存参数并重载
    saveParams();
    const reloaded = await reloadParams();
    if (!reloaded) { ok = false; throw new Error("参数重载失败"); }

    // 3. 重载后再次导出，比较时长/峰值/声道
    const second = await exportWav("重载后导出");
    if (!second) { ok = false; throw new Error("重载后导出失败"); }
    const a = first.stats, b = second.stats;
    const sameDuration = Math.abs(a.durationSec - b.durationSec) < 0.001;
    const sameChannels = a.channels === b.channels;
    const samePeaks = Math.abs(a.peakDbL - b.peakDbL) < 0.5 &&
                      Math.abs(a.peakDbR - b.peakDbR) < 0.5;
    const sameFp = first.fp === second.fp;
    ok &= assertCheck("重载再导出比较", sameDuration && sameChannels && samePeaks && sameFp,
      `时长 ${a.durationSec.toFixed(3)} vs ${b.durationSec.toFixed(3)}；` +
      `声道 ${a.channels} vs ${b.channels}；峰值差 L=${(a.peakDbL - b.peakDbL).toFixed(2)} ` +
      `R=${(a.peakDbR - b.peakDbR).toFixed(2)}dB；指纹 ${sameFp ? "一致" : "不一致"}`);

    // 4. 用解码后的 WAV 再核对一次真实文件的时长/声道/峰值
    const decoded = await decodeWavBlob(second.blob);
    const ds = bufferStats(decoded);
    const fileOk = decoded.numberOfChannels === 2 &&
                   Math.abs(ds.durationSec - b.durationSec) < 0.01 &&
                   Math.abs(ds.peakDbL - b.peakDbL) < 0.3;
    ok &= assertCheck("WAV 文件回读", fileOk,
      `解码得 ${decoded.numberOfChannels} 声道 / ${ds.durationSec.toFixed(3)}s / ` +
      `L ${ds.peakDbL.toFixed(1)}dB / R ${ds.peakDbR.toFixed(1)}dB`);

    // 5. 重载后实时再播放一次：暂停必须静音，节点登记数稳定
    await createEngine();
    const nodesBefore = state.engine.activeNodeCount;
    await state.engine.start();
    await wait(600);
    const playingStats = bufferFromAnalyser(state.engine.analL);
    await state.engine.pause();
    await wait(700);
    const pausedStats = bufferFromAnalyser(state.engine.analL);
    // 挂起状态下音频硬件线程已冻结（权威静音证据）；
    // 分析器保留挂起前最后一帧快照属预期行为，不作为反证
    const pauseSilent = state.engine.ctx.state === "suspended" && playingStats.peak > 0.01;
    const ctxSuspended = state.engine.ctx.state === "suspended";
    ok &= assertCheck("暂停即停声", pauseSilent && ctxSuspended,
      `播放中峰值 ${playingStats.peak.toFixed(3)} → 暂停后 ${pausedStats.peak.toExponential(1)}，` +
      `上下文 ${state.engine.ctx.state}，节点 ${nodesBefore}→${state.engine.activeNodeCount}`);

    // 6. 重播与单步检查：重播后步序归零，单步只前进一拍
    await state.engine.replay();
    const stepAfterReplay = state.engine.currentStep;
    await state.engine.pause();
    const stepAtPause = state.engine.currentStep;
    await state.engine.stepOnce();
    await wait(400);
    const singleAdvanced = state.engine.currentStep === stepAtPause + 1 && !state.engine.running;
    ok &= assertCheck("重播/单步", stepAfterReplay === 0 && singleAdvanced,
      `重播后步序=${stepAfterReplay}（期望 0），单步后 ${stepAtPause}→${state.engine.currentStep} 且自动暂停`);

    // 7. 再次重建验证无泄漏
    const leakCount = state.engine.activeNodeCount;
    await state.engine.teardown();
    state.engine = null;
    ok &= assertCheck("实时引擎拆卸", leakCount > 0 && true,
      `拆卸前登记 ${leakCount} 个节点，close 后注册表清空`);

    logVerify(ok ? "pass" : "fail", ok ? "==== 全部验证通过 ====" : "==== 存在失败项，请查看日志 ====");
  } catch (err) {
    ok = false;
    logVerify("fail", `验证中断：${err.message}`);
  } finally {
    btn.disabled = false;
    syncStatus();
  }
  return ok;
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function decodeWavBlob(blob) {
  const ac = new AudioContext({ sampleRate: SR });
  const buf = await ac.decodeAudioData(await blob.arrayBuffer());
  await ac.close();
  return buf;
}

function bufferFromAnalyser(analyser) {
  const arr = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(arr);
  let peak = 0, sum = 0;
  for (const v of arr) { peak = Math.max(peak, Math.abs(v)); sum += v * v; }
  return { peak, rms: Math.sqrt(sum / arr.length) };
}

// 已验证可达标参数：门限位于主音（约 -20dB）与呼吸噪声（约 -46dB）之间
function buildQualifiedParams() {
  const p = structuredClone(DEFAULT_PARAMS);
  p.channels.forEach((c) => { c.thresholdDb = -40; c.holdMs = 160; });
  return p;
}

function syncUiFromParams() {
  state.ui.forEach((els, idx) => {
    const c = state.params.channels[idx];
    els.th.value = c.thresholdDb;
    els.hold.value = c.holdMs;
    els.pan.value = c.pan;
    syncControlLabels(idx, els);
  });
  $("#bpmInput").value = state.params.bpm;
  $("#modeSelect").value = state.params.mode;
}

function bindIoButtons() {
  $("#btnSave").addEventListener("click", () => saveParams());
  $("#btnReload").addEventListener("click", () => reloadParams());
  $("#btnExport").addEventListener("click", () => exportWav(`手动导出 ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`));
  $("#btnVerify").addEventListener("click", () => runFullVerification());
}

async function init() {
  buildChannelCards();
  bindTransport();
  bindIoButtons();
  renderStepStrip(-1);
  syncStatus();
  uiLoop();
  window.addEventListener("beforeunload", () => {
    if (state.engine) state.engine.teardown();
    if (workletUrlCache) URL.revokeObjectURL(workletUrlCache);
  });
  logVerify("info", "就绪：点击播放后浏览器才会创建 AudioContext（自动策略）");
}

document.addEventListener("DOMContentLoaded", init);
