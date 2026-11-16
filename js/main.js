/* UI 装配与交互：所有视图、列表、曲线、导出共用 state.currentResult() 单一数据版本。 */
(function () {
  const App = window.App;
  const { state } = App.state;
  const mapCanvas = document.getElementById('mapCanvas');
  const chartCanvas = document.getElementById('chartCanvas');
  const listEl = document.getElementById('stationList');

  const els = {
    dataset: document.getElementById('datasetSelect'),
    line: document.getElementById('lineSelect'),
    transfer: document.getElementById('transferSelect'),
    window: document.getElementById('windowSelect'),
    summary: document.getElementById('dataSummary'),
    filterBar: document.getElementById('filterBar'),
    version: document.getElementById('versionTag'),
    detail: document.getElementById('stationDetail'),
    log: document.getElementById('exportLog'),
    selftest: document.getElementById('selftestResult'),
  };

  function populateControls() {
    App.generate.DATASETS.forEach((d) => {
      els.dataset.add(new Option(d.name + '：' + d.description, d.id));
    });
    els.line.add(new Option('全部线路', 'ALL'));
    App.network.LINES.forEach((l) => els.line.add(new Option(l.name, l.id)));
    App.network.TRANSFER_TYPES.forEach((t) => els.transfer.add(new Option(t.name, t.id)));
    els.transfer.add(new Option('全部换乘类型', 'all'), 0);
    App.network.WINDOWS.forEach((w) => els.window.add(new Option(w.name, w.id)));
  }

  function renderSummary(result) {
    const s = App.state.dataSummary();
    const win = result.window;
    els.summary.innerHTML =
      '<b>' + s.datasetName + '</b> 原始 ' + s.rawCount + ' 条 · 清洗后 ' + s.cleanCount + ' 条' +
      ' · 去重 ' + s.duplicatesRemoved + ' · 非法 ' + s.invalidCount +
      ' · 截断 ' + s.outlierTruncated + ' · 补缺 ' + s.filledCount + ' 桶';
    const lineName =
      result.filters.lineId === 'ALL'
        ? '全部线路'
        : App.network.LINES.find((l) => l.id === result.filters.lineId).name;
    const transferName =
      result.filters.transferType === 'all'
        ? '全部换乘类型'
        : result.filters.transferType === 'transfer'
        ? '仅换乘'
        : '仅非换乘';
    els.filterBar.innerHTML =
      '当前筛选：<b>' + lineName + '</b> ｜ 换乘：<b>' + transferName + '</b>' +
      ' ｜ 时间窗口：<b>' + win.name + ' ' + App.util.hourLabel(win.startHour) +
      '–' + App.util.hourLabel(win.endHour) + '</b> ｜ 口径：' + App.state.caliberText().replace('口径：', '') +
      ' ｜ 命中记录 <b>' + result.agg.matchedRecords + '</b> 条';
    els.version.textContent = '数据版本 ' + result.version;
  }

  function renderDetail(result) {
    const id = state.selectedStationId;
    if (!id) {
      els.detail.innerHTML = '<span class="muted">点击站点查看进出量与换乘量</span>';
      return;
    }
    const s = result.agg.stations.find((x) => x.stationId === id);
    if (!s) {
      els.detail.innerHTML = '<span class="muted">该站点在当前筛选下无数据</span>';
      return;
    }
    els.detail.innerHTML =
      '<b>' + s.name + '</b>' + (s.transfer ? '（换乘站）' : '') +
      ' ｜ 进站 <b>' + s.entry + '</b> ｜ 出站 <b>' + s.exit +
      '</b> ｜ 换乘 <b>' + s.transfer + '</b> ｜ 总量 <b>' + s.total + '</b>';
  }

  function renderLog() {
    const log = App.state.readLog();
    if (log.length === 0) {
      els.log.innerHTML = '<div class="muted">暂无导出记录</div>';
      return;
    }
    els.log.innerHTML = log
      .map(
        (e) =>
          '<div class="log-row"><span class="log-time">' + e.time + '</span> 导出 <code>' +
          e.filename + '</code> · ' + e.dataset + ' · 窗口 ' + e.window +
          ' · 命中 ' + e.matchedRecords + ' 条 · ' + e.pixelSize +
          '<br><span class="muted">版本 ' + e.version + '</span></div>'
      )
      .join('');
  }

  function renderAll() {
    const result = App.state.currentResult();
    els.dataset.value = state.datasetId;
    els.line.value = state.filters.lineId;
    els.transfer.value = state.filters.transferType;
    els.window.value = state.windowId;
    renderSummary(result);
    App.mapView.renderMap(mapCanvas, result, state.view, state.selectedStationId);
    App.chart.renderChart(chartCanvas, result);
    App.chart.renderList(listEl, result, state.selectedStationId, (id) => {
      App.state.setSelected(id === state.selectedStationId ? null : id);
      renderAll();
    });
    renderDetail(result);
    return result;
  }

  function bindControls() {
    els.dataset.addEventListener('change', (e) => {
      App.state.switchDataset(e.target.value);
      renderAll();
    });
    els.line.addEventListener('change', (e) => {
      App.state.setFilters({ lineId: e.target.value });
      renderAll();
    });
    els.transfer.addEventListener('change', (e) => {
      App.state.setFilters({ transferType: e.target.value });
      renderAll();
    });
    els.window.addEventListener('change', (e) => {
      App.state.setWindow(e.target.value);
      renderAll();
    });
    document.getElementById('exportBtn').addEventListener('click', () => {
      const result = App.state.currentResult();
      App.exporter.exportPNG(result, App.state.dataSummary(), App.state.caliberText());
      renderLog();
    });
    document.getElementById('resetViewBtn').addEventListener('click', () => {
      App.state.setView({ scale: 1, offsetX: 0, offsetY: 0 });
      renderAll();
    });
    document.getElementById('selftestBtn').addEventListener('click', () => {
      const report = App.selftest.run();
      els.selftest.innerHTML = report
        .map((r) => '<div class="' + (r.pass ? 'test-pass' : 'test-fail') + '">' +
          (r.pass ? '✓' : '✗') + ' ' + r.name + (r.pass ? '' : ' — ' + r.detail) + '</div>')
        .join('');
    });
  }

  function bindMap() {
    let dragging = false;
    let last = null;
    mapCanvas.addEventListener('mousedown', (e) => {
      dragging = true;
      last = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('mouseup', () => {
      dragging = false;
      last = null;
    });
    mapCanvas.addEventListener('mousemove', (e) => {
      if (!dragging || !last) return;
      App.state.setView({
        offsetX: state.view.offsetX + (e.clientX - last.x) * (mapCanvas.width / mapCanvas.getBoundingClientRect().width),
        offsetY: state.view.offsetY + (e.clientY - last.y) * (mapCanvas.height / mapCanvas.getBoundingClientRect().height),
      });
      last = { x: e.clientX, y: e.clientY };
      const result = App.state.currentResult();
      App.mapView.renderMap(mapCanvas, result, state.view, state.selectedStationId);
    });
    mapCanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      App.state.setView({ scale: App.util.clamp(state.view.scale * factor, 0.5, 4) });
      const result = App.state.currentResult();
      App.mapView.renderMap(mapCanvas, result, state.view, state.selectedStationId);
    }, { passive: false });
    mapCanvas.addEventListener('click', (e) => {
      const result = App.state.currentResult();
      const world = App.mapView.screenToWorld(mapCanvas, state.view, e.clientX, e.clientY);
      const hit = App.mapView.hitTest(result, world);
      App.state.setSelected(hit ? hit.stationId : null);
      renderAll();
    });
  }

  populateControls();
  bindControls();
  bindMap();
  document.addEventListener('app:selection-changed', renderAll);
  renderAll();
  renderLog();
})();
