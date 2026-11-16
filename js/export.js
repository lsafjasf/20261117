/* PNG 导出：离屏画布重绘。地图与曲线复用屏幕同一渲染函数与同一份聚合结果，
   因此导出图数值与屏幕严格一致；不允许硬编码任何预设结果。 */
(function (global) {
  const App = (global.App = global.App || {});
  const { hourLabel } = App.util;

  function drawHeader(ctx, result, summary, caliber, width) {
    const f = result.filters;
    const lineName =
      f.lineId === 'ALL' ? '全部线路' : App.network.LINES.find((l) => l.id === f.lineId).name;
    const transferName =
      f.transferType === 'all' ? '全部换乘类型' : f.transferType === 'transfer' ? '仅换乘' : '仅非换乘';
    const win = result.window;
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('公交刷卡站点热区 · 导出报告', 24, 38);
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#334155';
    const lines = [
      '数据集：' + summary.datasetName + '（' + summary.description + '）',
      '当前筛选：' + lineName + ' / ' + transferName,
      '时间窗口：' + win.name + ' ' + hourLabel(win.startHour) + '–' + hourLabel(win.endHour) +
        '（' + win.hours.map((h) => hourLabel(h)).join('、') + '）',
      caliber,
      '数据版本：' + result.version,
      '导出时间：' + App.util.formatTime(),
    ];
    lines.forEach((text, i) => ctx.fillText(text, 24, 68 + i * 20));
    ctx.strokeStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.moveTo(24, 68 + lines.length * 20 + 4);
    ctx.lineTo(width - 24, 68 + lines.length * 20 + 4);
    ctx.stroke();
    return 68 + lines.length * 20 + 20;
  }

  function drawSummaryTable(ctx, result, y0) {
    const rows = result.agg.stations.slice().sort((a, b) => b.total - a.total);
    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.fillText('站点统计（与屏幕列表同一数据版本）', 24, y0 + 16);
    const cols = ['站点', '进站', '出站', '换乘', '总量'];
    const x0 = 24;
    const colW = [200, 110, 110, 110, 110];
    let y = y0 + 38;
    ctx.font = '12px sans-serif';
    let x = x0;
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(x0, y - 14, colW.reduce((a, b) => a + b, 0), 22);
    ctx.fillStyle = '#334155';
    cols.forEach((c, i) => {
      ctx.fillText(c, x + 6, y + 2);
      x += colW[i];
    });
    y += 16;
    rows.forEach((s) => {
      x = x0;
      const vals = [s.name + (s.transfer ? '（换乘）' : ''), s.entry, s.exit, s.transfer, s.total];
      vals.forEach((v, i) => {
        ctx.fillText(String(v), x + 6, y + 2);
        x += colW[i];
      });
      y += 18;
    });
    return y + 8;
  }

  function exportPNG(result, summary, caliber) {
    const width = 1200;
    const headerH = 200;
    const mapCanvas = document.createElement('canvas');
    mapCanvas.width = 1152;
    mapCanvas.height = 620;
    App.mapView.renderMap(mapCanvas, result, { scale: 1, offsetX: 0, offsetY: 0 }, App.state.state.selectedStationId);

    const chartCanvas = document.createElement('canvas');
    chartCanvas.width = 1152;
    chartCanvas.height = 240;
    App.chart.renderChart(chartCanvas, result);

    const tableEstimate = result.agg.stations.length * 18 + 70;
    const height = headerH + 620 + 16 + 240 + 16 + tableEstimate + 40;
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    const afterHeader = drawHeader(ctx, result, summary, caliber, width);
    ctx.drawImage(mapCanvas, 24, afterHeader, 1152, 620);
    ctx.drawImage(chartCanvas, 24, afterHeader + 636, 1152, 240);
    drawSummaryTable(ctx, result, afterHeader + 892);

    out.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'bus-hotspot-' + result.version + '.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, 'image/png');

    const log = App.state.appendLog({
      filename: 'bus-hotspot-' + result.version + '.png',
      dataset: summary.datasetName,
      filters: result.filters,
      window: result.window.id,
      matchedRecords: result.agg.matchedRecords,
      version: result.version,
      pixelSize: width + 'x' + height,
    });
    return log;
  }

  App.exporter = { exportPNG };
})(typeof window !== 'undefined' ? window : globalThis);
