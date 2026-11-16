// Main app: canvas rendering, view/layer/param state, persistence,
// pause, screenshot, SVG export, error handling with last-valid frame.

import { buildHeightField } from './noise.js';
import { buildContours } from './contours.js';
import { placeLabels } from './labels.js';
import {
  SCHEMA, PRESETS, defaultState, validateParams,
  loadState, saveState,
} from './state.js';
import { exportSVG } from './svg.js';

const WORLD = { x: 0, y: 0, w: 800, h: 600 };
const GRID_COLS = 240;
const GRID_ROWS = 180;

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const errorBox = document.getElementById('error-box');
const statsBox = document.getElementById('stats');

// ---- state ----------------------------------------------------------------
// `state` is the last VALID applied state; invalid edits never touch it,
// so the previous good frame stays on screen.
let state = loadState(window.localStorage);
let field = null;
let fieldSeed = null;
let lines = [];
let labels = [];
let terrainCanvas = null;
let dashOffset = 0;
let rafId = null;

function persist() {
  saveState(window.localStorage, state);
}

// ---- pipeline ---------------------------------------------------------------
function ensureField() {
  if (!field || fieldSeed !== state.params.seed) {
    field = buildHeightField(state.params.seed, GRID_COLS, GRID_ROWS, WORLD);
    fieldSeed = state.params.seed;
    terrainCanvas = null;
  }
}

function recompute() {
  ensureField();
  lines = buildContours(field, state.params.interval, state.params.smoothness);
  labels = placeLabels(lines, state.params.labelDensity, WORLD);
  updateStats();
}

function updateStats() {
  const pts = lines.reduce((n, l) => n + l.points.length, 0);
  statsBox.textContent =
    `等高线: ${lines.length} 条\n顶点: ${pts}\n标注: ${labels.length} 个\n` +
    `视角: x=${state.view.x.toFixed(0)} y=${state.view.y.toFixed(0)} ` +
    `缩放=${state.view.scale.toFixed(2)}${state.paused ? '\n已暂停' : ''}`;
}
// ---- terrain colour layer (cached offscreen) -------------------------------
function terrainColor(t) {
  // hypsometric tint: lowland green -> brown -> white
  const stops = [
    [0.0, [226, 232, 200]],
    [0.35, [205, 214, 165]],
    [0.6, [196, 183, 138]],
    [0.8, [178, 150, 110]],
    [1.0, [240, 238, 232]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const k = (t - t0) / (t1 - t0);
      return `rgb(${Math.round(c0[0] + (c1[0] - c0[0]) * k)},` +
        `${Math.round(c0[1] + (c1[1] - c0[1]) * k)},` +
        `${Math.round(c0[2] + (c1[2] - c0[2]) * k)})`;
    }
  }
  return 'rgb(240,238,232)';
}

function renderTerrainLayer() {
  if (terrainCanvas) return terrainCanvas;
  const off = document.createElement('canvas');
  off.width = GRID_COLS;
  off.height = GRID_ROWS;
  const octx = off.getContext('2d');
  const range = field.max - field.min || 1;
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      const t = (field.data[r * GRID_COLS + c] - field.min) / range;
      octx.fillStyle = terrainColor(t);
      octx.fillRect(c, r, 1, 1);
    }
  }
  terrainCanvas = off;
  return off;
}

// ---- render ------------------------------------------------------------------
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
}

function applyViewTransform() {
  const dpr = window.devicePixelRatio || 1;
  const fit = Math.min(canvas.width / WORLD.w, canvas.height / WORLD.h);
  const s = fit * state.view.scale;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  ctx.setTransform(
    s, 0, 0, s,
    canvas.width / 2 - (WORLD.x + WORLD.w / 2) * s + state.view.x * dpr,
    canvas.height / 2 - (WORLD.y + WORLD.h / 2) * s + state.view.y * dpr
  );
  return s;
}

function render() {
  const s = applyViewTransform();
  if (state.layers.terrain) {
    const off = renderTerrainLayer();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, WORLD.x, WORLD.y, WORLD.w, WORLD.h);
  } else {
    ctx.fillStyle = '#f4efe4';
    ctx.fillRect(WORLD.x, WORLD.y, WORLD.w, WORLD.h);
  }
  if (state.layers.contours) {
    ctx.strokeStyle = '#8a5a2b';
    ctx.lineWidth = 1.1 / s;
    ctx.setLineDash([6 / s, 4 / s]);
    ctx.lineDashOffset = dashOffset / s;
    ctx.beginPath();
    for (const line of lines) {
      const pts = line.points;
      if (!pts.length) continue;
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      if (line.closed) ctx.closePath();
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (state.layers.labels) {
    const fs = 12 / s;
    ctx.font = `${fs}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const lb of labels) {
      ctx.save();
      ctx.translate(lb.x, lb.y);
      ctx.rotate(lb.angle);
      ctx.fillStyle = '#f4efe4';
      const w = ctx.measureText(lb.text).width + fs * 0.4;
      ctx.fillRect(-w / 2, -fs * 0.55, w, fs * 1.1);
      ctx.fillStyle = '#5a3a1b';
      ctx.fillText(lb.text, 0, 0);
      ctx.restore();
    }
  }
}
// ---- animation loop (pause stops it; last frame stays) ----------------------
function tick() {
  if (!state.paused) {
    dashOffset -= 0.35;
    render();
    rafId = requestAnimationFrame(tick);
  } else {
    rafId = null;
  }
}

function startLoop() {
  if (rafId === null) rafId = requestAnimationFrame(tick);
}

function setPaused(paused) {
  state.paused = paused;
  document.getElementById('btn-pause').textContent = paused ? '继续' : '暂停';
  document.getElementById('btn-pause').classList.toggle('active', paused);
  persist();
  updateStats();
  if (paused) {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    render(); // keep last valid frame visible
  } else {
    startLoop();
  }
}

// ---- interaction: pan & zoom -------------------------------------------------
function bindView() {
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    state.view.x += e.clientX - drag.x;
    state.view.y += e.clientY - drag.y;
    drag = { x: e.clientX, y: e.clientY };
    persist();
    updateStats();
    if (state.paused) render();
  });
  canvas.addEventListener('pointerup', () => {
    drag = null;
    canvas.classList.remove('dragging');
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    state.view.scale = Math.min(20, Math.max(0.1, state.view.scale * factor));
    persist();
    updateStats();
    if (state.paused) render();
  }, { passive: false });
}

// ---- params UI -----------------------------------------------------------------
function readParamsFromInputs() {
  return {
    seed: document.getElementById('p-seed').value,
    interval: document.getElementById('p-interval').value,
    smoothness: document.getElementById('p-smoothness').value,
    labelDensity: document.getElementById('p-labelDensity').value,
  };
}

function writeParamsToInputs(params) {
  document.getElementById('p-seed').value = params.seed;
  document.getElementById('p-interval').value = params.interval;
  document.getElementById('p-smoothness').value = params.smoothness;
  document.getElementById('p-labelDensity').value = params.labelDensity;
}

function showErrors(errors) {
  if (!errors.length) {
    errorBox.classList.add('hidden');
    errorBox.textContent = '';
  } else {
    errorBox.classList.remove('hidden');
    errorBox.textContent =
      '参数无效, 已保留上一张可用画面:\n' + errors.map((e) => '• ' + e).join('\n');
  }
}

// Apply params: invalid input shows reasons and keeps the last valid frame.
function applyParams(raw) {
  const v = validateParams(raw);
  if (!v.ok) {
    showErrors(v.errors);
    return false;
  }
  showErrors([]);
  state.params = v.params;
  persist();
  recompute();
  if (state.paused) render();
  return true;
}

function applyPreset(name) {
  const p = PRESETS[name];
  state.params = { ...p.params };
  state.view = { ...p.view };
  state.layers = { ...p.layers };
  writeParamsToInputs(state.params);
  syncLayerInputs();
  showErrors([]);
  persist();
  recompute();
  if (state.paused) render();
}
// ---- layers / export / screenshot ---------------------------------------------
function syncLayerInputs() {
  document.getElementById('layer-terrain').checked = state.layers.terrain;
  document.getElementById('layer-contours').checked = state.layers.contours;
  document.getElementById('layer-labels').checked = state.layers.labels;
}

function bindLayers() {
  for (const key of ['terrain', 'contours', 'labels']) {
    document.getElementById('layer-' + key).addEventListener('change', (e) => {
      state.layers[key] = e.target.checked;
      persist();
      if (state.paused) render();
    });
  }
}

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function screenshot() {
  render(); // guarantee the exported bitmap matches the current frame
  canvas.toBlob((blob) => {
    if (blob) download(blob, 'contours.png');
  }, 'image/png');
}

function exportSvgFile() {
  const svg = exportSVG({
    world: WORLD,
    lines,
    labels,
    layers: state.layers,
  });
  download(new Blob([svg], { type: 'image/svg+xml' }), 'contours.svg');
}

// ---- wiring ---------------------------------------------------------------------
function bindControls() {
  document.getElementById('btn-apply').addEventListener('click', () => {
    applyParams(readParamsFromInputs());
  });
  document.getElementById('btn-save').addEventListener('click', () => {
    if (applyParams(readParamsFromInputs())) {
      persist();
      const btn = document.getElementById('btn-save');
      btn.textContent = '已保存 ✓';
      setTimeout(() => { btn.textContent = '保存参数'; }, 1200);
    }
  });
  document.getElementById('btn-preset-default').addEventListener('click', () => applyPreset('default'));
  document.getElementById('btn-preset-extreme').addEventListener('click', () => applyPreset('extreme'));
  document.getElementById('btn-pause').addEventListener('click', () => setPaused(!state.paused));
  document.getElementById('btn-reset-view').addEventListener('click', () => {
    state.view = { x: 0, y: 0, scale: 1 };
    persist();
    updateStats();
    if (state.paused) render();
  });
  document.getElementById('btn-shot').addEventListener('click', screenshot);
  document.getElementById('btn-svg').addEventListener('click', exportSvgFile);
  window.addEventListener('resize', () => {
    resizeCanvas();
    if (state.paused) render();
  });
}

// ---- boot --------------------------------------------------------------------------
function boot() {
  resizeCanvas();
  writeParamsToInputs(state.params);
  syncLayerInputs();
  document.getElementById('btn-pause').textContent = state.paused ? '继续' : '暂停';
  bindView();
  bindLayers();
  bindControls();
  recompute();
  if (state.paused) render();
  else startLoop();
}

boot();
