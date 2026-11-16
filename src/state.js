// State store: validation-gated updates, autosave/restore, named presets.

import { validateParams } from './validation.js';
import { layoutScene } from './layout.js';

export const STORAGE_KEY = 'typo-studio/state/v1';
export const SNAPSHOT_KEY = 'typo-studio/snapshot/v1';

let sequence = 0;
export function nextLayerId() {
  sequence += 1;
  return `L${Date.now().toString(36)}${sequence}`;
}

export function defaultLayer(overrides = {}) {
  return {
    id: overrides.id || nextLayerId(),
    name: overrides.name || '图层 1',
    text: 'Hello TYPO',
    fontSize: 64,
    weight: 400,
    slant: 0,
    width: 1,
    corner: 0.2,
    color: '#1f2933',
    position: { x: 80, y: 40 },
    ...overrides
  };
}

export function defaultScene() {
  return {
    version: 1,
    background: '#f7f8fa',
    wrapWidth: 720,
    selectedLayer: null,
    view: { zoom: 1, panX: 0, panY: 0, rotation: 0 },
    layers: [defaultLayer()],
    savedAt: null,
    paused: false
  };
}

export function extremeScene() {
  return {
    ...defaultScene(),
    background: '#101418',
    wrapWidth: 900,
    view: { zoom: 1, panX: 24, panY: 18, rotation: 0 },
    layers: [
      defaultLayer({
        name: '极端-粗窄斜',
        text: 'BLACK WIDTH 0.5 SLANT 45 ROUND',
        fontSize: 56,
        weight: 900,
        slant: 45,
        width: 0.5,
        corner: 1,
        color: '#ffd166',
        position: { x: 60, y: 40 }
      }),
      defaultLayer({
        name: '极端-细宽反向',
        text: 'thin 2x reverse italic minimum',
        fontSize: 28,
        weight: 100,
        slant: -45,
        width: 2,
        corner: 0,
        color: '#06d6a0',
        position: { x: 60, y: 600 }
      })
    ]
  };
}

export function createStore(storage) {
  let state = defaultScene();
  let lastValid = structuredCloneSafe(state);
  const listeners = new Set();

  const emit = (notice) => {
    for (const fn of listeners) fn(state, notice);
  };

  const renderCheck = (candidate) => {
    const result = layoutScene(candidate, candidate.wrapWidth);
    return result.ok ? null : result.invalid.map((l) => `${l.name}: ${l.reason}`).join('；');
  };

  const replace = (next, notice) => {
    state = next;
    lastValid = structuredCloneSafe(next);
    persist();
    emit(notice);
  };

  function getState() {
    return state;
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function applyLayerUpdate(layerId, patch) {
    const layer = state.layers.find((item) => item.id === layerId);
    if (!layer) return { ok: false, reason: `图层 ${layerId} 不存在` };
    const candidateLayer = { ...layer, ...patch };
    const check = validateParams(candidateLayer);
    if (!check.ok) {
      return { ok: false, reason: check.errors.map((e) => e.reason).join('；') };
    }
    const candidate = {
      ...state,
      layers: state.layers.map((item) => (item.id === layerId ? candidateLayer : item))
    };
    const renderError = renderCheck(candidate);
    if (renderError) return { ok: false, reason: renderError };
    replace(candidate, { type: 'layer', layerId });
    return { ok: true };
  }

  function applyScenePatch(patch, notice = { type: 'scene' }) {
    const candidate = { ...state, ...patch };
    if (typeof candidate.wrapWidth !== 'number' ||
      candidate.wrapWidth < 80 || candidate.wrapWidth > 4000) {
      return { ok: false, reason: '换行宽度必须在 80 到 4000 像素之间' };
    }
    const view = candidate.view;
    if (view && (
      typeof view.zoom !== 'number' || view.zoom < 0.2 || view.zoom > 4 ||
      Math.abs(view.rotation) > 180
    )) {
      return { ok: false, reason: '视角超出允许范围（缩放 0.2–4，旋转 ±180°）' };
    }
    const renderError = renderCheck(candidate);
    if (renderError) return { ok: false, reason: renderError };
    replace(candidate, notice);
    return { ok: true };
  }

  function addLayer() {
    const layer = defaultLayer({
      name: `图层 ${state.layers.length + 1}`,
      position: { x: 80 + state.layers.length * 24, y: 60 + state.layers.length * 24 }
    });
    return applyScenePatch({ layers: [...state.layers, layer], selectedLayer: layer.id });
  }

  function moveLayer(layerId, direction) {
    const index = state.layers.findIndex((item) => item.id === layerId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= state.layers.length) {
      return { ok: false, reason: '图层顺序越界，无法移动' };
    }
    const layers = [...state.layers];
    [layers[index], layers[target]] = [layers[target], layers[index]];
    return applyScenePatch({ layers }, { type: 'reorder' });
  }

  function removeLayer(layerId) {
    if (state.layers.length <= 1) return { ok: false, reason: '至少保留一个图层' };
    return applyScenePatch({
      layers: state.layers.filter((item) => item.id !== layerId),
      selectedLayer: null
    });
  }

  function resetAll(preset = 'default') {
    const next = preset === 'extreme' ? extremeScene() : defaultScene();
    replace(next, { type: 'reset', preset });
    return { ok: true };
  }

  function saveSnapshot(label = 'manual') {
    const snapshot = { ...structuredCloneSafe(state), savedAt: new Date().toISOString(), label };
    if (storage) storage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
    replace({ ...state, savedAt: snapshot.savedAt }, { type: 'saved' });
    return snapshot;
  }

  function persist() {
    if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function restore() {
    if (!storage) return { restored: false };
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { restored: false };
    try {
      const parsed = JSON.parse(raw);
      const candidate = migrate(parsed);
      const renderError = renderCheck(candidate);
      if (renderError) throw new Error(renderError);
      state = candidate;
      lastValid = structuredCloneSafe(candidate);
      emit({ type: 'restore' });
      return { restored: true };
    } catch (error) {
      state = lastValid;
      emit({ type: 'restore-failed', reason: error.message });
      return { restored: false, reason: error.message };
    }
  }

  return {
    getState,
    subscribe,
    applyLayerUpdate,
    applyScenePatch,
    addLayer,
    moveLayer,
    removeLayer,
    resetAll,
    saveSnapshot,
    restore,
    get lastValid() {
      return lastValid;
    }
  };
}

function migrate(parsed) {
  const base = defaultScene();
  if (!parsed || !Array.isArray(parsed.layers) || parsed.layers.length === 0) {
    throw new Error('存档缺少 layers 数组');
  }
  const layers = parsed.layers.map((layer) => {
    const check = validateParams(layer);
    if (!check.ok) throw new Error(`存档图层 ${layer.name || layer.id}: ${check.errors[0].reason}`);
    return { ...defaultLayer(), ...layer, position: { ...defaultLayer().position, ...layer.position } };
  });
  return {
    ...base,
    ...parsed,
    layers,
    view: { ...base.view, ...(parsed.view || {}) },
    paused: Boolean(parsed.paused)
  };
}

export function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}
