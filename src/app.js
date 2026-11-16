import {
  DEFAULT_SEED,
  DEFAULT_STATE,
  SAVED_KEY,
  SEASON_LABELS,
  STORAGE_KEY,
  SceneValidationError,
  cloneDefaultState,
  createScene,
  formatCount,
  mergeState,
  nearestPathPoint,
  validateState
} from "./scene.js";
import { PlazaRenderer } from "./renderer.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const canvas = $("#scene");
const renderer = new PlazaRenderer(canvas);
const elements = {
  saveDot: $("#save-dot"),
  saveStatus: $("#save-status"),
  savePreset: $("#save-preset"),
  pauseButton: $("#pause-button"),
  pauseLabel: $("#pause-label"),
  pausedStamp: $("#paused-stamp"),
  exportButton: $("#export-button"),
  angleRange: $("#angle-range"),
  angleValue: $("#angle-value"),
  zoomRange: $("#zoom-range"),
  zoomHud: $("#zoom-hud"),
  resetView: $("#reset-view"),
  seasonNote: $("#season-note"),
  plantTotal: $("#plant-total"),
  seedInput: $("#seed-input"),
  applySeed: $("#apply-seed"),
  benchX: $("#bench-x"),
  benchZ: $("#bench-z"),
  benchRotation: $("#bench-rotation"),
  benchNote: $("#bench-note"),
  layerSummary: $("#layer-summary"),
  objectCount: $("#object-count"),
  jsonEditor: $("#json-editor"),
  loadJson: $("#load-json"),
  resetAll: $("#reset-all"),
  errorBanner: $("#error-banner"),
  errorMessage: $("#error-message"),
  dismissError: $("#dismiss-error"),
  toast: $("#toast"),
  captionSeason: $("#caption-season"),
  captionSeed: $("#caption-seed")
};

const SEASON_NOTES = {
  spring: "新芽与初花",
  summer: "浓荫与盛花",
  autumn: "暖叶与果色",
  winter: "霜白与静枝"
};

let state;
let scene;
let selectedBenchId = DEFAULT_STATE.benches[0].id;
let needsRender = true;
let drag = null;
let toastTimer = null;
let saveTimer = null;
let lastFrame = 0;
let initialWarning = null;

function loadInitialState() {
  const keys = [
    { key: STORAGE_KEY, label: "草稿" },
    { key: SAVED_KEY, label: "已保存方案" }
  ];
  for (const item of keys) {
    const raw = readStorage(item.key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const candidate = parsed?.state ?? parsed;
      const result = sanitizeForLoad(candidate);
      if (result.error) {
        initialWarning ??= `${item.label}恢复失败：${result.error}。已尝试更早的有效记录。`;
        continue;
      }
      return result.state;
    } catch {
      initialWarning ??= `${item.label}存档不是有效 JSON，已尝试更早的有效记录。`;
    }
  }
  return cloneDefaultState();
}

function sanitizeForLoad(value) {
  try {
    return { state: validateState(mergeState(DEFAULT_STATE, value)), error: null };
  } catch (error) {
    return {
      state: cloneDefaultState(),
      error: error instanceof SceneValidationError ? error.message : "存档格式损坏"
    };
  }
}

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    showToast("浏览器存储不可用，刷新后可能无法恢复草稿");
    return false;
  }
}

function currentBench() {
  return state.benches.find((bench) => bench.id === selectedBenchId) || state.benches[0];
}

function setStateCandidate(candidate, options = {}) {
  let validated;
  let nextScene = scene;
  try {
    validated = validateState(candidate);
    if (!scene || validated.seed !== state.seed) nextScene = createScene(validated.seed);
  } catch (error) {
    showError(error);
    syncUI();
    return false;
  }
  state = validated;
  scene = nextScene;
  if (!state.benches.some((bench) => bench.id === selectedBenchId)) selectedBenchId = state.benches[0].id;
  renderer.setData({ scene, state, selectedBench: selectedBenchId });
  dismissError();
  syncUI();
  scheduleDraftSave();
  needsRender = true;
  if (options.toast) showToast(options.toast);
  return true;
}

function patchState(patch, options) {
  return setStateCandidate(mergeState(state, patch), options);
}

function scheduleDraftSave() {
  clearTimeout(saveTimer);
  elements.saveDot.classList.add("is-saving");
  elements.saveStatus.textContent = "正在保存草稿";
  saveTimer = setTimeout(saveDraftNow, 120);
}

function saveDraftNow() {
  clearTimeout(saveTimer);
  const payload = JSON.stringify({ state, savedAt: new Date().toISOString() });
  if (writeStorage(STORAGE_KEY, payload)) {
    elements.saveDot.classList.remove("is-saving");
    elements.saveStatus.textContent = "草稿已自动保存";
  }
}

function showError(error) {
  const message = error instanceof SceneValidationError
    ? error.message
    : error instanceof SyntaxError
      ? `JSON 解析失败：${error.message}`
      : String(error?.message || error || "未知参数错误");
  elements.errorMessage.textContent = message;
  elements.errorBanner.hidden = false;
}

function dismissError() {
  elements.errorBanner.hidden = true;
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  toastTimer = setTimeout(() => {
    elements.toast.hidden = true;
  }, 2600);
}

function syncUI() {
  const angle = Math.round(state.view.angle);
  elements.angleRange.value = angle;
  elements.angleValue.textContent = `${angle > 0 ? "+" : ""}${angle}°`;
  elements.zoomRange.value = state.view.zoom;
  elements.zoomHud.textContent = `${Math.round(state.view.zoom * 100)}%`;
  elements.seedInput.value = state.seed;
  elements.plantTotal.textContent = `${formatCount(scene.plantCount)} 株`;
  elements.captionSeed.textContent = `SEED ${state.seed}`;
  elements.captionSeason.textContent = `${SEASON_LABELS[state.season]} · ${state.season.toUpperCase()}`;
  elements.seasonNote.textContent = SEASON_NOTES[state.season];

  for (const button of $$(".season-button")) {
    const active = button.dataset.season === state.season;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }

  for (const checkbox of $$("[data-layer]")) {
    checkbox.checked = state.layers[checkbox.dataset.layer];
  }
  const visibleLayers = Object.values(state.layers).filter(Boolean).length;
  elements.layerSummary.textContent = `${visibleLayers} / 6 可见`;

  const bench = currentBench();
  for (const tab of $$(".bench-tab")) tab.classList.toggle("is-active", tab.dataset.bench === bench.id);
  elements.benchX.value = bench.x.toFixed(1);
  elements.benchZ.value = bench.z.toFixed(1);
  elements.benchRotation.value = String(bench.rotation);
  elements.benchNote.textContent = isVerticalBench(bench) ? "长椅 A/B 沿南北步道移动。" : "长椅 C 沿东西步道移动。";
  elements.objectCount.textContent = `4 花坛 · ${state.benches.length} 长椅 · ${formatCount(scene.plantCount)} 植物`;

  elements.pauseButton.classList.toggle("is-paused", state.paused);
  elements.pauseButton.setAttribute("aria-pressed", String(state.paused));
  elements.pauseLabel.textContent = state.paused ? "继续" : "暂停";
  elements.pausedStamp.hidden = !state.paused;
  elements.jsonEditor.value = JSON.stringify(state, null, 2);
}

function isVerticalBench(bench) {
  return Math.abs(bench.z) >= Math.abs(bench.x);
}

function plantFingerprint() {
  const source = scene.beds
    .flatMap((bed) => bed.plants.map((plant) => `${plant.id}:${plant.x}:${plant.z}:${plant.height}:${plant.tone}`))
    .join("|");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function updateSelectedBench(id) {
  if (!state.benches.some((bench) => bench.id === id)) return;
  selectedBenchId = id;
  renderer.setData({ scene, state, selectedBench: selectedBenchId });
  syncUI();
  needsRender = true;
}

function moveBench(id, rawX, rawZ) {
  const point = nearestPathPoint(Number(rawX), Number(rawZ));
  const candidate = mergeState(state, {
    benches: state.benches.map((bench) => bench.id === id ? { ...bench, x: point.x, z: point.z } : bench)
  });
  if (!setStateCandidate(candidate)) return false;
  const bench = candidate.benches.find((item) => item.id === id);
  elements.benchX.value = bench.x.toFixed(1);
  elements.benchZ.value = bench.z.toFixed(1);
  elements.benchNote.textContent = "已吸附到步道中心线，花坛与步道保持无碰撞。";
  return true;
}

function rotateView(nextAngle) {
  let angle = nextAngle;
  while (angle > 180) angle -= 360;
  while (angle < -180) angle += 360;
  patchState({ view: { ...state.view, angle: Math.round(angle) } });
}

async function exportPNG() {
  try {
    const exportCanvas = renderer.renderExport();
    const blob = await new Promise((resolve, reject) => {
      exportCanvas.toBlob((result) => result ? resolve(result) : reject(new Error("浏览器未能编码 PNG")), "image/png");
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `xiaoman-plaza-${state.season}-seed-${state.seed}.png`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast(`PNG 已导出 · ${exportCanvas.width} × ${exportCanvas.height}`);
  } catch (error) {
    showError(new Error(`导出失败：${error.message}。当前画面未受影响。`));
  }
}

function applyJson() {
  try {
    const parsed = JSON.parse(elements.jsonEditor.value);
    const candidate = parsed?.state ?? parsed;
    setStateCandidate(mergeState(DEFAULT_STATE, candidate), { toast: "参数校验通过，场景已更新" });
  } catch (error) {
    showError(error instanceof SyntaxError ? error : new Error(error.message));
  }
}

function savePreset() {
  saveDraftNow();
  const payload = JSON.stringify({ state, savedAt: new Date().toISOString() });
  if (writeStorage(SAVED_KEY, payload)) {
    elements.saveStatus.textContent = "方案已保存到本机";
    showToast("视角、图层与全部参数已保存");
  }
}

function bindEvents() {
  for (const button of $$(".season-button")) {
    button.addEventListener("click", () => {
      patchState({ season: button.dataset.season });
    });
  }

  elements.angleRange.addEventListener("input", () => {
    rotateView(Number(elements.angleRange.value));
  });
  elements.zoomRange.addEventListener("input", () => {
    patchState({ view: { ...state.view, zoom: Number(elements.zoomRange.value) } });
  });
  elements.resetView.addEventListener("click", () => {
    patchState({ view: { angle: 0, zoom: 1 } }, { toast: "视角与缩放已复位" });
  });

  for (const tab of $$(".bench-tab")) {
    tab.addEventListener("click", () => updateSelectedBench(tab.dataset.bench));
  }
  for (const input of [elements.benchX, elements.benchZ]) {
    input.addEventListener("change", () => {
      if (!moveBench(selectedBenchId, elements.benchX.value, elements.benchZ.value)) {
        syncUI();
      }
    });
  }
  elements.benchRotation.addEventListener("change", () => {
    const bench = currentBench();
    patchState({
      benches: state.benches.map((item) => item.id === bench.id
        ? { ...item, rotation: Number(elements.benchRotation.value) }
        : item)
    });
  });

  elements.applySeed.addEventListener("click", applySeed);
  elements.seedInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") applySeed();
  });

  for (const checkbox of $$("[data-layer]")) {
    checkbox.addEventListener("change", () => {
      patchState({
        layers: { ...state.layers, [checkbox.dataset.layer]: checkbox.checked }
      });
    });
  }

  elements.pauseButton.addEventListener("click", () => {
    patchState({ paused: !state.paused }, {
      toast: state.paused ? "环境动画已暂停，画面仍可编辑" : "环境动画继续"
    });
  });
  elements.savePreset.addEventListener("click", savePreset);
  elements.exportButton.addEventListener("click", exportPNG);
  elements.loadJson.addEventListener("click", applyJson);
  elements.dismissError.addEventListener("click", dismissError);
  elements.resetAll.addEventListener("click", () => {
    selectedBenchId = DEFAULT_STATE.benches[0].id;
    if (setStateCandidate(cloneDefaultState(), { toast: "已恢复默认广场" })) {
      elements.jsonEditor.value = JSON.stringify(state, null, 2);
    }
  });
  elements.toast.addEventListener("click", () => {
    elements.toast.hidden = true;
  });

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  window.addEventListener("beforeunload", saveDraftNow);
  window.addEventListener("pagehide", saveDraftNow);
  window.addEventListener("resize", () => {
    needsRender = true;
  });
}

function applySeed() {
  const seed = Number(elements.seedInput.value);
  if (!Number.isInteger(seed)) {
    showError(new SceneValidationError(["seed 必须是 1–4294967295 之间的整数"]));
    elements.seedInput.value = state.seed;
    return;
  }
  setStateCandidate(mergeState(state, { seed }), { toast: `花坛排布已按 Seed ${seed} 重新生成` });
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function onPointerDown(event) {
  if (event.button !== 0) return;
  const point = canvasPoint(event);
  const bench = renderer.hitBench(point.x, point.y);
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add("is-dragging");
  if (bench) {
    updateSelectedBench(bench.id);
    const world = renderer.screenToWorld(point.x, point.y);
    drag = {
      kind: "bench",
      pointerId: event.pointerId,
      id: bench.id,
      offsetX: world.x - bench.x,
      offsetZ: world.z - bench.z
    };
  } else {
    drag = {
      kind: "rotate",
      pointerId: event.pointerId,
      startX: event.clientX,
      startAngle: state.view.angle
    };
  }
  event.preventDefault();
}

function onPointerMove(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (drag.kind === "bench") {
    const point = canvasPoint(event);
    const world = renderer.screenToWorld(point.x, point.y);
    moveBench(drag.id, world.x - drag.offsetX, world.z - drag.offsetZ);
  } else {
    const delta = event.clientX - drag.startX;
    if (Math.abs(delta) > 1) rotateView(drag.startAngle + delta * 0.42);
  }
  event.preventDefault();
}

function onPointerUp(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag = null;
  canvas.classList.remove("is-dragging");
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
}

function onWheel(event) {
  event.preventDefault();
  const step = event.deltaY > 0 ? -0.04 : 0.04;
  const zoom = Math.min(1.45, Math.max(0.65, Math.round((state.view.zoom + step) * 100) / 100));
  if (zoom !== state.view.zoom) patchState({ view: { ...state.view, zoom } });
}

function frame(now) {
  if (!state.paused || needsRender) {
    renderer.draw(now);
    needsRender = false;
  }
  lastFrame = now;
  requestAnimationFrame(frame);
}

function exposeDebugApi() {
  window.__plaza = {
    getState: () => structuredClone(state),
    getDiagnostics: () => ({
      seed: state.seed,
      season: state.season,
      view: structuredClone(state.view),
      paused: state.paused,
      layers: structuredClone(state.layers),
      benches: structuredClone(state.benches),
      plantCount: scene.plantCount,
      plantFingerprint: plantFingerprint(),
      bedCount: scene.beds.length,
      plantSample: scene.beds.map((bed) => ({
        id: bed.id,
        count: bed.plants.length,
        first: { ...bed.plants[0] },
        last: { ...bed.plants[bed.plants.length - 1] }
      })),
      canvas: { width: canvas.width, height: canvas.height },
      storageKeys: { draft: STORAGE_KEY, saved: SAVED_KEY }
    }),
    setState: (next) => {
      const ok = setStateCandidate(mergeState(DEFAULT_STATE, next));
      return {
        ok,
        state: structuredClone(state),
        error: ok ? null : elements.errorMessage.textContent
      };
    },
    setSeason: (season) => {
      const ok = setStateCandidate(mergeState(state, { season }));
      return { ok, state: structuredClone(state) };
    },
    setView: (angle, zoom = state.view.zoom) => {
      const ok = setStateCandidate(mergeState(state, { view: { angle, zoom } }));
      return { ok, state: structuredClone(state) };
    },
    moveBench: (id, x, z) => {
      const ok = moveBench(id, x, z);
      return { ok, state: structuredClone(state) };
    },
    redraw: () => {
      needsRender = true;
      renderer.draw(performance.now());
    },
    renderTrace: () => {
      const trace = [];
      renderer.trace = trace;
      renderer.draw(performance.now());
      renderer.trace = null;
      return trace;
    },
    getObjectOrder: () => renderer.lastObjectOrder.map((item) => ({ ...item })),
    projectPoint: (x, z, y = 0) => {
      const point = renderer.project(x, z, y, renderer.lastCamera);
      return { x: point.x, y: point.y, depth: point.depth };
    },
    canvasSnapshot: () => canvas.toDataURL("image/png"),
    exportDataURL: () => renderer.renderExport().toDataURL("image/png")
  };
}

function init() {
  state = loadInitialState();
  try {
    scene = createScene(state.seed);
  } catch (error) {
    state = cloneDefaultState();
    scene = createScene(state.seed);
    initialWarning = `场景生成失败：${error.message}。已载入默认画面。`;
  }
  selectedBenchId = state.benches[0].id;
  renderer.setData({ scene, state, selectedBench: selectedBenchId });
  bindEvents();
  syncUI();
  scheduleDraftSave();
  canvas.tabIndex = 0;
  exposeDebugApi();
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      needsRender = true;
    });
  }
  if (initialWarning) setTimeout(() => showError(new Error(initialWarning)), 80);
  needsRender = true;
  requestAnimationFrame(frame);
}

init();
