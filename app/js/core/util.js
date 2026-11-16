// 统一的数值/文本格式化，屏幕与 SVG 导出共用，杜绝两套口径
export function fmtM(v, digits = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${Number(v).toFixed(digits)} m`;
}

export function fmtNum(v, digits = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return Number(v).toFixed(digits);
}

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

export function round(v, digits = 2) {
  const p = 10 ** digits;
  return Math.round(v * p) / p;
}

// 确定性 FNV-1a 哈希，生成数据版本号；相同输入必得相同版本
export function hashVersion(input) {
  const str = typeof input === 'string' ? input : JSON.stringify(input);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `v${(h >>> 0).toString(16).padStart(8, '0')}`;
}

export function isoDay(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

export function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
