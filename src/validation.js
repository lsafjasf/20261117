// Parameter validation. Invalid input never throws into the renderer:
// callers receive structured reasons and keep the last usable frame.

export const PARAM_SPEC = {
  fontSize: { min: 12, max: 200, step: 1, label: '字号' },
  weight: { min: 100, max: 900, step: 100, label: '字重' },
  slant: { min: -45, max: 45, step: 1, label: '倾斜角' },
  width: { min: 0.5, max: 2, step: 0.01, label: '宽度' },
  corner: { min: 0, max: 1, step: 0.01, label: '拐角圆度' }
};

export const MAX_TEXT_LENGTH = 500;

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function validateParams(input) {
  const errors = [];
  const value = {};
  if (input === null || typeof input !== 'object') {
    return { ok: false, errors: [{ key: 'params', reason: '参数必须是对象' }], value: null };
  }
  for (const [key, spec] of Object.entries(PARAM_SPEC)) {
    const raw = input[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      errors.push({ key, reason: `${spec.label}必须是有限数字，收到 ${String(raw)}` });
      continue;
    }
    if (raw < spec.min || raw > spec.max) {
      errors.push({
        key,
        reason: `${spec.label}超出允许范围 [${spec.min}, ${spec.max}]，收到 ${raw}`
      });
      continue;
    }
    value[key] = raw;
  }
  if (typeof input.text !== 'string') {
    errors.push({ key: 'text', reason: '文本必须是字符串' });
  } else if (input.text.length > MAX_TEXT_LENGTH) {
    errors.push({ key: 'text', reason: `文本长度不能超过 ${MAX_TEXT_LENGTH} 字` });
  } else {
    value.text = input.text;
  }
  if ('color' in input) {
    if (typeof input.color !== 'string' || !COLOR_RE.test(input.color)) {
      errors.push({ key: 'color', reason: '颜色必须是 #RRGGBB 格式' });
    } else {
      value.color = input.color;
    }
  }
  if ('name' in input && typeof input.name !== 'string') {
    errors.push({ key: 'name', reason: '图层名称必须是字符串' });
  }
  return { ok: errors.length === 0, errors, value };
}

export function clampParams(params) {
  const out = { ...params };
  for (const [key, spec] of Object.entries(PARAM_SPEC)) {
    if (typeof out[key] === 'number' && Number.isFinite(out[key])) {
      out[key] = Math.min(spec.max, Math.max(spec.min, out[key]));
    }
  }
  return out;
}
