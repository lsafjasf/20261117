/* 浮雕地图浏览器端：状态管理、持久化、渲染调度、交互。 */
(function () {
  'use strict';
  var H = window.Hillshade;
  var STORE_KEY = 'reliefMapState.v1';
  var PRESET_KEY = 'reliefMapPresets.v1';

  var canvas = document.getElementById('map');
  var ctx = canvas.getContext('2d');
  var tooltip = document.getElementById('tooltip');
  var errorBox = document.getElementById('errorBox');
  var statusEl = document.getElementById('status');

  var state = H.clone(H.DEFAULTS);
  var lastGoodState = H.clone(state);
  var paused = false;
  var elevCache = null;
  var elevKey = '';
  var frameCanvas = document.createElement('canvas');
  var frameDirty = true;
  var frameKey = '';
  var rafId = null;
  var saveTimer = null;

  function getElevation() {
    var key = state.seed + ':' + state.size;
    if (key !== elevKey) {
      elevCache = H.generateElevation(state.seed, state.size);
      elevKey = key;
    }
    return elevCache;
  }

  function setStatus(msg) { statusEl.textContent = msg; }

  function showErrors(errors) {
    errorBox.style.display = 'block';
    errorBox.textContent = '参数错误（已保留上一张可用画面）：\n'
      + errors.map(function (e) { return '· ' + e.reason; }).join('\n');
  }

  function clearErrors() {
    errorBox.style.display = 'none';
    errorBox.textContent = '';
  }

  /* 应用候选状态：非法则报原因并保留上一张可用画面，绝不白屏。 */
  function applyState(candidate, source) {
    var errors = H.validateState(candidate);
    if (errors.length) {
      showErrors(errors);
      return false;
    }
    clearErrors();
    var nextKey = frameSignature(candidate);
    var viewOnly = nextKey === frameKey;
    state = candidate;
    lastGoodState = H.clone(candidate);
    if (viewOnly) {
      drawView(); /* 仅视角变化：不重算逐像素帧 */
    } else {
      frameDirty = true;
      render();
    }
    scheduleSave();
    setStatus('已更新（' + source + '） ' + new Date().toLocaleTimeString());
    return true;
  }

  function frameSignature(s) {
    return s.seed + '|' + s.size + '|' + JSON.stringify(s.params) + '|' + JSON.stringify(s.layers);
  }

  function render() {
    if (!frameDirty) return;
    var rgba = H.renderFrame(state, getElevation());
    frameKey = frameSignature(state);
    frameCanvas.width = state.size;
    frameCanvas.height = state.size;
    var img = new ImageData(new Uint8ClampedArray(rgba), state.size, state.size);
    frameCanvas.getContext('2d').putImageData(img, 0, 0);
    frameDirty = false;
    drawView();
  }

  function drawView() {
    var w = canvas.width, h = canvas.height;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#10151f';
    ctx.fillRect(0, 0, w, h);
    var tl = H.project(state.view, w, h, state.size, 0, 0);
    var span = state.size * state.view.zoom;
    ctx.drawImage(frameCanvas, tl.x, tl.y, span, span);
  }

  function resize() {
    var stage = document.getElementById('stage');
    canvas.width = stage.clientWidth;
    canvas.height = stage.clientHeight;
    drawView();
  }

  /* 持久化：每次变更防抖保存，刷新后恢复未保存状态。 */
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(STORE_KEY, H.serializeState(state)); } catch (e) { /* 忽略配额错误 */ }
    }, 200);
  }

  function restore() {
    var text = null;
    try { text = localStorage.getItem(STORE_KEY); } catch (e) { return; }
    if (!text) return;
    try {
      var restored = H.deserializeState(text);
      state = restored;
      lastGoodState = H.clone(restored);
      frameDirty = true;
      setStatus('已恢复上次状态');
    } catch (err) {
      showErrors([{ reason: '本地状态损坏，已回退默认参数：' + err.message }]);
    }
  }

  function getPresets() {
    try { return JSON.parse(localStorage.getItem(PRESET_KEY)) || {}; } catch (e) { return {}; }
  }

  function setPresets(p) {
    try { localStorage.setItem(PRESET_KEY, JSON.stringify(p)); } catch (e) { /* 忽略 */ }
  }

  function refreshPresetList() {
    var list = document.getElementById('presetList');
    list.innerHTML = '';
    var presets = getPresets();
    Object.keys(presets).forEach(function (name) {
      var row = document.createElement('div');
      row.className = 'preset';
      var label = document.createElement('span');
      label.textContent = name;
      var load = document.createElement('button');
      load.textContent = '载入';
      load.onclick = function () { applyState(H.clone(presets[name]), '预设 ' + name); syncInputs(); };
      var del = document.createElement('button');
      del.textContent = '删除';
      del.className = 'secondary';
      del.onclick = function () { delete presets[name]; setPresets(presets); refreshPresetList(); };
      row.appendChild(label); row.appendChild(load); row.appendChild(del);
      list.appendChild(row);
    });
  }

  /* ---- 控件绑定：滑块与数字框双向同步，数字框可输入任意值以触发校验 ---- */
  var FIELDS = [
    { id: 'azimuth', get: function (s) { return s.params.azimuth; }, set: function (s, v) { s.params.azimuth = v; } },
    { id: 'altitude', get: function (s) { return s.params.altitude; }, set: function (s, v) { s.params.altitude = v; } },
    { id: 'exaggeration', get: function (s) { return s.params.exaggeration; }, set: function (s, v) { s.params.exaggeration = v; } },
    { id: 'softness', get: function (s) { return s.params.softness; }, set: function (s, v) { s.params.softness = v; } },
    { id: 'zoom', get: function (s) { return s.view.zoom; }, set: function (s, v) { s.view.zoom = v; } },
    { id: 'panX', get: function (s) { return s.view.panX; }, set: function (s, v) { s.view.panX = v; } },
    { id: 'panY', get: function (s) { return s.view.panY; }, set: function (s, v) { s.view.panY = v; } }
  ];

  function bindField(f) {
    var slider = document.getElementById(f.id);
    var num = document.getElementById(f.id + 'Num');
    slider.addEventListener('input', function () {
      var c = H.clone(state);
      f.set(c, parseFloat(slider.value));
      if (applyState(c, f.id)) num.value = slider.value;
    });
    num.addEventListener('change', function () {
      var c = H.clone(state);
      f.set(c, parseFloat(num.value));
      if (applyState(c, f.id)) slider.value = num.value;
      else num.value = f.get(state); /* 非法输入回显上一次可用值 */
    });
  }
  FIELDS.forEach(bindField);

  function syncInputs() {
    FIELDS.forEach(function (f) {
      var v = f.get(state);
      document.getElementById(f.id).value = v;
      document.getElementById(f.id + 'Num').value = v;
    });
    document.getElementById('layerTint').checked = state.layers.tint;
    document.getElementById('layerShade').checked = state.layers.hillshade;
  }

  document.getElementById('layerTint').addEventListener('change', function (e) {
    var c = H.clone(state); c.layers.tint = e.target.checked; applyState(c, '图层');
  });
  document.getElementById('layerShade').addEventListener('change', function (e) {
    var c = H.clone(state); c.layers.hillshade = e.target.checked; applyState(c, '图层');
  });

  document.getElementById('resetView').addEventListener('click', function () {
    var c = H.clone(state); c.view = H.clone(H.DEFAULTS.view);
    applyState(c, '重置视角'); syncInputs();
  });
  document.getElementById('presetDefault').addEventListener('click', function () {
    applyState(H.clone(H.DEFAULTS), '默认画面'); syncInputs();
  });
  document.getElementById('presetExtreme').addEventListener('click', function () {
    applyState(H.clone(H.EXTREME), '极端画面'); syncInputs();
  });
  document.getElementById('savePreset').addEventListener('click', function () {
    var name = window.prompt('预设名称：', '我的参数 ' + new Date().toLocaleTimeString());
    if (!name) return;
    var presets = getPresets();
    presets[name] = H.clone(state);
    setPresets(presets);
    refreshPresetList();
  });

  /* ---- 暂停与光源旋转动画 ---- */
  var pauseBtn = document.getElementById('pauseBtn');
  var rotateBtn = document.getElementById('rotateBtn');
  function tick() {
    if (!paused && state.autoRotate) {
      var c = H.clone(state);
      c.params.azimuth = (c.params.azimuth + 0.5) % 360;
      state = c; lastGoodState = H.clone(c);
      frameDirty = true;
      render();
      syncInputs();
      scheduleSave();
    }
    rafId = requestAnimationFrame(tick);
  }
  pauseBtn.addEventListener('click', function () {
    paused = !paused;
    pauseBtn.textContent = paused ? '继续' : '暂停';
    pauseBtn.classList.toggle('active', paused);
    setStatus(paused ? '已暂停（画面冻结，参数仍可调整）' : '已继续');
  });
  rotateBtn.addEventListener('click', function () {
    var c = H.clone(state);
    c.autoRotate = !c.autoRotate;
    applyState(c, '旋转开关');
    rotateBtn.classList.toggle('active', state.autoRotate);
  });

  /* ---- 导出 PNG：按当前视角离屏合成后下载 ---- */
  document.getElementById('exportBtn').addEventListener('click', function () {
    var out = document.createElement('canvas');
    out.width = canvas.width; out.height = canvas.height;
    var octx = out.getContext('2d');
    octx.imageSmoothingEnabled = false;
    octx.fillStyle = '#10151f';
    octx.fillRect(0, 0, out.width, out.height);
    var tl = H.project(state.view, out.width, out.height, state.size, 0, 0);
    var span = state.size * state.view.zoom;
    octx.drawImage(frameCanvas, tl.x, tl.y, span, span);
    var a = document.createElement('a');
    a.download = 'relief_' + Date.now() + '.png';
    a.href = out.toDataURL('image/png');
    a.click();
    setStatus('已导出 PNG（' + out.width + '×' + out.height + '）');
  });

  /* ---- 悬停标高 + 拖拽平移 + 滚轮缩放 ---- */
  var dragging = false, dragStart = null;
  canvas.addEventListener('mousemove', function (e) {
    var rect = canvas.getBoundingClientRect();
    var sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    if (dragging && dragStart) {
      var c = H.clone(state);
      c.view.panX = dragStart.panX + (sx - dragStart.sx);
      c.view.panY = dragStart.panY + (sy - dragStart.sy);
      if (applyState(c, '拖拽')) syncInputs();
      return;
    }
    var w = H.unproject(state.view, canvas.width, canvas.height, state.size, sx, sy);
    var elev = H.sampleElevation(getElevation(), state.size, w.x, w.y);
    if (elev === null) { tooltip.style.display = 'none'; return; }
    tooltip.style.display = 'block';
    tooltip.style.left = (sx + 14) + 'px';
    tooltip.style.top = (sy + 10) + 'px';
    tooltip.textContent = '标高 ' + elev.toFixed(1) + ' m（栅格 ' + Math.round(w.x) + ', ' + Math.round(w.y) + '）';
  });
  canvas.addEventListener('mouseleave', function () { tooltip.style.display = 'none'; dragging = false; });
  canvas.addEventListener('mousedown', function (e) {
    var rect = canvas.getBoundingClientRect();
    dragging = true;
    dragStart = { sx: e.clientX - rect.left, sy: e.clientY - rect.top, panX: state.view.panX, panY: state.view.panY };
  });
  window.addEventListener('mouseup', function () { dragging = false; });
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    var c = H.clone(state);
    c.view.zoom = state.view.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15);
    if (applyState(c, '滚轮缩放')) syncInputs();
    else drawView(); /* 缩放越界：维持上一张可用画面 */
  }, { passive: false });

  /* ---- 初始化 ---- */
  restore();
  syncInputs();
  refreshPresetList();
  window.addEventListener('resize', resize);
  resize();
  render();
  tick();
})();
