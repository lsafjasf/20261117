// app.js — browser controller: UI binding, persistence, pause, export,
// and the invalid-parameter path that preserves the last good frame.

import {
  DEFAULT_STATE, LAYER_ORDER, cloneState, generateScene,
} from './scene.js';
import { render, setCanvasFactory } from './render.js';
import { createStore, serializeState, deserializeState } from './store.js';

const STORAGE_KEY = 'mtn.scene.state.v1';
const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');
const errorBox = document.getElementById('error');
const statusBox = document.getElementById('status');

setCanvasFactory((w, h) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
});

const store = createStore(loadInitialState());
let state = store.getState();
const scene = generateScene(state.seed);

function loadInitialState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneState(DEFAULT_STATE);
    const result = deserializeState(raw);
    if (result.ok) return result.state;
    showError(['已保存的状态无效，回退到默认画面', ...result.errors]);
  } catch (err) {
    showError([`读取存档失败：${err.message}，回退到默认画面`]);
  }
  return cloneState(DEFAULT_STATE);
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, serializeState(state));
  } catch (err) {
    setStatus(`存档写入失败：${err.message}`);
  }
}

function showError(lines) {
  errorBox.textContent = ['参数校验失败，画面保持上一次可用状态', ...lines].join('\n');
  errorBox.style.display = 'block';
}

function clearError() {
  errorBox.style.display = 'none';
  errorBox.textContent = '';
}

function setStatus(text) {
  statusBox.textContent = text;
}

// applyCandidate is the single entry point for every state change. Invalid
// candidates are rejected with reasons; the last good frame stays on screen.
function applyCandidate(candidate, { persistChange = true } = {}) {
  const result = store.apply(candidate);
  if (!result.ok) {
    showError(result.errors);
    syncControls(); // snap controls back to the last good state
    return false;
  }
  state = store.getState();
  clearError();
  drawFrame();
  syncControls();
  if (persistChange) persist();
  return true;
}

function drawFrame() {
  render(ctx, scene, state);
}

const FIELDS = [
  ['azimuth', (s) => s.sun.azimuth, (s, v) => { s.sun.azimuth = v; }],
  ['elevation', (s) => s.sun.elevation, (s, v) => { s.sun.elevation = v; }],
  ['softness', (s) => s.shadows.softness, (s, v) => { s.shadows.softness = v; }],
  ['strength', (s) => s.shadows.strength, (s, v) => { s.shadows.strength = v; }],
  ['length', (s) => s.shadows.length, (s, v) => { s.shadows.length = v; }],
  ['zoom', (s) => s.view.zoom, (s, v) => { s.view.zoom = v; s.view.preset = 'manual'; }],
  ['panX', (s) => s.view.panX, (s, v) => { s.view.panX = v; s.view.preset = 'manual'; }],
  ['panY', (s) => s.view.panY, (s, v) => { s.view.panY = v; s.view.preset = 'manual'; }],
];

function syncControls() {
  for (const [id, get] of FIELDS) {
    const value = get(state);
    const slider = document.getElementById(id);
    const num = document.getElementById(`${id}Num`);
    if (slider) slider.value = String(value);
    if (num) num.value = String(Math.round(value * 100) / 100);
  }
  document.querySelectorAll('#layers input').forEach((box) => {
    box.checked = Boolean(state.layers[box.dataset.layer]);
  });
  document.getElementById('pauseBtn').textContent = state.paused ? '继续' : '暂停';
}

function bindControls() {
  for (const [id, , set] of FIELDS) {
    for (const el of [document.getElementById(id), document.getElementById(`${id}Num`)]) {
      if (!el) continue;
      el.addEventListener('input', () => {
        const candidate = cloneState(state);
        set(candidate, Number(el.value));
        applyCandidate(candidate);
      });
    }
  }
}

const LAYER_LABELS = {
  sky: '天空', sun: '太阳', ridges: '山脊', ridgeShadows: '山脊阴影',
  objectShadows: '物体阴影', terrainDetails: '植被岩石', labels: '标签', annotations: '读数',
};

const VIEW_PRESETS = {
  wide: { zoom: 1, panX: 0, panY: 0 },
  close: { zoom: 1.6, panX: -40, panY: -30 },
  peak: { zoom: 2.2, panX: -120, panY: -60 },
};

function bindLayers() {
  const host = document.getElementById('layers');
  for (const name of LAYER_ORDER) {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.dataset.layer = name;
    box.addEventListener('change', () => {
      const candidate = cloneState(state);
      candidate.layers[name] = box.checked;
      applyCandidate(candidate);
    });
    label.append(box, document.createTextNode(LAYER_LABELS[name] || name));
    host.append(label);
  }
}

function bindButtons() {
  document.querySelectorAll('#presets button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = VIEW_PRESETS[btn.dataset.preset];
      const candidate = cloneState(state);
      Object.assign(candidate.view, preset, { preset: btn.dataset.preset });
      applyCandidate(candidate);
    });
  });
  document.getElementById('pauseBtn').addEventListener('click', () => {
    const candidate = cloneState(state);
    candidate.paused = !candidate.paused;
    applyCandidate(candidate);
  });
  document.getElementById('saveBtn').addEventListener('click', () => {
    persist();
    setStatus(`已保存 · ${new Date().toLocaleTimeString()}`);
  });
  document.getElementById('resetBtn').addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY);
    applyCandidate(cloneState(DEFAULT_STATE));
    setStatus('已重置为默认参数');
  });
  document.getElementById('exportBtn').addEventListener('click', () => {
    canvas.toBlob((blob) => {
      if (!blob) { setStatus('导出失败'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `mountain-scene-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
      setStatus('已导出当前画面 PNG');
    }, 'image/png');
  });
}

// Slow sun drift while unpaused; pausing freezes the frame exactly.
let lastTick = 0;
function animate(now) {
  if (!state.paused && now - lastTick > 50) {
    lastTick = now;
    const candidate = cloneState(state);
    candidate.sun.azimuth = Math.max(-85, Math.min(85, candidate.sun.azimuth + 0.12));
    if (candidate.sun.azimuth >= 85) candidate.sun.azimuth = -85;
    applyCandidate(candidate, { persistChange: false });
  }
  requestAnimationFrame(animate);
}

bindLayers();
bindControls();
bindButtons();
syncControls();
// Wait for the CJK font so exported PNGs have correct labels.
(document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
  drawFrame();
  persist();
  setStatus(state.paused ? '已暂停' : '播放中');
  requestAnimationFrame(animate);
});
