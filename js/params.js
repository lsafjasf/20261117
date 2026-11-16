// 参数模型、校验与持久化。

export const DEFAULT_PARAMS = Object.freeze({
  wave: "sawtooth",
  baseFreq: 110,        // A2
  pan: 0,
  masterGain: 0.5,
  lowsDb: 0,
  midsDb: 0,
  highsDb: 0,
  delayTime: 0.18,
  feedback: 0.3,
  bpm: 120,
  holdSeconds: 1.0,
  inputGain: 1,
  noiseFloor: 0.01,
  centsTolerance: 8,   // 音分容差
  holdRounds: 2,       // 连续稳定轮次
  detuneLow: -14,      // 各音区初始偏差（音分），供调音校正
  detuneMid: 9,
  detuneHigh: -6
});

// 三个八度音区：低/中/高，目标频率分别为 A2/A3/A4。
export const REGISTERS = Object.freeze([
  { id: "low", name: "低音区", target: 110.0 },
  { id: "mid", name: "中音区", target: 220.0 },
  { id: "high", name: "高音区", target: 440.0 }
]);

const LIMITS = {
  wave: (v) => ["sine", "square", "sawtooth", "triangle"].includes(v),
  baseFreq: (v) => v >= 27.5 && v <= 880,
  pan: (v) => v >= -1 && v <= 1,
  masterGain: (v) => v >= 0 && v <= 1,
  lowsDb: (v) => v >= -24 && v <= 12,
  midsDb: (v) => v >= -24 && v <= 12,
  highsDb: (v) => v >= -24 && v <= 12,
  delayTime: (v) => v >= 0 && v <= 0.6,
  feedback: (v) => v >= 0 && v <= 0.85,
  bpm: (v) => v >= 40 && v <= 240,
  holdSeconds: (v) => v >= 0.2 && v <= 3,
  inputGain: (v) => v >= 0 && v <= 3,
  noiseFloor: (v) => v >= 0 && v <= 0.5,
  centsTolerance: (v) => v >= 1 && v <= 50,
  holdRounds: (v) => v >= 1 && v <= 10,
  detuneLow: (v) => v >= -50 && v <= 50,
  detuneMid: (v) => v >= -50 && v <= 50,
  detuneHigh: (v) => v >= -50 && v <= 50
};

export function sanitizeParams(raw = {}) {
  const out = { ...DEFAULT_PARAMS };
  for (const key of Object.keys(DEFAULT_PARAMS)) {
    const v = raw[key];
    if (v === undefined || v === null) continue;
    const num = typeof v === "string" && key !== "wave" ? Number(v) : v;
    if (key === "wave") {
      out[key] = LIMITS.wave(v) ? v : DEFAULT_PARAMS[key];
    } else if (Number.isFinite(num) && LIMITS[key](num)) {
      out[key] = num;
    }
  }
  return out;
}

const STORAGE_KEY = "synth-tuner-params-v1";

// 可注入 storage，Node 测试时使用 Map 回退。
export function saveParams(params, storage = globalThis.localStorage) {
  const clean = sanitizeParams(params);
  const json = JSON.stringify({ version: 1, params: clean, savedAt: new Date(0).toISOString() });
  if (storage?.setItem) storage.setItem(STORAGE_KEY, json);
  return clean;
}

export function loadParams(storage = globalThis.localStorage) {
  let json = null;
  try {
    json = storage?.getItem ? storage.getItem(STORAGE_KEY) : null;
  } catch {
    json = null;
  }
  if (!json) return { ...DEFAULT_PARAMS };
  const parsed = JSON.parse(json);
  return sanitizeParams(parsed.params ?? {});
}
