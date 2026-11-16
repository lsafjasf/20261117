// 趋势图：绘制最近若干秒内选定物理量的变化曲线，并标注安全上下限
(function () {
  const C = window.CONFIG;
  const METRICS = [
    { key: 'gap', label: '悬浮间隙 (mm)', scale: 1000, lim: C.limits.gap },
    { key: 'v', label: '速度 (m/s)', scale: 1, lim: C.limits.speed },
    { key: 'temp', label: '温度 (°C)', scale: 1, lim: C.limits.temp },
    { key: 'pressure', label: '压力 (kPa)', scale: 0.001, lim: C.limits.pressure }
  ];

  function TrendChart(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.metric = METRICS[0];
    this.resize();
  }

  TrendChart.prototype.resize = function () {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = rect.width;
    this.h = rect.height;
  };

  TrendChart.prototype.setMetric = function (key) {
    const m = METRICS.find(x => x.key === key);
    if (m) this.metric = m;
  };

  TrendChart.prototype.draw = function (frames) {
    const ctx = this.ctx, m = this.metric;
    ctx.clearRect(0, 0, this.w, this.h);
    const padL = 44, padR = 10, padT = 12, padB = 22;
    const cw = this.w - padL - padR, ch = this.h - padT - padB;

    const windowSec = C.sim.historySeconds;
    const now = frames.length ? frames[frames.length - 1].time : 0;
    const t0 = Math.max(0, now - windowSec);
    const visible = frames.filter(f => f.time >= t0);
    if (visible.length < 2) {
      ctx.fillStyle = '#64748b';
      ctx.font = '12px sans-serif';
      ctx.fillText('等待数据…', padL, padT + 20);
      return;
    }

    const vals = visible.map(f => f[m.key] * m.scale);
    const lim = m.lim;
    let lo = Math.min(...vals, lim.min * m.scale);
    let hi = Math.max(...vals, lim.max * m.scale);
    const span = (hi - lo) || 1;
    lo -= span * 0.1; hi += span * 0.1;

    const x = t => padL + ((t - t0) / windowSec) * cw;
    const y = v => padT + (1 - (v - lo) / (hi - lo)) * ch;

    // 网格与上下限
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + ch);
    ctx.lineTo(padL + cw, padT + ch);
    ctx.stroke();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#dc2626';
    [lim.min, lim.max].forEach(bound => {
      const yy = y(bound * m.scale);
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + cw, yy); ctx.stroke();
      ctx.fillStyle = '#f87171';
      ctx.font = '10px sans-serif';
      ctx.fillText((bound * m.scale).toFixed(1), padL + 2, yy - 2);
    });
    ctx.setLineDash([]);

    // 数据曲线
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    visible.forEach((f, i) => {
      const xx = x(f.time), yy = y(f[m.key] * m.scale);
      if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
    });
    ctx.stroke();

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '11px sans-serif';
    ctx.fillText(m.label, padL, padT - 2);
    ctx.fillText(t0.toFixed(1) + 's', padL, this.h - 6);
    ctx.fillText(now.toFixed(1) + 's', padL + cw - 24, this.h - 6);
  };

  window.TrendChart = TrendChart;
  window.TREND_METRICS = METRICS;
})();
