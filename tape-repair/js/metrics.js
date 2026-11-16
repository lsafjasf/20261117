/* Offline signal metrics: peaks, clipping, bands, beats, channel balance. */
(function (root) {
  function peakAndClip(channels) {
    const peaks = channels.map((data) => {
      let peak = 0;
      for (let i = 0; i < data.length; i++) {
        const a = Math.abs(data[i]);
        if (a > peak) peak = a;
      }
      return peak;
    });
    let clipped = 0;
    for (const data of channels) {
      for (let i = 0; i < data.length; i++) {
        if (Math.abs(data[i]) >= 1) clipped++;
      }
    }
    return { peaks, clipped, peak: Math.max.apply(null, peaks) };
  }

  function fftPower(data, sampleRate) {
    let n = 1;
    const maxN = Math.min(32768, data.length);
    while (n * 2 <= maxN) n *= 2;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = data[i];
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      while (j & bit) {
        j ^= bit;
        bit >>= 1;
      }
      j ^= bit;
      if (i < j) {
        const tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const angle = -2 * Math.PI / size;
      const wRe = Math.cos(angle);
      const wIm = Math.sin(angle);
      for (let base = 0; base < n; base += size) {
        let curRe = 1;
        let curIm = 0;
        for (let j = 0; j < half; j++) {
          const a = re[base + j];
          const c = im[base + j];
          const bRe = re[base + j + half];
          const bIm = im[base + j + half];
          const tRe = bRe * curRe - bIm * curIm;
          const tIm = bRe * curIm + bIm * curRe;
          re[base + j] = a + tRe;
          im[base + j] = c + tIm;
          re[base + j + half] = a - tRe;
          im[base + j + half] = c - tIm;
          const nextRe = curRe * wRe - curIm * wIm;
          const nextIm = curRe * wIm + curIm * wRe;
          curRe = nextRe;
          curIm = nextIm;
        }
      }
    }
    const power = new Float64Array(n / 2);
    for (let k = 0; k < n / 2; k++) {
      power[k] = (re[k] * re[k] + im[k] * im[k]) / (n * n);
    }
    return { power, binHz: sampleRate / n };
  }

  function bandEnergy(channels, sampleRate, bands) {
    const mono = new Float32Array(channels[0].length);
    for (const ch of channels) {
      for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / channels.length;
    }
    const { power, binHz } = fftPower(mono, sampleRate);
    const result = {};
    for (const name of Object.keys(bands)) {
      const [lo, hi] = bands[name];
      const k0 = Math.max(1, Math.floor(lo / binHz));
      const k1 = Math.min(power.length - 1, Math.ceil(hi / binHz));
      let sum = 0;
      for (let k = k0; k <= k1; k++) sum += power[k];
      result[name] = sum / Math.max(1, k1 - k0 + 1);
    }
    return result;
  }

  function detectBeats(channels, sampleRate) {
    const data = channels[0];
    const win = Math.floor(sampleRate * 0.02);
    const env = new Float32Array(Math.floor(data.length / win));
    for (let i = 0; i < env.length; i++) {
      let sum = 0;
      for (let j = 0; j < win; j++) {
        const v = data[i * win + j] || 0;
        sum += v * v;
      }
      env[i] = Math.sqrt(sum / win);
    }
    let mean = 0;
    for (let i = 0; i < env.length; i++) mean += env[i];
    mean /= env.length;
    const times = [];
    const gap = Math.ceil(0.12 / 0.02);
    for (let i = 2; i < env.length - 2; i++) {
      if (env[i] > mean * 1.6 &&
          env[i] >= env[i - 1] && env[i] >= env[i + 1] &&
          (times.length === 0 || i - times[times.length - 1] >= gap)) {
        times.push(i);
      }
    }
    return times.map((i) => i * win / sampleRate);
  }

  function beatStats(beats) {
    if (beats.length < 3) {
      return { intervals: [], mean: 0, maxDriftSec: null, count: beats.length };
    }
    const intervals = [];
    for (let i = 1; i < beats.length; i++) {
      intervals.push(beats[i] - beats[i - 1]);
    }
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const maxDriftSec = Math.max.apply(null,
      intervals.map((v) => Math.abs(v - mean)));
    return { intervals, mean, maxDriftSec, count: beats.length };
  }

  function channelBalance(channels) {
    if (channels.length < 2) return { rms: [rms(channels[0])], diff: 0 };
    const rmsL = rms(channels[0]);
    const rmsR = rms(channels[1]);
    let diffSum = 0;
    for (let i = 0; i < channels[0].length; i++) {
      diffSum += Math.abs(channels[0][i] - channels[1][i]);
    }
    return {
      rms: [rmsL, rmsR],
      diff: diffSum / channels[0].length,
      ratioDb: 20 * Math.log10((rmsR + 1e-12) / (rmsL + 1e-12)),
    };
  }

  function rms(data) {
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    return Math.sqrt(sum / data.length);
  }

  function summarize(channels, sampleRate, bands) {
    const level = peakAndClip(channels);
    const balance = channelBalance(channels);
    const beats = detectBeats(channels, sampleRate);
    return {
      durationSec: channels[0].length / sampleRate,
      channels: channels.length,
      peaks: level.peaks,
      peak: level.peak,
      clippedSamples: level.clipped,
      bands: bandEnergy(channels, sampleRate, bands),
      beat: beatStats(beats),
      balance,
    };
  }

  const api = {
    peakAndClip, bandEnergy, detectBeats, beatStats,
    channelBalance, summarize,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.AudioMetrics = api;
  }
})(typeof self !== 'undefined' ? self : globalThis);
