/* 交互层：状态提交（先校验后入历史）、撤销/重做、保存/载入、导出、批量与测试用例。 */
(function () {
  'use strict';

  var M = window.TicketModel;
  var R = window.TicketRender;
  var S = window.TicketSVG;
  var STORE_KEY = 'ticket-stub-project-v1';

  var state = M.defaults();
  var history = [];
  var hIndex = -1;
  var zoom = 1;

  var $ = function (id) { return document.getElementById(id); };
  var cv = $('cv');
  var errBox = $('errors');

  // ---------- 渲染与提示 ----------
  function render() {
    var scale = zoom;
    cv.width = (state.width + R.PAD * 2) * scale;
    cv.height = (state.height + R.PAD * 2) * scale;
    R.renderTicket(cv.getContext('2d'), state, scale);
  }

  function showErrors(errs) {
    if (errs && errs.length) {
      errBox.textContent = '⚠ 输入未应用，已保留原有内容：\n' + errs.join('\n');
      errBox.classList.add('show');
    } else {
      errBox.textContent = '';
      errBox.classList.remove('show');
    }
  }

  function syncInputs() {
    $('inTitle').value = state.title;
    $('inSession').value = state.session;
    $('inSeat').value = state.seat;
    $('inDate').value = state.date;
    $('inSerial').value = state.serial;
    $('selFont').value = state.fontFamily;
    $('rngFontScale').value = state.fontScale;
    $('rngTear').value = state.tearX;
    $('numW').value = state.width;
    $('numH').value = state.height;
    $('lblFontScale').textContent = '×' + state.fontScale.toFixed(2);
    $('lblTear').textContent = Math.round(state.tearX * 100) + '%';
    $('lblZoom').textContent = Math.round(zoom * 100) + '%';
    $('btnUndo').disabled = hIndex <= 0;
    $('btnRedo').disabled = hIndex >= history.length - 1;
  }

  // ---------- 历史 ----------
  function commit() {
    var snap = JSON.stringify(state);
    if (history[hIndex] === snap) return;
    history = history.slice(0, hIndex + 1);
    history.push(snap);
    hIndex = history.length - 1;
    localStorage.setItem(STORE_KEY, snap);
  }

  /* 所有修改的唯一入口：先构造候选状态并校验，
   * 通过才提交；失败则保留原状态并给出具体修复建议。 */
  function applyChange(patch, opts) {
    opts = opts || {};
    var candidate = Object.assign({}, state, patch);
    var errs = M.validate(candidate);
    if (errs.length) {
      showErrors(errs);
      return false; // 不丢失用户输入：输入框保留所键内容，预览保持上一有效状态
    }
    state = candidate;
    showErrors(null);
    if (!opts.defer) commit();
    render();
    syncInputs();
    return true;
  }

  function undo() {
    if (hIndex <= 0) return;
    hIndex--;
    state = JSON.parse(history[hIndex]);
    localStorage.setItem(STORE_KEY, history[hIndex]);
    showErrors(null); render(); syncInputs();
  }
  function redo() {
    if (hIndex >= history.length - 1) return;
    hIndex++;
    state = JSON.parse(history[hIndex]);
    localStorage.setItem(STORE_KEY, history[hIndex]);
    showErrors(null); render(); syncInputs();
  }

  // ---------- 保存 / 载入 ----------
  function saveProject() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    errBox.classList.remove('show');
    return true;
  }
  function reloadProject() {
    var raw = localStorage.getItem(STORE_KEY);
    if (!raw) { showErrors(['没有已保存的工程，请先点击"保存"。']); return; }
    loadFromJSON(raw, '本地存档');
  }
  function loadFromJSON(raw, source) {
    try {
      var obj = JSON.parse(raw);
      var candidate = Object.assign(M.defaults(), obj);
      var errs = M.validate(candidate);
      if (errs.length) { showErrors(errs.map(function (e) { return '[' + source + '] ' + e; })); return; }
      state = candidate;
      commit(); showErrors(null); render(); syncInputs();
    } catch (e) {
      showErrors(['[' + source + '] 文件解析失败：' + e.message + '。请确认是有效的工程 JSON。']);
    }
  }

  // ---------- 导出 ----------
  function download(name, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function exportSVG(st, name) {
    download(name, new Blob([S.buildSVG(st)], { type: 'image/svg+xml' }));
  }
  function exportPNG() {
    var scale = 2;
    var off = document.createElement('canvas');
    off.width = (state.width + R.PAD * 2) * scale;
    off.height = (state.height + R.PAD * 2) * scale;
    R.renderTicket(off.getContext('2d'), state, scale);
    off.toBlob(function (b) { download('ticket-' + state.serial + '.png', b); }, 'image/png');
  }
  function nextSerial(serial, i) {
    return serial.replace(/(\d+)(?!.*\d)/, function (m) {
      return String(parseInt(m, 10) + i).padStart(m.length, '0');
    });
  }
  function batchExport() {
    var n = Math.max(1, Math.min(200, parseInt($('numBatch').value, 10) || 1));
    var bad = [];
    for (var i = 0; i < n; i++) {
      var st = Object.assign({}, state, { serial: nextSerial(state.serial, i) });
      var errs = M.validate(st);
      if (errs.length) { bad.push('第 ' + (i + 1) + ' 张（' + st.serial + '）：' + errs[0]); break; }
    }
    if (bad.length) { showErrors(['批量导出已取消：'].concat(bad)); return; }
    for (var j = 0; j < n; j++) {
      var st2 = Object.assign({}, state, { serial: nextSerial(state.serial, j) });
      exportSVG(st2, 'ticket-' + st2.serial + '.svg');
    }
  }

  // ---------- 事件绑定 ----------
  function bindText(id, key) {
    $(id).addEventListener('change', function () {
      var patch = {}; patch[key] = this.value;
      applyChange(patch);
    });
  }
  bindText('inTitle', 'title');
  bindText('inSession', 'session');
  bindText('inSeat', 'seat');
  bindText('inDate', 'date');
  bindText('inSerial', 'serial');
  $('selFont').addEventListener('change', function () { applyChange({ fontFamily: this.value }); });
  $('rngFontScale').addEventListener('input', function () { applyChange({ fontScale: parseFloat(this.value) }, { defer: true }); });
  $('rngFontScale').addEventListener('change', function () { applyChange({ fontScale: parseFloat(this.value) }); });
  $('rngTear').addEventListener('input', function () { applyChange({ tearX: parseFloat(this.value) }, { defer: true }); });
  $('rngTear').addEventListener('change', function () { applyChange({ tearX: parseFloat(this.value) }); });
  $('numW').addEventListener('change', function () { applyChange({ width: parseInt(this.value, 10) }); });
  $('numH').addEventListener('change', function () { applyChange({ height: parseInt(this.value, 10) }); });
  $('rngZoom').addEventListener('input', function () { zoom = parseFloat(this.value); render(); syncInputs(); });

  $('btnUndo').addEventListener('click', undo);
  $('btnRedo').addEventListener('click', redo);
  document.addEventListener('keydown', function (e) {
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return; // 输入框内保留原生行为
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
  });
  $('btnSave').addEventListener('click', saveProject);
  $('btnReload').addEventListener('click', reloadProject);
  $('btnExportJSON').addEventListener('click', function () {
    download('ticket-project.json', new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
  });
  $('fileImport').addEventListener('change', function () {
    var f = this.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () { loadFromJSON(rd.result, f.name); };
    rd.readAsText(f);
    this.value = '';
  });
  $('btnExportSVG').addEventListener('click', function () { exportSVG(state, 'ticket-' + state.serial + '.svg'); });
  $('btnExportPNG').addEventListener('click', exportPNG);
  $('btnBatchSVG').addEventListener('click', batchExport);

  // ---------- 测试用例 ----------
  $('btnCaseStandard').addEventListener('click', function () { applyChange(M.defaults()); });
  $('btnCaseLong').addEventListener('click', function () {
    applyChange(Object.assign(M.defaults(), {
      title: '2026 国际现代戏剧节开幕大戏《漫长告别之夜》全球首演特别加场',
      session: '2026-12-31 23:59 跨年夜特别加长场次（含中场休息两次）',
      seat: 'VIP至尊包厢区 东区 第18排 236座',
      width: 1400, height: 320, fontScale: 0.7
    }));
  });
  $('btnCaseTiny').addEventListener('click', function () {
    applyChange(Object.assign(M.defaults(), {
      width: 200, height: 80, fontScale: 0.5,
      title: '影展', session: '01-01 10:00', seat: '1排1座', date: '01-01', serial: 'NO.1'
    }));
  });

  // ---------- 启动 ----------
  var saved = localStorage.getItem(STORE_KEY);
  if (saved) {
    try {
      var obj = Object.assign(M.defaults(), JSON.parse(saved));
      if (!M.validate(obj).length) state = obj;
    } catch (e) { /* 存档损坏则使用默认值 */ }
  }
  commit();
  render();
  syncInputs();
})();
