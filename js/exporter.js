/* 离线渲染 → 防削波 → WAV 编码 → 指标分析(时长/声道/峰值/频段/节拍)。 */
const Exporter = (() => {

  async function renderOffline(project, masterGain = 0.9, sampleRate = 44100) {
    const len = Math.round(TIMELINE_LEN * sampleRate);
    const ctx = new OfflineAudioContext(2, len, sampleRate);
    const clipBus = ctx.createGain();
    const mg = ctx.createGain(); mg.gain.value = masterGain;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6; comp.ratio.value = 8;
    clipBus.connect(mg).connect(comp).connect(ctx.destination);
    Synths.resetRandom(20261117); // 固定种子:相同参数渲染结果可复现
    for (const clip of project.clips) Synths[clip.type](ctx, clip, clipBus, 0);
    let buffer = await ctx.startRendering();
    let peak = 0;
    for (let ch = 0; ch < 2; ch++) {
      const d = buffer.getChannelData(ch);
      for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
    }
    let normalized = false;
    if (peak > 0.98) { // 防削波:整体缩放到 0.98
      const k = 0.98 / peak;
      for (let ch = 0; ch < 2; ch++) {
        const d = buffer.getChannelData(ch);
        for (let i = 0; i < d.length; i++) d[i] *= k;
      }
      peak = 0.98; normalized = true;
    }
    return { buffer, peak, normalized };
  }

  function encodeWAV(buffer) {
    const ch = buffer.numberOfChannels, sr = buffer.sampleRate, n = buffer.length;
    const bytes = 44 + n * ch * 2;
    const ab = new ArrayBuffer(bytes), v = new DataView(ab);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); v.setUint32(4, bytes - 8, true); ws(8, 'WAVE');
    ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, ch, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true);
    v.setUint16(34, 16, true); ws(36, 'data'); v.setUint32(40, n * ch * 2, true);
    let o = 44;
    const chans = []; for (let c = 0; c < ch; c++) chans.push(buffer.getChannelData(c));
    for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true); o += 2;
    }
    return new Blob([ab], { type: 'audio/wav' });
  }

  function onePoleLP(x, cutoff, sr) {
    const a = 1 - Math.exp(-2 * Math.PI * cutoff / sr);
    const y = new Float32Array(x.length); let acc = 0;
    for (let i = 0; i < x.length; i++) { acc += a * (x[i] - acc); y[i] = acc; }
    return y;
  }
  const rms = x => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / x.length); };
  const peakOf = x => { let p = 0; for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > p) p = a; } return p; };

  function analyzeBuffer(buffer) {
    const sr = buffer.sampleRate, ch = buffer.numberOfChannels;
    const L = buffer.getChannelData(0), R = ch > 1 ? buffer.getChannelData(1) : L;
    const lpLow = onePoleLP(L, 250, sr), lpMid = onePoleLP(L, 2000, sr);
    const n = L.length;
    let eL = 0, eM = 0, eH = 0;
    for (let i = 0; i < n; i++) {
      const lo = lpLow[i], hi = L[i] - lpMid[i], mi = lpMid[i] - lpLow[i];
      eL += lo * lo; eM += mi * mi; eH += hi * hi;
    }
    const tailN = Math.min(Math.floor(sr * 0.05), n);
    let tailE = 0;
    for (let i = n - tailN; i < n; i++) tailE += L[i] * L[i] + R[i] * R[i];
    return {
      duration: n / sr, channels: ch, sampleRate: sr,
      peakL: peakOf(L), peakR: peakOf(R), rmsL: rms(L), rmsR: rms(R),
      bandLow: Math.sqrt(eL / n), bandMid: Math.sqrt(eM / n), bandHigh: Math.sqrt(eH / n),
      tailRms: Math.sqrt(tailE / (tailN * 2)),
    };
  }

  /* 起点检测:包络过阈上升沿,用于节拍漂移测量 */
  function detectOnsets(buffer, minGap = 0.1, threshRatio = 0.3) {
    const sr = buffer.sampleRate, L = buffer.getChannelData(0);
    const win = Math.floor(sr * 0.01), hops = Math.floor(L.length / win);
    const env = new Float32Array(hops);
    for (let h = 0; h < hops; h++) {
      let s = 0; const base = h * win;
      for (let i = 0; i < win; i++) s += Math.abs(L[base + i]);
      env[h] = s / win;
    }
    let mx = 0; for (const v of env) if (v > mx) mx = v;
    const th = mx * threshRatio, onsets = [];
    let last = -1;
    for (let h = 1; h < hops; h++) {
      const t = h * win / sr;
      if (env[h] > th && env[h - 1] <= th && t - last > minGap) { onsets.push(t); last = t; }
    }
    return onsets;
  }

  function beatDrift(onsets, expectedInterval) {
    if (onsets.length < 3) return { drift: null, meanInterval: null };
    const iv = [];
    for (let i = 1; i < onsets.length; i++) iv.push(onsets[i] - onsets[i - 1]);
    const mean = iv.reduce((a, b) => a + b, 0) / iv.length;
    let drift = 0;
    for (const d of iv) drift = Math.max(drift, Math.abs(d - expectedInterval));
    return { drift, meanInterval: mean };
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  return { renderOffline, encodeWAV, analyzeBuffer, detectOnsets, beatDrift, download };
})();
