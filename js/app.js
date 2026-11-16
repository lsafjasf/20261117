// UI wiring: view (zoom/pan), brush with wrap-around sync, layer toggles,
// persistence (localStorage), pause, screenshot, PNG export.
(function () {
  "use strict";
  const P = window.SaltParams;
  const R = window.SaltRender;

  const RENDER_RES = 256;
  const $ = (id) => document.getElementById(id);

  const mainCanvas = $("mainCanvas");
  const mainCtx = mainCanvas.getContext("2d");
  const previewCanvas = $("tilePreview");
  const previewCtx = previewCanvas.getContext("2d");
  const tileCanvas = document.createElement("canvas");
  tileCanvas.width = tileCanvas.height = RENDER_RES;
  const tileCtx = tileCanvas.getContext("2d");
  const errorBar = $("errorBar");
  const statusLine = $("statusLine");

  // ---- state ----
  let params = { ...P.DEFAULTS };
  let view = { ...P.DEFAULT_VIEW };
  let layers = { ...P.DEFAULT_LAYERS };
  let dabs = [];
  let brushFields = R.buildBrushFields([], R.BRUSH_FIELD_SIZE);
  let brushMode = "wet";
  let paused = false;
  let animate = false;
  let lightAngle = 0.9;
  let dirty = true;
  let hasGoodFrame = false;

  // ---- error handling: keep last good frame, never blank ----
  function showError(msg) {
    errorBar.textContent = "参数错误：" + msg + "（已保留上一张可用画面）";
    errorBar.hidden = false;
  }
  function clearError() { errorBar.hidden = true; }
  function setStatus(msg) { statusLine.textContent = msg; }

  // ---- rendering ----
  function renderTileNow() {
    let img;
    try {
      img = R.renderTile(params, brushFields, layers, RENDER_RES, RENDER_RES, { lightAngle });
    } catch (err) {
      showError(err.message);
      return; // keep previous frame on screen
    }
    clearError();
    tileCtx.putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
    hasGoodFrame = true;
    drawMain();
    drawPreview();
  }

  function drawMain() {
    if (!hasGoodFrame) return;
    const size = mainCanvas.width;
    const scale = view.zoom * size; // tile size in canvas px
    const ox = size / 2 - view.cx * scale;
    const oy = size / 2 - view.cy * scale;
    mainCtx.fillStyle = "#111";
    mainCtx.fillRect(0, 0, size, size);
    mainCtx.imageSmoothingEnabled = view.zoom < 3;
    const x0 = Math.floor(-ox / scale), y0 = Math.floor(-oy / scale);
    const x1 = Math.ceil((size - ox) / scale), y1 = Math.ceil((size - oy) / scale);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        mainCtx.drawImage(tileCanvas, ox + tx * scale, oy + ty * scale, scale, scale);
      }
    }
  }

  function drawPreview() {
    if (!hasGoodFrame) return;
    const size = previewCanvas.width;
    const t = size / 3;
    previewCtx.imageSmoothingEnabled = true;
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        previewCtx.drawImage(tileCanvas, x * t, y * t, t, t);
      }
    }
  }

  function scheduleRender() { dirty = true; }

  // ---- persistence ----
  let saveTimer = null;
  function saveNow() {
    const state = P.makeState(params, view, layers, dabs, { paused, animate });
    try {
      localStorage.setItem(P.STORAGE_KEY, P.serializeState(state));
      setStatus("已保存 " + new Date().toLocaleTimeString());
    } catch (err) {
      setStatus("保存失败: " + err.message);
    }
  }
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 300);
  }
  function loadState() {
    let raw = null;
    try { raw = localStorage.getItem(P.STORAGE_KEY); } catch { /* ignore */ }
    if (!raw) return;
    const state = P.deserializeState(raw);
    if (!state) { setStatus("本地存档损坏，已使用默认参数"); return; }
    params = state.params;
    view = state.view;
    layers = state.layers;
    dabs = state.dabs;
    paused = state.paused;
    animate = state.animate;
    brushFields = R.buildBrushFields(dabs, R.BRUSH_FIELD_SIZE);
    setStatus("已恢复上次状态（含笔刷 " + dabs.length + " 笔）");
  }

  // ---- UI sync ----
  const controls = {
    seed: $("pSeed"), crystalScale: $("pCrystal"), porosity: $("pPore"),
    wetness: $("pWet"), grain: $("pGrain"), relief: $("pRelief"),
    brushSize: $("pBrushSize"), brushStrength: $("pBrushStr"),
  };
  const outputs = {
    crystalScale: $("oCrystal"), porosity: $("oPore"), wetness: $("oWet"),
    grain: $("oGrain"), relief: $("oRelief"),
    brushSize: $("oBrushSize"), brushStrength: $("oBrushStr"),
  };

  function pushParamsToUI() {
    for (const [k, el] of Object.entries(controls)) el.value = params[k];
    for (const [k, el] of Object.entries(outputs)) el.textContent = params[k];
    for (const [k, id] of [["base", "lBase"], ["relief", "lRelief"], ["pores", "lPores"], ["wet", "lWet"]]) {
      $(id).checked = layers[k];
    }
    $("animate").checked = animate;
    $("btnPause").textContent = paused ? "继续" : "暂停";
    $("btnPause").classList.toggle("active", paused);
  }

  function readParamsFromUI() {
    const out = {};
    for (const [k, el] of Object.entries(controls)) out[k] = parseFloat(el.value);
    return out;
  }

  function applyParamsFromUI() {
    const candidate = readParamsFromUI();
    const check = P.validateParams(candidate);
    if (!check.ok) {
      showError(check.errors.join("；"));
      return;
    }
    params = check.value;
    for (const [k, el] of Object.entries(outputs)) el.textContent = params[k];
    scheduleRender();
    saveSoon();
  }

  // ---- pointer: brush (wrap-around) & pan ----
  function canvasToTile(evt) {
    const rect = mainCanvas.getBoundingClientRect();
    const px = (evt.clientX - rect.left) * (mainCanvas.width / rect.width);
    const py = (evt.clientY - rect.top) * (mainCanvas.height / rect.height);
    const scale = view.zoom * mainCanvas.width;
    return {
      u: (px - mainCanvas.width / 2) / scale + view.cx,
      v: (py - mainCanvas.height / 2) / scale + view.cy,
    };
  }

  let painting = false;
  let panning = false;
  let lastPan = null;

  function applyBrushAt(u, v) {
    const dab = {
      u: u - Math.floor(u),
      v: v - Math.floor(v),
      r: params.brushSize / 2 / RENDER_RES,
      s: params.brushStrength,
      mode: brushMode,
    };
    dabs.push(dab);
    if (dabs.length > 5000) dabs.shift();
    brushFields = R.buildBrushFields(dabs, R.BRUSH_FIELD_SIZE);
    scheduleRender();
    saveSoon();
  }

  mainCanvas.addEventListener("pointerdown", (evt) => {
    mainCanvas.setPointerCapture(evt.pointerId);
    if ($("panMode").checked || evt.button === 1) {
      panning = true;
      lastPan = { x: evt.clientX, y: evt.clientY };
    } else {
      painting = true;
      const { u, v } = canvasToTile(evt);
      applyBrushAt(u, v);
    }
  });

  mainCanvas.addEventListener("pointermove", (evt) => {
    if (panning && lastPan) {
      const rect = mainCanvas.getBoundingClientRect();
      const scale = view.zoom * rect.width;
      view.cx -= (evt.clientX - lastPan.x) / scale;
      view.cy -= (evt.clientY - lastPan.y) / scale;
      lastPan = { x: evt.clientX, y: evt.clientY };
      drawMain();
      saveSoon();
    } else if (painting) {
      const { u, v } = canvasToTile(evt);
      applyBrushAt(u, v);
    }
  });

  function endPointer() { painting = false; panning = false; lastPan = null; }
  mainCanvas.addEventListener("pointerup", endPointer);
  mainCanvas.addEventListener("pointercancel", endPointer);

  mainCanvas.addEventListener("wheel", (evt) => {
    evt.preventDefault();
    const factor = evt.deltaY < 0 ? 1.15 : 1 / 1.15;
    view.zoom = Math.min(16, Math.max(0.25, view.zoom * factor));
    drawMain();
    saveSoon();
  }, { passive: false });

  // ---- controls ----
  for (const el of Object.values(controls)) {
    el.addEventListener("input", applyParamsFromUI);
  }
  $("brushMode").addEventListener("change", (e) => { brushMode = e.target.value; });
  for (const [k, id] of [["base", "lBase"], ["relief", "lRelief"], ["pores", "lPores"], ["wet", "lWet"]]) {
    $(id).addEventListener("change", (e) => {
      layers[k] = e.target.checked;
      scheduleRender();
      saveSoon();
    });
  }

  $("btnPause").addEventListener("click", () => {
    paused = !paused;
    pushParamsToUI();
    saveSoon();
    setStatus(paused ? "已暂停动态光照" : "已继续");
  });

  $("animate").addEventListener("change", (e) => {
    animate = e.target.checked;
    saveSoon();
  });

  $("btnSave").addEventListener("click", saveNow);

  function download(canvas, name) {
    canvas.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, "image/png");
  }

  $("btnShot").addEventListener("click", () => download(mainCanvas, "rocksalt-view.png"));

  function exportPng(size) {
    try {
      const img = R.renderTile(params, brushFields, layers, size, size, { lightAngle });
      const c = document.createElement("canvas");
      c.width = c.height = size;
      c.getContext("2d").putImageData(new ImageData(img.data, size, size), 0, 0);
      download(c, `rocksalt-${size}.png`);
      setStatus(`已导出 ${size}×${size} PNG`);
    } catch (err) {
      showError(err.message);
    }
  }
  $("btnExport512").addEventListener("click", () => exportPng(512));
  $("btnExport1024").addEventListener("click", () => exportPng(1024));

  function applyPreset(preset) {
    const check = P.validateParams(preset);
    if (!check.ok) { showError(check.errors.join("；")); return; }
    params = check.value;
    pushParamsToUI();
    scheduleRender();
    saveSoon();
  }
  $("btnPresetDefault").addEventListener("click", () => applyPreset(P.PRESETS.default));
  $("btnPresetExtreme").addEventListener("click", () => applyPreset(P.PRESETS.extreme));
  $("btnResetBrush").addEventListener("click", () => {
    dabs = [];
    brushFields = R.buildBrushFields(dabs, R.BRUSH_FIELD_SIZE);
    scheduleRender();
    saveSoon();
    setStatus("笔刷已清空");
  });

  // ---- main loop ----
  function frame() {
    if (animate && !paused) {
      lightAngle += 0.015;
      dirty = true;
    }
    if (dirty) {
      dirty = false;
      renderTileNow();
    }
    requestAnimationFrame(frame);
  }

  // ---- init ----
  loadState();
  pushParamsToUI();
  renderTileNow();
  requestAnimationFrame(frame);
})();
