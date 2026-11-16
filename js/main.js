/* 主控：装配数据管线、视图渲染、筛选联动、摘要栏、列表与导出日志 */
(function (root) {
  'use strict';
  var RF = root.RF;

  function $(id) { return document.getElementById(id); }

  var processed = {};
  Object.keys(RF.datasets.DATASETS).forEach(function (id) {
    processed[id] = RF.pipeline.process(RF.datasets.DATASETS[id]);
  });

  var state = new RF.AppState(processed);
  var tooltip = $('tooltip');
  var mapView = new RF.MapView($('cv-map'), state, tooltip);
  var chartView = new RF.ChartView($('cv-chart'), state, tooltip);
  var heatView = new RF.HeatView($('cv-heat'), state, tooltip);
  var views = { map: mapView, chart: chartView, heat: heatView };

  var logEl = $('log');
  function log(msg, level) {
    var li = document.createElement('li');
    if (level) li.className = level;
    var time = new Date().toTimeString().slice(0, 8);
    li.innerHTML = '<b>' + time + '</b> ' + msg;
    logEl.insertBefore(li, logEl.firstChild);
    while (logEl.children.length > 80) logEl.removeChild(logEl.lastChild);
  }

  function renderSummary() {
    var d = state.data();
    var visible = state.visibleStations();
    var t = d.totals;
    var modeText = state.mode === 'cumulative' ? '累计雨量（mm）' : '瞬时雨强（mm/h）';
    var empty = visible.length === 0;
    var html = [
      chip('数据集', d.datasetName + '（原始 ' + t.rawCount + ' 条）'),
      chip('数据版本', d.version, 'ok'),
      chip('统计口径', modeText),
      chip('时间窗口', RF.util.hourToISO(state.window[0]) + ' ～ ' +
        RF.util.hourToISO(state.window[1]) + '（' +
        (state.window[1] - state.window[0] + 1) + 'h）'),
      chip('游标时刻', RF.util.hourToISO(state.cursor)),
      chip('阈值筛选', '≥ ' + state.threshold + ' mm/h'),
      chip('站点', '选中 ' + state.selected.length + ' / 可见 ' + visible.length +
        ' / 共 12', empty ? 'bad' : 'ok'),
      chip('去重', '移除 ' + t.dupRemoved + ' 条重复'),
      chip('数据质量', '异常 ' + t.anomalyCells + ' · 补缺 ' + t.filledCells +
        ' · 仍缺 ' + t.missingCells, t.anomalyCells + t.missingCells ? 'warn' : 'ok'),
      chip('结果状态', empty ? '空结果' : '正常', empty ? 'bad' : 'ok')
    ];
    $('summary').innerHTML = html.join('');
    $('btn-back').disabled = !state.canBack();
  }

  function chip(k, v, cls) {
    return '<span class="chip"><span class="k">' + k +
      '</span><span class="v ' + (cls || '') + '">' + v + '</span></span>';
  }

  function renderTable() {
    var d = state.data();
    var visible = state.visibleStations();
    var tbody = $('station-table').querySelector('tbody');
    tbody.innerHTML = '';
    visible.forEach(function (st) {
      var agg = RF.pipeline.aggregate(d.grid[st.id], state.window[0], state.window[1]);
      var tr = document.createElement('tr');
      if (state.selected.indexOf(st.id) >= 0) tr.className = 'selected';
      var tags = '';
      if (agg.missing) tags += '<span class="tag miss">缺' + agg.missing + '</span>';
      if (agg.filled) tags += '<span class="tag fill">补' + agg.filled + '</span>';
      if (agg.anomalous) tags += '<span class="tag bad">异' + agg.anomalous + '</span>';
      if (!tags) tags = '<span class="tag" style="background:#22344f;color:#93a4bd">完整</span>';
      tr.innerHTML =
        '<td>' + st.id + ' ' + st.name + '</td>' +
        '<td>' + agg.valid + '</td>' +
        '<td>' + agg.missing + '</td>' +
        '<td>' + agg.filled + '</td>' +
        '<td>' + RF.util.fmt(agg.total, 2) + '</td>' +
        '<td>' + RF.util.fmt(agg.maxInstant, 2) + '</td>' +
        '<td>' + RF.util.fmt(agg.mean, 2) + '</td>' +
        '<td>' + RF.util.pct(agg.missingRate) + '</td>' +
        '<td>' + tags + '</td>';
      tr.addEventListener('click', function () { state.toggleStation(st.id); });
      tbody.appendChild(tr);
    });
    $('list-empty').hidden = visible.length !== 0;
  }

  function renderAll(reason) {
    mapView.render();
    chartView.render();
    heatView.render();
    renderSummary();
    renderTable();
    if (reason) log('视图已按「' + reason + '」重绘，版本 ' + state.data().version);
  }

  state.subscribe(renderAll);

  function renderVerify() {
    var results = RF.tests.runAll();
    var box = $('verify-results');
    box.innerHTML = '';
    var pass = 0;
    results.forEach(function (r) {
      if (r.pass) pass++;
      var div = document.createElement('div');
      div.className = 'case ' + (r.pass ? 'pass' : 'fail');
      div.title = r.pass ? '通过' : r.error;
      div.innerHTML = '<span class="dot">' + (r.pass ? '✓' : '✗') +
        '</span> ' + r.name;
      box.appendChild(div);
    });
    log('验证完成：' + pass + '/' + results.length + ' 项通过',
      pass === results.length ? 'ok' : 'bad');
  }

  function bindControls() {
    $('sel-dataset').addEventListener('change', function (ev) {
      state.setDataset(ev.target.value);
      log('切换数据集 → ' + RF.datasets.DATASETS[ev.target.value].name, 'warn');
    });
    $('sel-mode').addEventListener('change', function (ev) {
      state.setMode(ev.target.value);
      log('切换口径 → ' + (ev.target.value === 'cumulative' ? '累计模式' : '瞬时模式'));
    });
    $('in-threshold').addEventListener('change', function (ev) {
      state.setThreshold(ev.target.value);
      log('阈值调整为 ≥ ' + state.threshold + ' mm/h', 'warn');
    });
    $('btn-back').addEventListener('click', function () {
      if (state.back()) {
        syncControls();
        log('已切回前一条件，窗口/选择/阈值均恢复', 'ok');
      }
    });
    $('btn-reset').addEventListener('click', function () {
      state.saveCheckpoint();
      state.window = [0, RF.util.HOURS - 1];
      state.cursor = 48;
      state.threshold = 0;
      state.selected = RF.stations.STATIONS.map(function (s) { return s.id; });
      syncControls();
      state.emit('reset');
      log('已重置当前数据集的窗口、阈值与选择', 'warn');
    });
    $('btn-export-png').addEventListener('click', function () {
      var r = RF.exporter.exportPNG(state, views);
      var name = 'rainfall_' + r.meta.datasetId + '_' + r.meta.version + '.png';
      RF.exporter.download(name, r.dataUrl);
      state.exportSeq++;
      log('导出 PNG：' + name + '（' + r.width + '×' + r.height +
        '，窗口 ' + r.meta.window[0] + '-' + r.meta.window[1] + '，屏幕同源）', 'ok');
    });
    $('btn-export-csv').addEventListener('click', function () {
      var r = RF.exporter.exportCSV(state);
      var name = 'rainfall_' + r.meta.datasetId + '_' + r.meta.version + '.csv';
      var blob = new Blob(['﻿' + r.text], { type: 'text/csv;charset=utf-8' });
      RF.exporter.download(name, URL.createObjectURL(blob));
      state.exportSeq++;
      log('导出 CSV：' + name + '（' + r.rows.length + ' 个站点行，版本 ' +
        r.meta.version + '）', r.rows.length ? 'ok' : 'warn');
    });
    $('btn-verify').addEventListener('click', renderVerify);
    window.addEventListener('resize', function () { renderAll(); });
  }

  function syncControls() {
    $('sel-dataset').value = state.datasetId;
    $('sel-mode').value = state.mode;
    $('in-threshold').value = state.threshold;
  }

  bindControls();
  renderVerify();
  renderAll('init');
  log('初始化完成：三组数据已通过同一管线处理，版本分别为 ' +
    Object.keys(processed).map(function (id) {
      return id + '=' + processed[id].version;
    }).join('，'), 'ok');
  root.__RAIN_APP__ = { state: state, processed: processed, views: views };
})(typeof window !== 'undefined' ? window : globalThis);
