/* 导出：PNG 合成图 + CSV；数值全部取自当前状态（与屏幕同源，不写死预设） */
(function (root) {
  'use strict';
  var RF = root.RF;

  function currentMeta(state) {
    var d = state.data();
    return {
      dataset: d.datasetName,
      datasetId: d.datasetId,
      mode: state.mode === 'cumulative' ? '累计雨量(mm)' : '瞬时雨强(mm/h)',
      window: state.window,
      threshold: state.threshold,
      version: d.version,
      pipeline: d.pipelineVersion,
      selectedCount: state.selected.length
    };
  }

  function exportPNG(state, views) {
    var W = 1280;
    var headerH = 110, footerH = 64;
    var heights = [380, 340, 330];
    var H = headerH + heights.reduce(function (a, b) { return a + b + 18; }, 0) + footerH;
    var out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    var ctx = out.getContext('2d');
    ctx.fillStyle = '#0f1623';
    ctx.fillRect(0, 0, W, H);

    var m = currentMeta(state);
    ctx.fillStyle = '#e6edf7';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('雨量观测导出 · ' + m.dataset, 24, 34);
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#93a4bd';
    var line1 = '口径：' + m.mode + ' ｜ 时间窗口：' + RF.util.hourToISO(m.window[0]) +
      ' 至 ' + RF.util.hourToISO(m.window[1]) + '（' +
      (m.window[1] - m.window[0] + 1) + ' 小时）';
    var line2 = '阈值：≥' + m.threshold + ' mm/h ｜ 选中站点：' + m.selectedCount +
      ' ｜ 数据版本：' + m.version + '（' + m.pipeline + '）';
    ctx.fillText(line1, 24, 60);
    ctx.fillText(line2, 24, 82);

    var sources = [
      { cv: views.map.canvas, title: '站点地图' },
      { cv: views.chart.canvas, title: '雨量曲线' },
      { cv: views.heat.canvas, title: '时间热区' }
    ];
    var y = headerH;
    sources.forEach(function (src) {
      ctx.fillStyle = '#182234';
      ctx.fillRect(12, y, W - 24, heights[sources.indexOf(src)] + 18);
      ctx.fillStyle = '#c7d4e8';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText(src.title, 24, y + 18);
      var drawW = W - 48;
      var drawH = heights[sources.indexOf(src)];
      ctx.drawImage(src.cv, 24, y + 26, drawW, drawH);
      y += heights[sources.indexOf(src)] + 18;
    });

    ctx.fillStyle = '#93a4bd';
    ctx.font = '12px monospace';
    var stamp = '导出时间 ' + new Date().toISOString() + ' ｜ 数值与屏幕当前窗口同源 ｜ 版本 ' + m.version;
    ctx.fillText(stamp, 24, H - 24);

    return {
      dataUrl: out.toDataURL('image/png'),
      width: W,
      height: H,
      meta: m
    };
  }

  function buildRows(state) {
    var visible = state.visibleStations();
    var d = state.data();
    return visible.map(function (st) {
      var agg = RF.pipeline.aggregate(d.grid[st.id], state.window[0], state.window[1]);
      return {
        id: st.id,
        name: st.name,
        selected: state.selected.indexOf(st.id) >= 0 ? '是' : '否',
        valid: agg.valid,
        filled: agg.filled,
        missing: agg.missing,
        anomalous: agg.anomalous,
        total: agg.total === null ? '' : agg.total.toFixed(2),
        maxInstant: agg.maxInstant === null ? '' : agg.maxInstant.toFixed(2),
        mean: agg.mean === null ? '' : agg.mean.toFixed(2),
        missingRate: (agg.missingRate * 100).toFixed(1) + '%'
      };
    });
  }

  function exportCSV(state) {
    var m = currentMeta(state);
    var rows = buildRows(state);
    var lines = [
      '# 雨量数据导出',
      '# 数据集,' + m.datasetId + ' ' + m.dataset,
      '# 统计口径,' + m.mode,
      '# 时间窗口,' + RF.util.hourToISO(m.window[0]) + ' ~ ' +
        RF.util.hourToISO(m.window[1]),
      '# 阈值(mm/h),' + m.threshold,
      '# 数据版本,' + m.version,
      '# 管线,' + m.pipeline,
      ['站点', '名称', '当前选中', '有效h', '补缺h', '缺失h', '异常h',
        '窗口累计mm', '最大瞬时mm/h', '均值mm/h', '缺失率'].join(',')
    ];
    rows.forEach(function (r) {
      lines.push([r.id, r.name, r.selected, r.valid, r.filled, r.missing, r.anomalous,
        r.total, r.maxInstant, r.mean, r.missingRate].join(','));
    });
    if (!rows.length) lines.push('# 空结果：当前筛选条件下没有匹配站点');
    return { text: lines.join('\n'), rows: rows, meta: m };
  }

  function download(filename, href) {
    var a = document.createElement('a');
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  RF.exporter = {
    exportPNG: exportPNG,
    exportCSV: exportCSV,
    buildRows: buildRows,
    currentMeta: currentMeta,
    download: download
  };
})(typeof window !== 'undefined' ? window : globalThis);
