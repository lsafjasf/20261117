// Web Audio 实时引擎：会话级图构建、节点注册表、精确调度、空间化与混响。
import { computeSpatial, STEP_COUNT } from './acoustics.js';

const SCHEDULE_LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_S = 0.12;
const NOTE_GATE_S = 0.18;

// 确定性 PRNG：离线渲染使用固定种子，保证同参数重复导出逐样本一致。
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class AudioEngine {
  constructor(state) {
    this.state = state;
    this.ctx = null;
    this.nodes = new Set();
    this.session = null;
    this.timerId = null;
    this.stepIndex = 0;
    this.nextNoteTime = 0;
    this.playing = false;
    this.meterCallback = null;
    this.rafId = 0;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
  }

  get activeNodeCount() { return this.nodes.size; }
  get currentStep() { return this.stepIndex; }

  async resumeContext() {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  track(node) {
    this.nodes.add(node);
    return node;
  }

  // ---- 播放会话：每次播放/重播/重建都从零构建图，停止即整体拆除 ----
  async play() {
    await this.resumeContext();
    if (this.playing) return;
    this.buildSessionGraph();
    this.playing = true;
    this.nextNoteTime = this.ctx.currentTime + 0.06;
    this.startScheduler();
    this.startMeterLoop();
  }

  pause() {
    if (!this.playing) return;
    this.stopScheduler();
    this.teardownSession();
    this.playing = false;
  }

  replay() {
    this.pause();
    this.stepIndex = 0;
    this.play();
  }

  // 单步：只触发当前步进一次，然后推进指针，不启动连续调度。
  async singleStep() {
    await this.resumeContext();
    if (this.playing) return;
    if (!this.session) this.buildSessionGraph();
    const when = this.ctx.currentTime + 0.02;
    this.triggerStep(this.stepIndex, when);
    this.stepIndex = (this.stepIndex + 1) % STEP_COUNT;
    this.startMeterLoop();
  }

  // 运行中切换模式：重建图但保留 stepIndex（声源位置由 state 保留，绝不重置）。
  rebuildIfPlaying() {
    if (!this.playing) return;
    this.stopScheduler();
    this.teardownSession();
    this.buildSessionGraph();
    this.nextNoteTime = this.ctx.currentTime + 0.05;
    this.startScheduler();
    this.startMeterLoop();
  }

  setAudition(audition) {
    this.state.audition = audition;
    if (this.session) this.applyAuditionGains();
  }

  applyAuditionGains() {
    const { mainGain, bypassGain } = this.session;
    const map = { main: [1, 0], bypass: [0, 1], mute: [0, 0] };
    const [m, b] = map[this.state.audition] ?? map.main;
    mainGain.gain.setTargetAtTime(m, this.ctx.currentTime, 0.015);
    bypassGain.gain.setTargetAtTime(b, this.ctx.currentTime, 0.015);
  }

  stopScheduler() {
    if (this.timerId !== null) { clearInterval(this.timerId); this.timerId = null; }
  }

  startScheduler() {
    this.stopScheduler();
    this.timerId = setInterval(() => this.schedulerTick(), SCHEDULE_LOOKAHEAD_MS);
  }

  // 绝对时间调度：nextNoteTime 只按步进时长推进，不存在累加漂移。
  schedulerTick() {
    if (!this.playing || !this.session) return;
    while (this.nextNoteTime < this.ctx.currentTime + SCHEDULE_AHEAD_S) {
      this.triggerStep(this.stepIndex, this.nextNoteTime);
      const stepSeconds = 60 / this.state.bpm / 2; // 八分音符
      this.nextNoteTime += stepSeconds;
      this.stepIndex = (this.stepIndex + 1) % STEP_COUNT;
    }
  }

  // 同一套图结构同时服务实时 AudioContext 与离线 OfflineAudioContext。
  buildSessionGraph(targetCtx = this.ctx, offline = false) {
    const ctx = targetCtx;
    this.activeRand = offline ? mulberry32(0x51a7) : Math.random;
    const isSurround = this.state.mode === 'surround';
    const outChannels = isSurround ? 4 : 2;
    const session = { ctx, offline, outChannels, voices: [] };

    session.mainGain = ctx.createGain();
    session.bypassGain = ctx.createGain();
    session.bypassGain.gain.value = 0;
    session.masterGain = ctx.createGain();
    session.masterGain.gain.value = 0.9;

    const merger = ctx.createChannelMerger(outChannels);
    const splitter = ctx.createChannelSplitter(outChannels);
    session.analysers = [];
    for (let c = 0; c < outChannels; c++) {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.5;
      session.analysers.push(analyser);
      splitter.connect(analyser, c, 0);
      if (!offline) this.track(analyser);
    }

    // 混响总线：由主路径各声源 send 汇入，返回至 merger 各声道。
    session.reverbInput = ctx.createGain();
    session.reverbInput.gain.value = this.state.reverbMix;
    const convolver = ctx.createConvolver();
    convolver.buffer = this.makeImpulseResponse(ctx, this.state.reverbDecay, this.activeRand);
    const reverbWet = ctx.createGain();
    reverbWet.gain.value = 1;
    session.reverbInput.connect(convolver);
    convolver.connect(reverbWet);
    if (isSurround) {
      for (let c = 0; c < 4; c++) reverbWet.connect(merger, 0, c);
    } else {
      reverbWet.connect(merger, 0, 0);
      reverbWet.connect(merger, 0, 1);
    }

    // 旁路（干声、无空间化/无混响）直接进主 merger。
    if (isSurround) {
      for (let c = 0; c < 4; c++) session.bypassGain.connect(merger, 0, c);
    } else {
      session.bypassGain.connect(merger, 0, 0);
      session.bypassGain.connect(merger, 0, 1);
    }

    merger.connect(splitter);
    merger.connect(session.masterGain);
    session.masterGain.connect(ctx.destination);

    [session.mainGain, session.bypassGain, session.masterGain, merger,
      session.reverbInput, convolver, reverbWet, splitter].forEach((n) => {
      if (!offline) this.track(n);
    });
    session.merger = merger;
    if (!offline) {
      this.session = session;
      this.applyAuditionGains();
    }
    return session;
  }

  // 指数衰减立体声/多声道脉冲响应，模拟墙面反射混响。
  makeImpulseResponse(ctx, decaySeconds, rand = Math.random) {
    const rate = ctx.sampleRate;
    const length = Math.max(1, Math.floor(rate * decaySeconds));
    const impulse = ctx.createBuffer(2, length, rate);
    for (let c = 0; c < 2; c++) {
      const data = impulse.getChannelData(c);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        data[i] = (rand() * 2 - 1) * Math.pow(1 - t, 2.6);
      }
    }
    return impulse;
  }

  triggerStep(step, when) {
    this.state.sources.forEach((source) => {
      if (!source.pattern[step]) return;
      this.triggerNote(source, when);
    });
  }

  createSourceNode(ctx, source, when, offline, rand = Math.random) {
    let node;
    let stopAt = when + NOTE_GATE_S + 0.05;
    if (source.type === 'noise') {
      const len = Math.floor(ctx.sampleRate * NOTE_GATE_S);
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = rand() * 2 - 1;
      node = ctx.createBufferSource();
      node.buffer = buffer;
      // 简单带通，让噪声声源具有可辨识频段。
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = source.freq;
      filter.Q.value = 1.2;
      node.connect(filter);
      node.__postFilter = filter;
      if (!offline) this.track(filter);
    } else {
      node = ctx.createOscillator();
      node.type = source.type;
      node.frequency.value = source.freq;
      node.__postFilter = node;
    }
    node.start(when);
    node.stop(stopAt);
    if (!offline) this.track(node);
    return node;
  }

  // 每个音符自带包络，停止后自然截断，避免尾音残留。
  triggerNote(source, when, targetSession = this.session) {
    const session = targetSession;
    const activeCtx = session.ctx;
    const { merger, mainGain, bypassGain, reverbInput } = session;
    const src = this.createSourceNode(activeCtx, source, when, session.offline, this.activeRand);
    const env = activeCtx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(0.9, when + 0.012);
    env.gain.exponentialRampToValueAtTime(0.001, when + NOTE_GATE_S);
    src.__postFilter.connect(env);
    if (!session.offline) this.track(env);

    // 旁路：完全干声，等分到输出声道。
    const bypassTap = activeCtx.createGain();
    bypassTap.gain.value = 0.5;
    env.connect(bypassTap);
    bypassTap.connect(bypassGain);
    if (!session.offline) this.track(bypassTap);

    // 混响发送。
    const send = activeCtx.createGain();
    send.gain.value = 0.6;
    env.connect(send);
    send.connect(reverbInput);
    if (!session.offline) this.track(send);

    const spatial = computeSpatial(this.state.mode, source, this.state.listener);
    const dist = activeCtx.createGain();
    dist.gain.value = spatial.gain * 0.55;
    env.connect(dist);

    // 传播延迟：距离越大延迟越长。
    const delay = activeCtx.createDelay(1);
    delay.delayTime.value = spatial.delayMs / 1000;
    dist.connect(delay);
    if (!session.offline) this.track(dist);

    this.routeSpatial(session, spatial, delay, merger, mainGain);
    src.onended = () => {
      if (!session.offline) {
        [env, bypassTap, send, dist, delay].forEach((n) => this.safeUntrack(n));
      }
    };
  }

  routeSpatial(session, spatial, input, merger, mainGain) {
    const ctx = session.ctx;
    const mode = spatial.mode;
    const tap = (node) => { if (!session.offline) this.track(node); return node; };

    if (mode === 'stereo') {
      const panner = tap(ctx.createStereoPanner());
      panner.pan.value = spatial.pan;
      input.connect(panner);
      panner.connect(mainGain);
      return;
    }

    if (mode === 'binaural') {
      // ITD：左右耳独立延迟线；ILD 已在增益系数中体现。
      const split = tap(ctx.createGain());
      input.connect(split);
      const leftDelay = tap(ctx.createDelay(0.01));
      const rightDelay = tap(ctx.createDelay(0.01));
      leftDelay.delayTime.value = spatial.delayLeftMs / 1000;
      rightDelay.delayTime.value = spatial.delayRightMs / 1000;
      const leftGain = tap(ctx.createGain());
      const rightGain = tap(ctx.createGain());
      leftGain.gain.value = spatial.left;
      rightGain.gain.value = spatial.right;
      split.connect(leftDelay); split.connect(rightDelay);
      leftDelay.connect(leftGain); rightDelay.connect(rightGain);
      leftGain.connect(merger, 0, 0);
      rightGain.connect(merger, 0, 1);
      return;
    }

    // surround：四扬声器等功率分配。
    const map = [spatial.fl, spatial.fr, spatial.bl, spatial.br];
    map.forEach((g, c) => {
      const gNode = tap(ctx.createGain());
      gNode.gain.value = g;
      input.connect(gNode);
      gNode.connect(merger, 0, c);
    });
  }

  safeUntrack(node) {
    if (node && this.nodes.has(node)) this.nodes.delete(node);
  }

  // 拆除整个会话图：先静音再停止所有源，最后逐一断开，杜绝未关闭节点与尾音。
  teardownSession() {
    const session = this.session;
    if (!session) return;
    try {
      session.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
      session.masterGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.004);
    } catch { /* 节点可能已失效 */ }

    const all = [...this.nodes];
    all.forEach((node) => {
      try {
        if (typeof node.stop === 'function' && node !== this.ctx.destination) node.stop();
      } catch { /* 已停止的源忽略 */ }
      try { node.disconnect(); } catch { /* 已断开忽略 */ }
    });
    this.nodes.clear();
    this.session = null;
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  destroy() {
    this.pause();
    this.ctx.close().catch(() => {});
  }

  startMeterLoop() {
    if (this.rafId) return;
    const loop = () => {
      this.rafId = requestAnimationFrame(loop);
      if (!this.session || !this.meterCallback) return;
      const readings = this.session.analysers.map((analyser) => {
        const time = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(time);
        let sumSq = 0;
        for (let i = 0; i < time.length; i++) sumSq += time[i] * time[i];
        const rms = Math.sqrt(sumSq / time.length);
        const freq = new Float32Array(analyser.frequencyBinCount);
        analyser.getFloatFrequencyData(freq);
        const sr = this.ctx.sampleRate;
        const binHz = sr / 2 / freq.length;
        const band = (lo, hi) => {
          const start = Math.max(1, Math.floor(lo / binHz));
          const end = Math.min(freq.length - 1, Math.ceil(hi / binHz));
          let sum = 0;
          for (let i = start; i <= end; i++) sum += freq[i];
          const db = sum / Math.max(1, end - start + 1);
          return Math.max(0, Math.min(1, (db + 90) / 90));
        };
        return {
          rms,
          bands: { low: band(20, 250), mid: band(250, 2000), high: band(2000, 12000) },
        };
      });
      this.meterCallback(readings);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  // 离线渲染导出：图结构与实时完全一致，时长固定，渲染结束即销毁全部节点。
  async renderOffline(bars = 2) {
    const stepSeconds = 60 / this.state.bpm / 2;
    const tailSeconds = this.state.reverbDecay + 0.25;
    const duration = bars * STEP_COUNT * stepSeconds + tailSeconds;
    const outChannels = this.state.mode === 'surround' ? 4 : 2;
    const offline = new OfflineAudioContext(outChannels,
      Math.ceil(48000 * duration), 48000);

    const previousSession = this.session;
    const offlineSession = this.buildSessionGraph(offline, true);
    this.session = offlineSession;
    const totalSteps = bars * STEP_COUNT;
    let when = 0.05;
    for (let i = 0; i < totalSteps; i++) {
      this.triggerStep(i % STEP_COUNT, when);
      when += stepSeconds;
    }
    const rendered = await offline.startRendering();
    this.session = previousSession;
    return rendered;
  }
}
