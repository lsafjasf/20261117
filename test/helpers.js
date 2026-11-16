// 测试公共工具：PCM 正弦波生成、全局 Web Audio 注入、内存版 localStorage。
import nwa from "node-web-audio-api";

export const SR = 48000;

export function sineWave(freq, seconds, sr = SR, phase = 0) {
  const n = Math.floor(seconds * sr);
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    buf[i] = Math.sin(2 * Math.PI * freq * (i / sr) + phase);
  }
  return buf;
}

export function noisySine(freq, seconds, noiseLevel, sr = SR) {
  const base = sineWave(freq, seconds, sr);
  for (let i = 0; i < base.length; i++) {
    base[i] += (Math.random() * 2 - 1) * noiseLevel;
  }
  return base;
}

export function installWebAudioGlobals() {
  globalThis.OfflineAudioContext = nwa.OfflineAudioContext;
  globalThis.AudioContext = nwa.AudioContext;
  globalThis.webkitOfflineAudioContext = nwa.OfflineAudioContext;
}

export class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
