// 离线渲染与维度对比：验证声道/频段/节拍随参数真实变化
import { buildVoice } from './engine.js';
import { analyzeBuffer, encodeWAV, decodeWAV, comparePeaks } from './analysis.js';

// 用当前参数离线渲染整段 pattern（确定性，可重复对比）
export async function renderOffline(params, pattern, loops = 2, sampleRate = 44100) {
  const steps = pattern.length * loops;
  const interval = params.stepInterval / 1000;
  const maxDecay = Math.max(
    params.success.decay, params.warning.decay, params.error.decay
  );
  const lead = 0.1;
  const total = lead + steps * interval + maxDecay + 0.3;
  const ctx = new OfflineAudioContext(2, Math.ceil(total * sampleRate), sampleRate);
  const out = ctx.createGain();
  out.connect(ctx.destination);
  let t = lead;
  for (let i = 0; i < steps; i++) {
    const type = pattern[i % pattern.length];
    if (type) buildVoice(ctx, out, type, t, params[type]);
    t += interval;
  }
  return ctx.startRendering();
}

export async function analyzeParams(params, pattern, loops = 2) {
  const buf = await renderOffline(params, pattern, loops);
  return analyzeBuffer(buf);
}

const fmt = (v, d = 3) => (typeof v === 'number' && isFinite(v) ? v.toFixed(d) : String(v));

// 维度行定义：名称 / 取值 / 判定显著变化的阈值
export const DIMENSIONS = [
  { key: 'peakL', name: '左声道峰值', digits: 4, threshold: 0.001 },
  { key: 'peakR', name: '右声道峰值', digits: 4, threshold: 0.001 },
  { key: 'lrRatio', name: '左右峰值比', digits: 3, threshold: 0.01 },
  { key: 'dominantFreq', name: '主频 (Hz)', digits: 1, threshold: 2 },
  { key: 'spectralCentroid', name: '频谱质心 (Hz)', digits: 1, threshold: 5 },
  { key: 'firstOnset', name: '首事件时刻 (s)', digits: 3, threshold: 0.005 },
  { key: 'avgInterval', name: '平均节拍间隔 (s)', digits: 3, threshold: 0.005 },
  { key: 'onsetCount', name: '事件数', digits: 0, threshold: 0.5 },
  { key: 'duration', name: '总时长 (s)', digits: 3, threshold: 0.01 },
];

export function compareMetrics(baseline, current) {
  return DIMENSIONS.map((d) => {
    const b = baseline[d.key];
    const c = current[d.key];
    const changed = Math.abs(b - c) > d.threshold;
    return { name: d.name, baseline: fmt(b, d.digits), current: fmt(c, d.digits), changed };
  });
}

// 导出 WAV 并回读校验：时长、声道数、关键峰值
export async function exportAndVerifyWAV(params, pattern, loops = 2) {
  const buf = await renderOffline(params, pattern, loops);
  const wavBytes = encodeWAV(buf);
  const decoded = decodeWAV(wavBytes);
  const peaks = comparePeaks(buf, decoded);
  return {
    buffer: buf,
    wavBytes,
    check: {
      durationSrc: buf.length / buf.sampleRate,
      durationWav: decoded.length / decoded.sampleRate,
      durationOk: peaks.durationOk,
      channelsSrc: buf.numberOfChannels,
      channelsWav: decoded.channels,
      channelsOk: buf.numberOfChannels === decoded.channels,
      peaks: peaks.channels,
      peaksOk: peaks.channels.every((p) => p.peakErr < 0.001 && p.posErr < 0.001),
    },
  };
}
