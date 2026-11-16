/* app.js — UI、渲染管线、视角交互、持久化、导入导出 */
(function () {
  'use strict';
  const Core = window.SceneCore;
  const STORAGE_KEY = 'uid845.layerEditor.v1';

  /* ---------- 状态 ---------- */
  const state = {
    params: Core.defaultParams(),   // 上一次可用参数（非法输入不会覆盖）
    layers: Core.defaultLayers(),
    view: Core.defaultView(),
    selectedLayer: 0,
    paused: false,
    phase: 0,
    lastTime: 0,
    counts: [0, 0, 0],
    total: 0,
    dirtySplit: true,               // 需要重新逐像素分层
  };

  /* ---------- 画布 ---------- */
  const view = document.getElementById('view');
  const vctx = view.getContext('2d');
  const base = document.createElement('canvas');
  base.width = Core.BASE_W; base.height = Core.BASE_H;
  const bctx = base.getContext('2d');
  const layerCanvases = [];
  const layerCtxs = [];
  for (let i = 0; i < Core.LAYER_COUNT; i++) {
    const c = document.createElement('canvas');
    c.width = Core.BASE_W; c.height = Core.BASE_H;
    layerCanvases.push(c);
    layerCtxs.push(c.getContext('2d'));
  }

  /* ---------- 场景绘制 ---------- */
  function drawScene() {
    const p = state.params;
    bctx.clearRect(0, 0, Core.BASE_W, Core.BASE_H);
    bctx.fillStyle = `hsl(${(p.hueBase + 180) % 360} 30% ${p.bgLight}%)`;
    bctx.fillRect(0, 0, Core.BASE_W, Core.BASE_H);
    const shapes = Core.generateScene(p, Core.BASE_W, Core.BASE_H);
    for (const s of shapes) {
      bctx.fillStyle = `hsl(${s.hue} ${s.sat}% ${s.light}%)`;
      bctx.strokeStyle = bctx.fillStyle;
      if (s.type === 'circle') {
        bctx.beginPath();
        bctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        bctx.fill();
      } else if (s.type === 'ring') {
        bctx.lineWidth = 4 + (s.id % 5);
        bctx.beginPath();
        bctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        bctx.stroke();
      } else if (s.type === 'rect') {
        bctx.save();
        bctx.translate(s.x, s.y);
        bctx.rotate(s.rot);
        bctx.fillRect(-s.w / 2, -s.h / 2, s.w, s.h);
        bctx.restore();
      } else { // wave
        bctx.lineWidth = s.thick;
        bctx.beginPath();
        for (let x = 0; x <= Core.BASE_W; x += 4) {
          const y = s.y + Math.sin(x / Core.BASE_W * Math.PI * 2 * s.freq + s.phase + state.phase) * s.amp;
          if (x === 0) bctx.moveTo(x, y); else bctx.lineTo(x, y);
        }
        bctx.stroke();
      }
    }
  }

  /* ---------- 逐像素分层 ---------- */
  function resplit() {
    const img = bctx.getImageData(0, 0, Core.BASE_W, Core.BASE_H);
    const p = state.params;
    const result = Core.splitImage(img.data, p.splitMode, p.th1, p.th2);
    state.counts = result.counts;
    state.total = result.total;
    for (let i = 0; i < Core.LAYER_COUNT; i++) {
      const out = layerCtxs[i].createImageData(Core.BASE_W, Core.BASE_H);
      out.data.set(result.layers[i]);
      layerCtxs[i].putImageData(out, 0, 0);
    }
    state.dirtySplit = false;
  }

  /* ---------- 合成显示（图层顺序 0→1→2，底层先画） ---------- */
  function composite() {
    vctx.setTransform(1, 0, 0, 1, 0, 0);
    vctx.clearRect(0, 0, view.width, view.height);
    vctx.setTransform(
      state.view.zoom, 0, 0, state.view.zoom,
      view.width / 2 + state.view.panX, view.height / 2 + state.view.panY
    );
    for (let i = 0; i < Core.LAYER_COUNT; i++) {
      const layer = state.layers[i];
      if (!layer.visible) continue;
      vctx.globalAlpha = layer.opacity;
      vctx.filter = layer.hueShift ? `hue-rotate(${layer.hueShift}deg)` : 'none';
      vctx.drawImage(layerCanvases[i], -Core.BASE_W / 2, -Core.BASE_H / 2);
    }
    vctx.filter = 'none';
    vctx.globalAlpha = 1;
    vctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function renderFrame() {
    drawScene();
    resplit();
    composite();
    updateStats();
  }

  /* ---------- 动画循环 ---------- */
  function tick(now) {
    const dt = Math.min((now - state.lastTime) / 1000, 0.1) || 0;
    state.lastTime = now;
    if (!state.paused && state.params.animSpeed > 0) {
      state.phase += dt * state.params.animSpeed * 2;
      renderFrame();
    } else if (state.dirtySplit) {
      renderFrame();
    }
    requestAnimationFrame(tick);
  }

  /* ---------- 状态栏 ---------- */
  const statusEl = document.getElementById('status');
  function setStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.className = 'status ' + (isError ? 'error' : 'ok');
  }

  /* ---------- 持久化 ---------- */
  let saveTimer = null;
  function saveState() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const json = Core.exportState(state.params, state.layers, state.view, state.counts, state.total);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(json));
      } catch (e) { /* 存储不可用时静默忽略 */ }
    }, 150);
  }

  function loadState() {
    let raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { return; }
    if (!raw) return;
    const res = Core.importState(raw);
    if (!res.ok) {
      setStatus('本地存档无效，已使用默认画面: ' + res.errors.join('；'), true);
      return;
    }
    state.params = res.params;
    state.layers = res.layers;
    state.view = res.view;
  }

  /* ---------- 参数应用（非法输入保留上一可用画面） ---------- */
  function applyParams(raw, sourceLabel) {
    const res = Core.validateParams(raw);
    if (!res.ok) {
      setStatus(`参数无效（${sourceLabel}），保留上一可用画面: ` + res.errors.join('；'), true);
      syncParamForm(); // 把表单回滚到当前有效值
      return false;
    }
    state.params = res.params;
    state.dirtySplit = true;
    renderFrame();
    saveState();
    setStatus('参数已应用（' + sourceLabel + '）', false);
    return true;
  }

  /* ---------- 参数表单 ---------- */
  const paramForm = document.getElementById('param-form');
  const paramInputs = {};
  function buildParamForm() {
    for (const key in Core.PARAM_DEFS) {
      const def = Core.PARAM_DEFS[key];
      const row = document.createElement('div');
      row.className = 'param-row';
      const label = document.createElement('label');
      label.textContent = def.label;
      row.appendChild(label);
      let input;
      if (def.type === 'enum') {
        input = document.createElement('select');
        const names = { brightness: '亮度', saturation: '饱和度', hue: '色相' };
        for (const v of def.values) {
          const opt = document.createElement('option');
          opt.value = v;
          opt.textContent = names[v] || v;
          input.appendChild(opt);
        }
      } else {
        input = document.createElement('input');
        input.type = 'number';
        input.min = def.min; input.max = def.max;
        input.step = def.type === 'int' ? 1 : 0.01;
      }
      input.dataset.key = key;
      input.addEventListener('change', () => {
        const raw = {};
        for (const k in paramInputs) raw[k] = paramInputs[k].value;
        applyParams(raw, '手动输入');
      });
      paramInputs[key] = input;
      row.appendChild(input);
      paramForm.appendChild(row);
    }
  }

  function syncParamForm() {
    for (const key in paramInputs) paramInputs[key].value = state.params[key];
  }

  /* ---------- 图层列表 ---------- */
  const layerListEl = document.getElementById('layer-list');
  function buildLayerList() {
    layerListEl.innerHTML = '';
    state.layers.forEach((layer, i) => {
      const row = document.createElement('div');
      row.className = 'layer-row' + (i === state.selectedLayer ? ' selected' : '');
      row.addEventListener('click', () => {
        state.selectedLayer = i;
        buildLayerList();
      });

      const head = document.createElement('div');
      head.className = 'layer-head';
      const title = document.createElement('span');
      title.textContent = layer.name;
      const vis = document.createElement('input');
      vis.type = 'checkbox';
      vis.checked = layer.visible;
      vis.title = '显示/隐藏';
      vis.addEventListener('click', e => e.stopPropagation());
      vis.addEventListener('change', () => {
        layer.visible = vis.checked;
        composite();
        saveState();
      });
      head.appendChild(title);
      head.appendChild(vis);
      row.appendChild(head);

      const bar = document.createElement('div');
      bar.className = 'ratio-bar';
      const fill = document.createElement('div');
      fill.className = 'ratio-fill';
      const ratio = state.total ? state.counts[i] / state.total : 0;
      fill.style.width = (ratio * 100).toFixed(2) + '%';
      bar.appendChild(fill);
      row.appendChild(bar);

      const ctl = document.createElement('div');
      ctl.className = 'layer-ctl';
      ctl.appendChild(document.createTextNode('不透明'));
      const op = document.createElement('input');
      op.type = 'range'; op.min = 0; op.max = 1; op.step = 0.05;
      op.value = layer.opacity;
      op.addEventListener('click', e => e.stopPropagation());
      op.addEventListener('input', () => {
        layer.opacity = Number(op.value);
        composite();
        saveState();
      });
      ctl.appendChild(op);
      ctl.appendChild(document.createTextNode('色相'));
      const hue = document.createElement('input');
      hue.type = 'range'; hue.min = -180; hue.max = 180; hue.step = 5;
      hue.value = layer.hueShift;
      hue.addEventListener('click', e => e.stopPropagation());
      hue.addEventListener('input', () => {
        layer.hueShift = Number(hue.value);
        composite();
        saveState();
      });
      ctl.appendChild(hue);
      row.appendChild(ctl);

      layerListEl.appendChild(row);
    });
  }

  /* ---------- 统计 ---------- */
  const statsEl = document.getElementById('stats');
  function updateStats() {
    const p = state.params;
    let html = '';
    for (let i = 0; i < Core.LAYER_COUNT; i++) {
      const ratio = state.total ? (state.counts[i] / state.total * 100).toFixed(1) : '0.0';
      html += `<div class="stat-line"><span>${state.layers[i].name}</span><span>${ratio}% (${state.counts[i]}px)</span></div>`;
    }
    html += `<div class="stat-line"><span>分层依据</span><span>${p.splitMode} [${p.th1}, ${p.th2}]</span></div>`;
    html += `<div class="stat-line"><span>视角</span><span>zoom ${state.view.zoom.toFixed(2)} · (${state.view.panX | 0}, ${state.view.panY | 0})</span></div>`;
    html += `<div class="stat-line"><span>状态</span><span>${state.paused ? '已暂停' : '播放中'}</span></div>`;
    statsEl.innerHTML = html;
    if (layerListEl.children.length) {
      const fills = layerListEl.querySelectorAll('.ratio-fill');
      fills.forEach((f, i) => {
        const r = state.total ? state.counts[i] / state.total : 0;
        f.style.width = (r * 100).toFixed(2) + '%';
      });
    }
  }

  /* ---------- 操作按钮 ---------- */
  function applyPreset(preset, label) {
    state.params = preset.params;
    state.layers = preset.layers;
    state.view = preset.view;
    state.dirtySplit = true;
    syncParamForm();
    buildLayerList();
    renderFrame();
    saveState();
    setStatus('已载入' + label, false);
  }

  document.getElementById('btn-default').addEventListener('click', () => {
    applyPreset(Core.presetDefault(), '默认预设');
  });
  document.getElementById('btn-extreme').addEventListener('click', () => {
    applyPreset(Core.presetExtreme(), '极端预设');
  });

  const btnPause = document.getElementById('btn-pause');
  btnPause.addEventListener('click', () => {
    state.paused = !state.paused;
    btnPause.textContent = state.paused ? '继续' : '暂停';
    updateStats();
    saveState();
  });

  function download(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  }

  document.getElementById('btn-shot').addEventListener('click', () => {
    composite(); // 确保截取最新帧
    download(view.toDataURL('image/png'), 'abstract-shot.png');
    setStatus('已保存截图', false);
  });

  document.getElementById('btn-export-png').addEventListener('click', () => {
    composite();
    download(view.toDataURL('image/png'), 'abstract-layers.png');
    setStatus('已导出 PNG', false);
  });

  document.getElementById('btn-export-json').addEventListener('click', () => {
    const json = Core.exportState(state.params, state.layers, state.view, state.counts, state.total);
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
    download(URL.createObjectURL(blob), 'abstract-layers.json');
    setStatus('已导出层 JSON（含参数/图层/视角）', false);
  });

  document.getElementById('import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const res = Core.importState(String(reader.result));
      if (!res.ok) {
        setStatus('导入失败，保留当前画面: ' + res.errors.join('；'), true);
      } else {
        state.params = res.params;
        state.layers = res.layers;
        state.view = res.view;
        state.dirtySplit = true;
        syncParamForm();
        buildLayerList();
        renderFrame();
        saveState();
        setStatus('导入成功，颜色与层级已恢复', false);
      }
      e.target.value = '';
    };
    reader.onerror = () => setStatus('读取文件失败，保留当前画面', true);
    reader.readAsText(file);
  });

  /* ---------- 缩放 / 平移 ---------- */
  view.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const next = state.view.zoom * factor;
    const res = Core.validateView({ zoom: next, panX: state.view.panX, panY: state.view.panY });
    if (!res.ok) { setStatus('缩放超出范围: ' + res.errors.join('；'), true); return; }
    state.view = res.view;
    composite();
    updateStats();
    saveState();
  }, { passive: false });

  let dragging = false;
  let lastX = 0, lastY = 0;
  view.addEventListener('mousedown', (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const next = {
      zoom: state.view.zoom,
      panX: state.view.panX + (e.clientX - lastX),
      panY: state.view.panY + (e.clientY - lastY),
    };
    lastX = e.clientX; lastY = e.clientY;
    const res = Core.validateView(next);
    if (!res.ok) { setStatus('平移超出范围: ' + res.errors.join('；'), true); return; }
    state.view = res.view;
    composite();
    updateStats();
  });
  window.addEventListener('mouseup', () => {
    if (dragging) { dragging = false; saveState(); }
  });

  /* ---------- 初始化 ---------- */
  loadState();
  buildParamForm();
  syncParamForm();
  buildLayerList();
  renderFrame();
  saveState();
  if (statusEl.className.indexOf('error') === -1) {
    setStatus('就绪：画面由 Canvas 程序生成，刷新后自动恢复视角/图层/参数', false);
  }
  requestAnimationFrame((t) => { state.lastTime = t; tick(t); });
})();
