// 主交互：画布交互、属性编辑、撤销/重做、保存/载入、导出拦截。
(() => {
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const statusbar = document.getElementById('statusbar');
  const propsEl = document.getElementById('props');
  const violEl = document.getElementById('violations');
  const summaryEl = document.getElementById('check-summary');
  const SAVE_KEY = 'trifold-doc-v1';

  let doc = Cases.standard();
  let history = Model.createHistory(doc);
  let selectedId = null;
  let viewMode = 'flat';
  let zoom = 1;
  let foldAngleDeg = 55;
  let drag = null;
  let violations = [];

  const $ = id => document.getElementById(id);

  function setStatus(msg, isError) {
    statusbar.textContent = msg;
    statusbar.classList.toggle('error', !!isError);
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(300, r.width);
    canvas.height = Math.max(200, r.height - 0);
    render();
  }

  function baseScale() {
    return Math.min((canvas.width - 80) / doc.page.w, (canvas.height - 120) / doc.page.h);
  }

  function flatTransform() {
    const s = baseScale() * zoom;
    return { s, ox: (canvas.width - doc.page.w * s) / 2, oy: 40 * zoom };
  }

  function render() {
    violations = Model.validate(doc);
    if (viewMode === 'flat') {
      const t = flatTransform();
      Renderer.drawFlat(ctx, doc, {
        pxPerMm: baseScale(), zoom, ox: t.ox, oy: t.oy,
        selectedId, violations,
      });
    } else {
      Renderer.drawFolded(ctx, doc, {
        pxPerMm: baseScale(), zoom, foldAngleDeg,
      });
    }
    renderViolations();
    renderProps();
    $('btn-undo').disabled = !history.canUndo();
    $('btn-redo').disabled = !history.canRedo();
  }

  function renderViolations() {
    const errs = violations.filter(v => v.level === 'error');
    const warns = violations.filter(v => v.level === 'warn');
    summaryEl.textContent = errs.length ? `${errs.length} 个错误（已阻止导出）`
      : warns.length ? `${warns.length} 个警告` : '通过';
    summaryEl.className = errs.length ? 'bad' : warns.length ? 'warn' : 'ok';
    violEl.innerHTML = '';
    for (const v of violations) {
      const li = document.createElement('li');
      li.className = v.level;
      li.innerHTML = `<b>[${v.rule}]</b> ${v.message}<span class="fix">修复建议：${v.fix}</span>`;
      li.onclick = () => { selectedId = v.elId; viewMode = 'flat'; $('view-mode').value = 'flat'; render(); };
      violEl.appendChild(li);
    }
  }

  function commit() { history.commit(doc); }

  // ---- 命中与拖动（仅展开图）----
  function toMM(e) {
    const r = canvas.getBoundingClientRect();
    const t = flatTransform();
    return { x: (e.clientX - r.left - t.ox) / t.s, y: (e.clientY - r.top - t.oy) / t.s };
  }

  function hitTest(p) {
    for (let i = doc.elements.length - 1; i >= 0; i--) {
      const el = doc.elements[i];
      const b = Model.elBBox(el);
      const bx = el.type === 'text' ? el.x : b.x, bw = el.type === 'text' ? el.w : b.w;
      if (p.x >= bx - 1 && p.x <= bx + bw + 1 && p.y >= b.y - 1 && p.y <= b.y + b.h + 1) return el;
    }
    return null;
  }

  canvas.addEventListener('pointerdown', e => {
    if (viewMode !== 'flat') return;
    const el = hitTest(toMM(e));
    selectedId = el ? el.id : null;
    if (el) {
      drag = { id: el.id, startX: el.x, startY: el.y, px: toMM(e).x, py: toMM(e).y, moved: false };
      canvas.setPointerCapture(e.pointerId);
    }
    render();
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const el = doc.elements.find(x => x.id === drag.id);
    if (!el) return;
    const p = toMM(e);
    el.x = Math.round((drag.startX + p.x - drag.px) * 2) / 2; // 0.5mm 吸附
    el.y = Math.round((drag.startY + p.y - drag.py) * 2) / 2;
    drag.moved = true;
    render();
  });
  canvas.addEventListener('pointerup', () => {
    if (drag && drag.moved) commit();
    drag = null;
    render();
  });

  // ---- 属性面板：非法输入保留旧值并说明违反的规则 ----
  function renderProps() {
    const el = doc.elements.find(x => x.id === selectedId);
    if (!el) {
      propsEl.innerHTML = '<p class="muted">未选中元素。点击画布中的元素进行编辑，拖动可移动。</p>';
      return;
    }
    const numField = (key, label, min, max, step = 0.5) =>
      `<div><label>${label} (mm)</label><input data-k="${key}" type="number" value="${el[key]}" min="${min}" max="${max}" step="${step}"></div>`;
    let html = `<div class="row">${numField('x', 'X')}${numField('y', 'Y')}</div>`
      + `<div class="row">${numField('w', '宽', 1)}`;
    if (el.type !== 'text') html += numField('h', '高', 1);
    html += '</div>';
    if (el.type === 'text') {
      html += `<label>文字内容</label><textarea data-k="text">${escapeHtml(el.text)}</textarea>
        <div class="row">
        <div><label>字号 (pt)</label><input data-k="fontSize" type="number" value="${el.fontSize}" min="4" max="72" step="0.5"></div>
        <div><label>颜色</label><input data-k="color" type="color" value="${el.color}"></div>
        </div>
        <div class="row">
        <div><label>对齐</label><select data-k="align">
          ${['left', 'center', 'right'].map(a => `<option ${el.align === a ? 'selected' : ''}>${a}</option>`).join('')}
        </select></div>
        <div><label>粗体</label><select data-k="bold">
          <option value="false" ${!el.bold ? 'selected' : ''}>否</option>
          <option value="true" ${el.bold ? 'selected' : ''}>是</option>
        </select></div>
        </div>`;
    } else {
      html += `<div class="row">
        <div><label>填充</label><input data-k="fill" type="color" value="${el.fill}"></div>
        <div><label>描边</label><input data-k="stroke" type="color" value="${el.stroke || '#000000'}"></div>
        </div>
        <label>描边宽 (mm，0=无)</label><input data-k="lineWidth" type="number" value="${el.lineWidth}" min="0" max="5" step="0.1">`;
    }
    html += `<div class="err" id="prop-err"></div>
      <button id="btn-del" style="margin-top:6px">删除元素</button>`;
    propsEl.innerHTML = html;
    propsEl.querySelectorAll('[data-k]').forEach(inp => {
      inp.onchange = () => applyProp(el, inp);
    });
    $('btn-del').onclick = () => {
      doc.elements = doc.elements.filter(x => x.id !== el.id);
      selectedId = null;
      commit(); render();
      setStatus('已删除元素');
    };
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function applyProp(el, inp) {
    const k = inp.dataset.k;
    const old = el[k];
    let v = inp.value;
    const err = $('prop-err');
    const fail = msg => { err.textContent = '已保留原值：' + msg; inp.value = old; };
    if (['x', 'y', 'w', 'h', 'fontSize', 'lineWidth'].includes(k)) {
      v = parseFloat(v);
      if (!isFinite(v)) return fail('必须是数字。');
      if ((k === 'w' || k === 'h') && v < 1) return fail('宽/高不能小于 1mm（排版规则：元素需可见且可印刷）。');
      if (k === 'fontSize' && (v < 4 || v > 72)) return fail('字号需在 4–72pt 之间（排版规则：保证可读性）。');
      if (k === 'lineWidth' && (v < 0 || v > 5)) return fail('描边宽需在 0–5mm 之间。');
    }
    if (k === 'text' && v.trim() === '') return fail('文字内容不能为空（可删除元素）。');
    if (k === 'bold') v = v === 'true';
    el[k] = v;
    commit();
    render();
    setStatus('已更新属性');
  }

  // ---- 工具栏 ----
  function addElement(el) {
    doc.elements.push(el);
    selectedId = el.id;
    commit(); render();
  }
  $('btn-add-text').onclick = () => addElement(Model.makeText(104, 95, 89, '双击编辑我', { fontSize: 12 }));
  $('btn-add-rect').onclick = () => addElement(Model.makeRect(120, 90, 40, 25));
  $('btn-add-ellipse').onclick = () => addElement(Model.makeEllipse(120, 90, 35, 35));

  $('btn-undo').onclick = () => {
    const d = history.undo();
    if (d) { doc = d; selectedId = null; render(); setStatus('已撤销'); }
  };
  $('btn-redo').onclick = () => {
    const d = history.redo();
    if (d) { doc = d; selectedId = null; render(); setStatus('已重做'); }
  };
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      (e.shiftKey ? $('btn-redo') : $('btn-undo')).click();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault(); $('btn-redo').click();
    }
  });

  $('btn-save').onclick = () => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(doc));
      setStatus(`已保存到浏览器本地存储（${doc.elements.length} 个元素，可随时重新载入）`);
    } catch (err) {
      setStatus('保存失败：' + err.message, true);
    }
  };
  $('btn-reload').onclick = () => {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return setStatus('本地存储中没有已保存的文档', true);
    try {
      const d = JSON.parse(raw);
      if (!d || !Array.isArray(d.elements) || !d.page) throw new Error('文档结构不完整');
      doc = d;
      history.reset(doc);
      selectedId = null;
      render();
      setStatus(`已重新载入（${doc.elements.length} 个元素，文字与图形均可继续编辑）`);
    } catch (err) {
      setStatus('载入失败，已保留当前文档：' + err.message, true);
    }
  };

  $('btn-fold-dir').onclick = () => {
    doc.foldDirection = doc.foldDirection === 'in' ? 'out' : 'in';
    $('btn-fold-dir').textContent = '折叠方向: ' + (doc.foldDirection === 'in' ? '内折' : '外折');
    commit(); render();
    setStatus('已切换折叠方向（仅视图变化，元素世界坐标不变）');
  };
  $('fold-angle').oninput = e => { foldAngleDeg = +e.target.value; render(); };
  $('zoom').oninput = e => { zoom = +e.target.value / 100; render(); };
  $('view-mode').onchange = e => { viewMode = e.target.value; render(); };

  // ---- 导出：有错误时阻止并说明 ----
  function guardExport() {
    const errs = Model.validate(doc).filter(v => v.level === 'error');
    if (errs.length) {
      viewMode = 'flat'; $('view-mode').value = 'flat';
      render();
      setStatus(`已阻止导出：存在 ${errs.length} 个排版错误。第一项 [${errs[0].rule}] ${errs[0].message} 修复：${errs[0].fix}`, true);
      return false;
    }
    return true;
  }
  $('btn-export-svg').onclick = () => {
    if (!guardExport()) return;
    Exporter.exportSVG(doc);
    setStatus('已导出 trifold.svg（展开图，与预览同一排版引擎）');
  };
  $('btn-export-png').onclick = () => {
    if (!guardExport()) return;
    Exporter.exportPNG(canvas);
    setStatus(`已导出 trifold.png（当前${viewMode === 'flat' ? '展开图' : '折叠透视'}视图）`);
  };

  // ---- 案例 ----
  function loadCase(fn, name) {
    doc = fn();
    history.reset(doc);
    selectedId = null;
    render();
    const errs = violations.filter(v => v.level === 'error').length;
    const warns = violations.filter(v => v.level === 'warn').length;
    setStatus(`已载入${name}：${doc.elements.length} 个元素；检查：${errs} 错误 / ${warns} 警告`);
  }
  $('btn-case-standard').onclick = () => loadCase(Cases.standard, '标准案例');
  $('btn-case-extreme').onclick = () => loadCase(Cases.extreme, '极端案例（超长文本 + 极小元素）');

  window.addEventListener('resize', resize);
  resize();

  // 自动化测试钩子：把第一个文字元素移到跨折线位置（可撤销）
  window.__test_moveFirst = () => {
    const el = doc.elements.find(e => e.type === 'text');
    if (el) { el.x = 90; commit(); render(); }
  };
})();
