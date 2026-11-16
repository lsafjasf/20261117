/* 趋势图：把四类物理量按各自安全限值归一化绘制，越限区域红色警示。 */
(function (global) {
  'use strict';
  const CFG = global.CRANE_CFG;

  const SERIES = [
    { key: 'tension', color: '#5db3ff', label: '张力' },
    { key: 'speed', color: '#7dffa7', label: '速度' },
    { key: 'temp', color: '#ffb347', label: '温度' },
    { key: 'pressure', color: '#c78bff', label: '压力' }
  ];

  function norm(key, v) {
    const lim = CFG.limits[key];
    return (v - lim.min) / (lim.max - lim.min);
  }

  function drawTrend(ctx, state) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0d131b';
    ctx.fillRect(0, 0, W, H);

    // 越限红线（100% 限值）
    const yMax = 14;
    const yLimit = yMax;
    ctx.strokeStyle = 'rgba(255,80,80,0.8)';
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(0, yLimit); ctx.lineTo(W, yLimit);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ff8080';
    ctx.font = '10px sans-serif';
    ctx.fillText('安全上限 100%', 6, yLimit - 3);

    const hist = state.history;
    if (hist.length < 2) {
      ctx.fillStyle = '#7d8ca0';
      ctx.font = '12px sans-serif';
      ctx.fillText('运行后显示受力/变化趋势…', W / 2 - 80, H / 2);
      drawLegend(ctx, W);
      return;
    }
    const n = hist.length;
    const usableW = W - 130;
    SERIES.forEach((s) => {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * usableW;
        const y = yMax + Math.max(0, Math.min(1.25, norm(s.key, hist[i][s.key])))
          * (H - yMax - 12);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
    ctx.lineWidth = 1;
    drawLegend(ctx, W);
  }

  function drawLegend(ctx, W) {
    let y = 16;
    SERIES.forEach((s) => {
      ctx.fillStyle = s.color;
      ctx.fillRect(W - 118, y - 8, 12, 3);
      ctx.fillStyle = '#cdd8e3';
      ctx.font = '11px sans-serif';
      const cur = '';
      ctx.fillText(s.label, W - 100, y - 3);
      y += 18;
    });
    ctx.fillStyle = '#7d8ca0';
    ctx.fillText('虚线=限值', W - 118, y + 2);
  }

  global.CraneChart = { drawTrend, SERIES };
})(typeof window !== 'undefined' ? window : globalThis);
