/* 小时曲线 Canvas 与站点列表渲染，数据均来自同一 aggregate 结果。 */
(function (global) {
  const App = (global.App = global.App || {});
  const { hourLabel } = App.util;

  function drawSeries(ctx, points, color, width, height, pad) {
    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    points.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    });
  }

  function renderChart(canvas, result) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const pad = { left: 48, right: 16, top: 18, bottom: 34 };
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    const hours = result.agg.hours;
    if (hours.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('当前窗口无数据', width / 2, height / 2);
      return;
    }
    const maxVal = Math.max(1, ...hours.map((h) => h.total));
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const xAt = (i) => pad.left + (hours.length === 1 ? plotW / 2 : (i * plotW) / (hours.length - 1));
    const yAt = (v) => pad.top + plotH - (v / maxVal) * plotH;

    ctx.strokeStyle = '#e2e8f0';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    for (let g = 0; g <= 4; g++) {
      const val = (maxVal * g) / 4;
      const y = yAt(val);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();
      ctx.fillText(Math.round(val), pad.left - 6, y + 4);
    }
    ctx.textAlign = 'center';
    hours.forEach((h, i) => {
      ctx.fillStyle = '#64748b';
      ctx.fillText(hourLabel(h.hour), xAt(i), height - 12);
    });

    const series = [
      { key: 'total', color: '#1d4ed8' },
      { key: 'entry', color: '#059669' },
      { key: 'exit', color: '#d97706' },
      { key: 'transfer', color: '#7c3aed' },
    ];
    series.forEach((s) => {
      const points = hours.map((h, i) => ({ x: xAt(i), y: yAt(h[s.key]) }));
      drawSeries(ctx, points, s.color, width, height, pad);
    });

    const legend = [
      ['总量', '#1d4ed8'],
      ['进站', '#059669'],
      ['出站', '#d97706'],
      ['换乘', '#7c3aed'],
    ];
    ctx.textAlign = 'left';
    legend.forEach(([name, color], i) => {
      const lx = pad.left + i * 78;
      ctx.fillStyle = color;
      ctx.fillRect(lx, 4, 10, 10);
      ctx.fillStyle = '#334155';
      ctx.fillText(name, lx + 14, 13);
    });
  }

  function renderList(container, result, selectedId, onSelect) {
    const rows = result.agg.stations.slice().sort((a, b) => b.total - a.total);
    const maxTotal = Math.max(1, ...rows.map((r) => r.total));
    container.innerHTML = '';
    if (result.agg.matchedRecords === 0) {
      container.innerHTML = '<div class="empty-tip">当前筛选与窗口下没有任何刷卡记录（空结果）。</div>';
      return;
    }
    rows.forEach((s) => {
      const row = document.createElement('div');
      row.className = 'list-row' + (s.stationId === selectedId ? ' selected' : '');
      row.innerHTML =
        '<div class="list-head"><span class="list-name"></span><span class="list-total"></span></div>' +
        '<div class="list-bar"><i></i></div>' +
        '<div class="list-sub"></div>';
      row.querySelector('.list-name').textContent = s.name + (s.transfer ? '（换乘）' : '');
      row.querySelector('.list-total').textContent = s.total + ' 次';
      row.querySelector('.list-bar i').style.width = Math.round((s.total / maxTotal) * 100) + '%';
      row.querySelector('.list-sub').textContent =
        '进 ' + s.entry + ' / 出 ' + s.exit + ' / 换乘 ' + s.transfer;
      row.addEventListener('click', () => onSelect(s.stationId));
      container.appendChild(row);
    });
  }

  App.chart = { renderChart, renderList };
})(typeof window !== 'undefined' ? window : globalThis);
