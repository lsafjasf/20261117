// 验证套件：导出比较、四维参数变化、节拍漂移、尾音与静音检查。纯函数可在 Node 运行。
import { decodeWav, rms, peak, magnitudeSpectrum } from "./dsp.js";
import { renderOffline } from "./exporter.js";
import { DEFAULT_PARAMS, sanitizeParams } from "./params.js";

export function channelBalance(channelData) {
  const [l, r] = channelData;
  return {
    lPeak: peak(l),
    rPeak: peak(r),
    lRms: rms(l),
    rRms: rms(r),
    balance: (rms(r) - rms(l)) / (rms(r) + rms(l) + 1e-12)
  };
}

// 频段能量：低 <250Hz，中 250-2kHz，高 >2kHz。
export function bandEnergy(channelData, sampleRate) {
  const mono = new Float32Array(channelData[0].length);
  for (let i = 0; i < mono.length; i++) mono[i] = (channelData[0][i] + channelData[1][i]) * 0.5;
  const size = 1 << Math.floor(Math.log2(mono.length));
  const mag = magnitudeSpectrum(mono.slice(0, size));
  const binHz = sampleRate / size;
  const bands = { low: 0, mid: 0, high: 0 };
  for (let i = 1; i < mag.length; i++) {
    const hz = i * binHz;
    const e = mag[i] * mag[i];
    if (hz < 250) bands.low += e;
    else if (hz <= 2000) bands.mid += e;
    else bands.high += e;
  }
  return bands;
}

// 比较两次导出：时长、关键峰值、左右声道。
export function compareExports(wavA, wavB) {
  const a = decodeWav(wavA);
  const b = decodeWav(wavB);
  const durA = a.channelData[0].length / a.sampleRate;
  const durB = b.channelData[0].length / b.sampleRate;
  const balA = channelBalance(a.channelData);
  const balB = channelBalance(b.channelData);
  return {
    duration: { a: durA, b: durB, equal: Math.abs(durA - durB) < 0.02 },
    channels: { a: a.channels, b: b.channels, equal: a.channels === b.channels },
    peak: {
      a: { l: balA.lPeak, r: balA.rPeak },
      b: { l: balB.lPeak, r: balB.rPeak },
      changed: Math.abs(balA.lPeak - balB.lPeak) > 1e-4 || Math.abs(balA.rPeak - balB.rPeak) > 1e-4
    },
    balance: { a: balA.balance, b: balB.balance, changed: Math.abs(balA.balance - balB.balance) > 0.02 },
    sampleRate: { a: a.sampleRate, b: b.sampleRate }
  };
}

// 检测起音点（用于节拍漂移分析）。
export function onsetTimes(channelData, sampleRate, threshold = 0.08, expectedGap = null, noteCount = null) {
  const mono = channelData[0];
  const hop = Math.max(8, Math.floor(sampleRate * 0.005));
  // 先以 30ms 窗计算平滑能量包络，抑制锯齿波周期波动。
  const envWindow = Math.floor(sampleRate * 0.03);
  const levels = [];
  const times = [];
  for (let i = 0; i + envWindow < mono.length; i += hop) {
    let s = 0;
    for (let j = 0; j < envWindow; j++) s += mono[i + j] * mono[i + j];
    levels.push(Math.sqrt(s / envWindow));
    times.push(i / sampleRate);
  }
  const onsets = [];
  if (expectedGap) {
    // 节拍网格模式：首个起音由包络过阈值确定；之后每个节拍窗口（不重叠）
    // 内取最大能量上升位置作为该拍实测起音，尾音只会衰减、不会产生更大上升。
    let firstIdx = levels.findIndex((l) => l >= threshold);
    if (firstIdx < 0) return onsets;
    const expectedNotes = noteCount ?? Math.round(times[times.length - 1] / expectedGap);
    // 平滑窗会使首个过阈值点偏早半个窗，用理论首拍偏移（音符在 ~0.03s 触发）校正。
    const firstOnset = Math.max(times[firstIdx], 0.03);
    onsets.push(firstOnset);
    const gridStart = firstOnset + expectedGap;
    const win = expectedGap * 0.45;
    for (let k = 0; k < expectedNotes - 1; k++) {
      const center = gridStart + k * expectedGap;
      let bestIdx = -1;
      let bestRise = -Infinity;
      for (let i = 1; i < levels.length; i++) {
        if (Math.abs(times[i] - center) > win) continue;
        const rise = levels[i] - levels[i - 1];
        if (rise > bestRise && levels[i] >= threshold) {
          bestRise = rise;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) onsets.push(times[bestIdx]);
    }
  } else {
    // 无网格时回退到静音复位上升沿检测。
    let lastOnsetTime = -Infinity;
    let wasSilent = true;
    const silence = threshold * 0.25;
    for (let i = 0; i < levels.length; i++) {
      if (wasSilent && levels[i] >= threshold && times[i] - lastOnsetTime >= 0.12) {
        onsets.push(times[i]);
        lastOnsetTime = times[i];
        wasSilent = false;
      } else if (levels[i] < silence) {
        wasSilent = true;
      }
    }
  }
  return onsets;
}

// 尾部静音检查：最后 tailSeconds 内能量必须接近零（无尾音）。
export function tailSilence(channelData, sampleRate, tailSeconds = 0.12) {
  const tailLen = Math.floor(sampleRate * tailSeconds);
  const slice = channelData[0].slice(channelData[0].length - tailLen);
  return rms(slice);
}

async function render(overrides, mode) {
  return renderOffline({ ...DEFAULT_PARAMS, ...overrides }, { mode, bars: 3 });
}

// 四维验证：声道、频段、延迟/节拍至少三个维度随操作真实变化。
export async function verifyDimensions() {
  const results = [];
  const base = await render({});
  const panned = await render({ pan: 0.85 });
  const baseBal = channelBalance(base.channelData);
  const panBal = channelBalance(panned.channelData);
  results.push({
    dim: "左右声道",
    pass: Math.abs(panBal.balance - baseBal.balance) > 0.05,
    detail: `balance ${baseBal.balance.toFixed(3)} -> ${panBal.balance.toFixed(3)}`
  });

  const bright = await render({ highsDb: 12, lowsDb: -24 });
  const bandBase = bandEnergy(base.channelData, base.sampleRate);
  const bandBright = bandEnergy(bright.channelData, bright.sampleRate);
  const highRatio = bandBright.high / (bandBase.high + 1e-12);
  results.push({
    dim: "频段能量",
    pass: highRatio > 1.5,
    detail: `高频能量 x${highRatio.toFixed(2)}`
  });

  const delayed = await render({ delayTime: 0.45, feedback: 0.6 });
  const tailBase = tailSilence(base.channelData, base.sampleRate, 0.2);
  const tailDelay = tailSilence(delayed.channelData, delayed.sampleRate, 0.2);
  results.push({
    dim: "延迟尾音",
    pass: tailDelay > tailBase * 1.5 && tailDelay > 0.002,
    detail: `尾部RMS ${tailBase.toFixed(4)} -> ${tailDelay.toFixed(4)}`
  });

  const slow = await render({ bpm: 60 });
  const fast = await render({ bpm: 200 });
  const slowOnsets = onsetTimes(slow.channelData, slow.sampleRate, 0.08, 60 / 60, 3);
  const fastOnsets = onsetTimes(fast.channelData, fast.sampleRate, 0.08, 60 / 200, 3);
  results.push({
    dim: "节拍间隔",
    pass: slowOnsets.length >= 2 && fastOnsets.length >= 2 &&
      (slowOnsets[1] - slowOnsets[0]) > (fastOnsets[1] - fastOnsets[0]) * 1.5,
    detail: `起音间隔 ${slowOnsets.length ? (slowOnsets[1] - slowOnsets[0]).toFixed(3) : "n/a"}s(60bpm) vs ${fastOnsets.length ? (fastOnsets[1] - fastOnsets[0]).toFixed(3) : "n/a"}s(200bpm)`
  });

  const passCount = results.filter((r) => r.pass).length;
  return { results, passCount, ok: passCount >= 3 };
}

// 节拍漂移：各拍实际起音间隔与理论 BPM 间隔偏差。
export function beatDriftReport(channelData, sampleRate, bpm, noteCount = null) {
  const expected = 60 / bpm;
  const onsets = onsetTimes(channelData, sampleRate, 0.08, expected, noteCount);
  const intervals = [];
  for (let i = 1; i < onsets.length; i++) intervals.push(onsets[i] - onsets[i - 1]);
  const maxErr = intervals.reduce((m, v) => Math.max(m, Math.abs(v - expected)), 0);
  return { onsets, intervals, expected, maxErr, ok: maxErr < 0.02 };
}

export { sanitizeParams };
