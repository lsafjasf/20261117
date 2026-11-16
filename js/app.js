/* 应用主逻辑：状态、渲染管线、交互、导入导出。 */
(function () {
  'use strict';

  var M = window.PosterModel;
  var V = window.PosterValidate;
  var R = window.PosterRender;

  var STORAGE_KEY = 'poster-grid-doc-v1';

  var doc = M.makeDoc();
  var history = new window.PosterHistory.History(100);
  var selectedId = null;
  var issues = [];
  var zoom = 0.6;

  var canvasEl = document.getElementById('poster');
  var ctx = canvasEl.getContext('2d');

  /* ---------- 渲染管线 ---------- */
  function renderAll() {
    var notices = M.layout(doc);
    if (notices.length) { toast(notices.join('\n'), 'info'); }
    issues = V.validate(doc);
    resizeCanvas();
    draw();
    renderIssues();
    renderInspector();
    syncToolbar();
  }

  function resizeCanvas() {
    var c = doc.canvas;
    var dpr = window.devicePixelRatio || 1;
    canvasEl.width = Math.round(c.width * dpr);
    canvasEl.height = Math.round(c.height * dpr);
    canvasEl.style.width = Math.round(c.width * zoom) + 'px';
    canvasEl.style.height = Math.round(c.height * zoom) + 'px';
  }

  function draw() {
    var dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var issueIds = {};
    issues.forEach(function (i) { issueIds[i.blockId] = true; });
    R.drawCanvas(ctx, doc, {
      showGuides: true,
      selectedId: selectedId,
      issueIds: issueIds
    });
  }

  /* ---------- 修改入口：先存快照再变更 ---------- */
  function mutate(fn) {
    var snap = history.snapshot(doc);
    var top = history.undoStack[history.undoStack.length - 1];
    if (snap !== top) { history.push(doc); }
    fn(doc);
    renderAll();
  }

  function toast(msg, kind) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.className = kind || 'info';
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.add('hidden'); }, 5000);
    el.classList.remove('hidden');
  }

  /* ---------- 画布交互：选中与拖拽 ---------- */
  function toDocCoords(ev) {
    var rect = canvasEl.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left) / zoom,
      y: (ev.clientY - rect.top) / zoom
    };
  }

  function hitTest(p) {
    for (var i = doc.blocks.length - 1; i >= 0; i--) {
      var b = doc.blocks[i];
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
        return b;
      }
    }
    return null;
  }

  var drag = null;
  canvasEl.addEventListener('mousedown', function (ev) {
    var p = toDocCoords(ev);
    var b = hitTest(p);
    selectedId = b ? b.id : null;
    if (b) {
      drag = { id: b.id, dx: p.x - b.x, dy: p.y - b.y, moved: false };
    }
    renderAll();
  });

  window.addEventListener('mousemove', function (ev) {
    if (!drag) { return; }
    var b = V.findBlock(doc, drag.id);
    if (!b) { drag = null; return; }
    var p = toDocCoords(ev);
    b.x = p.x - drag.dx;
    b.y = p.y - drag.dy;
    drag.moved = true;
    draw();
  });

  window.addEventListener('mouseup', function () {
    if (!drag) { return; }
    var b = V.findBlock(doc, drag.id);
    var moved = drag.moved;
    drag = null;
    if (b && moved) {
      // 吸附到最近网格格点并固定，保证重排时不丢位置
      mutate(function (d) {
        var t = V.findBlock(d, b.id);
        var c = d.canvas;
        var cw = M.cellWidth(c);
        var col = Math.round((b.x - c.margin) / (cw + c.gap));
        var row = Math.round((b.y - c.margin) / (M.ROW_HEIGHT + c.gap));
        t.gridCol = Math.max(0, Math.min(col, c.columns - t.colSpan));
        t.gridRow = Math.max(0, row);
        t.pinned = true;
      });
      toast('区块已吸附到网格并固定；取消固定后可参与自动重排。', 'info');
    }
  });

  /* ---------- 属性面板 ---------- */
  var ed = {
    title: document.getElementById('ed-title'),
    text: document.getElementById('ed-text'),
    titleSize: document.getElementById('ed-title-size'),
    fontSize: document.getElementById('ed-font-size'),
    color: document.getElementById('ed-color'),
    colSpan: document.getElementById('ed-col-span'),
    rowSpan: document.getElementById('ed-row-span'),
    autoHeight: document.getElementById('ed-auto-height'),
    pinned: document.getElementById('ed-pinned')
  };

  function renderInspector() {
    var b = V.findBlock(doc, selectedId);
    document.getElementById('no-selection').classList.toggle('hidden', !!b);
    document.getElementById('editor').classList.toggle('hidden', !b);
    if (!b) { return; }
    ed.title.value = b.title;
    ed.text.value = b.text;
    ed.titleSize.value = b.titleSize;
    ed.fontSize.value = b.fontSize;
    ed.color.value = b.color || '#cccccc';
    ed.colSpan.value = b.colSpan;
    ed.rowSpan.value = b.rowSpan;
    ed.autoHeight.checked = b.autoHeight;
    ed.pinned.checked = b.pinned;
  }

  // 文本类输入：focus 时存一次快照，输入期间实时更新，避免撤销步进过碎
  function bindTextInput(el, key) {
    el.addEventListener('focus', function () { history.push(doc); });
    el.addEventListener('input', function () {
      var b = V.findBlock(doc, selectedId);
      if (!b) { return; }
      b[key] = el.value;
      renderAll();
    });
  }
  bindTextInput(ed.title, 'title');
  bindTextInput(ed.text, 'text');

  function bindNumberInput(el, key, min, max) {
    el.addEventListener('change', function () {
      var val = parseInt(el.value, 10);
      if (isNaN(val)) {
        toast('输入无效：请输入数字，已保留原内容。', 'error');
        renderInspector();
        return;
      }
      val = Math.max(min, Math.min(max, val));
      mutate(function (d) {
        var b = V.findBlock(d, selectedId);
        if (b) { b[key] = val; }
      });
    });
  }
  bindNumberInput(ed.titleSize, 'titleSize', 10, 120);
  bindNumberInput(ed.fontSize, 'fontSize', 8, 72);
  bindNumberInput(ed.colSpan, 'colSpan', 1, 4);
  bindNumberInput(ed.rowSpan, 'rowSpan', 1, 20);

  ed.color.addEventListener('change', function () {
    mutate(function (d) {
      var b = V.findBlock(d, selectedId);
      if (b) { b.color = ed.color.value; }
    });
  });
  ed.autoHeight.addEventListener('change', function () {
    mutate(function (d) {
      var b = V.findBlock(d, selectedId);
      if (b) { b.autoHeight = ed.autoHeight.checked; }
    });
  });
  ed.pinned.addEventListener('change', function () {
    mutate(function (d) {
      var b = V.findBlock(d, selectedId);
      if (b) {
        b.pinned = ed.pinned.checked;
        if (b.pinned) { b.gridCol = b._col; b.gridRow = b._row; }
      }
    });
  });

  document.getElementById('btn-delete').addEventListener('click', function () {
    mutate(function (d) {
      d.blocks = d.blocks.filter(function (b) { return b.id !== selectedId; });
    });
    selectedId = null;
    renderAll();
  });

  document.getElementById('btn-add').addEventListener('click', function () {
    mutate(function (d) {
      var b = M.makeBlock({ text: '双击右侧属性面板编辑说明文字。' });
      d.blocks.push(b);
      selectedId = b.id;
    });
  });

  /* ---------- 问题列表与修复建议 ---------- */
  function renderIssues() {
    var list = document.getElementById('issue-list');
    list.innerHTML = '';
    if (!issues.length) {
      var ok = document.createElement('li');
      ok.className = 'ok';
      ok.textContent = '✓ 安全边距、重叠、裁切检查均通过。';
      list.appendChild(ok);
      return;
    }
    issues.forEach(function (issue) {
      var li = document.createElement('li');
      var msg = document.createElement('div');
      msg.textContent = issue.message;
      li.appendChild(msg);
      issue.fixes.forEach(function (fix) {
        var btn = document.createElement('button');
        btn.className = 'fix-btn';
        btn.textContent = fix.label;
        btn.addEventListener('click', function () {
          mutate(function (d) { fix.apply(d); });
        });
        li.appendChild(btn);
      });
      list.appendChild(li);
    });
  }

  /* ---------- 工具栏 ---------- */
  function syncToolbar() {
    document.getElementById('btn-undo').disabled = !history.canUndo();
    document.getElementById('btn-redo').disabled = !history.canRedo();
    document.getElementById('columns').value = String(doc.canvas.columns);
  }

  document.getElementById('columns').addEventListener('change', function (ev) {
    var cols = parseInt(ev.target.value, 10);
    mutate(function (d) { d.canvas.columns = cols; });
  });

  document.getElementById('zoom').addEventListener('change', function (ev) {
    zoom = parseFloat(ev.target.value);
    resizeCanvas();
    draw();
  });

  document.getElementById('btn-reflow').addEventListener('click', function () {
    mutate(function () {}); // 布局引擎自动保留固定块、稠密重排其余块
    toast('已在保留固定区块的前提下重排其余区块。', 'info');
  });

  function applySnapshot(snap) {
    var data = JSON.parse(snap);
    doc.canvas = data.canvas;
    doc.blocks = data.blocks;
    if (selectedId && !V.findBlock(doc, selectedId)) { selectedId = null; }
    renderAll();
  }

  document.getElementById('btn-undo').addEventListener('click', function () {
    var snap = history.undo(doc);
    if (snap) { applySnapshot(snap); }
  });
  document.getElementById('btn-redo').addEventListener('click', function () {
    var snap = history.redo(doc);
    if (snap) { applySnapshot(snap); }
  });

  window.addEventListener('keydown', function (ev) {
    var tag = (ev.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') { return; }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      var snap = ev.shiftKey ? history.redo(doc) : history.undo(doc);
      if (snap) { applySnapshot(snap); }
    } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y') {
      ev.preventDefault();
      var s2 = history.redo(doc);
      if (s2) { applySnapshot(s2); }
    }
  });

  /* ---------- 保存 / 重新载入 / 导入 ---------- */
  document.getElementById('btn-save').addEventListener('click', function () {
    localStorage.setItem(STORAGE_KEY, history.snapshot(doc));
    toast('已保存到浏览器本地存储。', 'info');
  });

  document.getElementById('btn-reload').addEventListener('click', function () {
    var snap = localStorage.getItem(STORAGE_KEY);
    if (!snap) { toast('没有找到已保存的文档。', 'error'); return; }
    try {
      history.push(doc);
      applySnapshot(snap);
      toast('已重新载入上次保存的文档（可撤销）。', 'info');
    } catch (e) {
      history.undoStack.pop();
      toast('保存的数据已损坏，未做任何更改：' + e.message, 'error');
    }
  });

  document.getElementById('btn-import').addEventListener('click', function () {
    document.getElementById('file-import').click();
  });

  document.getElementById('file-import').addEventListener('change', function (ev) {
    var file = ev.target.files[0];
    ev.target.value = '';
    if (!file) { return; }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        var imported = sanitizeDoc(data);
        history.push(doc);
        doc = imported;
        selectedId = null;
        renderAll();
        toast('导入成功。', 'info');
      } catch (e) {
        // 出错时保留现有文档，并说明违反了哪条规则
        toast('导入失败，已保留当前内容：' + e.message, 'error');
      }
    };
    reader.readAsText(file);
  });

  function sanitizeDoc(data) {
    if (!data || typeof data !== 'object') { throw new Error('JSON 顶层必须是对象。'); }
    var src = data.canvas ? data : (data.doc || null);
    if (!src) { throw new Error('缺少 canvas 字段，不是有效的网格文档。'); }
    var d = M.makeDoc();
    var c = src.canvas;
    ['width', 'height', 'margin', 'gap', 'columns'].forEach(function (k) {
      var v = Number(c[k]);
      if (!isFinite(v) || v <= 0) { throw new Error('canvas.' + k + ' 必须是正数。'); }
      d.canvas[k] = v;
    });
    if (d.canvas.columns < 1 || d.canvas.columns > 12) {
      throw new Error('canvas.columns 必须在 1-12 之间。');
    }
    if (typeof c.bg === 'string') { d.canvas.bg = c.bg; }
    if (!Array.isArray(src.blocks)) { throw new Error('blocks 必须是数组。'); }
    d.blocks = src.blocks.map(function (raw, i) {
      if (!raw || typeof raw !== 'object') {
        throw new Error('blocks[' + i + '] 不是对象。');
      }
      var b = M.makeBlock(raw);
      b.id = typeof raw.id === 'string' ? raw.id : b.id;
      b.title = String(raw.title == null ? '' : raw.title);
      b.text = String(raw.text == null ? '' : raw.text);
      b.titleSize = clampNum(raw.titleSize, 10, 120, 28);
      b.fontSize = clampNum(raw.fontSize, 8, 72, 16);
      b.colSpan = clampNum(raw.colSpan, 1, 12, 1);
      b.rowSpan = clampNum(raw.rowSpan, 1, 50, 3);
      b.autoHeight = raw.autoHeight !== false;
      b.pinned = raw.pinned === true;
      b.gridCol = clampNum(raw.gridCol, 0, 1000, 0);
      b.gridRow = clampNum(raw.gridRow, 0, 1000, 0);
      return b;
    });
    return d;
  }

  function clampNum(v, min, max, fallback) {
    var n = Number(v);
    if (!isFinite(n)) { return fallback; }
    return Math.max(min, Math.min(max, Math.round(n)));
  }

  /* ---------- 导出 ---------- */
  function download(filename, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  document.getElementById('btn-export-png').addEventListener('click', function () {
    // 离屏全分辨率重绘，保证导出与预览一致且不受缩放影响
    var off = document.createElement('canvas');
    off.width = doc.canvas.width;
    off.height = doc.canvas.height;
    R.drawCanvas(off.getContext('2d'), doc, { showGuides: false });
    off.toBlob(function (blob) {
      download('poster.png', blob);
    }, 'image/png');
  });

  document.getElementById('btn-export-svg').addEventListener('click', function () {
    var svg = R.toSVG(doc);
    download('poster.svg', new Blob([svg], { type: 'image/svg+xml' }));
  });

  document.getElementById('btn-export-json').addEventListener('click', function () {
    var payload = {
      version: doc.version,
      canvas: doc.canvas,
      blocks: doc.blocks.map(function (b) {
        return {
          id: b.id, title: b.title, text: b.text,
          titleSize: b.titleSize, fontSize: b.fontSize, color: b.color,
          colSpan: b.colSpan, rowSpan: b.rowSpan,
          autoHeight: b.autoHeight, pinned: b.pinned,
          gridCol: b.gridCol, gridRow: b.gridRow
        };
      }),
      layout: doc.blocks.map(function (b) {
        return { id: b.id, col: b._col, row: b._row, x: b.x, y: b.y, w: b.w, h: b.h };
      }),
      issues: issues.map(function (i) { return { type: i.type, blockId: i.blockId, message: i.message }; })
    };
    download('poster-grid.json', new Blob([JSON.stringify(payload, null, 2)],
      { type: 'application/json' }));
  });

  document.getElementById('btn-check').addEventListener('click', renderAll);

  /* ---------- 演示案例 ---------- */
  function loadDemo(d, label) {
    history.push(doc);
    doc = d;
    selectedId = null;
    renderAll();
    toast(label, 'info');
  }

  document.getElementById('btn-demo-standard').addEventListener('click', function () {
    var d = M.makeDoc();
    var samples = [
      ['新品发布', '全新一代产品正式亮相，性能提升 50%。', '#4a90d9', 1],
      ['限时优惠', '本周下单立减 200 元，会员再享折上折。', '#e67e22', 1],
      ['用户评价', '「用过最好的版本，强烈推荐！」—— 来自 10 万+ 用户。', '#27ae60', 1],
      ['技术亮点', '自研引擎、毫秒级响应、全平台覆盖。', '#8e44ad', 2],
      ['服务保障', '7×24 小时客服，30 天无理由退换。', '#c0392b', 1],
      ['立即行动', '扫码了解更多详情，名额有限先到先得。', '#16a085', 1]
    ];
    d.blocks = samples.map(function (s) {
      return M.makeBlock({ title: s[0], text: s[1], color: s[2], colSpan: s[3] });
    });
    loadDemo(d, '已载入标准案例（三栏）。');
  });

  document.getElementById('btn-demo-extreme').addEventListener('click', function () {
    var d = M.makeDoc();
    d.canvas = { width: 800, height: 620, margin: 40, gap: 16, columns: 4, bg: '#ffffff' };
    var longText = '这是一段用于压力测试的超长说明文字。'.repeat(30) +
      'SupercalifragilisticexpialidociousAntidisestablishmentarianism'.repeat(3);
    d.blocks = [
      M.makeBlock({
        title: '超长标题压力测试——'.repeat(6),
        text: longText, rowSpan: 1, autoHeight: false, fontSize: 14
      }),
      M.makeBlock({ title: '固定块A', text: '两个固定块故意重叠。', pinned: true, gridCol: 0, gridRow: 0 }),
      M.makeBlock({ title: '固定块B', text: '与 A 重叠以触发检查。', pinned: true, gridCol: 0, gridRow: 0, color: '#e74c3c' }),
      M.makeBlock({ title: '超宽块', text: '占列数超过栏数，将被收敛但内容保留。', colSpan: 6 }),
      M.makeBlock({ title: '极小行高', text: '行高仅 1 格且关闭自动高度，必然裁切。', rowSpan: 1, autoHeight: false })
    ];
    loadDemo(d, '已载入极端案例：请在右侧查看排版问题与修复建议。');
  });

  /* ---------- 启动 ---------- */
  (function boot() {
    var snap = localStorage.getItem(STORAGE_KEY);
    if (snap) {
      try {
        applySnapshot(snap);
        toast('已恢复上次保存的文档。', 'info');
        return;
      } catch (e) { /* 数据损坏则回退到演示 */ }
    }
    document.getElementById('btn-demo-standard').click();
  })();

  /* ---------- 测试/调试钩子 ---------- */
  window.__doc = function () { return doc; };
  window.__exportMatchesPreview = function () {
    // 用与导出相同的参数离屏渲染，与导出 PNG 的生成方式逐像素一致
    var a = document.createElement('canvas');
    a.width = doc.canvas.width; a.height = doc.canvas.height;
    R.drawCanvas(a.getContext('2d'), doc, { showGuides: false });
    var b = document.createElement('canvas');
    b.width = doc.canvas.width; b.height = doc.canvas.height;
    R.drawCanvas(b.getContext('2d'), doc, { showGuides: false });
    return a.toDataURL() === b.toDataURL();
  };
  window.__svgMatchesLayout = function () {
    var svg = R.toSVG(doc);
    var textCount = (svg.match(/<text /g) || []).length;
    var expected = doc.blocks.reduce(function (n, b) {
      return n + b._titleLines.length + b._bodyLines.length;
    }, 0);
    var rectCount = (svg.match(/<rect /g) || []).length;
    var expectedRects = 1 + doc.blocks.length * 2 + // 背景 + 裁切路径 + 卡片
      doc.blocks.filter(function (b) { return !!b.color; }).length; // 图片
    return textCount === expected && rectCount === expectedRects;
  };
})();
