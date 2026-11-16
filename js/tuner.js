// 调音逻辑：模拟/真实输入、音高识别、噪声门限、削波误判、三音区保持判定。
import { detectPitch, centsOffset, rms } from "./dsp.js";
import { REGISTERS, sanitizeParams } from "./params.js";

export class Tuner {
  constructor(params) {
    this.params = sanitizeParams(params);
    this.states = new Map(REGISTERS.map((r) => [r.id, { stableRounds: 0, ok: false, lastCents: null }]));
    this.overload = false;
    this.lastResult = { freq: 0, clarity: 0, level: 0, cents: 0, regId: null };
  }

  updateParams(params) {
    this.params = sanitizeParams(params);
  }

  // 模拟麦克风：从引擎当前回采缓冲 + 背景噪声合成输入，再施加输入增益。
  static simulateMicInput(cleanBuffer, sampleRate, inputGain, noiseLevel = 0.004) {
    const out = new Float32Array(cleanBuffer.length);
    let clipping = false;
    let noiseEnergy = 0;
    for (let i = 0; i < out.length; i++) {
      const noise = (Math.random() * 2 - 1) * noiseLevel;
      noiseEnergy += noise * noise;
      let v = (cleanBuffer[i] + noise) * inputGain;
      if (v > 1 || v < -1) {
        clipping = true;
        v = Math.max(-1, Math.min(1, v));
      }
      out[i] = v;
    }
    return { buffer: out, clipping, noiseRms: Math.sqrt(noiseEnergy / out.length) };
  }

  // 选择与检测频率最接近的音区。
  pickRegister(freq) {
    let best = null;
    let bestDist = Infinity;
    for (const reg of REGISTERS) {
      const dist = Math.abs(Math.log2(freq / reg.target));
      if (dist < bestDist) {
        bestDist = dist;
        best = reg;
      }
    }
    return bestDist <= 0.4 ? best : null;
  }

  // 处理一帧输入并更新调音状态。
  processFrame(buffer, sampleRate, clipping = false) {
    const p = this.params;
    const level = rms(buffer);
    this.overload = clipping || level >= 0.99;
    const result = detectPitch(buffer, sampleRate, {
      noiseFloor: p.noiseFloor,
      clarityThreshold: 0.35,
      minFreq: 60,
      maxFreq: 1000
    });
    if (!result.freq) {
      this.lastResult = { ...result, cents: 0, regId: null };
      return this.lastResult;
    }
    const reg = this.pickRegister(result.freq);
    if (!reg) {
      this.lastResult = { ...result, cents: 0, regId: null };
      return this.lastResult;
    }
    const cents = centsOffset(result.freq, reg.target);
    const state = this.states.get(reg.id);
    state.lastCents = cents;
    // 增益过高导致削波时不计为有效校准，防止误判。
    if (!this.overload && Math.abs(cents) <= p.centsTolerance) {
      state.stableRounds++;
      if (state.stableRounds >= p.holdRounds) state.ok = true;
    } else {
      state.stableRounds = 0;
    }
    this.lastResult = { ...result, cents, regId: reg.id };
    return this.lastResult;
  }

  isComplete() {
    return REGISTERS.every((r) => this.states.get(r.id).ok);
  }

  snapshot() {
    return {
      overload: this.overload,
      last: this.lastResult,
      registers: REGISTERS.map((r) => ({ ...r, ...this.states.get(r.id) })),
      complete: this.isComplete()
    };
  }
}
