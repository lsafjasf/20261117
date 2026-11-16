// 运行时四维验证：左右声道、频段、延迟、节拍。
import { computeSpatial } from './acoustics.js';

// 采集当前参数下各声源的可观测维度快照。
export function collectSnapshot(state) {
  const sources = state.sources.map((source) => {
    const spatial = computeSpatial(state.mode, source, state.listener);
    return {
      name: source.name,
      mode: state.mode,
      freq: source.freq,
      distanceM: spatial.distanceM,
      delayMs: spatial.delayMs,
      gain: spatial.gain,
      left: spatial.left ?? spatial.fl ?? 0,
      right: spatial.right ?? spatial.fr ?? 0,
      reverbMix: state.reverbMix,
      bpm: state.bpm,
    };
  });
  return {
    at: new Date().toISOString(),
    mode: state.mode,
    audition: state.audition,
    bpm: state.bpm,
    listener: { ...state.listener },
    reverbMix: state.reverbMix,
    sources,
  };
}

const EPS = 1e-6;

// 对比两次快照，报告四个维度是否发生真实变化；至少三维变化即通过。
export function diffSnapshots(before, after) {
  const dims = [];
  const pick = (s) => s.sources;
  const b = pick(before);
  const a = pick(after);

  dims.push({
    dimension: '左右声道',
    changed: b.some((src, i) =>
      Math.abs(src.left - a[i].left) > EPS || Math.abs(src.right - a[i].right) > EPS),
    detail: describe(b, a, (s) => `L=${s.left.toFixed(3)} R=${s.right.toFixed(3)}`),
  });
  dims.push({
    dimension: '频段',
    changed: b.some((src, i) => src.freq !== a[i].freq),
    detail: describe(b, a, (s) => `${s.freq}Hz`),
  });
  dims.push({
    dimension: '延迟',
    changed: b.some((src, i) =>
      Math.abs(src.delayMs - a[i].delayMs) > EPS || Math.abs(src.gain - a[i].gain) > EPS),
    detail: describe(b, a, (s) => `${s.delayMs.toFixed(2)}ms/g${s.gain.toFixed(3)}`),
  });
  dims.push({
    dimension: '节拍',
    changed: before.bpm !== after.bpm,
    detail: `${before.bpm} BPM → ${after.bpm} BPM`,
  });

  const changedCount = dims.filter((d) => d.changed).length;
  return { dims, changedCount, pass: changedCount >= 3 };
}

function describe(before, after, fn) {
  return before.map((s, i) => `${s.name}: ${fn(s)} → ${fn(after[i])}`).join('；');
}

// 节点清洁自检：暂停后活动节点必须归零，且不允许出现游离 source。
export function cleanCheck(engine) {
  const count = engine.activeNodeCount;
  const playing = engine.playing;
  const hasSession = engine.session !== null;
  const pass = count === 0 && !playing && !hasSession;
  return {
    pass,
    activeNodes: count,
    playing,
    sessionOpen: hasSession,
    note: pass ? '暂停后无未关闭节点、无会话图、无尾音来源' : '检测到残留节点或未关闭会话',
  };
}

// 节拍漂移验证：调度时间戳与理论时间比较，偏差应小于一个音频量子。
export function beatDriftCheck(timestamps, bpm, stepCount = 8) {
  if (timestamps.length < 2) return { pass: false, maxDriftMs: null, note: '样本不足' };
  const nominal = 60 / bpm / 2;
  let maxDrift = 0;
  for (let i = 1; i < timestamps.length; i++) {
    const dt = (timestamps[i] - timestamps[i - 1]) / 1000;
    maxDrift = Math.max(maxDrift, Math.abs(dt - nominal));
  }
  const maxDriftMs = Math.round(maxDrift * 1000 * 100) / 100;
  return {
    pass: maxDrift < 0.005,
    maxDriftMs,
    note: `最大步进偏差 ${maxDriftMs}ms（阈值 5ms，共 ${timestamps.length} 个步进）`,
  };
}
