// Single source of truth for all user-tunable parameters.
export const VIEW_W = 1280;
export const VIEW_H = 720;

export const PARAM_SCHEMA = Object.freeze({
  seed: { type: 'int', min: 0, max: 2147483647, default: 20261117 },
  layerCount: { type: 'int', min: 2, max: 6, default: 4 },
  buildingDensity: { type: 'number', min: 0, max: 1, default: 0.55 },
  windowLitRatio: { type: 'number', min: 0, max: 1, default: 0.62 },
  lightBeams: { type: 'boolean', default: true },
  sunsetHue: { type: 'number', min: 0, max: 360, default: 24 },
  sunSize: { type: 'number', min: 0, max: 1, default: 0.55 },
  parallaxStrength: { type: 'number', min: 0, max: 2, default: 1 },
  zoom: { type: 'number', min: 0.5, max: 2.5, default: 1 },
  masterVolume: { type: 'number', min: 0, max: 1, default: 0.35 },
});

export function defaultParams() {
  const out = {};
  for (const [key, spec] of Object.entries(PARAM_SCHEMA)) out[key] = spec.default;
  return Object.freeze ? { ...out } : out;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// Returns { ok, value, error }. Never throws, never clamps silently.
export function validateField(key, rawValue) {
  const spec = PARAM_SCHEMA[key];
  if (!spec) {
    return { ok: false, error: `未知参数 "${key}"` };
  }
  if (spec.type === 'boolean') {
    if (typeof rawValue !== 'boolean') {
      return { ok: false, error: `参数 ${key} 必须是布尔值 true/false，收到 ${typeof rawValue}` };
    }
    return { ok: true, value: rawValue };
  }
  let value = rawValue;
  if (spec.type === 'int') {
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      value = Number(value);
    }
    if (!isFiniteNumber(value) || !Number.isInteger(value)) {
      return { ok: false, error: `参数 ${key} 必须是整数，收到 "${String(rawValue)}"` };
    }
  } else {
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      value = Number(value);
    }
    if (!isFiniteNumber(value)) {
      return { ok: false, error: `参数 ${key} 必须是有限数字，收到 "${String(rawValue)}"` };
    }
  }
  if (value < spec.min || value > spec.max) {
    return {
      ok: false,
      error: `参数 ${key}=${value} 超出允许范围 [${spec.min}, ${spec.max}]`,
    };
  }
  return { ok: true, value };
}

// Validates a partial/full patch against the schema.
// Returns { params, errors } where params contains only accepted fields.
export function validateParams(patch) {
  const errors = [];
  const accepted = {};
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, errors: ['参数集合必须是对象'], params: {} };
  }
  for (const [key, raw] of Object.entries(patch)) {
    const result = validateField(key, raw);
    if (result.ok) accepted[key] = result.value;
    else errors.push(result.error);
  }
  return { ok: errors.length === 0, errors, params: accepted };
}

// Merge a validated patch onto a base object and return a new object.
export function mergeParams(base, patch) {
  const result = { ...defaultParams(), ...base, ...patch };
  const out = {};
  for (const key of Object.keys(PARAM_SCHEMA)) out[key] = result[key];
  return out;
}
