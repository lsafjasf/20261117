/* DOM wiring: sliders, buttons, banners, downloads and autosave recovery. */
(function () {
  'use strict';
  var T = window.TeaCup;
  var canvas = document.getElementById('view');
  var app = T.createApp(canvas);
  var banner = document.getElementById('errorBanner');
  var statusLine = document.getElementById('statusLine');
  var sliderBox = document.getElementById('sliders');
  var LIMITS = T.params.LIMITS;

  function showBanner(text) {
    if (!text) { banner.classList.add('hidden'); banner.textContent = ''; }
    else { banner.textContent = text; banner.classList.remove('hidden'); }
  }

  function refreshSliders() {
    var p = app.getState().params;
    Object.keys(LIMITS).forEach(function (key) {
      var input = document.getElementById('in_' + key);
      var out = document.getElementById('val_' + key);
      if (input) input.value = p[key];
      if (out) out.textContent = p[key];
    });
  }

  function buildSliders() {
    var p = app.getState().params;
    Object.keys(LIMITS).forEach(function (key) {
      var spec = LIMITS[key];
      var row = document.createElement('label');
      row.className = 'slider-row';
      row.innerHTML = spec.label +
        ' <input type="range" id="in_' + key + '" min="' + spec.min +
        '" max="' + spec.max + '" step="' +
        (spec.integer ? 1 : 0.01) + '" value="' + p[key] + '">' +
        '<span id="val_' + key + '">' + p[key] + '</span>' +
        '<input type="text" id="raw_' + key + '" class="raw-input" value="' +
        p[key] + '">';
      sliderBox.appendChild(row);
      row.querySelector('input[type=range]').addEventListener('input',
        function (e) {
          applyParam(key, e.target.value);
        });
      row.querySelector('.raw-input').addEventListener('change',
        function (e) {
          applyParam(key, e.target.value);
        });
    });
  }

  function applyParam(key, raw) {
    var candidate = T.params.clone(app.getState().params);
    candidate[key] = raw;
    var ok = app.rebuild(candidate);
    showBanner(ok ? '' : app.getError());
    refreshSliders();
    updateStatus();
  }

  function updateStatus() {
    var mesh = app.getMesh();
    statusLine.textContent = '顶点 ' + mesh.vertices.length +
      ' · 三角面 ' + mesh.faces.length +
      ' · 组(body/handle) 2 · 帧 ' + app.frameCount() +
      (app.isPaused() ? ' · 已暂停' : '');
  }

  function download(filename, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function refreshPresetList() {
    var select = document.getElementById('presetList');
    select.innerHTML = '';
    Object.keys(T.storage.listPresets()).forEach(function (name) {
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    });
  }

  function bindUI() {
    document.getElementById('layerShadow').addEventListener('change',
      function (e) {
        app.getState().layers.shadow = e.target.checked;
        app.autosave();
        app.redraw();
      });
    document.getElementById('layerWire').addEventListener('change',
      function (e) {
        app.getState().layers.wireframe = e.target.checked;
        app.autosave();
        app.redraw();
      });
    document.getElementById('btnPause').addEventListener('click', function (e) {
      var now = !app.isPaused();
      app.setPaused(now);
      e.target.textContent = now ? '继续' : '暂停';
      updateStatus();
    });
    document.getElementById('btnRotate').addEventListener('click',
      function (e) {
        var on = e.target.textContent.indexOf('开') >= 0;
        app.setAutoRotate(!on);
        e.target.textContent = '自动旋转：' + (on ? '关' : '开');
      });
    document.getElementById('btnDefault').addEventListener('click', function () {
      app.applyPreset(T.params.DEFAULT_PARAMS);
      showBanner(''); refreshSliders(); updateStatus();
    });
    document.getElementById('btnExtreme').addEventListener('click', function () {
      app.applyPreset(T.params.EXTREME_PARAMS);
      showBanner(''); refreshSliders(); updateStatus();
    });
    document.getElementById('btnSavePreset').addEventListener('click',
      function () {
        var name = document.getElementById('presetName').value.trim();
        try {
          T.storage.savePreset(name, app.getState());
          refreshPresetList();
          showBanner('');
        } catch (err) {
          showBanner(err.message);
        }
      });
    document.getElementById('btnLoadPreset').addEventListener('click',
      function () {
        var name = document.getElementById('presetList').value;
        var preset = T.storage.loadPreset(name);
        if (!preset) { showBanner('请先选择一个预设'); return; }
        if (app.applyPreset(preset.state.params)) {
          app.getState().view = Object.assign(app.getState().view,
            preset.state.view);
          app.getState().layers = preset.state.layers;
          document.getElementById('layerShadow').checked =
            preset.state.layers.shadow !== false;
          document.getElementById('layerWire').checked =
            !!preset.state.layers.wireframe;
          showBanner(''); refreshSliders();
        } else {
          showBanner(app.getError());
        }
      });
    document.getElementById('btnDeletePreset').addEventListener('click',
      function () {
        var name = document.getElementById('presetList').value;
        if (name) {
          T.storage.deletePreset(name);
          refreshPresetList();
        }
      });
    document.getElementById('btnPNG').addEventListener('click', function () {
      var bytes = app.exportPNGBytes();
      download('teacup.png', new Blob([bytes], { type: 'image/png' }));
    });
    document.getElementById('btnOBJ').addEventListener('click', function () {
      download('teacup.obj', new Blob([app.exportOBJText()],
        { type: 'text/plain' }));
    });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var v = app.getState().view;
      v.scale = T.math3d.clamp(v.scale * (e.deltaY > 0 ? 0.92 : 1.08),
        0.4, 3);
      app.autosave();
      app.redraw();
    }, { passive: false });
  }

  var restored = app.restore();
  buildSliders();
  bindUI();
  refreshSliders();
  refreshPresetList();
  document.getElementById('layerShadow').checked =
    app.getState().layers.shadow !== false;
  document.getElementById('layerWire').checked =
    !!app.getState().layers.wireframe;
  updateStatus();
  showBanner(restored ? '已恢复上次未保存的视角、图层与参数。' : '');
  setTimeout(function () { showBanner(''); }, 4000);
  setInterval(updateStatus, 250);
  updateStatus();
})();
