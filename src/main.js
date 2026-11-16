import { createStore } from './state.js';
import { renderCanvas, serializeSVG } from './render.js';
import { parseEmbeddedState } from './svg-io.js';
import { MAX_TEXT_LENGTH } from './validation.js';

const canvas = document.querySelector('#canvas');
const ctx = canvas.getContext('2d');
const banner = document.querySelector('#error-banner');
const saveStatus = document.querySelector('#save-status');
const store = createStore(window.localStorage);

let renderRequested = true;
let dashOffset = 0;
let bannerTimer = 0;

const rangeKeys = ['fontSize', 'weight', 'slant', 'width', 'corner'];
const inputOf = (key) => document.querySelector(`#in-${key}`);
const outputOf = (key) => document.querySelector(`#out-${key}`);

function showError(reason) {
  banner.textContent = `参数未应用：${reason}（保留上一张可用画面）`;
  banner.classList.remove('hidden');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => banner.classList.add('hidden'), 4000);
}

function requestRender() {
  renderRequested = true;
}

function frame() {
  const state = store.getState();
  if (renderRequested) {
    const result = renderCanvas(ctx, state, state.view, {
      width: canvas.width,
      height: canvas.height
    }, state.paused ? null : state.selectedLayer, state.paused ? 0 : dashOffset);
    if (result && result.ok === false) showError(result.reason);
    renderRequested = false;
  }
  if (!state.paused) {
    dashOffset = (dashOffset + 0.4) % 10;
    requestRender();
  } else {
    dashOffset = 0;
  }
  requestAnimationFrame(frame);
}

function syncControls() {
  const state = store.getState();
  const layer = state.layers.find((item) => item.id === state.selectedLayer) || state.layers[0];
  document.querySelector('#in-name').value = layer.name;
  document.querySelector('#in-text').value = layer.text;
  document.querySelector('#in-color').value = layer.color;
  for (const key of rangeKeys) {
    inputOf(key).value = layer[key];
    outputOf(key).value = layer[key];
  }
  document.querySelector('#in-wrap').value = state.wrapWidth;
  document.querySelector('#out-wrap').value = state.wrapWidth;
  document.querySelector('#btn-pause').textContent = state.paused ? '继续' : '暂停';
  renderLayerList();
  requestRender();
}

function renderLayerList() {
  const state = store.getState();
  const list = document.querySelector('#layer-list');
  list.innerHTML = '';
  state.layers.forEach((layer, index) => {
    const item = document.createElement('li');
    item.className = layer.id === state.selectedLayer ? 'active' : '';
    item.innerHTML = `<span>${index + 1}. ${escapeHtml(layer.name)}</span>`;
    item.addEventListener('click', () => {
      store.applyScenePatch({ selectedLayer: layer.id });
      syncControls();
    });
    list.appendChild(item);
  });
}

function patchLayer(patch) {
  const state = store.getState();
  const layerId = state.selectedLayer || state.layers[0].id;
  const result = store.applyLayerUpdate(layerId, patch);
  if (!result.ok) {
    showError(result.reason);
    syncControls();
    return;
  }
  banner.classList.add('hidden');
  syncControls();
}

for (const key of rangeKeys) {
  inputOf(key).addEventListener('input', (event) => {
    const value = Number(event.target.value);
    outputOf(key).value = value;
    patchLayer({ [key]: value });
  });
}

document.querySelector('#in-text').addEventListener('input', (event) => {
  if (event.target.value.length > MAX_TEXT_LENGTH) {
    showError(`文本长度不能超过 ${MAX_TEXT_LENGTH} 字`);
    const active = store.getState().layers.find((l) => l.id === store.getState().selectedLayer)
      || store.getState().layers[0];
    event.target.value = active.text;
    return;
  }
  patchLayer({ text: event.target.value });
});
document.querySelector('#in-name').addEventListener('input', (e) => patchLayer({ name: e.target.value }));
document.querySelector('#in-color').addEventListener('input', (e) => patchLayer({ color: e.target.value }));
document.querySelector('#in-wrap').addEventListener('input', (event) => {
  const value = Number(event.target.value);
  document.querySelector('#out-wrap').value = value;
  const result = store.applyScenePatch({ wrapWidth: value });
  if (!result.ok) {
    showError(result.reason);
    document.querySelector('#in-wrap').value = store.getState().wrapWidth;
    document.querySelector('#out-wrap').value = store.getState().wrapWidth;
    return;
  }
  requestRender();
});

document.querySelector('#btn-add-layer').addEventListener('click', () => {
  store.addLayer();
  syncControls();
});
document.querySelector('#btn-up').addEventListener('click', () => {
  const result = store.moveLayer(store.getState().selectedLayer, -1);
  if (!result.ok) showError(result.reason);
  syncControls();
});
document.querySelector('#btn-down').addEventListener('click', () => {
  const result = store.moveLayer(store.getState().selectedLayer, 1);
  if (!result.ok) showError(result.reason);
  syncControls();
});
document.querySelector('#btn-delete').addEventListener('click', () => {
  const result = store.removeLayer(store.getState().selectedLayer);
  if (!result.ok) showError(result.reason);
  syncControls();
});

document.querySelector('#btn-pause').addEventListener('click', () => {
  const state = store.getState();
  store.applyScenePatch({ paused: !state.paused });
  syncControls();
});
document.querySelector('#btn-reset').addEventListener('click', () => {
  store.resetAll('default');
  syncControls();
});
document.querySelector('#btn-extreme').addEventListener('click', () => {
  store.resetAll('extreme');
  syncControls();
});
document.querySelector('#btn-save').addEventListener('click', () => {
  const snapshot = store.saveSnapshot('manual');
  saveStatus.textContent = `已保存 ${snapshot.savedAt.slice(11, 19)}`;
});
document.querySelector('#btn-svg').addEventListener('click', () => {
  const state = store.getState();
  const { svg } = serializeSVG(state, state.view, { width: canvas.width, height: canvas.height });
  download(new Blob([svg], { type: 'image/svg+xml' }), 'typo-studio.svg');
});
document.querySelector('#btn-import').addEventListener('click', () => {
  document.querySelector('#file-svg').click();
});
document.querySelector('#file-svg').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const text = await file.text();
  const parsed = parseEmbeddedState(text);
  if (!parsed.ok) {
    showError(parsed.reason);
    return;
  }
  const result = store.applyScenePatch({
    ...parsed.scene,
    view: parsed.view || parsed.scene.view
  });
  if (!result.ok) showError(result.reason);
  syncControls();
  event.target.value = '';
});
document.querySelector('#btn-shot').addEventListener('click', () => {
  const state = store.getState();
  const result = renderCanvas(ctx, state, state.view, {
    width: canvas.width,
    height: canvas.height
  }, null);
  if (result.ok === false) {
    showError(result.reason);
    return;
  }
  canvas.toBlob((blob) => download(blob, 'typo-studio.png'), 'image/png');
  requestRender();
});

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let dragging = null;
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  const view = store.getState().view;
  const zoom = Math.min(4, Math.max(0.2, view.zoom * (event.deltaY > 0 ? 0.92 : 1.08)));
  store.applyScenePatch({ view: { ...view, zoom } });
  requestRender();
}, { passive: false });

canvas.addEventListener('pointerdown', (event) => {
  dragging = { x: event.clientX, y: event.clientY, shift: event.shiftKey };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  const view = { ...store.getState().view };
  if (dragging.shift) {
    view.rotation = Math.max(-180, Math.min(180, view.rotation + (event.movementX || 0)));
  } else {
    view.panX += event.movementX || 0;
    view.panY += event.movementY || 0;
  }
  store.applyScenePatch({ view });
  requestRender();
});
canvas.addEventListener('pointerup', () => {
  dragging = null;
});

function escapeHtml(text) {
  return String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

const restore = store.restore();
if (!restore.restored && restore.reason) showError(`存档损坏：${restore.reason}`);
syncControls();
frame();

export { showError, requestRender };
