'use strict';
/* 纯函数部分:不依赖浏览器,可在 Node 中测试 */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FAULTS = ['连续音', '敲击音', '摩擦音'];

function assignmentFromSeed(seed) {
  const rng = mulberry32(seed);
  const arr = [0, 1, 2];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr; // arr[machine] = faultType
}

function knockInterval(load) { return 0.9 - 0.55 * load; }
function humLevel(load) { return 0.04 + 0.22 * load; }
function humFreq(load) { return 50 + 40 * load; }
function frictionFreq(load) { return 700 + 500 * load; }

function encodeWav(buf) {
  const ch = buf.numberOfChannels, len = buf.length, sr = buf.sampleRate;
  const bytes = 44 + len * ch * 2;
  const ab = new ArrayBuffer(bytes), v = new DataView(ab);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, bytes - 8, true); ws(8, 'WAVE');
  ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, ch, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true); ws(36, 'data'); v.setUint32(40, len * ch * 2, true);
  const chans = [];
  for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      let s = Math.max(-1, Math.min(1, chans[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true); o += 2;
    }
  }
  return ab;
}

function goertzel(data, sr, freq) {
  const w = 2 * Math.PI * freq / sr;
  const coeff = 2 * Math.cos(w);
  let s0 = 0, s1 = 0, s2 = 0;
  for (let i = 0; i < data.length; i++) {
    s0 = data[i] + coeff * s1 - s2; s2 = s1; s1 = s0;
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / data.length;
}

function analyzeBuffer(buf, extraFreqs) {
  const ch = buf.numberOfChannels, len = buf.length, sr = buf.sampleRate;
  const L = buf.getChannelData(0), R = ch > 1 ? buf.getChannelData(1) : L;
  let peakL = 0, peakR = 0, tL = 0, tR = 0;
  for (let i = 0; i < len; i++) {
    const a = Math.abs(L[i]), b = Math.abs(R[i]);
    if (a > peakL) { peakL = a; tL = i / sr; }
    if (b > peakR) { peakR = b; tR = i / sr; }
  }
  const mono = new Float32Array(len);
  for (let i = 0; i < len; i++) mono[i] = (L[i] + R[i]) * 0.5;
  // 谱通量起始检测(100-400Hz):连续背景声通量≈0,仅敲击瞬态响应
  const fftN = 1024, hop = 512;
  const hopSec = hop / sr;
  const fluxFreqs = [100, 150, 200, 250, 300, 350, 400];
  const nFr = Math.max(0, Math.floor((len - fftN) / hop));
  const flux = new Float32Array(nFr);
  const prevMag = new Float32Array(fluxFreqs.length);
  for (let f = 0; f < nFr; f++) {
    const off = f * hop;
    let fl = 0;
    for (let k = 0; k < fluxFreqs.length; k++) {
      const w = 2 * Math.PI * fluxFreqs[k] / sr;
      const coeff = 2 * Math.cos(w);
      let s0 = 0, s1 = 0, s2 = 0;
      for (let i = 0; i < fftN; i++) {
        s0 = mono[off + i] + coeff * s1 - s2; s2 = s1; s1 = s0;
      }
      const mag = Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / fftN;
      fl += Math.max(0, mag - prevMag[k]);
      prevMag[k] = mag;
    }
    flux[f] = fl;
  }
  let maxFlux = 0;
  for (let f = 0; f < nFr; f++) maxFlux = Math.max(maxFlux, flux[f]);
  const sortedFl = Array.from(flux).sort((a, b) => a - b);
  const medFl = sortedFl[Math.floor(nFr / 2)] || 0;
  const fluxThr = Math.max(medFl * 6, maxFlux * 0.22, 1e-4);
  const peaks = [];
  let coolF = 0;
  const coolFr = Math.round(0.25 / hopSec);
  for (let f = 0; f < nFr; f++) {
    if (coolF > 0) { coolF--; continue; }
    if (flux[f] > fluxThr) {
      peaks.push(f * hopSec); coolF = coolFr;
    }
  }
  // 峰值间隔中位数(主) + 平滑通量自相关(备)
  const ivs = [];
  for (let i = 1; i < peaks.length; i++) ivs.push(peaks[i] - peaks[i - 1]);
  ivs.sort((a, b) => a - b);
  const medIv = ivs.length >= 2 ? ivs[Math.floor(ivs.length / 2)] : 0;
  const fluxS = new Float32Array(nFr);
  for (let f = 0; f < nFr; f++) {
    let s = 0, c = 0;
    for (let k = -2; k <= 2; k++) {
      const j = f + k;
      if (j >= 0 && j < nFr) { s += flux[j]; c++; }
    }
    fluxS[f] = s / c;
  }
  let fm = 0;
  for (let f = 0; f < nFr; f++) fm += fluxS[f];
  fm /= nFr || 1;
  const lagMin = Math.round(0.25 / hopSec), lagMax = Math.round(1.0 / hopSec);
  const corrAt = new Float32Array(lagMax + 1);
  let bestC = 0;
  for (let lag = lagMin; lag <= lagMax && lag < nFr / 2; lag++) {
    let num = 0, d0 = 0, d1 = 0;
    for (let f = 0; f + lag < nFr; f++) {
      const a = fluxS[f] - fm, b = fluxS[f + lag] - fm;
      num += a * b; d0 += a * a; d1 += b * b;
    }
    const c = num / (Math.sqrt(d0 * d1) || 1);
    corrAt[lag] = c;
    if (c > bestC) bestC = c;
  }
  let bestLag = 0;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    if (corrAt[lag] >= bestC * 0.8) { bestLag = lag; break; }
  }
  const acIv = bestC > 0.2 ? bestLag * hopSec : 0;
  const meanIv = medIv > 0.2 ? medIv : acIv;
  const bands = {};
  for (const f of [50, 90, 150, 700, 900, 1200]) {
    bands[f] = goertzel(mono, sr, f);
  }
  for (const f of extraFreqs || []) {
    bands[f] = goertzel(mono, sr, f);
  }
  return {
    duration: len / sr, channels: ch, sampleRate: sr,
    peakL, peakR, peakTimeL: tL, peakTimeR: tR,
    bands,
    knockPeaks: peaks, knockInterval: meanIv,
    dbg: { maxFlux, corr: bestC },
  };
}

const AudioLib = {
  mulberry32, FAULTS, assignmentFromSeed, knockInterval,
  humLevel, humFreq, frictionFreq, encodeWav, goertzel, analyzeBuffer,
};
if (typeof module !== 'undefined') module.exports = AudioLib;

/* ================= 实时引擎(浏览器) ================= */
const MACHINE_X = [0.18, 0.5, 0.82];
const MACHINE_Y = 0.52;

function distGain(point, mx, my) {
  const d = Math.hypot(point.x - mx, point.y - my);
  return Math.max(0, 1 - d / 0.45);
}

function makeDistCurve(amount) {
  const n = 256, curve = new Float32Array(n);
  const k = 1 + amount * 60;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}

/* 在任意 BaseAudioContext 上构建故障声源,实时/离线共用。
   reg 为节点注册表(离线时传 null);返回 { stop(at) }。 */
function buildVoices(ctx, mix, params, point, t0, duration, reg) {
  const assign = assignmentFromSeed(params.seed);
  const track = (n) => { if (reg) reg.add(n); return n; };
  const stops = [];
  const machineGains = [];
  const noiseBuf = ctx.createBuffer(2, ctx.sampleRate * 2, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const rng = mulberry32(params.seed * 31 + c + 1);
    const d = noiseBuf.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] = rng() * 2 - 1;
  }

  // 背景负载嗡声(不随听诊点变化)
  const humG = track(ctx.createGain());
  humG.gain.setValueAtTime(humLevel(params.load), t0);
  const hum1 = track(ctx.createOscillator());
  hum1.frequency.value = humFreq(params.load);
  const hum2 = track(ctx.createOscillator());
  hum2.frequency.value = humFreq(params.load) * 2;
  const hum2g = track(ctx.createGain()); hum2g.gain.value = 0.4;
  hum1.connect(humG); hum2.connect(hum2g); hum2g.connect(humG);
  humG.connect(mix);
  hum1.start(t0); hum2.start(t0);
  stops.push(hum1, hum2);

  for (let m = 0; m < 3; m++) {
    const g = track(ctx.createGain());
    g.gain.value = distGain(point, MACHINE_X[m], MACHINE_Y);
    machineGains.push(g);
    const pan = track(ctx.createStereoPanner());
    pan.pan.value = (MACHINE_X[m] - 0.5) * 1.6;
    g.connect(pan); pan.connect(mix);
    const fault = assign[m];

    if (fault === 0) { // 连续音
      const o1 = track(ctx.createOscillator());
      o1.type = 'sawtooth';
      o1.frequency.value = 110 * (1 + 0.3 * params.load);
      const o2 = track(ctx.createOscillator());
      o2.frequency.value = o1.frequency.value * 2.01;
      const og = track(ctx.createGain()); og.gain.value = 0.16;
      const o2g = track(ctx.createGain()); o2g.gain.value = 0.4;
      const lfo = track(ctx.createOscillator()); lfo.frequency.value = 5;
      const lfoG = track(ctx.createGain()); lfoG.gain.value = 3;
      lfo.connect(lfoG); lfoG.connect(o1.frequency);
      o1.connect(og); o2.connect(o2g); o2g.connect(og); og.connect(g);
      o1.start(t0); o2.start(t0); lfo.start(t0);
      stops.push(o1, o2, lfo);
    } else if (fault === 1) { // 敲击音:绝对时间调度,无累积漂移
      const iv = knockInterval(params.load);
      const end = isFinite(duration) ? t0 + duration : Infinity;
      const scheduleKnock = (t) => {
        const o = track(ctx.createOscillator());
        o.frequency.setValueAtTime(190, t);
        o.frequency.exponentialRampToValueAtTime(70, t + 0.09);
        const e = track(ctx.createGain());
        e.gain.setValueAtTime(0.0001, t);
        e.gain.exponentialRampToValueAtTime(0.9, t + 0.004);
        e.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        o.connect(e); e.connect(g);
        o.start(t); o.stop(t + 0.2);
        if (reg) o.onended = () => {
          reg.delete(o); reg.delete(e);
          o.disconnect(); e.disconnect();
        };
      };
      if (isFinite(duration)) {
        for (let t = t0; t < end; t += iv) scheduleKnock(t);
      } else {
        const st = { next: t0, iv, scheduleKnock, timer: null };
        st.timer = setInterval(() => {
          const ahead = ctx.currentTime + 0.15;
          while (st.next < ahead) { st.scheduleKnock(st.next); st.next += st.iv; }
        }, 40);
        stops.push({ stop: () => clearInterval(st.timer) });
      }
    } else { // 摩擦音
      const src = track(ctx.createBufferSource());
      src.buffer = noiseBuf; src.loop = true;
      const bp = track(ctx.createBiquadFilter());
      bp.type = 'bandpass';
      bp.frequency.value = frictionFreq(params.load);
      bp.Q.value = 9;
      const lfo = track(ctx.createOscillator()); lfo.frequency.value = 0.8;
      const lfoG = track(ctx.createGain());
      lfoG.gain.value = frictionFreq(params.load) * 0.35;
      lfo.connect(lfoG); lfoG.connect(bp.frequency);
      const fg = track(ctx.createGain()); fg.gain.value = 0.5;
      src.connect(bp); bp.connect(fg); fg.connect(g);
      src.start(t0); lfo.start(t0);
      stops.push(src, lfo);
    }
  }
  return {
    stop(at) {
      for (const s of stops) { try { s.stop(at); } catch (e) { /* 已停止 */ } }
    },
    machineGains,
  };
}

class Engine {
  constructor() {
    this.ctx = null;
    this.params = { load: 0.4, gain: 0.5, monitor: 'main', seed: 7 };
    this.point = { x: 0.18, y: 0.30 };
    this.voiceNodes = new Set();
    this.voices = null;
    this.playing = false;
    this.stepCount = 0;
  }

  ensure() {
    if (this.ctx) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.mix = ctx.createGain();          // 声源汇总
    this.preGain = ctx.createGain();      // 听诊增益
    this.shaper = ctx.createWaveShaper(); // 过度增益失真
    this.shaper.oversample = '2x';
    this.comp = ctx.createDynamicsCompressor();
    this.mainPath = ctx.createGain();
    this.bypassPath = ctx.createGain();
    this.master = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.splitter = ctx.createChannelSplitter(2);
    this.anaL = ctx.createAnalyser(); this.anaR = ctx.createAnalyser();
    this.mix.connect(this.preGain);
    this.preGain.connect(this.shaper);
    this.shaper.connect(this.comp);
    this.comp.connect(this.mainPath);
    this.preGain.connect(this.bypassPath);
    this.mainPath.connect(this.master);
    this.bypassPath.connect(this.master);
    this.master.connect(this.analyser);
    this.analyser.connect(this.splitter);
    this.splitter.connect(this.anaL, 0);
    this.splitter.connect(this.anaR, 1);
    this.analyser.connect(ctx.destination);
    this.applyParams();
  }

  applyParams() {
    if (!this.ctx) return;
    const p = this.params;
    this.preGain.gain.value = 0.2 + p.gain * 1.6;
    const drive = Math.max(0, (p.gain - 0.7) / 0.3);
    this.shaper.curve = makeDistCurve(drive);
    this.distorted = drive > 0;
    this.mainPath.gain.value = p.monitor === 'main' ? 1 : 0;
    this.bypassPath.gain.value = p.monitor === 'bypass' ? 1 : 0;
    this.master.gain.value = p.monitor === 'mute' ? 0 : 1;
  }

  setParams(p) { Object.assign(this.params, p); this.applyParams(); }
  setPoint(pt) {
    this.point = pt;
    if (this.playing && this.voices && this.voices.machineGains) {
      const t = this.ctx.currentTime;
      this.voices.machineGains.forEach((g, m) => {
        g.gain.setTargetAtTime(distGain(pt, MACHINE_X[m], MACHINE_Y), t, 0.03);
      });
    }
  }

  play() {
    this.ensure();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.teardownVoices();
    this.voices = buildVoices(
      this.ctx, this.mix, this.params, this.point,
      this.ctx.currentTime + 0.05, Infinity, this.voiceNodes);
    this.playing = true;
  }

  teardownVoices() {
    if (this.voices) { this.voices.stop(); this.voices = null; }
    for (const n of this.voiceNodes) { try { n.disconnect(); } catch (e) {} }
    this.voiceNodes.clear();
  }

  pause() {
    // 立即停止所有声源并断开,无尾音、无残留节点
    this.teardownVoices();
    this.playing = false;
  }

  replay() { this.play(); }

  step() {
    // 暂停态下单步:精确触发一次敲击节拍
    this.ensure();
    if (this.playing) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const t = this.ctx.currentTime + 0.03;
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.09);
    const e = this.ctx.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(0.9, t + 0.004);
    e.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(e); e.connect(this.mix);
    this.voiceNodes.add(o); this.voiceNodes.add(e);
    o.onended = () => {
      this.voiceNodes.delete(o); this.voiceNodes.delete(e);
      o.disconnect(); e.disconnect();
    };
    o.start(t); o.stop(t + 0.2);
    this.stepCount++;
  }

  activeNodes() { return this.voiceNodes.size; }

  levels() {
    if (!this.ctx) return { l: 0, r: 0 };
    const a = new Float32Array(this.anaL.fftSize);
    const b = new Float32Array(this.anaR.fftSize);
    this.anaL.getFloatTimeDomainData(a);
    this.anaR.getFloatTimeDomainData(b);
    const rms = (d) => Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length);
    return { l: rms(a), r: rms(b) };
  }

  /* 离线渲染并导出 WAV,返回 { wav, analysis } */
  async exportWav(duration = 4, extraFreqs) {
    const sr = 44100;
    const off = new OfflineAudioContext(2, Math.floor(sr * duration), sr);
    const mix = off.createGain();
    const pre = off.createGain();
    pre.gain.value = 0.2 + this.params.gain * 1.6;
    const shaper = off.createWaveShaper();
    const drive = Math.max(0, (this.params.gain - 0.7) / 0.3);
    shaper.curve = makeDistCurve(drive);
    mix.connect(pre); pre.connect(shaper); shaper.connect(off.destination);
    buildVoices(off, mix, this.params, this.point, 0, duration, null);
    const buf = await off.startRendering();
    return { wav: encodeWav(buf), analysis: analyzeBuffer(buf, extraFreqs) };
  }
}

if (typeof window !== 'undefined') {
  window.AudioLib = AudioLib;
  window.Engine = Engine;
}
