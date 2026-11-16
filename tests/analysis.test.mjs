// 分析链路单元测试：FFT / WAV 编解码 / 维度分析 / 峰值对比
import { fft, analyzeBuffer, encodeWAV, decodeWAV, comparePeaks } from '../js/analysis.js';
import { compareMetrics } from '../js/verify.js';

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error('FAIL:', msg); }
  else console.log('ok:', msg);
}

// --- FFT：单频余弦应在对应 bin 出现峰值 ---
{
  const n = 1024, k = 37;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * k * i) / n);
  fft(re, im);
  let peakBin = 0, peakMag = 0;
  for (let i = 0; i < n / 2; i++) {
    const m = Math.hypot(re[i], im[i]);
    if (m > peakMag) { peakMag = m; peakBin = i; }
  }
  assert(peakBin === k, `FFT 峰值 bin=${peakBin} 期望 ${k}`);
}

// --- 构造假 AudioBuffer ---
function fakeBuffer(channels, sampleRate) {
  return {
    numberOfChannels: channels.length,
    sampleRate,
    length: channels[0].length,
    getChannelData: (i) => channels[i],
  };
}

// --- 合成：左偏声像的 3 个 440Hz 事件，间隔 0.3s ---
const sr = 44100;
const interval = 0.3, decay = 0.2, freq = 440, events = 3, lead = 0.1;
const total = lead + events * interval + 0.5;
const L = new Float32Array(Math.ceil(total * sr));
const R = new Float32Array(L.length);
for (let e = 0; e < events; e++) {
  const start = Math.floor((lead + e * interval) * sr);
  const len = Math.floor(decay * sr);
  for (let i = 0; i < len && start + i < L.length; i++) {
    const env = Math.exp((-4 * i) / len);
    const s = 0.5 * Math.sin((2 * Math.PI * freq * i) / sr) * env;
    L[start + i] += s * 0.9; // 左偏
    R[start + i] += s * 0.4;
  }
}
const buf = fakeBuffer([L, R], sr);

// --- analyzeBuffer ---
const m = analyzeBuffer(buf);
assert(Math.abs(m.duration - total) < 0.01, `时长 ${m.duration.toFixed(3)} ≈ ${total}`);
assert(m.channels === 2, '声道数 = 2');
assert(m.peakL > m.peakR * 1.5, `左峰值 ${m.peakL.toFixed(3)} 明显大于右 ${m.peakR.toFixed(3)}`);
assert(Math.abs(m.dominantFreq - freq) < 10, `主频 ${m.dominantFreq.toFixed(1)} ≈ ${freq}`);
assert(m.onsetCount === events, `onset 数 ${m.onsetCount} = ${events}`);
assert(Math.abs(m.avgInterval - interval) < 0.01, `平均间隔 ${m.avgInterval.toFixed(3)} ≈ ${interval}`);
assert(Math.abs(m.firstOnset - lead) < 0.02, `首 onset ${m.firstOnset.toFixed(3)} ≈ ${lead}`);

// --- WAV 往返 ---
const wav = encodeWAV(buf);
const dec = decodeWAV(wav);
assert(dec.channels === 2, 'WAV 声道数 = 2');
assert(dec.sampleRate === sr, 'WAV 采样率一致');
assert(dec.length === buf.length, `WAV 帧数 ${dec.length} = ${buf.length}`);
const cmp = comparePeaks(buf, dec);
assert(cmp.durationOk, '时长一致');
assert(cmp.channels.every((p) => p.peakErr < 0.001), '峰值误差 < 0.001');
assert(cmp.channels.every((p) => p.posErr < 0.001), '峰位误差 < 1ms');

// --- compareMetrics：改音高/声像/间隔后 ≥3 维度变化 ---
const m2 = analyzeBuffer(buf);
const m3 = { ...m2, peakR: m2.peakR * 0.5, lrRatio: m2.lrRatio * 2, dominantFreq: m2.dominantFreq * 1.5, avgInterval: m2.avgInterval * 2 };
const rows = compareMetrics(m2, m3);
const changed = rows.filter((r) => r.changed).length;
assert(changed >= 3, `参数变化后 ${changed} 个维度变化 (≥3)`);
const rowsSame = compareMetrics(m2, m2);
assert(rowsSame.every((r) => !r.changed), '相同参数复验全部一致（无漂移）');

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
