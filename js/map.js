/* Canvas 地图：线路、热区、站点与标签。屏幕渲染与 PNG 导出共用同一纯绘制函数。 */
(function (global) {
  const App = (global.App = global.App || {});
  const { STATIONS, LINES, stationById } = App.network;

  const HEAT_COLORS = {
    high: 'rgba(220, 38, 38, 0.30)',
    mid: 'rgba(234, 88, 12, 0.26)',
    low: 'rgba(245, 158, 11, 0.22)',
    none: 'rgba(107, 114, 128, 0.10)',
  };

  function heatColor(total, maxTotal) {
    if (total === 0) return HEAT_COLORS.none;
    const ratio = total / Math.max(1, maxTotal);
    if (ratio >= 0.66) return HEAT_COLORS.high;
    if (ratio >= 0.33) return HEAT_COLORS.mid;
    return HEAT_COLORS.low;
  }

  function applyTransform(ctx, view, width, height) {
    const baseScale = Math.min(width / 1000, height / 620);
    const padX = (width - 1000 * baseScale) / 2;
    const padY = (height - 620 * baseScale) / 2;
    ctx.setTransform(
      baseScale * view.scale,
      0,
      0,
      baseScale * view.scale,
      padX + view.offsetX,
      padY + view.offsetY
    );
    return { baseScale, padX, padY };
  }

  function drawLinePaths(ctx) {
    LINES.forEach((line) => {
      ctx.beginPath();
      line.stationIds.forEach((id, i) => {
        const s = stationById[id];
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.strokeStyle = line.color;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.globalAlpha = 1;
    });
  }

  function drawHotspots(ctx, stationMetrics, radii) {
    const maxTotal = Math.max(1, ...stationMetrics.map((s) => s.total));
    stationMetrics.forEach((s, i) => {
      const radius = radii[i];
      if (radius === 0) return;
      const gradient = ctx.createRadialGradient(s.x, s.y, 2, s.x, s.y, radius);
      gradient.addColorStop(0, heatColor(s.total, maxTotal));
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawStations(ctx, stationMetrics, selectedId, view) {
    const fontScale = 1 / view.scale;
    stationMetrics.forEach((s) => {
      const selected = s.stationId === selectedId;
      ctx.beginPath();
      ctx.arc(s.x, s.y, selected ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = s.transfer ? '#7c3aed' : '#0f172a';
      ctx.fill();
      ctx.lineWidth = selected ? 2.5 : 1.5;
      ctx.strokeStyle = '#fff';
      ctx.stroke();

      ctx.font = 13 * fontScale + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const label = s.name + (s.total > 0 ? ' ' + s.total : '');
      const tw = ctx.measureText(label).width;
      const lx = s.x - tw / 2 - 4 * fontScale;
      const ly = s.y + 11 * fontScale;
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.fillRect(lx, ly, tw + 8 * fontScale, 18 * fontScale);
      ctx.strokeStyle = 'rgba(15,23,42,0.25)';
      ctx.lineWidth = fontScale;
      ctx.strokeRect(lx, ly, tw + 8 * fontScale, 18 * fontScale);
      ctx.fillStyle = '#0f172a';
      ctx.fillText(label, s.x, s.y + 13 * fontScale);
    });
  }

  function renderMap(canvas, result, view, selectedId) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, width, height);
    const t = applyTransform(ctx, view, width, height);
    drawLinePaths(ctx);
    drawHotspots(ctx, result.agg.stations, result.radii);
    drawStations(ctx, result.agg.stations, selectedId, view);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return t;
  }

  // 屏幕坐标 → 世界坐标
  function screenToWorld(canvas, view, clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const px = (clientX - rect.left) * (canvas.width / rect.width);
    const py = (clientY - rect.top) * (canvas.height / rect.height);
    const baseScale = Math.min(canvas.width / 1000, canvas.height / 620);
    const padX = (canvas.width - 1000 * baseScale) / 2;
    const padY = (canvas.height - 620 * baseScale) / 2;
    return {
      x: (px - padX - view.offsetX) / (baseScale * view.scale),
      y: (py - padY - view.offsetY) / (baseScale * view.scale),
    };
  }

  function hitTest(result, world) {
    let hit = null;
    let best = 14;
    result.agg.stations.forEach((s) => {
      const d = Math.hypot(s.x - world.x, s.y - world.y);
      if (d < best) {
        best = d;
        hit = s;
      }
    });
    return hit;
  }

  App.mapView = { renderMap, screenToWorld, hitTest, heatColor };
})(typeof window !== 'undefined' ? window : globalThis);
