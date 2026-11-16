// 纯 DSP 工具：FFT、自相关音高检测、电平/峰值、WAV 编解码。无 DOM 依赖。

export function dbToGain(db) {
  return Math.pow(10, db / 20);
}

export function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}

export function peak(samples) {
  let p = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > p) p = a;
  }
  return p;
}

// 迭代基-2 FFT。re/im 长度必须为 2 的幂。
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

export function magnitudeSpectrum(samples) {
  const n = samples.length;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  re.set(samples);
  fft(re, im);
  const mag = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) mag[i] = Math.hypot(re[i], im[i]) / n;
  return mag;
}

// 带噪声门限的自相关基频检测，返回 {freq, clarity}。
export function detectPitch(buffer, sampleRate, options = {}) {
  const noiseFloor = options.noiseFloor ?? 0.01;
  const clarityThreshold = options.clarityThreshold ?? 0.3;
  const minFreq = options.minFreq ?? 40;
  const maxFreq = options.maxFreq ?? 2000;
  const level = rms(buffer);
  if (level < noiseFloor) return { freq: 0, clarity: 0, level };

  const minLag = Math.floor(sampleRate / maxFreq);
  const maxLag = Math.min(Math.floor(buffer.length / 2), Math.ceil(sampleRate / minFreq));
  // YIN 差分函数 + 累积均值归一化（CMNDF），抑制次谐波误判。
  const diff = new Float32Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < buffer.length; i++) {
      const d = buffer[i] - buffer[i + lag];
      sum += d * d;
    }
    diff[lag] = sum;
  }
  const cmndf = new Float32Array(maxLag + 1);
  cmndf[0] = 1;
  let run = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    run += diff[lag];
    cmndf[lag] = diff[lag] / (run / lag);
  }
  // 取低于阈值的第一个谷，避免选到倍周期。
  const threshold = 1 - clarityThreshold;
  let tau = 0;
  for (let lag = minLag; lag < maxLag; lag++) {
    if (cmndf[lag] < threshold && cmndf[lag] <= cmndf[lag - 1] && cmndf[lag] <= cmndf[lag + 1]) {
      tau = lag;
      break;
    }
  }
  if (!tau) {
    let best = Infinity;
    for (let lag = minLag; lag < maxLag; lag++) {
      if (cmndf[lag] < best) { best = cmndf[lag]; tau = lag; }
    }
  }
  // 抛物线插值得到亚样本精度。
  let refined = tau;
  if (tau > 0 && tau < maxLag) {
    const s0 = cmndf[tau - 1], s1 = cmndf[tau], s2 = cmndf[tau + 1];
    const denom = s0 + s2 - 2 * s1;
    if (Math.abs(denom) > 1e-12) refined = tau + 0.5 * (s0 - s2) / denom;
  }
  const clarity = 1 - cmndf[tau];
  if (clarity < clarityThreshold || !tau) {
    return { freq: 0, clarity, level };
  }
  return { freq: sampleRate / refined, clarity, level };
}

export function centsOffset(detected, target) {
  if (!detected || !target) return 0;
  return 1200 * Math.log2(detected / target);
}

// 交错立体声 PCM -> 16-bit PCM WAV (Blob 由调用方包装)。
export function encodeWav(channelData, sampleRate) {
  const channels = channelData.length;
  const frames = channelData[0].length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (off, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  let off = 44;
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < channels; ch++) {
      const s = Math.max(-1, Math.min(1, channelData[ch][i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return buffer;
}

// 解析 WAV -> {sampleRate, channels, channelData: Float32Array[]}。
export function decodeWav(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (view.getUint32(0, false) !== 0x52494646) throw new Error("不是 WAV (RIFF) 文件");
  const sampleRate = view.getUint32(24, true);
  const channels = view.getUint16(22, true);
  const bits = view.getUint16(34, true);
  let off = 12;
  let dataSize = 0;
  while (off + 8 <= view.byteLength) {
    const id = view.getUint32(off, false);
    const size = view.getUint32(off + 4, true);
    if (id === 0x64617461) {
      dataSize = size;
      off += 8;
      break;
    }
    off += 8 + size + (size & 1);
  }
  if (!dataSize) throw new Error("WAV 缺少 data 块");
  const frames = Math.floor(dataSize / (channels * (bits / 8)));
  const channelData = Array.from({ length: channels }, () => new Float32Array(frames));
  let p = off;
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < channels; ch++) {
      const int = view.getInt16(p, true);
      channelData[ch][i] = int < 0 ? int / 0x8000 : int / 0x7fff;
      p += 2;
    }
  }
  return { sampleRate, channels, channelData };
}
