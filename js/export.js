// PNG 导出：离屏 Canvas 重绘地图/图例/统计，数值直接取自当前 view，保证与屏幕一致。

import { GRID_COLS, GRID_ROWS } from './data.js';
import { LEVELS } from './pipeline.js';

function fmt(v, digits = 3) {
  return v === null || v === undefined ? '—' : Number(v).toFixed(digits);
}

export function exportPng(view) {
  const W = 1180;
  const H = 820;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0d141e';
  ctx.fillRect(0, 0, W, H);

  // 标题与当前筛选/窗口/口径（与界面状态条同源）。
  ctx.fillStyle = '#e8f1fb';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('栖息地适宜性地图导出', 24, 36);
  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#9fb6cc';
  ctx.fillText(`窗口: ${view.window.label}  统计口径: ${view.statsMode === 'all' ? '全部网格' : '筛选后'}  版本: ${view.version}`, 24, 60);
  const f = view.filter;
  ctx.fillText(
    `筛选: 适宜度[${fmt(f.scoreMin, 2)}, ${fmt(f.scoreMax, 2)}] 高程[${Math.round(f.elevMin)}, ${Math.round(f.elevMax)}] 等级{${f.levels.join(',')}}`,
    24, 80,
  );

  // 地图。
  const cellPx = 30;
  const ox = 24;
  const oy = 104;
  const visible = new Set(view.filteredCells.map((c) => c.cellId));
  for (const cell of view.allCells) {
    const x = ox + cell.col * cellPx;
    const y = oy + cell.row * cellPx;
    const e = cell.norm.elevation;
    const g = Math.round(60 + (0.32 + e * 0.5) * 150);
    ctx.fillStyle = `rgb(${g - 18},${g},${g - 26})`;
    ctx.fillRect(x, y, cellPx, cellPx);
    if (visible.has(cell.cellId)) {
      ctx.globalAlpha = 0.78;
      ctx.fillStyle = LEVELS.find((l) => l.id === cell.level).color;
      ctx.fillRect(x, y, cellPx, cellPx);
      ctx.globalAlpha = 1;
    } else {
      ctx.strokeStyle = 'rgba(10,14,20,0.55)';
      ctx.beginPath();
      ctx.moveTo(x, y + cellPx);
      ctx.lineTo(x + cellPx, y);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.strokeRect(x + 0.5, y + 0.5, cellPx - 1, cellPx - 1);
  }

  // 图例 + 等级计数（与界面图例同一 stats 对象）。
  let lx = 24;
  const ly = oy + GRID_ROWS * cellPx + 22;
  ctx.font = '13px sans-serif';
  for (const level of LEVELS) {
    ctx.fillStyle = level.color;
    ctx.fillRect(lx, ly, 15, 15);
    ctx.fillStyle = '#d6e2f0';
    const label = `${level.label} ${view.stats.byLevel[level.id] || 0}`;
    ctx.fillText(label, lx + 20, ly + 12);
    lx += 24 + ctx.measureText(label).width + 16;
  }

  // 统计摘要：数值与统计面板完全一致。
  const s = view.stats;
  const sx = ox + GRID_COLS * cellPx + 36;
  ctx.fillStyle = '#e8f1fb';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText('统计摘要', sx, 120);
  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#b9cce0';
  const lines = [
    `样本数: ${s.count}`,
    `均值: ${fmt(s.mean)}`,
    `中位数: ${fmt(s.median)}`,
    `最小: ${fmt(s.min)}`,
    `最大: ${fmt(s.max)}`,
    `标准差: ${fmt(s.std)}`,
    `管道: 去重${view.pipeline.dedupedRemoved} 异常${view.pipeline.anomalyCount} 补缺${view.pipeline.filledCount}`,
    `权重(归一): 高程${fmt(view.normalizedWeights.elevation)}`,
    `植被${fmt(view.normalizedWeights.ndvi)} 水源${fmt(view.normalizedWeights.water)}`,
  ];
  lines.forEach((line, i) => ctx.fillText(line, sx, 148 + i * 22));

  if (s.count === 0) {
    ctx.fillStyle = '#ff8a80';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('空结果：当前筛选下没有匹配网格', ox, ly + 56);
  }

  const stamp = new Date().toISOString();
  ctx.fillStyle = '#5e7388';
  ctx.font = '11px sans-serif';
  ctx.fillText(`导出时间 ${stamp}`, 24, H - 16);

  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = `habitat-${view.windowId}-${view.version}.png`;
  a.click();
  return {
    at: stamp,
    file: a.download,
    version: view.version,
    count: s.count,
    mean: s.mean,
  };
}
