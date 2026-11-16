// Parameter schema, validation (with human-readable reasons), presets,
// and persistence. Pure module; storage is injectable for tests.

export const SCHEMA = {
  seed:        { type: 'int',   min: 0,    max: 99999999, def: 20261117, label: '随机种子' },
  interval:    { type: 'float', min: 0.02, max: 0.5,    def: 0.1,      label: '线距(等高距)' },
  smoothness:  { type: 'int',   min: 0,    max: 5,      def: 2,        label: '平滑度' },
  labelDensity:{ type: 'int',   min: 0,    max: 3,      def: 2,        label: '标签密度' },
};

export const DEFAULT_VIEW = { x: 0, y: 0, scale: 1 };

export const DEFAULT_LAYERS = { terrain: true, contours: true, labels: true };

export function defaultState() {
  const params = {};
  for (const k of Object.keys(SCHEMA)) params[k] = SCHEMA[k].def;
  return {
    params,
    view: { ...DEFAULT_VIEW },
    layers: { ...DEFAULT_LAYERS },
    paused: false,
  };
}

// 默认画面 / 极端画面 两组预设
export const PRESETS = {
  default: defaultState(),
  extreme: {
    params: { seed: 20261117, interval: 0.02, smoothness: 5, labelDensity: 3 },
    view: { x: 0, y: 0, scale: 2.5 },
    layers: { terrain: true, contours: true, labels: true },
    paused: false,
  },
};

// Returns { ok, errors: [string], params } — never throws.
export function validateParams(raw) {
  const errors = [];
  const params = {};
  for (const key of Object.keys(SCHEMA)) {
    const rule = SCHEMA[key];
    const v = raw ? raw[key] : undefined;
    if (v === undefined || v === null || v === '') {
      errors.push(`${rule.label}(${key}) 缺失`);
      continue;
    }
    const num = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(num)) {
      errors.push(`${rule.label}(${key}) 不是有效数字: ${JSON.stringify(v)}`);
      continue;
    }
    if (rule.type === 'int' && !Number.isInteger(num)) {
      errors.push(`${rule.label}(${key}) 必须是整数, 当前为 ${num}`);
      continue;
    }
    if (num < rule.min || num > rule.max) {
      errors.push(`${rule.label}(${key}) 超出范围 [${rule.min}, ${rule.max}], 当前为 ${num}`);
      continue;
    }
    params[key] = num;
  }
  return { ok: errors.length === 0, errors, params };
}

export function validateView(view) {
  if (!view) return { ...DEFAULT_VIEW };
  const out = { ...DEFAULT_VIEW };
  for (const k of ['x', 'y', 'scale']) {
    if (Number.isFinite(view[k])) out[k] = view[k];
  }
  out.scale = Math.min(20, Math.max(0.1, out.scale));
  return out;
}

export function validateLayers(layers) {
  const out = { ...DEFAULT_LAYERS };
  if (layers) {
    for (const k of Object.keys(out)) {
      if (typeof layers[k] === 'boolean') out[k] = layers[k];
    }
  }
  return out;
}
const STORAGE_KEY = 'contour-studio-state-v1';

// Load full state from storage; falls back to defaults on any corruption.
export function loadState(storage) {
  const base = defaultState();
  try {
    const raw = storage && storage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    const v = validateParams(parsed.params);
    if (v.ok) base.params = v.params;
    base.view = validateView(parsed.view);
    base.layers = validateLayers(parsed.layers);
    base.paused = parsed.paused === true;
    return base;
  } catch {
    return base;
  }
}

export function saveState(storage, state) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export { STORAGE_KEY };
