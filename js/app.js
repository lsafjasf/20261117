/* app.js — UI 层：画布、工具、撤销/重做、保存/载入、导出。
 * 所有模型与校验逻辑在 icon-core.js，预览与导出共用 svgForIcon。 */
(function () {
  'use strict';
  const Core = window.IconCore;
  const STORE_KEY = 'icon-studio-state-v1';
  const BOARD_CSS = 480;
  const SCALE = BOARD_CSS / Core.GRID;

  let state = loadStored() || Core.createStandardState();
  let undoStack = [];
  let redoStack = [];
  let tool = 'select';
  let selectedShapeId = null;
  let drag = null;
  const imageCache = new Map();

  const $ = function (id) { return document.getElementById(id); };
  const board = $('board');
  const ctx = board.getContext('2d');

  /* ---------- 提示 ---------- */
  function toast(message, kind) {
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || 'info');
    el.textContent = message;
    $('toasts').appendChild(el);
    setTimeout(function () { el.remove(); }, 6000);
  }

  /* ---------- 历史 ---------- */
  function pushHistory() {
    undoStack.push(Core.clone(state));
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
  }

  function mutate(fn) {
    pushHistory();
    fn(state);
    renderAll();
  }

  function undo() {
    if (!undoStack.length) { toast('没有可撤销的操作'); return; }
    redoStack.push(Core.clone(state));
    state = undoStack.pop();
    selectedShapeId = null;
    renderAll();
  }

  function redo() {
    if (!redoStack.length) { toast('没有可重做的操作'); return; }
    undoStack.push(Core.clone(state));
    state = redoStack.pop();
    selectedShapeId = null;
    renderAll();
  }

  /* ---------- 保存 / 重新载入 ---------- */
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      toast('已保存到本地存储', 'success');
    } catch (err) {
      toast('保存失败：' + err.message + '。当前内容仍保留在页面中。', 'error');
    }
    renderAll();
  }

  function loadStored() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.icons) || !parsed.style) return null;
      return parsed;
    } catch (err) {
      return null;
    }
  }

  function reload() {
    const stored = loadStored();
    if (!stored) {
      toast('没有找到已保存的内容，当前内容未受影响。请先点击“保存”。', 'error');
      return;
    }
    pushHistory();
    state = stored;
    selectedShapeId = null;
    toast('已重新载入上次保存的内容', 'success');
    renderAll();
  }

  /* ---------- SVG → Image 缓存（预览与导出同源） ---------- */
  function svgDataUri(svg) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function iconImage(svg) {
    let img = imageCache.get(svg);
    if (!img) {
      img = new Image();
      img.onload = function () { renderBoard(); };
      img.src = svgDataUri(svg);
      imageCache.set(svg, img);
      if (imageCache.size > 60) imageCache.delete(imageCache.keys().next().value);
    }
    return img;
  }

  /* ---------- 画布渲染 ---------- */
  function renderBoard() {
    const dpr = window.devicePixelRatio || 1;
    if (board.width !== BOARD_CSS * dpr) {
      board.width = BOARD_CSS * dpr;
      board.height = BOARD_CSS * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, BOARD_CSS, BOARD_CSS);
    ctx.fillStyle = state.style.background;
    ctx.fillRect(0, 0, BOARD_CSS, BOARD_CSS);

    const svg = Core.svgForIcon(state, state.activeIcon);
    const img = iconImage(svg);
    if (img.complete && img.naturalWidth) {
      ctx.drawImage(img, 0, 0, BOARD_CSS, BOARD_CSS);
    }

    if ($('showGrid').checked) drawGrid();
    if ($('showSafe').checked) drawSafeArea();
    drawSelection();
  }

  function drawGrid() {
    ctx.save();
    for (let u = 1; u < Core.GRID; u += 1) {
      const p = u * SCALE;
      ctx.strokeStyle = u % 4 === 0 ? 'rgba(37,99,235,0.18)' : 'rgba(0,0,0,0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p, 0); ctx.lineTo(p, BOARD_CSS);
      ctx.moveTo(0, p); ctx.lineTo(BOARD_CSS, p);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSafeArea() {
    const m = Core.SAFE_MARGIN * SCALE;
    ctx.save();
    ctx.strokeStyle = '#ef4444';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(m, m, BOARD_CSS - 2 * m, BOARD_CSS - 2 * m);
    ctx.restore();
  }

  function drawSelection() {
    const shape = Core.findShape(state, state.activeIcon, selectedShapeId);
    if (!shape) return;
    const box = Core.bboxOf(shape, state.style);
    ctx.save();
    ctx.strokeStyle = '#2563eb';
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(box.x * SCALE - 3, box.y * SCALE - 3, box.w * SCALE + 6, box.h * SCALE + 6);
    ctx.restore();
  }

  /* ---------- 预览条 / 页签 / 校验面板 ---------- */
  function renderPreviews() {
    const wrap = $('previews');
    wrap.innerHTML = '';
    state.icons.forEach(function (icon, i) {
      const item = document.createElement('div');
      item.className = 'preview-item';
      [48, 24].forEach(function (size) {
        const img = document.createElement('img');
        img.width = size;
        img.height = size;
        img.alt = icon.name + ' ' + size + 'px';
        img.title = size + 'px 实尺寸预览';
        img.src = svgDataUri(Core.svgForIcon(state, i, { size: size }));
        item.appendChild(img);
      });
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = icon.name;
      item.appendChild(name);
      wrap.appendChild(item);
    });
  }

  function renderTabs() {
    const tabs = $('iconTabs');
    tabs.innerHTML = '';
    state.icons.forEach(function (icon, i) {
      const btn = document.createElement('button');
      btn.textContent = (i + 1) + ' · ' + icon.name;
      if (i === state.activeIcon) btn.className = 'active';
      btn.addEventListener('click', function () {
        state.activeIcon = i;
        selectedShapeId = null;
        renderAll();
      });
      tabs.appendChild(btn);
    });
    $('iconName').value = state.icons[state.activeIcon].name;
  }

  function renderIssues() {
    const list = $('issues');
    list.innerHTML = '';
    const issues = Core.validateState(state);
    if (!issues.length) {
      const li = document.createElement('li');
      li.className = 'ok';
      li.textContent = '✓ 全部通过：安全边距、重叠、裁切、文本与 24px 线宽均符合规则。';
      list.appendChild(li);
      return;
    }
    issues.forEach(function (issue) {
      const li = document.createElement('li');
      li.className = issue.severity;
      const head = document.createElement('span');
      head.className = 'rule';
      head.textContent = '[' + issue.rule + '] ' + issue.iconName + '：';
      li.appendChild(head);
      li.appendChild(document.createTextNode(issue.message));
      const fix = document.createElement('span');
      fix.className = 'fix';
      fix.textContent = '修复建议：' + issue.fix;
      li.appendChild(fix);
      li.addEventListener('click', function () {
        if (issue.iconIndex >= 0) {
          state.activeIcon = issue.iconIndex;
          selectedShapeId = issue.shapeId;
          renderAll();
        }
      });
      list.appendChild(li);
    });
  }

  function renderStyleInputs() {
    $('styleStroke').value = state.style.strokeWidth;
    $('styleRadius').value = state.style.cornerRadius;
    $('stylePrimary').value = state.style.colorPrimary;
    $('styleAccent').value = state.style.colorAccent;
    $('styleBg').value = state.style.background;
  }

  function renderAll() {
    renderBoard();
    renderPreviews();
    renderTabs();
    renderIssues();
    renderProps();
    renderStyleInputs();
    $('btnUndo').disabled = !undoStack.length;
    $('btnRedo').disabled = !redoStack.length;
  }

  /* ---------- 属性面板 ---------- */
  const NUM_LIMITS = {
    x: { min: -48, max: 96, label: 'X' }, y: { min: -48, max: 96, label: 'Y' },
    w: { min: 0.5, max: 96, label: '宽' }, h: { min: 0.5, max: 96, label: '高' },
    cx: { min: -48, max: 96, label: '圆心 X' }, cy: { min: -48, max: 96, label: '圆心 Y' },
    r: { min: 0.5, max: 48, label: '半径' },
    x1: { min: -48, max: 96, label: '起点 X' }, y1: { min: -48, max: 96, label: '起点 Y' },
    x2: { min: -48, max: 96, label: '终点 X' }, y2: { min: -48, max: 96, label: '终点 Y' },
    fontSize: { min: 3, max: 24, label: '字号' },
    rx: { min: 0, max: 24, label: '圆角' },
    strokeWidth: { min: 0.5, max: 8, label: '线宽' }
  };

  function numberField(shape, key, value) {
    const label = document.createElement('label');
    label.className = 'field';
    const lim = NUM_LIMITS[key];
    const span = document.createElement('span');
    span.textContent = lim.label + '（' + lim.min + '–' + lim.max + '）';
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.5';
    input.value = value == null ? '' : value;
    input.addEventListener('change', function () {
      if (input.value.trim() === '' && (key === 'rx' || key === 'strokeWidth')) {
        mutate(function () { shape[key] = null; });
        return;
      }
      const res = Core.commitNumber(input.value, lim);
      if (!res.ok) {
        toast(res.error + '（违反取值范围规则）', 'error');
        renderProps();
        return;
      }
      mutate(function () { shape[key] = res.value; });
    });
    label.appendChild(span);
    label.appendChild(input);
    return label;
  }

  function tokenField(shape, key, labelText, allowNone) {
    const label = document.createElement('label');
    label.className = 'field';
    const span = document.createElement('span');
    span.textContent = labelText;
    const select = document.createElement('select');
    const opts = allowNone ? ['none', 'primary', 'accent'] : ['primary', 'accent'];
    const names = { none: '无', primary: '主色', accent: '强调色' };
    opts.forEach(function (token) {
      const opt = document.createElement('option');
      opt.value = token;
      opt.textContent = names[token];
      if (shape[key] === token) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', function () {
      mutate(function () { shape[key] = select.value; });
    });
    label.appendChild(span);
    label.appendChild(select);
    return label;
  }

  function renderProps() {
    const wrap = $('props');
    wrap.innerHTML = '';
    const shape = Core.findShape(state, state.activeIcon, selectedShapeId);
    if (!shape) {
      wrap.innerHTML = '<p class="hint">在画布中点击元素进行选择；选择“矩形/圆形/线条/文本”工具后点击画布可添加元素。</p>';
      return;
    }
    const title = document.createElement('p');
    title.className = 'hint';
    title.textContent = '类型：' + Core.shapeLabel(shape) + '（' + shape.id + '）';
    wrap.appendChild(title);

    if (shape.type === 'rect') {
      ['x', 'y', 'w', 'h', 'rx'].forEach(function (k) { wrap.appendChild(numberField(shape, k, shape[k])); });
      wrap.appendChild(tokenField(shape, 'fill', '填充', true));
      wrap.appendChild(tokenField(shape, 'stroke', '描边', true));
      wrap.appendChild(numberField(shape, 'strokeWidth', shape.strokeWidth));
    } else if (shape.type === 'circle') {
      ['cx', 'cy', 'r'].forEach(function (k) { wrap.appendChild(numberField(shape, k, shape[k])); });
      wrap.appendChild(tokenField(shape, 'fill', '填充', true));
      wrap.appendChild(tokenField(shape, 'stroke', '描边', true));
      wrap.appendChild(numberField(shape, 'strokeWidth', shape.strokeWidth));
    } else if (shape.type === 'line') {
      ['x1', 'y1', 'x2', 'y2'].forEach(function (k) { wrap.appendChild(numberField(shape, k, shape[k])); });
      wrap.appendChild(tokenField(shape, 'stroke', '描边', false));
      wrap.appendChild(numberField(shape, 'strokeWidth', shape.strokeWidth));
    } else if (shape.type === 'text') {
      const label = document.createElement('label');
      label.className = 'field';
      const span = document.createElement('span');
      span.textContent = '文本内容（≤' + Core.MAX_TEXT_CHARS + ' 字）';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = shape.content;
      input.addEventListener('change', function () {
        const res = Core.commitText(state, state.activeIcon, shape.id, input.value);
        if (!res.ok) {
          res.errors.forEach(function (e) { toast('已保留原文本。' + e, 'error'); });
          renderProps();
          return;
        }
        pushHistory();
        state = res.state;
        renderAll();
      });
      label.appendChild(span);
      label.appendChild(input);
      wrap.appendChild(label);
      ['x', 'y', 'fontSize'].forEach(function (k) { wrap.appendChild(numberField(shape, k, shape[k])); });
      wrap.appendChild(tokenField(shape, 'fill', '颜色', false));
    }

    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = '删除该元素';
    del.addEventListener('click', function () {
      mutate(function () {
        const icon = state.icons[state.activeIcon];
        icon.shapes = icon.shapes.filter(function (s) { return s.id !== shape.id; });
        selectedShapeId = null;
      });
    });
    wrap.appendChild(del);
  }

  /* ---------- 画布交互 ---------- */
  function toGrid(evt) {
    const rect = board.getBoundingClientRect();
    return {
      x: (evt.clientX - rect.left) / SCALE,
      y: (evt.clientY - rect.top) / SCALE
    };
  }

  function hitTest(pt) {
    const icon = state.icons[state.activeIcon];
    for (let i = icon.shapes.length - 1; i >= 0; i -= 1) {
      const box = Core.bboxOf(icon.shapes[i], state.style);
      if (pt.x >= box.x - 1 && pt.x <= box.x + box.w + 1 &&
          pt.y >= box.y - 1 && pt.y <= box.y + box.h + 1) {
        return icon.shapes[i];
      }
    }
    return null;
  }

  function moveShape(shape, dx, dy) {
    const r = function (v) { return Math.round(v * 2) / 2; };
    if (shape.type === 'rect') { shape.x = r(shape.x + dx); shape.y = r(shape.y + dy); }
    else if (shape.type === 'circle') { shape.cx = r(shape.cx + dx); shape.cy = r(shape.cy + dy); }
    else if (shape.type === 'line') {
      shape.x1 = r(shape.x1 + dx); shape.y1 = r(shape.y1 + dy);
      shape.x2 = r(shape.x2 + dx); shape.y2 = r(shape.y2 + dy);
    } else if (shape.type === 'text') { shape.x = r(shape.x + dx); shape.y = r(shape.y + dy); }
  }

  board.addEventListener('pointerdown', function (evt) {
    const pt = toGrid(evt);
    if (tool === 'select') {
      const hit = hitTest(pt);
      selectedShapeId = hit ? hit.id : null;
      if (hit) {
        pushHistory();
        drag = { id: hit.id, lastX: pt.x, lastY: pt.y };
        board.setPointerCapture(evt.pointerId);
      }
      renderAll();
    } else {
      const shape = Core.makeShape(tool, pt);
      mutate(function () {
        state.icons[state.activeIcon].shapes.push(shape);
        selectedShapeId = shape.id;
      });
      setTool('select');
    }
  });

  board.addEventListener('pointermove', function (evt) {
    if (!drag) return;
    const pt = toGrid(evt);
    const shape = Core.findShape(state, state.activeIcon, drag.id);
    if (!shape) { drag = null; return; }
    moveShape(shape, pt.x - drag.lastX, pt.y - drag.lastY);
    drag.lastX = pt.x;
    drag.lastY = pt.y;
    renderBoard();
    renderIssues();
  });

  board.addEventListener('pointerup', function () {
    if (drag) { drag = null; renderAll(); }
  });

  function setTool(next) {
    tool = next;
    document.querySelectorAll('.tools button').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.tool === next);
    });
  }

  document.querySelectorAll('.tools button').forEach(function (btn) {
    btn.addEventListener('click', function () { setTool(btn.dataset.tool); });
  });

  /* ---------- 导出 ---------- */
  function download(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }

  function exportSvg() {
    const issues = Core.validateState(state).filter(function (i) { return i.severity === 'error'; });
    if (issues.length) {
      toast('存在 ' + issues.length + ' 条错误级规则违规，仍已导出；建议先按“排版规则检查”面板修复。', 'error');
    }
    state.icons.forEach(function (icon, i) {
      const svg = Core.svgForIcon(state, i);
      download(new Blob([svg], { type: 'image/svg+xml' }), icon.id + '.svg');
    });
    const index = JSON.stringify(Core.indexJson(state), null, 2);
    download(new Blob([index], { type: 'application/json' }), 'index.json');
    if (!issues.length) toast('已导出 3 个 SVG 与 index.json', 'success');
  }

  function svgToPngBlob(svg, size) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.onload = function () {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        canvas.getContext('2d').drawImage(img, 0, 0, size, size);
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob);
          else reject(new Error('PNG 编码失败'));
        }, 'image/png');
      };
      img.onerror = function () { reject(new Error('SVG 渲染失败')); };
      img.src = svgDataUri(svg);
    });
  }

  async function exportPng() {
    try {
      for (let i = 0; i < state.icons.length; i += 1) {
        const blob = await svgToPngBlob(Core.svgForIcon(state, i), 48);
        download(blob, state.icons[i].id + '.png');
      }
      const strip = document.createElement('canvas');
      strip.width = 24 * 3 + 16;
      strip.height = 24;
      const stripCtx = strip.getContext('2d');
      for (let i = 0; i < state.icons.length; i += 1) {
        const img = new Image();
        img.src = svgDataUri(Core.svgForIcon(state, i, { size: 24 }));
        await new Promise(function (res, rej) {
          img.onload = res;
          img.onerror = function () { rej(new Error('24px 预览渲染失败')); };
        });
        stripCtx.drawImage(img, i * (24 + 8), 0, 24, 24);
      }
      strip.toBlob(function (blob) {
        if (blob) download(blob, 'icons-24px.png');
      }, 'image/png');
      toast('已导出 3 个 48px PNG 与 24px 对比条', 'success');
    } catch (err) {
      toast('PNG 导出失败：' + err.message + '。内容未丢失，可重试或改用 SVG 导出。', 'error');
    }
  }

  /* ---------- 事件绑定与初始化 ---------- */
  $('btnUndo').addEventListener('click', undo);
  $('btnRedo').addEventListener('click', redo);
  $('btnSave').addEventListener('click', save);
  $('btnReload').addEventListener('click', reload);
  $('btnExportSvg').addEventListener('click', exportSvg);
  $('btnExportPng').addEventListener('click', exportPng);
  $('btnSampleStandard').addEventListener('click', function () {
    pushHistory();
    state = Core.createStandardState();
    selectedShapeId = null;
    toast('已载入标准案例（可撤销）');
    renderAll();
  });
  $('btnSampleExtreme').addEventListener('click', function () {
    pushHistory();
    state = Core.createExtremeState();
    selectedShapeId = null;
    toast('已载入极端案例：请查看“排版规则检查”面板的错误与修复建议（可撤销）');
    renderAll();
  });

  $('iconName').addEventListener('change', function () {
    const name = $('iconName').value.trim();
    if (!name) {
      toast('图标名称不能为空，已保留原名称。', 'error');
      renderTabs();
      return;
    }
    mutate(function () { state.icons[state.activeIcon].name = name; });
  });

  function bindStyleNumber(id, key, min, max, label) {
    $(id).addEventListener('change', function () {
      const res = Core.commitNumber($(id).value, { min: min, max: max, label: label });
      if (!res.ok) {
        toast(res.error, 'error');
        renderStyleInputs();
        return;
      }
      mutate(function () { state.style[key] = res.value; });
    });
  }
  bindStyleNumber('styleStroke', 'strokeWidth', 0.5, 8, '统一线宽');
  bindStyleNumber('styleRadius', 'cornerRadius', 0, 16, '统一圆角');

  function bindStyleColor(id, key) {
    $(id).addEventListener('change', function () {
      mutate(function () { state.style[key] = $(id).value; });
    });
  }
  bindStyleColor('stylePrimary', 'colorPrimary');
  bindStyleColor('styleAccent', 'colorAccent');
  bindStyleColor('styleBg', 'background');

  $('showGrid').addEventListener('change', renderBoard);
  $('showSafe').addEventListener('change', renderBoard);

  document.addEventListener('keydown', function (evt) {
    const mod = evt.ctrlKey || evt.metaKey;
    if (!mod) return;
    const key = evt.key.toLowerCase();
    if (key === 'z' && evt.shiftKey) { evt.preventDefault(); redo(); }
    else if (key === 'z') { evt.preventDefault(); undo(); }
    else if (key === 'y') { evt.preventDefault(); redo(); }
    else if (key === 's') { evt.preventDefault(); save(); }
  });

  renderAll();
})();
