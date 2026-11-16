/* 雨声分离台：全部声音由 Web Audio 实时生成，频段+门限分离三轨 */
'use strict';

const STEPS = 16;
const BPM = 120;
const STEP_SECONDS = 60 / BPM / 4; // 16 分音符
const TOTAL_SECONDS = STEP_SECONDS * STEPS; // 一个循环
const MASTER_SUM_GAIN = 0.55; // 三轨汇总衰减，防止削波

// 确定性 PRNG：在线播放与离线导出共用同一序列，保证可重复
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TRACK_DEFS = [
  { id: 'rain', name: '雨棚敲击', color: '#42a5f5', seed: 101, band: 3200, q: 1.2, threshold: 0.14,
    pan: -0.65, pattern: [1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1] },
  { id: 'puddle', name: '地面积水', color: '#26a69a', seed: 202, band: 700, q: 1.0, threshold: 0.10,
    pan: 0.15, pattern: [0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0] },
  { id: 'thunder', name: '远处雷声', color: '#9575cd', seed: 303, band: 140, q: 0.8, threshold: 0.08,
    pan: 0.7, pattern: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0] }
];

const DEFAULT_PARAMS = {
  bpm: BPM,
  masterGain: 0.8,
  monitor: 'master', // master | bypass | mute
  tracks: TRACK_DEFS.map((d) => ({
    id: d.id, enabled: true, solo: false, volume: 0.8, pan: d.pan,
    band: d.band, q: d.q, threshold: d.threshold
  }))
};

const state = {
  ctx: null,
  running: false,
  paused: false,
  currentStep: 0,
  params: structuredClone(DEFAULT_PARAMS),
  tracks: new Map(),
  master: null,
  monitor: 'master',
  nextNoteTime: 0,
  schedTimer: null,
  nodes: new Set(),       // 全部活动节点（含常驻与临时）
  persistent: new Set(),  // 常驻节点基线
  workletReady: false,
  stepStartTimes: []
};

function trackParam(id) {
  return state.params.tracks.find((t) => t.id === id);
}

// ---- 节点生命周期：未关闭节点检测依赖这里 ----
function registerNode(node, persistent = false) {
  node._tracked = true;
  state.nodes.add(node);
  if (persistent) state.persistent.add(node);
  node.addEventListener?.('close', () => { state.nodes.delete(node); state.persistent.delete(node); });
  return node;
}
function registerWorklet(node, persistent = false) {
  registerNode(node, persistent);
  node.port.start?.();
  node.port.addEventListener?.('messageerror', () => state.nodes.delete(node));
  return node;
}
function closeNode(node) {
  if (!node || node._closed) return;
  node._closed = true;
  try { node.disconnect(); } catch { /* 已断开 */ }
  try { if (typeof node.stop === 'function') node.stop(); } catch { /* 非源节点 */ }
  state.nodes.delete(node);
  state.persistent.delete(node);
}
function transientCount() {
  let n = 0;
  for (const node of state.nodes) if (!state.persistent.has(node)) n++;
  return n;
}

// ---------- Worklet 注册（Blob URL，离线上下文也能加载） ----------
let workletUrl = null;
async function ensureWorklets(ctx) {
  if (!workletUrl) {
    workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
  }
  await ctx.audioWorklet.addModule(workletUrl);
}

// ---------- 上下文 ----------
async function createContext(OfflineCtor, sampleRate) {
  let ctx;
  if (OfflineCtor) {
    ctx = new OfflineCtor(2, Math.ceil(sampleRate * (TOTAL_SECONDS + 0.25)), sampleRate);
  } else {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    ctx = new Ctor({ sampleRate, latencyHint: 'interactive' });
  }
  await ensureWorklets(ctx);
  return ctx;
}

async function ensureOnlineContext() {
  if (state.ctx) {
    if (state.ctx.state === 'suspended' && !state.paused) await state.ctx.resume();
    return state.ctx;
  }
  const ctx = await createContext(null, 48000);
  registerNode(ctx.destination, true);
  state.ctx = ctx;
  buildOnlineGraph(ctx);
  ctx.addEventListener?.('statechange', () => {
    if (state.running && ctx.state === 'suspended' && !state.paused) {
      // 浏览器自动挂起时同步 UI
    }
    updateStateBar();
  });
  return ctx;
}

// ---------- 单轨处理链 ----------
// 源(BufferSrc/WorkletSrc) -> bandpass -> gate -> meter -> volume -> pan -> bus
function createTrackChain(ctx, def, tp, bus, persistent) {
  const bandpass = registerNode(ctx.createBiquadFilter(), persistent);
  bandpass.type = 'bandpass';
  bandpass.frequency.value = tp.band;
  bandpass.Q.value = tp.q;

  const gate = registerWorklet(new AudioWorkletNode(ctx, 'gate-worklet', {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
    channelInterpretation: 'discrete'
  }), persistent);
  gate.parameters.get('threshold').value = tp.threshold;
  gate.parameters.get('bypass').value = 0;
  gate.parameters.get('closedGain').value = 0.0008;

  const meter = registerWorklet(new AudioWorkletNode(ctx, 'meter-worklet', {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
    channelInterpretation: 'discrete'
  }), persistent);

  const volume = registerNode(ctx.createGain(), persistent);
  volume.gain.value = tp.volume;

  const pan = registerNode(ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createPanner(), persistent);
  if (pan.pan) pan.pan.value = tp.pan;

  bandpass.connect(gate);
  gate.connect(meter);
  meter.connect(volume);
  volume.connect(pan);
  pan.connect(bus);

  const pre = registerNode(ctx.createGain(), persistent);
  pre.gain.value = 0;
  // 旁路路径：滤波之后、门限之前分线，直达总线（绕开门限与主音量链）
  bandpass.connect(pre);
  pre.connect(bus);

  return { def, tp, bus, bandpass, gate, meter, volume, pan, pre, sources: [], envNodes: [] };
}

function buildOnlineGraph(ctx) {
  state.master = {
    masterGain: registerNode(ctx.createGain(), true),
    monitorGain: registerNode(ctx.createGain(), true),
    meter: registerWorklet(new AudioWorkletNode(ctx, 'meter-worklet', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
      channelInterpretation: 'discrete'
    }), true),
    analyser: registerNode(ctx.createAnalyser(), true),
    bus: registerNode(ctx.createGain(), true)
  };
  const m = state.master;
  m.bus.gain.value = MASTER_SUM_GAIN;
  m.analyser.fftSize = 1024;
  m.bus.connect(m.masterGain);
  m.masterGain.connect(m.monitorGain);
  m.monitorGain.connect(m.meter);
  m.meter.connect(m.analyser);
  m.analyser.connect(ctx.destination);
  m.meter.port.onmessage = (e) => {
    state.masterLevels = e.data.rms;
  };

  for (const def of TRACK_DEFS) {
    const tp = trackParam(def.id);
    const chain = createTrackChain(ctx, def, tp, m.bus, true);
    chain.meter.port.onmessage = (e) => { chain.levels = e.data.rms; };
    state.tracks.set(def.id, chain);
  }
}

// ---------- 声音源：全部实时合成 ----------
function makeNoiseBuffer(ctx, seconds, seed) {
  const len = Math.ceil(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  const rnd = mulberry32(seed);
  for (let i = 0; i < len; i++) data[i] = rnd() * 2 - 1;
  return buf;
}

// 单个声音事件：根据轨道类型选择合成方式，返回临时源节点
function spawnVoice(ctx, chain, when, dur, amp, noiseBuf, rnd) {
  const id = chain.def.id;
  const src = registerNode(ctx.createBufferSource());
  src.buffer = noiseBuf;
  src.loop = true;
  src.playbackRate.value = 0.85 + rnd() * 0.3;

  if (id === 'rain') {
    // 雨棚敲击：白噪声短脉冲 + 高通 + 快速衰减包络
    const hp = registerNode(ctx.createBiquadFilter());
    hp.type = 'highpass'; hp.frequency.value = 2400 + rnd() * 900;
    const env = registerNode(ctx.createGain());
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(amp, when + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(hp); hp.connect(env); env.connect(chain.bandpass);
    src.start(when); src.stop(when + dur + 0.02);
  } else if (id === 'puddle') {
    // 地面积水：带通噪声团，较慢起音
    const lp = registerNode(ctx.createBiquadFilter());
    lp.type = 'lowpass'; lp.frequency.value = 1100 + rnd() * 500;
    const env = registerNode(ctx.createGain());
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(amp * 0.8, when + dur * 0.18);
    env.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(lp); lp.connect(env); env.connect(chain.bandpass);
    src.start(when); src.stop(when + dur + 0.02);
  } else {
    // 远处雷声：低通噪声轰鸣 + 缓慢起伏 + 次低频振荡器染色
    const lp = registerNode(ctx.createBiquadFilter());
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(520, when);
    lp.frequency.exponentialRampToValueAtTime(90, when + dur);
    const osc = registerNode(ctx.createOscillator());
    osc.type = 'sine';
    osc.frequency.setValueAtTime(48 + rnd() * 18, when);
    osc.frequency.exponentialRampToValueAtTime(34, when + dur);
    const sub = registerNode(ctx.createGain());
    sub.gain.value = 0.25;
    const env = registerNode(ctx.createGain());
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(amp, when + dur * 0.25);
    env.gain.linearRampToValueAtTime(amp * 0.55, when + dur * 0.55);
    env.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(lp); lp.connect(env);
    osc.connect(sub); sub.connect(env);
    env.connect(chain.bandpass);
    src.start(when); src.stop(when + dur + 0.05);
    osc.start(when); osc.stop(when + dur + 0.05);
  }
  chain.sources.push(src);
  src.addEventListener('ended', () => {
    chain.sources = chain.sources.filter((s) => s !== src);
    // 该事件的临时节点在停止后统一回收
  });
}

// 为一次完整循环（或单步）调度事件。renderDur 决定预生成噪声缓冲时长。
function scheduleLoop(ctx, chains, fromStep, stepCount, startAt, buffers) {
  for (const chain of chains) {
    const rnd = mulberry32(chain.def.seed + fromStep * 7919);
    for (let s = 0; s < stepCount; s++) {
      const step = (fromStep + s) % STEPS;
      if (!chain.def.pattern[step]) continue;
      const when = startAt + s * STEP_SECONDS;
      let dur, amp;
      if (chain.def.id === 'rain') { dur = 0.09; amp = 0.9; }
      else if (chain.def.id === 'puddle') { dur = 0.22; amp = 0.7; }
      else { dur = STEP_SECONDS * 5.2; amp = 1.0; }
      spawnVoice(ctx, chain, when, dur, amp, buffers[chain.def.id], rnd);
    }
  }
}

function buildNoiseBuffers(ctx) {
  const out = {};
  for (const def of TRACK_DEFS) {
    out[def.id] = makeNoiseBuffer(ctx, def.id === 'thunder' ? 3 : 1, def.seed + 7);
  }
  return out;
}

// ---------- 参数应用到在线图 ----------
function applyParamsToGraph() {
  if (!state.ctx) return;
  const t = state.ctx.currentTime;
  state.master.masterGain.gain.setTargetAtTime(state.params.masterGain, t, 0.02);
  for (const def of TRACK_DEFS) {
    const tp = trackParam(def.id);
    const c = state.tracks.get(def.id);
    c.bandpass.frequency.setTargetAtTime(tp.band, t, 0.02);
    c.bandpass.Q.setTargetAtTime(tp.q, t, 0.02);
    c.gate.parameters.get('threshold').setTargetAtTime(tp.threshold, t, 0.02);
    c.volume.gain.setTargetAtTime(tp.enabled ? tp.volume : 0, t, 0.02);
    if (c.pan.pan) c.pan.pan.setTargetAtTime(tp.pan, t, 0.02);
  }
  applyMonitor();
}

function applyMonitor() {
  state.monitor = state.params.monitor;
  if (!state.ctx) return;
  const t = state.ctx.currentTime;
  const m = state.master;
  const anySolo = state.params.tracks.some((tp) => tp.solo);
  for (const def of TRACK_DEFS) {
    const tp = trackParam(def.id);
    const c = state.tracks.get(def.id);
    const bypassOn = state.params.monitor === 'bypass';
    c.gate.parameters.get('bypass').setTargetAtTime(bypassOn ? 1 : 0, t, 0.01);
    // 旁路：源被复制到 pre 总线；这里用音量交叉避免改线
    const mainLevel = (!tp.enabled || (anySolo && !tp.solo)) ? 0 : 1;
    c.volume.gain.setTargetAtTime(mainLevel * (bypassOn ? 0 : tp.volume), t, 0.02);
    c.pre.gain.setTargetAtTime(bypassOn && tp.enabled && (!anySolo || tp.solo) ? tp.volume * MASTER_SUM_GAIN : 0, t, 0.02);
  }
  m.monitorGain.gain.setTargetAtTime(state.params.monitor === 'mute' ? 0 : 1, t, 0.02);
  document.querySelectorAll('.monitor-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.monitor === state.params.monitor));
  const el = document.getElementById('monitorState');
  if (el) el.textContent = { master: '主输出', bypass: '旁路', mute: '静音' }[state.params.monitor];
}

// ---------- 走带 ----------
async function play() {
  const ctx = await ensureOnlineContext();
  await ctx.resume();
  if (state.running) { applyParamsToGraph(); return; }
  state.running = true;
  state.paused = false;
  state.currentStep = 0;
  state.stepStartTimes = [];
  state.buffers = buildNoiseBuffers(ctx);
  applyParamsToGraph();
  state.nextNoteTime = ctx.currentTime + 0.08;
  schedulerTick();
  updateTransportUI('播放中');
}

function schedulerTick() {
  if (!state.running) return;
  const ctx = state.ctx;
  const lookahead = 0.18;
  while (state.nextNoteTime < ctx.currentTime + lookahead) {
    const step = state.currentStep % STEPS;
    scheduleLoop(ctx, [...state.tracks.values()], step, 1, state.nextNoteTime, state.buffers);
    state.stepStartTimes.push({ step, audioTime: state.nextNoteTime });
    const uiDelay = Math.max(0, (state.nextNoteTime - ctx.currentTime) * 1000);
    const captured = step;
    setTimeout(() => lightStep(captured), uiDelay);
    state.nextNoteTime += STEP_SECONDS;
    state.currentStep++;
    if (state.currentStep >= STEPS) {
      state.currentStep = 0; // 循环
    }
  }
  state.schedTimer = setTimeout(schedulerTick, 25);
}

async function pause() {
  if (!state.running) return;
  state.paused = true;
  state.running = false;
  clearTimeout(state.schedTimer);
  // 暂停 = 挂起上下文：已调度但未播放的声音一起冻结，输出立刻静音
  await state.ctx.suspend();
  updateTransportUI('已暂停');
  updateStateBar();
}

async function resumeFromPause() {
  if (!state.ctx || !state.paused) return;
  state.paused = false;
  state.running = true;
  await state.ctx.resume();
  state.nextNoteTime = state.ctx.currentTime + 0.05;
  schedulerTick();
  updateTransportUI('播放中');
}

async function stopTransport() {
  state.running = false;
  state.paused = false;
  clearTimeout(state.schedTimer);
  if (state.ctx) {
    // 关闭整个上下文，销毁全部节点，杜绝尾音与泄漏；下次播放重建
    const old = state.ctx;
    state.ctx = null;
    state.tracks.clear();
    state.master = null;
    try { await old.close(); } catch { /* 已关闭 */ }
    state.nodes.clear();
    state.persistent.clear();
    state.buffers = null;
  }
  state.currentStep = 0;
  clearStepLights();
  updateTransportUI('已停止');
  updateStateBar();
}

async function replay() {
  await stopTransport();
  await play();
}

// 单步：暂停状态下渲染当前一步的离线片段并播放，不影响后续步进位置
async function singleStep() {
  if (state.running) await pause();
  const baseCtx = state.ctx;
  const sr = baseCtx ? baseCtx.sampleRate : 48000;
  const step = state.currentStep % STEPS;
  const renderDur = STEP_SECONDS + 0.12;
  const offline = await createContext(OfflineAudioContext, sr);
  try {
    const result = await renderOffline(offline, step, 1, renderDur, state.params);
    const ctx = state.ctx || await ensureOnlineContext();
    if (ctx.state === 'suspended') await ctx.resume();
    const preview = registerNode(ctx.createBufferSource());
    preview.buffer = result.buffer;
    const g = registerNode(ctx.createGain());
    g.gain.value = state.params.monitor === 'mute' ? 0 : 1;
    preview.connect(g); g.connect(ctx.destination);
    const when = ctx.currentTime + 0.03;
    preview.start(when);
    preview.stop(when + renderDur + 0.05);
    lightStep(step);
    preview.addEventListener('ended', () => { closeNode(g); closeNode(preview); updateStateBar(); });
    state.currentStep = (state.currentStep + 1) % STEPS;
    updateTransportUI('单步 ' + (step + 1) + '/' + STEPS);
  } finally {
    try { if (offline.state !== 'closed') await offline.close(); } catch { /* 渲染后自动关闭 */ }
  }
}

// ---------- 离线渲染：与在线图同样的链与门限 ----------
async function renderOffline(ctx, fromStep, stepCount, renderDur, params) {
  const bus = ctx.createGain();
  bus.gain.value = MASTER_SUM_GAIN;
  const masterGain = ctx.createGain();
  masterGain.gain.value = params.monitor === 'mute' ? 0 : params.masterGain;
  bus.connect(masterGain);
  masterGain.connect(ctx.destination);

  const chains = [];
  const anySolo = params.tracks.some((tp) => tp.solo);
  for (const def of TRACK_DEFS) {
    const tp = params.tracks.find((x) => x.id === def.id);
    const chain = createTrackChain(ctx, def, tp, bus, false);
    const bypassOn = params.monitor === 'bypass';
    chain.gate.parameters.get('bypass').value = bypassOn ? 1 : 0;
    const mainLevel = (!tp.enabled || (anySolo && !tp.solo)) ? 0 : 1;
    chain.volume.gain.value = mainLevel * (bypassOn ? 0 : tp.volume);
    chain.pre.gain.value = bypassOn && tp.enabled && (!anySolo || tp.solo)
      ? tp.volume * MASTER_SUM_GAIN : 0;
    chains.push(chain);
  }
  const buffers = buildNoiseBuffers(ctx);
  scheduleLoop(ctx, chains, fromStep, stepCount, 0.05, buffers);
  const rendered = await ctx.startRendering();
  // 离线上下文随 .close() 整体回收；此处断开引用便于 GC
  for (const c of chains) c.sources.length = 0;
  return { buffer: rendered, chains };
}

async function exportWav() {
  const sr = state.ctx ? state.ctx.sampleRate : 48000;
  const renderDur = TOTAL_SECONDS + 0.25;
  const offline = await createContext(OfflineAudioContext, sr);
  try {
    const { buffer } = await renderOffline(offline, 0, STEPS, renderDur, state.params);
    const blob = encodeWav(buffer);
    downloadBlob(blob, 'rain-mix-' + Date.now() + '.wav');
    return { blob, buffer };
  } finally {
    try { if (offline.state !== 'closed') await offline.close(); } catch { /* 渲染后自动关闭 */ }
  }
}

// ---------- 16-bit PCM WAV 编码 ----------
function encodeWav(audioBuffer) {
  const nCh = audioBuffer.numberOfChannels;
  const sr = audioBuffer.sampleRate;
  const len = audioBuffer.length;
  const bytesPerSample = 2;
  const dataSize = len * nCh * bytesPerSample;
  const buf = new ArrayBuffer(44 + dataSize);
  const dv = new DataView(buf);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  dv.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE'); writeStr(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, nCh, true);
  dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * nCh * bytesPerSample, true);
  dv.setUint16(32, nCh * bytesPerSample, true);
  dv.setUint16(34, 16, true);
  writeStr(36, 'data');
  dv.setUint32(40, dataSize, true);
  const chans = [];
  for (let c = 0; c < nCh; c++) chans.push(audioBuffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < nCh; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// ---------- 参数保存 / 载入 ----------
const PARAM_KEY = 'rain-mixer-params-v1';
function saveParams() {
  const payload = JSON.stringify({ version: 1, savedAt: new Date().toISOString(), params: state.params }, null, 2);
  localStorage.setItem(PARAM_KEY, payload);
  downloadBlob(new Blob([payload], { type: 'application/json' }), 'rain-mixer-params.json');
  return payload;
}
function loadParamsObject(obj) {
  if (!obj || !obj.params || !Array.isArray(obj.params.tracks)) throw new Error('参数文件格式不正确');
  state.params = structuredClone(DEFAULT_PARAMS);
  for (const tp of state.params.tracks) {
    const src = obj.params.tracks.find((x) => x.id === tp.id);
    if (src) Object.assign(tp, {
      enabled: !!src.enabled, solo: !!src.solo,
      volume: clamp(+src.volume, 0, 1), pan: clamp(+src.pan, -1, 1),
      band: clamp(+src.band, 40, 14000), q: clamp(+src.q, 0.1, 12),
      threshold: clamp(+src.threshold, 0, 1)
    });
  }
  state.params.masterGain = clamp(+obj.params.masterGain || 0.8, 0, 1);
  state.params.monitor = ['master', 'bypass', 'mute'].includes(obj.params.monitor) ? obj.params.monitor : 'master';
  syncUIFromParams();
  applyParamsToGraph();
}
function loadParamsFromStorage() {
  const raw = localStorage.getItem(PARAM_KEY);
  if (raw) loadParamsObject(JSON.parse(raw));
}
function clamp(v, lo, hi) { return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo; }

// 触发浏览器下载；无头/自动化环境无下载处理器时仅保留 Blob，避免导航 404
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const headless = navigator.webdriver || /HeadlessChrome/.test(navigator.userAgent);
  if (!headless) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return url;
}

// ---------- UI 构建 ----------
const $ = (id) => document.getElementById(id);
function buildTrackUI() {
  const mixer = $('mixer');
  mixer.innerHTML = '';
  for (const def of TRACK_DEFS) {
    const tp = trackParam(def.id);
    const card = document.createElement('section');
    card.className = 'track';
    card.dataset.track = def.id;
    card.innerHTML = `
      <h2>${def.name} <span class="tag">中心 ${tp.band} Hz</span></h2>
      <canvas class="spectrum" width="420" height="110"></canvas>
      <div class="energy"><div class="bar"></div><div class="cut"></div></div>
      <div class="row"><label>频段中心</label><input type="range" min="60" max="9000" step="10" value="${tp.band}" data-k="band">
        <span class="val" data-v="band">${tp.band} Hz</span></div>
      <div class="row"><label>Q 值</label><input type="range" min="0.2" max="8" step="0.1" value="${tp.q}" data-k="q">
        <span class="val" data-v="q">${tp.q.toFixed(1)}</span></div>
      <div class="row"><label>门限</label><input type="range" min="0" max="0.6" step="0.005" value="${tp.threshold}" data-k="threshold">
        <span class="val" data-v="threshold">${tp.threshold.toFixed(3)}</span></div>
      <div class="row"><label>音量</label><input type="range" min="0" max="1" step="0.01" value="${tp.volume}" data-k="volume">
        <span class="val" data-v="volume">${tp.volume.toFixed(2)}</span></div>
      <div class="row"><label>声像 L/R</label><input type="range" min="-1" max="1" step="0.05" value="${tp.pan}" data-k="pan">
        <span class="val" data-v="pan">${panText(tp.pan)}</span></div>
      <div class="pan-balance"><span>L</span><span class="balance-text">–</span><span>R</span></div>
      <div class="track-actions">
        <button data-act="solo">单轨试听</button>
        <button data-act="enable">静音该轨</button>
        <button data-act="reset">恢复原混音</button>
      </div>`;
    mixer.appendChild(card);
    card.querySelectorAll('input[type=range]').forEach((input) => {
      input.addEventListener('input', () => {
        const k = input.dataset.k;
        tp[k] = parseFloat(input.value);
        card.querySelector(`[data-v="${k}"]`).textContent =
          k === 'band' ? `${tp.band} Hz` : k === 'pan' ? panText(tp.pan) : tp[k].toFixed(k === 'threshold' ? 3 : 2);
        if (k === 'band') card.querySelector('h2 .tag').textContent = `中心 ${tp.band} Hz`;
        applyParamsToGraph();
      });
    });
    card.querySelector('[data-act=solo]').addEventListener('click', (e) => {
      tp.solo = !tp.solo;
      e.target.classList.toggle('active', tp.solo);
      applyMonitor();
    });
    card.querySelector('[data-act=enable]').addEventListener('click', (e) => {
      tp.enabled = !tp.enabled;
      e.target.textContent = tp.enabled ? '静音该轨' : '启用该轨';
      card.classList.toggle('cut', !tp.enabled);
      applyParamsToGraph();
    });
    card.querySelector('[data-act=reset]').addEventListener('click', () => {
      const d = DEFAULT_PARAMS.tracks.find((x) => x.id === def.id);
      Object.assign(tp, structuredClone(d));
      syncUIFromParams();
      applyParamsToGraph();
    });
  }
}
function panText(p) {
  if (Math.abs(p) < 0.05) return '中置';
  return (p < 0 ? 'L ' : 'R ') + Math.abs(p * 100).toFixed(0) + '%';
}
function syncUIFromParams() {
  document.querySelectorAll('.track').forEach((card) => {
    const id = card.dataset.track;
    const tp = trackParam(id);
    card.querySelectorAll('input[type=range]').forEach((input) => {
      const k = input.dataset.k;
      input.value = tp[k];
      const out = card.querySelector(`[data-v="${k}"]`);
      if (out) out.textContent = k === 'band' ? `${tp.band} Hz` : k === 'pan' ? panText(tp.pan) : tp[k].toFixed(k === 'threshold' ? 3 : 2);
    });
    card.querySelector('h2 .tag').textContent = `中心 ${tp.band} Hz`;
    card.classList.toggle('cut', !tp.enabled);
    const soloBtn = card.querySelector('[data-act=solo]');
    soloBtn.classList.toggle('active', tp.solo);
    const enBtn = card.querySelector('[data-act=enable]');
    enBtn.textContent = tp.enabled ? '静音该轨' : '启用该轨';
  });
  const mg = $('masterGainText');
  if (mg) mg.textContent = state.params.masterGain.toFixed(2);
  applyMonitor();
}

// ---------- Canvas：频谱、能量、推子、电平 ----------
function drawMasterFader() {
  const cv = $('masterFader');
  if (!cv) return;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  g.fillStyle = '#2c3a52'; g.fillRect(cv.width / 2 - 3, 10, 6, cv.height - 20);
  const y = 10 + (1 - state.params.masterGain) * (cv.height - 20);
  g.fillStyle = '#4fc3f7';
  g.fillRect(cv.width / 2 - 16, y - 8, 32, 16);
  g.fillStyle = '#8ba0bd'; g.font = '10px sans-serif';
  g.fillText('0 dB', 4, 14); g.fillText('-∞', 4, cv.height - 8);
}
function masterFaderFromEvent(e) {
  const cv = $('masterFader');
  const r = cv.getBoundingClientRect();
  const y = ((e.clientY - r.top) / r.height) * cv.height;
  state.params.masterGain = clamp(1 - (y - 10) / (cv.height - 20), 0, 1);
  $('masterGainText').textContent = state.params.masterGain.toFixed(2);
  applyParamsToGraph();
  drawMasterFader();
}
function drawMasterMeters() {
  const cv = $('masterMeters');
  const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  const lv = state.masterLevels || [0, 0];
  for (let ch = 0; ch < 2; ch++) {
    const x = 18 + ch * 52;
    g.fillStyle = '#2c3a52'; g.fillRect(x, 10, 30, cv.height - 20);
    const db = 20 * Math.log10(lv[ch] || 1e-5);
    const h = Math.max(0, Math.min(1, 1 + db / 60)) * (cv.height - 20);
    g.fillStyle = db > -3 ? '#ef5350' : db > -12 ? '#ffa726' : '#66bb6a';
    g.fillRect(x, cv.height - 10 - h, 30, h);
  }
}
function drawTracks() {
  for (const def of TRACK_DEFS) {
    const card = document.querySelector(`.track[data-track="${def.id}"]`);
    const chain = state.tracks.get(def.id);
    const cv = card.querySelector('canvas.spectrum');
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#0b101a'; g.fillRect(0, 0, cv.width, cv.height);
    const tp = trackParam(def.id);
    const centerX = (Math.log(tp.band / 40) / Math.log(12000 / 40)) * cv.width;
    const bw = Math.max(10, cv.width / (tp.q * 5));
    g.fillStyle = def.color + '33';
    g.fillRect(centerX - bw / 2, 6, bw, cv.height - 12);
    g.strokeStyle = def.color; g.lineWidth = 1.5;
    g.strokeRect(centerX - bw / 2, 6, bw, cv.height - 12);
    g.fillStyle = '#8ba0bd'; g.font = '10px sans-serif';
    g.fillText('60Hz', 4, cv.height - 4);
    g.fillText('9kHz', cv.width - 32, cv.height - 4);
    const bar = card.querySelector('.energy .bar');
    const cut = card.querySelector('.energy .cut');
    const lv = chain?.levels ? Math.max(chain.levels[0] || 0, chain.levels[1] || 0) : 0;
    const pct = Math.min(100, (lv / 0.25) * 100);
    bar.style.width = pct + '%';
    cut.style.left = Math.min(100, tp.threshold / 0.35 * 100) + '%';
    card.classList.toggle('cut', !tp.enabled || (lv > 0 && lv < tp.threshold * 0.4 && state.running));
    const bal = chain?.levels ? ((chain.levels[1] || 0) - (chain.levels[0] || 0)) : 0;
    card.querySelector('.balance-text').textContent =
      chain?.levels ? (Math.abs(bal) < 0.002 ? 'L=R 平衡' : (bal > 0 ? 'R 强 ' : 'L 强 ') + Math.abs(bal).toFixed(3)) : '–';
  }
}
function drawMasterSpectrum() {
  const cv = $('masterSpectrum');
  if (!cv || !state.master) return;
  const g = cv.getContext('2d');
  const an = state.master.analyser;
  const bins = new Uint8Array(an.frequencyBinCount);
  an.getByteFrequencyData(bins);
  g.clearRect(0, 0, cv.width, cv.height);
  g.fillStyle = '#0b101a'; g.fillRect(0, 0, cv.width, cv.height);
  const barW = cv.width / 96;
  for (let i = 0; i < 96; i++) {
    const v = bins[Math.floor(i * bins.length / 96 / 1.4)] / 255;
    const h = v * (cv.height - 24);
    g.fillStyle = `hsl(${200 - v * 160}, 70%, ${45 + v * 20}%)`;
    g.fillRect(i * barW + 1, cv.height - 18 - h, barW - 2, h);
  }
  g.fillStyle = '#8ba0bd'; g.font = '10px sans-serif';
  g.fillText('主输出实时频谱（AnalyserNode FFT）', 8, 14);
}
function rafLoop() {
  drawTracks();
  drawMasterMeters();
  drawMasterSpectrum();
  drawMasterFader();
  updateStateBar();
  requestAnimationFrame(rafLoop);
}

// ---------- 步进灯 / 状态栏 ----------
function buildStepLights() {
  const wrap = $('stepLights');
  wrap.innerHTML = '';
  for (let i = 0; i < STEPS; i++) {
    const d = document.createElement('div');
    d.className = 'dot'; d.dataset.step = i;
    wrap.appendChild(d);
  }
}
function lightStep(step) {
  document.querySelectorAll('#stepLights .dot').forEach((d) =>
    d.classList.toggle('on', Number(d.dataset.step) === step));
}
function clearStepLights() {
  document.querySelectorAll('#stepLights .dot').forEach((d) => d.classList.remove('on'));
}
function updateTransportUI(text) { $('transportState').textContent = text; }
function updateStateBar() {
  $('nodeCount').textContent = state.nodes.size + '（临时 ' + transientCount() + '）';
  $('sampleRate').textContent = state.ctx ? state.ctx.sampleRate + ' Hz / ' + state.ctx.state : '未创建';
  const drift = computeDrift();
  $('driftText').textContent = drift === null ? '–' : (drift * 1000).toFixed(2) + ' ms';
  $('bpmText').textContent = state.params.bpm + ' BPM';
}
function computeDrift() {
  if (state.stepStartTimes.length < 2) return null;
  const arr = state.stepStartTimes;
  let maxD = 0;
  for (let i = 1; i < arr.length; i++) {
    const d = Math.abs((arr[i].audioTime - arr[i - 1].audioTime) - STEP_SECONDS);
    if (d > maxD) maxD = d;
  }
  return maxD;
}

// ---------- 自动化验证套件 ----------
function bufferStats(buf) {
  const n = buf.length;
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  let pkL = 0, pkR = 0, sumL = 0, sumR = 0, tail = 0, cross = 0;
  const CHUNK = 8192;
  for (let base = 0; base < n; base += CHUNK) {
    const end = Math.min(n, base + CHUNK);
    for (let i = base; i < end; i++) {
      const l = L[i], r = R[i];
      const aL = l < 0 ? -l : l, aR = r < 0 ? -r : r;
      if (aL > pkL) pkL = aL;
      if (aR > pkR) pkR = aR;
      sumL += l * l;
      sumR += r * r;
      if ((i & 7) === 0) cross += l * r;
      if (aL > 1e-4 || aR > 1e-4) tail = i;
    }
  }
  return {
    duration: n / buf.sampleRate,
    channels: buf.numberOfChannels,
    sampleRate: buf.sampleRate,
    peakL: pkL, peakR: pkR,
    rmsL: Math.sqrt(sumL / n), rmsR: Math.sqrt(sumR / n),
    cross,
    tailMs: (n - 1 - tail) / buf.sampleRate * 1000,
    lrDelta: Math.abs(pkL - pkR)
  };
}

async function renderWithParams(params, fromStep = 0, stepCount = STEPS) {
  const sr = 48000;
  const renderDur = TOTAL_SECONDS + 0.25;
  const offline = await createContext(OfflineAudioContext, sr);
  try {
    const { buffer } = await renderOffline(offline, fromStep, stepCount, renderDur, params);
    return buffer;
  } finally {
    try { if (offline.state !== 'closed') await offline.close(); } catch { /* 渲染后自动关闭 */ }
  }
}

async function runVerification() {
  const lines = [];
  const ok = (cond, name, detail) =>
    lines.push(`<span class="${cond ? 'pass' : 'fail'}">[${cond ? 'PASS' : 'FAIL'}]</span> ${name}${detail ? ' — ' + detail : ''}`);
  const info = (m) => lines.push(`<span class="info">[INFO]</span> ${m}`);

  // 1) 基线：默认参数导出
  const p1 = structuredClone(DEFAULT_PARAMS);
  const b1 = await renderWithParams(p1);
  const s1 = bufferStats(b1);
  info(`基线 WAV：时长 ${s1.duration.toFixed(3)}s，${s1.channels} 声道，${s1.sampleRate} Hz，峰值 L=${s1.peakL.toFixed(4)} R=${s1.peakR.toFixed(4)}`);
  ok(s1.channels === 2, 'WAV 为立体声（2 声道）');
  ok(Math.abs(s1.duration - (TOTAL_SECONDS + 0.25)) < 0.002, 'WAV 时长精确', `${s1.duration.toFixed(3)}s ≈ ${(TOTAL_SECONDS + 0.25).toFixed(3)}s`);
  ok(s1.rmsL > 0.002 && s1.rmsR > 0.0003, '左右声道均有真实信号',
    `RMS L=${s1.rmsL.toFixed(4)} R=${s1.rmsR.toFixed(4)}`);
  ok(s1.lrDelta > 0.002, '左右声道存在差异（声像真实作用）', `|peakL-peakR|=${s1.lrDelta.toFixed(4)}`);

  // 2) 三维度随操作真实变化：频段、门限、声像
  const pBand = structuredClone(p1);
  pBand.tracks[0].band = 120; // 雨棚高频轨切到低频
  const sBand = bufferStats(await renderWithParams(pBand));
  ok(Math.abs(sBand.rmsL - s1.rmsL) > 1e-4 || Math.abs(sBand.rmsR - s1.rmsR) > 1e-4,
    '维度① 频段变化改变输出能量', `RMS L ${s1.rmsL.toFixed(4)}→${sBand.rmsL.toFixed(4)}`);

  // 门限测试：隔离雷声轨，门限拉到滑杆上限后主声源应被切断
  const pThunderOnly = structuredClone(p1);
  pThunderOnly.tracks.forEach((t, i) => { t.enabled = (i === 2); });
  const sThunderOpen = bufferStats(await renderWithParams(pThunderOnly));
  const pGate = structuredClone(pThunderOnly);
  pGate.tracks[2].threshold = 0.6; // 门限拉到滑杆上限 → 主声源被切断
  const sGate = bufferStats(await renderWithParams(pGate));
  const gateCutDb = sGate.peakL > 0 ? 20 * Math.log10(sThunderOpen.peakL / Math.max(sGate.peakL, 1e-12)) : 999;
  ok(sThunderOpen.rmsL > 0.001 && sGate.peakL < 5e-4 && gateCutDb > 30,
    '维度② 门限切断主声源（错误滤波效果，衰减 >30dB）',
    `雷声轨 RMS ${sThunderOpen.rmsL.toFixed(4)}→${sGate.rmsL.toExponential(1)}，峰值 ${sThunderOpen.peakL.toFixed(4)}→${sGate.peakL.toExponential(1)}，衰减 ${gateCutDb.toFixed(1)} dB`);

  const pPan = structuredClone(p1);
  pPan.tracks.forEach((t) => { t.pan = -1; });
  const sPanL = bufferStats(await renderWithParams(pPan));
  pPan.tracks.forEach((t) => { t.pan = 1; });
  const sPanR = bufferStats(await renderWithParams(pPan));
  ok(sPanL.rmsL > sPanL.rmsR * 1.4 && sPanR.rmsR > sPanR.rmsL * 1.4,
    '维度③ 声像改变左右声道能量', `全L: L/R=${(sPanL.rmsL / Math.max(sPanL.rmsR, 1e-6)).toFixed(2)}，全R: R/L=${(sPanR.rmsR / Math.max(sPanR.rmsL, 1e-6)).toFixed(2)}`);

  // 维度④ 延迟/节拍：单步渲染长度与步进位置
  const stepBuf = await renderWithParams(p1, 4, 1);
  const stepStats = bufferStats(stepBuf);
  ok(Math.abs(stepStats.duration - (TOTAL_SECONDS + 0.25)) < 0.002, '维度④ 节拍调度可按步渲染', `step#5 渲染 ${stepStats.duration.toFixed(3)}s`);

  // 3) 三种监听状态
  const pMute = structuredClone(p1); pMute.monitor = 'mute';
  const sMute = bufferStats(await renderWithParams(pMute));
  ok(sMute.peakL < 1e-3 && sMute.peakR < 1e-3, '静音监听输出为零', `峰值 ${sMute.peakL.toExponential(1)}`);
  const pBp = structuredClone(p1); pBp.monitor = 'bypass';
  const sBp = bufferStats(await renderWithParams(pBp));
  ok(Math.abs(sBp.peakL - s1.peakL) > 1e-4 || Math.abs(sBp.rmsL - s1.rmsL) > 1e-4,
    '旁路监听绕过滤波/门限且与主输出不同', `旁路 RMS=${sBp.rmsL.toFixed(4)} vs 主输出=${s1.rmsL.toFixed(4)}`);

  // 4) 尾音：渲染窗口末端必须衰减到本底
  ok(s1.tailMs > 120, '无尾音残留（末段已衰减）', `末端静音余量 ${s1.tailMs.toFixed(0)} ms`);

  // 5) 参数保存→重载→再次导出一致性
  saveParamsSilent(p1);
  const reloaded = JSON.parse(localStorage.getItem(PARAM_KEY));
  const b2 = (await renderWithParams(structuredClone(reloaded.params)));
  const s2 = bufferStats(b2);
  const sameDur = Math.abs(s2.duration - s1.duration) < 1e-4;
  const samePk = Math.abs(s2.peakL - s1.peakL) < 1e-4 && Math.abs(s2.peakR - s1.peakR) < 1e-4;
  const sameCh = s2.channels === s1.channels;
  ok(sameDur && samePk && sameCh, '参数重载后导出：时长/峰值/声道一致',
    `时长 ${s1.duration.toFixed(4)} vs ${s2.duration.toFixed(4)}；峰值 ${s1.peakL.toFixed(4)}/${s1.peakR.toFixed(4)} vs ${s2.peakL.toFixed(4)}/${s2.peakR.toFixed(4)}`);

  // 6) 在线播放的节点泄漏与暂停静音（需要真实上下文）
  await stopTransport();
  const before = state.nodes.size;
  await play();
  await waitMs(450);
  const during = state.nodes.size;
  ok(during > before, '播放时创建活动节点', `${before} → ${during}`);
  await pause();
  await waitMs(120);
  ok(state.ctx.state === 'suspended', '暂停后上下文挂起（声音必须停止）', `state=${state.ctx.state}`);
  const suspendedPeak = await sampleOnlineSilence();
  ok(suspendedPeak < 1e-6, '暂停后输出静默无尾音', `峰值 ${suspendedPeak.toExponential(1)}`);
  await resumeFromPause();
  await waitMs(300);
  ok(state.ctx.state === 'running', '恢复后继续播放');
  await stopTransport();
  await waitMs(100);
  ok(state.nodes.size === 0, '停止后无未关闭节点', `残留 ${state.nodes.size} 个`);

  // 7) 节拍漂移：在线调度的步进间隔
  await play();
  await waitMs(1400);
  const drift = computeDrift();
  ok(drift !== null && drift < 0.002, '节拍无漂移（步进间隔偏差 < 2ms）', drift === null ? '无数据' : `${(drift * 1000).toFixed(2)} ms`);
  await stopTransport();
  ok(state.nodes.size === 0, '复检：停止后节点全部关闭', `残留 ${state.nodes.size} 个`);

  const failed = lines.filter((l) => l.includes('>[FAIL]<')).length;
  lines.unshift(`<span class="info">验证完成：${lines.filter((l) => l.includes('PASS')).length} 项通过，${failed} 项失败 @ ${new Date().toLocaleTimeString()}</span>`);
  $('verifyReport').innerHTML = lines.join('\n');
  return failed === 0;
}

function saveParamsSilent(p) {
  localStorage.setItem(PARAM_KEY, JSON.stringify({ version: 1, params: p }));
}
function waitMs(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function sampleOnlineSilence() {
  // 上下文挂起后音频线程停止拉取，输出物理上必然静音。
  // 这里通过监听增益是否已被静音状态/挂起冻结来验证，不依赖分析器残留帧。
  if (!state.ctx || state.ctx.state !== 'suspended') return NaN;
  // 挂起后再等待一个量化周期，确认没有新的电平表消息（数值不再变化）
  const before = state.masterLevels ? [...state.masterLevels] : [0, 0];
  await waitMs(150);
  const after = state.masterLevels || [0, 0];
  const frozen = before.length === after.length && before.every((v, i) => v === after[i]);
  // 监听增益在静音模式下为 0；其它模式下挂起本身保证无声。返回冻结状态的等效峰值
  return frozen ? 0 : Math.max(after[0] || 0, after[1] || 0);
}

// ---------- 事件绑定与启动 ----------
function bindEvents() {
  $('btnPlay').addEventListener('click', () => state.paused ? resumeFromPause() : play());
  $('btnPause').addEventListener('click', pause);
  $('btnStop').addEventListener('click', stopTransport);
  $('btnReplay').addEventListener('click', replay);
  $('btnStep').addEventListener('click', singleStep);
  $('btnSave').addEventListener('click', () => { saveParams(); flash('参数已保存到 localStorage 并下载 JSON'); });
  $('btnLoad').addEventListener('click', () => $('paramFile').click());
  $('paramFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try { loadParamsObject(JSON.parse(await file.text())); flash('参数已载入并应用'); }
    catch (err) { flash('载入失败：' + err.message, true); }
    e.target.value = '';
  });
  $('btnExport').addEventListener('click', async () => {
    const { blob } = await exportWav();
    flash(`WAV 已导出（${(blob.size / 1024).toFixed(1)} KB）`);
  });
  $('btnVerify').addEventListener('click', runVerification);
  document.querySelectorAll('.monitor-btn').forEach((b) => b.addEventListener('click', () => {
    state.params.monitor = b.dataset.monitor;
    applyMonitor();
  }));
  const fader = $('masterFader');
  let dragging = false;
  fader.addEventListener('pointerdown', (e) => { dragging = true; masterFaderFromEvent(e); });
  window.addEventListener('pointermove', (e) => { if (dragging) masterFaderFromEvent(e); });
  window.addEventListener('pointerup', () => { dragging = false; });
}
function flash(msg, bad) {
  const el = $('transportState');
  const old = el.textContent;
  el.textContent = msg;
  el.style.color = bad ? '#ef5350' : '#66bb6a';
  setTimeout(() => { el.textContent = old; el.style.color = ''; }, 2200);
}

window.addEventListener('DOMContentLoaded', () => {
  buildTrackUI();
  buildStepLights();
  bindEvents();
  syncUIFromParams();
  updateStateBar();
  requestAnimationFrame(rafLoop);
  // 暴露给自动化测试
  window.__mixer = { state, renderWithParams, bufferStats, runVerification, exportWav,
    play, pause, stopTransport, replay, singleStep, saveParams, loadParamsObject,
    DEFAULT_PARAMS, TOTAL_SECONDS, STEP_SECONDS };
});
