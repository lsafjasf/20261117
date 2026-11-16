import { defaultParams, validateParams, mergeParams } from './params.js';

export const PARAMS_KEY = 'paperStreet.params.v1';
export const VIEW_KEY = 'paperStreet.viewDraft.v1';

export function hasStorage() {
  try {
    const probe = '__probe__';
    globalThis.localStorage.setItem(probe, '1');
    globalThis.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function safeParse(raw) {
  if (typeof raw !== 'string') return { ok: false };
  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

// Loads saved params; corrupt or out-of-range data is rejected field by
// field and falls back to defaults. Returns { params, errors }.
export function loadParams(storage = globalThis.localStorage) {
  const fallback = defaultParams();
  if (!storage) return { params: fallback, errors: ['localStorage 不可用，使用默认参数'] };
  let raw;
  try {
    raw = storage.getItem(PARAMS_KEY);
  } catch {
    return { params: fallback, errors: ['读取本地参数失败，使用默认参数'] };
  }
  if (raw === null || raw === undefined) return { params: fallback, errors: [] };
  const parsed = safeParse(raw);
  if (!parsed.ok || typeof parsed.data !== 'object' || parsed.data === null) {
    return { params: fallback, errors: ['本地参数已损坏，已恢复默认参数'] };
  }
  const result = validateParams(parsed.data);
  const params = mergeParams(fallback, result.params);
  const errors = result.ok ? [] : [`部分保存的参数无效，已回退：${result.errors.join('；')}`];
  return { params, errors };
}

export function saveParams(params, storage = globalThis.localStorage) {
  if (!storage) return false;
  try {
    storage.setItem(PARAMS_KEY, JSON.stringify(params));
    return true;
  } catch {
    return false;
  }
}

// Unsaved view drafts live in sessionStorage so a refresh restores the
// viewpoint but a new tab/session starts centered.
export function saveViewDraft(view, storage = globalThis.sessionStorage) {
  if (!storage) return false;
  try {
    storage.setItem(VIEW_KEY, JSON.stringify(view));
    return true;
  } catch {
    return false;
  }
}

export function loadViewDraft(storage = globalThis.sessionStorage) {
  if (!storage) return null;
  let raw;
  try {
    raw = storage.getItem(VIEW_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  const parsed = safeParse(raw);
  if (!parsed.ok) return null;
  const { viewX, viewY } = parsed.data;
  if (typeof viewX !== 'number' || typeof viewY !== 'number') return null;
  if (!Number.isFinite(viewX) || !Number.isFinite(viewY)) return null;
  return {
    viewX: Math.min(1, Math.max(-1, viewX)),
    viewY: Math.min(1, Math.max(-1, viewY)),
  };
}

export function clearViewDraft(storage = globalThis.sessionStorage) {
  if (!storage) return;
  try {
    storage.removeItem(VIEW_KEY);
  } catch {
    /* ignore */
  }
}
