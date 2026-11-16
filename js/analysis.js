// 纯函数分析模块：不依赖 Web Audio，可在 Node 中独立测试

// 基-2 FFT（就地，re/im 为 Float64Array）
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
      let cwr = 1, cwi = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j], ui = im[i + j];
        const vr = re[i + j + len / 2] * cwr - im[i + j + len / 2] * cwi;
        const vi = re[i + j + len / 2] * cwi + im[i + j + len / 2] * cwr;
        re[i + j] = ur + vr;
        im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr;
        im[i + j + len / 2] = ui - vi;
        const nwr = cwr * wr - cwi * wi;
        cwi = cwr * wi + cwi * wr;
        cwr = nwr;
      }
    }
  }
}

function peakOf(data) {
  let p = 0;
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i]);
    if (a > p) p = a;
  }
  return p;
}

function rmsOf(data) {
  let s = 0;
  for (let i = 0; i < data.length; i++) s += data[i] * data[i];
  return Math.sqrt(s / data.length);
}

// 包络 onset 检测：hop=256，阈值自适应，最小间隔 0.1s
function detectOnsets(mono, sampleRate) {
  const hop = 256;
  const env = [];
  for (let i = 0; i + hop <= mono.length; i += hop) {
    let s = 0;
    for (let j = 0; j < hop; j++) s += Math.abs(mono[i + j]);
    env.push(s / hop);
  }
  const maxEnv = Math.max(...env, 1e-9);
  const th = maxEnv * 0.15;
  const onsets = [];
  const minGap = Math.floor(0.1 * sampleRate / hop);
  let last = -minGap;
  for (let i = 1; i < env.length; i++) {
    if (env[i] > th && env[i - 1] <= th && i - last >= minGap) {
      onsets.push((i * hop) / sampleRate);
      last = i;
    }
  }
  return onsets;
}

// 主频与频谱质心：取第一个 onset 后 0.2s 窗口做 FFT
function spectrumStats(mono, sampleRate, onsetTime) {
  const n = 8192;
  const start = Math.floor(onsetTime * sampleRate);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const idx = start + i;
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1))); // Hann
    re[i] = idx < mono.length ? mono[idx] * w : 0;
  }
  fft(re, im);
  let peakMag = 0, peakBin = 0, centroidNum = 0, magSum = 0;
  const binHz = sampleRate / n;
  for (let i = 1; i < n / 2; i++) {
    const mag = Math.hypot(re[i], im[i]);
    if (mag > peakMag) { peakMag = mag; peakBin = i; }
    centroidNum += i * binHz * mag;
    magSum += mag;
  }
  return {
    dominantFreq: peakBin * binHz,
    spectralCentroid: magSum > 0 ? centroidNum / magSum : 0,
  };
}

// 综合维度分析：声道峰值/RMS、主频、质心、onset、节拍间隔、时长
export function analyzeBuffer(buffer) {
  const sampleRate = buffer.sampleRate;
  const L = buffer.getChannelData(0);
  const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
  const mono = new Float32Array(L.length);
  for (let i = 0; i < L.length; i++) mono[i] = (L[i] + R[i]) / 2;
  const onsets = detectOnsets(mono, sampleRate);
  const spec = spectrumStats(mono, sampleRate, onsets.length ? onsets[0] : 0);
  const intervals = [];
  for (let i = 1; i < onsets.length; i++) intervals.push(onsets[i] - onsets[i - 1]);
  const avgInterval = intervals.length
    ? intervals.reduce((a, b) => a + b, 0) / intervals.length
    : 0;
  return {
    duration: buffer.length / sampleRate,
    channels: buffer.numberOfChannels,
    peakL: peakOf(L),
    peakR: peakOf(R),
    rmsL: rmsOf(L),
    rmsR: rmsOf(R),
    lrRatio: peakOf(R) > 1e-9 ? peakOf(L) / peakOf(R) : Infinity,
    dominantFreq: spec.dominantFreq,
    spectralCentroid: spec.spectralCentroid,
    onsetCount: onsets.length,
    firstOnset: onsets.length ? onsets[0] : 0,
    avgInterval,
    onsets,
  };
}

// 编码 16-bit PCM 立体声 WAV
export function encodeWAV(buffer) {
  const numCh = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const len = buffer.length;
  const bytesPerSample = 2;
  const dataSize = len * numCh * bytesPerSample;
  const out = new ArrayBuffer(44 + dataSize);
  const v = new DataView(out);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, numCh, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * numCh * bytesPerSample, true);
  v.setUint16(32, numCh * bytesPerSample, true);
  v.setUint16(34, 16, true);
  writeStr(36, 'data');
  v.setUint32(40, dataSize, true);
  const chans = [];
  for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return out;
}

// 解码 16-bit PCM WAV → { channels, sampleRate, length, data: [Float32Array...] }
export function decodeWAV(arrayBuffer) {
  const v = new DataView(arrayBuffer);
  const numCh = v.getUint16(22, true);
  const sampleRate = v.getUint32(24, true);
  const bits = v.getUint16(34, true);
  if (bits !== 16) throw new Error('仅支持 16-bit WAV');
  let dataOff = 44;
  // 跳过非 data chunk
  let off = 12;
  while (off + 8 <= arrayBuffer.byteLength) {
    const id = String.fromCharCode(v.getUint8(off), v.getUint8(off + 1), v.getUint8(off + 2), v.getUint8(off + 3));
    const size = v.getUint32(off + 4, true);
    if (id === 'data') { dataOff = off + 8; break; }
    off += 8 + size;
  }
  const frames = Math.floor((arrayBuffer.byteLength - dataOff) / (numCh * 2));
  const data = [];
  for (let c = 0; c < numCh; c++) data.push(new Float32Array(frames));
  let p = dataOff;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      data[c][i] = v.getInt16(p, true) / 0x8000;
      p += 2;
    }
  }
  return { channels: numCh, sampleRate, length: frames, data };
}

// 关键峰值对比：逐声道峰值与峰值位置
export function comparePeaks(buffer, decoded) {
  const result = { channels: [], durationOk: false };
  result.durationOk = Math.abs(decoded.length - buffer.length) <= 2;
  for (let c = 0; c < Math.min(buffer.numberOfChannels, decoded.channels); c++) {
    const src = buffer.getChannelData(c);
    const dst = decoded.data[c];
    let srcPeak = 0, srcIdx = 0, dstPeak = 0, dstIdx = 0;
    for (let i = 0; i < src.length; i++) {
      if (Math.abs(src[i]) > srcPeak) { srcPeak = Math.abs(src[i]); srcIdx = i; }
    }
    for (let i = 0; i < dst.length; i++) {
      if (Math.abs(dst[i]) > dstPeak) { dstPeak = Math.abs(dst[i]); dstIdx = i; }
    }
    result.channels.push({
      channel: c,
      srcPeak, dstPeak,
      peakErr: Math.abs(srcPeak - dstPeak),
      srcPeakPos: srcIdx / buffer.sampleRate,
      dstPeakPos: dstIdx / decoded.sampleRate,
      posErr: Math.abs(srcIdx - dstIdx) / buffer.sampleRate,
    });
  }
  return result;
}
