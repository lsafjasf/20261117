/* 四种声音全部由 Web Audio 实时合成,不使用任何采样文件。
 * 每个 build* 函数返回 { nodes:[...], sources:[...] } 供引擎统一计数与关闭。 */
const Synths = (() => {
  const noiseCache = new WeakMap();
  let _seed = 1;
  function rand() { // LCG,保证相同种子下渲染结果完全一致
    _seed = (_seed * 1664525 + 1013904223) >>> 0;
    return _seed / 4294967296;
  }
  function resetRandom(seed) { _seed = seed >>> 0 || 1; }

  function noiseBuffer(ctx) {
    if (!noiseCache.has(ctx)) {
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = rand() * 2 - 1;
      }
      noiseCache.set(ctx, buf);
    }
    return noiseCache.get(ctx);
  }

  function reg(out, ...nodes) { out.nodes.push(...nodes); return out; }
  function src(out, s) { out.sources.push(s); out.nodes.push(s); return s; }

  /* 组合包络:基础增益 × 淡入淡出 × 音量点,用 setValueCurveAtTime 采样 */
  function applyEnvelope(param, clip, t0) {
    const start = clip.start, dur = clip.duration, end = start + dur;
    const rate = 200, n = Math.max(2, Math.ceil(dur * rate));
    const curve = new Float32Array(n);
    const pts = (clip.volumePoints || []).slice().sort((a, b) => a.t - b.t);
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * dur;
      let v = clip.gain;
      if (clip.fadeIn > 0 && t < clip.fadeIn) v *= t / clip.fadeIn;
      if (clip.fadeOut > 0 && dur - t < clip.fadeOut) v *= Math.max(0, (dur - t) / clip.fadeOut);
      if (pts.length) {
        let p0 = { t: 0, v: 1 }, p1 = { t: dur, v: 1 };
        for (const p of pts) { if (p.t <= t) p0 = p; if (p.t >= t) { p1 = p; break; } }
        const span = p1.t - p0.t;
        v *= span > 0 ? p0.v + (p1.v - p0.v) * (t - p0.t) / span : p1.v;
      }
      curve[i] = Math.max(0, v);
    }
    param.setValueCurveAtTime(curve, t0 + start, dur);
    return end;
  }

  function panner(ctx, pan) {
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    return p;
  }

  /* 脚步:按节拍触发的带通噪声短促脉冲,左右交替 */
  function buildFootsteps(ctx, clip, dest, t0) {
    const out = { nodes: [], sources: [] };
    const bus = ctx.createGain(); reg(out, bus);
    applyEnvelope(bus.gain, clip, t0);
    const bp0 = panner(ctx, clip.pan); reg(out, bp0);
    bus.connect(bp0).connect(dest);
    const interval = 1 / (clip.params.tempo || 2);
    const noise = noiseBuffer(ctx);
    let step = 0;
    for (let t = clip.start; t < clip.start + clip.duration - 0.01; t += interval, step++) {
      const s = ctx.createBufferSource(); s.buffer = noise;
      s.playbackRate.value = 0.8 + rand() * 0.4;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = 250 + rand() * 500; bp.Q.value = 1.2;
      const g = ctx.createGain();
      const at = t0 + t;
      g.gain.setValueAtTime(0.9, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.09);
      const pn = panner(ctx, (step % 2 ? 0.35 : -0.35));
      s.connect(bp).connect(g).connect(pn).connect(bus);
      reg(out, bp, g, pn); src(out, s);
      s.start(at, rand() * 1.5, 0.12);
    }
    return out;
  }

  /* 雨:双路去相关噪声,带通+高通,缓慢随机起伏 */
  function buildRain(ctx, clip, dest, t0) {
    const out = { nodes: [], sources: [] };
    const bus = ctx.createGain(); reg(out, bus);
    applyEnvelope(bus.gain, clip, t0);
    const bp0 = panner(ctx, clip.pan); reg(out, bp0);
    bus.connect(bp0).connect(dest);
    const noise = noiseBuffer(ctx);
    [-0.6, 0.6].forEach((side, idx) => {
      const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true;
      s.playbackRate.value = idx ? 1.07 : 0.93;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = (clip.params.bright || 1) * 1400; bp.Q.value = 0.5;
      const g = ctx.createGain(); g.gain.value = 0.5;
      const pn = panner(ctx, side);
      s.connect(hp).connect(bp).connect(g).connect(pn).connect(bus);
      reg(out, hp, bp, g, pn); src(out, s);
      s.start(t0 + clip.start, idx * 0.7);
      s.stop(t0 + clip.start + clip.duration + 0.05);
    });
    return out;
  }

  /* 风:低通噪声 + 截止频率/增益慢速 LFO,双声道不同相位 */
  function buildWind(ctx, clip, dest, t0) {
    const out = { nodes: [], sources: [] };
    const bus = ctx.createGain(); reg(out, bus);
    applyEnvelope(bus.gain, clip, t0);
    const bp0 = panner(ctx, clip.pan); reg(out, bp0);
    bus.connect(bp0).connect(dest);
    const noise = noiseBuffer(ctx);
    [-0.5, 0.5].forEach((side, idx) => {
      const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.value = 500; lp.Q.value = 0.8;
      const lfo = ctx.createOscillator(); lfo.frequency.value = (clip.params.rate || 0.15) * (idx ? 1.3 : 1);
      const lfoG = ctx.createGain(); lfoG.gain.value = 300 * (clip.params.depth || 1);
      lfo.connect(lfoG).connect(lp.frequency);
      const g = ctx.createGain(); g.gain.value = 0.6;
      const pn = panner(ctx, side);
      s.connect(lp).connect(g).connect(pn).connect(bus);
      reg(out, lp, lfo, lfoG, g, pn); src(out, s); out.sources.push(lfo);
      const at = t0 + clip.start;
      s.start(at, idx * 1.1); lfo.start(at);
      s.stop(at + clip.duration + 0.05); lfo.stop(at + clip.duration + 0.05);
    });
    return out;
  }

  /* 机械:按 16 分音符节拍的金属敲击 + 高频方波咔哒声 */
  function buildMechanical(ctx, clip, dest, t0) {
    const out = { nodes: [], sources: [] };
    const bus = ctx.createGain(); reg(out, bus);
    applyEnvelope(bus.gain, clip, t0);
    const bp0 = panner(ctx, clip.pan); reg(out, bp0);
    bus.connect(bp0).connect(dest);
    const bpm = clip.params.bpm || 120;
    const step16 = 60 / bpm / 4;
    const noise = noiseBuffer(ctx);
    let k = 0;
    for (let t = clip.start; t < clip.start + clip.duration - 0.01; t += step16, k++) {
      const accent = k % 8 === 0, hit = k % 4 === 0;
      const at = t0 + t;
      if (hit) {
        const s = ctx.createBufferSource(); s.buffer = noise;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
        bp.frequency.value = accent ? 2400 : 3600; bp.Q.value = 8;
        const g = ctx.createGain();
        g.gain.setValueAtTime(accent ? 0.8 : 0.4, at);
        g.gain.exponentialRampToValueAtTime(0.001, at + (accent ? 0.18 : 0.07));
        const pn = panner(ctx, (k % 8 < 4 ? -0.25 : 0.25));
        s.connect(bp).connect(g).connect(pn).connect(bus);
        reg(out, bp, g, pn); src(out, s);
        s.start(at, rand(), 0.2);
      }
      const o = ctx.createOscillator(); o.type = 'square';
      o.frequency.value = k % 2 ? 3200 : 2100;
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.12, at);
      og.gain.exponentialRampToValueAtTime(0.001, at + 0.03);
      o.connect(og).connect(bus);
      reg(out, o, og); out.sources.push(o);
      o.start(at); o.stop(at + 0.04);
    }
    return out;
  }

  return {
    resetRandom,
    footsteps: buildFootsteps,
    rain: buildRain,
    wind: buildWind,
    mechanical: buildMechanical,
  };
})();
