// 纯声学计算模块：不依赖 Web Audio，可在 Node 下直接单元测试。

export const SPEED_OF_SOUND = 343; // m/s
export const PIXELS_PER_METER = 90;
export const ROOM = { widthM: 8, depthM: 5.6, widthPx: 720, depthPx: 504 };
export const STEP_COUNT = 8;

export function pxToM(px) { return px / PIXELS_PER_METER; }

export function distanceM(a, b) {
  const dx = pxToM(a.x - b.x);
  const dy = pxToM(a.y - b.y);
  return Math.hypot(dx, dy);
}

// 距离衰减：1m 处约 0.67，随距离平滑下降，避免零距离发散。
export function distanceGain(distance) {
  return 1 / (0.5 + Math.max(0, distance));
}

// 传播延迟（毫秒）。
export function propagationDelayMs(distance) {
  return (Math.max(0, distance) / SPEED_OF_SOUND) * 1000;
}

// 相对监听朝向的方位角：0=正前方，正值=右侧，范围 [-PI, PI]。
// 监听点默认朝向画布上方（-y）。
export function azimuth(source, listener) {
  const dx = source.x - listener.x;
  const dy = source.y - listener.y;
  return Math.atan2(dx, -dy);
}

function equalPower(pan) {
  const p = Math.max(-1, Math.min(1, pan));
  const angle = ((p + 1) * Math.PI) / 4;
  return { left: Math.cos(angle), right: Math.sin(angle) };
}

// 立体声：等功率声像。
export function stereoGains(source, listener) {
  const pan = Math.sin(azimuth(source, listener));
  return { pan, ...equalPower(pan) };
}

// 双耳：等功率声像 + ILD 电平差 + ITD 双耳时间差（最大约 0.66ms）。
export function binauralGains(source, listener) {
  const phi = azimuth(source, listener);
  const base = equalPower(Math.sin(phi));
  const ild = 0.15 * Math.sin(phi);
  const itdSeconds = 0.00066 * Math.sin(phi);
  return {
    azimuthRad: phi,
    left: base.left * (1 - ild),
    right: base.right * (1 + ild),
    delayLeftMs: Math.max(0, itdSeconds) * 1000,
    delayRightMs: Math.max(0, -itdSeconds) * 1000,
  };
}

// 环绕：四墙角扬声器等功率分配，按声源在房间中的归一化位置。
export function surroundGains(source) {
  const xn = Math.max(0, Math.min(1, source.x / ROOM.widthPx));
  const yn = Math.max(0, Math.min(1, source.y / ROOM.depthPx));
  const front = 1 - yn;
  const back = yn;
  const left = 1 - xn;
  const right = xn;
  const fl = Math.sqrt(front * left);
  const fr = Math.sqrt(front * right);
  const bl = Math.sqrt(back * left);
  const br = Math.sqrt(back * right);
  const norm = Math.hypot(fl, fr, bl, br) || 1;
  return { fl: fl / norm, fr: fr / norm, bl: bl / norm, br: br / norm };
}

// 统一入口：返回某声源在某模式下的完整空间化参数。
export function computeSpatial(mode, source, listener) {
  const distance = distanceM(source, listener);
  const common = {
    mode,
    distanceM: round3(distance),
    gain: round3(distanceGain(distance)),
    delayMs: round3(propagationDelayMs(distance)),
  };
  if (mode === 'stereo') return { ...common, ...stereoGains(source, listener) };
  if (mode === 'binaural') return { ...common, ...binauralGains(source, listener) };
  return { ...common, ...surroundGains(source) };
}

export function round3(v) {
  return Math.round(v * 1000) / 1000;
}

export function defaultState() {
  return {
    version: 1,
    room: { ...ROOM },
    mode: 'stereo',
    audition: 'main',
    bpm: 100,
    reverbMix: 0.28,
    reverbDecay: 1.6,
    listener: { x: 360, y: 300 },
    sources: [
      { id: 0, name: '声源 A', type: 'sine', freq: 220, x: 150, y: 110, pattern: [1, 0, 1, 0, 1, 0, 1, 0] },
      { id: 1, name: '声源 B', type: 'triangle', freq: 440, x: 570, y: 120, pattern: [0, 1, 0, 1, 0, 1, 0, 1] },
      { id: 2, name: '声源 C', type: 'noise', freq: 1200, x: 360, y: 420, pattern: [1, 1, 0, 0, 1, 1, 0, 0] },
    ],
  };
}

// 仅序列化/反序列化可持久化参数，运行时字段不会进入参数文件。
export function serializeParams(state) {
  return JSON.stringify({
    version: 1,
    mode: state.mode,
    audition: state.audition,
    bpm: state.bpm,
    reverbMix: state.reverbMix,
    reverbDecay: state.reverbDecay,
    listener: { ...state.listener },
    sources: state.sources.map((s) => ({
      id: s.id, name: s.name, type: s.type, freq: s.freq,
      x: s.x, y: s.y, pattern: [...s.pattern],
    })),
  }, null, 2);
}

export function applyParams(state, params) {
  if (!params || params.version !== 1) throw new Error('参数文件版本不兼容');
  state.mode = params.mode;
  state.audition = params.audition;
  state.bpm = clampNum(params.bpm, 40, 240);
  state.reverbMix = clampNum(params.reverbMix, 0, 0.8);
  state.reverbDecay = clampNum(params.reverbDecay, 0.2, 4);
  state.listener = { x: num(params.listener.x), y: num(params.listener.y) };
  state.sources = params.sources.map((s, i) => ({
    id: i,
    name: String(s.name),
    type: ['sine', 'triangle', 'sawtooth', 'square', 'noise'].includes(s.type) ? s.type : 'sine',
    freq: clampNum(s.freq, 20, 12000),
    x: num(s.x), y: num(s.y),
    pattern: Array.isArray(s.pattern) && s.pattern.length === STEP_COUNT
      ? s.pattern.map((v) => (v ? 1 : 0))
      : defaultState().sources[0].pattern,
  }));
}

function num(v) { return Number(v) || 0; }
function clampNum(v, min, max) { return Math.max(min, Math.min(max, Number(v) || min)); }
