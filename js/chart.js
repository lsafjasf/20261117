// 适宜性分布直方图 + 累计曲线，以及图例。全部读同一个 view 模型。

import { LEVELS } from './pipeline.js';

const BINS = 10;

export class HistogramChart {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  draw(view) {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#111a26';
    ctx.fillRect(0, 0, w, h);

    const padL = 38;
    const padB = 24;
    const padT = 12;
    const plotW = w - padL - 10;
    const plotH = h - padB - padT;
    const cells = view.filteredCells;

    const counts = new Array(BINS).fill(0);
    for (const c of cells) {
      const idx = Math.min(BINS - 1, Math.floor(c.score * BINS));
      counts[idx] += 1;
    }
    const maxCount = Math.max(1, ...counts);
    const binW = plotW / BINS;

    ctx.strokeStyle = '#33415a';
    ctx.font = '10px sans-serif';
    for (let i = 0; i <= 4; i += 1) {
      const y = padT + (plotH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - 10, y);
      ctx.stroke();
      ctx.fillStyle = '#7d92ab';
      ctx.fillText(String(Math.round(maxCount * (1 - i / 4))), 6, y + 3);
    }

    for (let b = 0; b < BINS; b += 1) {
      const barH = (counts[b] / maxCount) * plotH;
      const x = padL + b * binW;
      const y = padT + plotH - barH;
      const midScore = (b + 0.5) / BINS;
      const level = LEVELS.find((l) => l.id === (
        midScore >= 0.75 ? 'high' : midScore >= 0.5 ? 'medium' : midScore >= 0.25 ? 'low' : 'poor'
      ));
      ctx.fillStyle = level.color;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x + 1, y, binW - 2, barH);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#7d92ab';
      ctx.fillText((b / BINS).toFixed(1), x, h - 8);
    }

    // 累计分布曲线（基于当前筛选后的同一批单元格）。
    const total = Math.max(1, cells.length);
    let acc = 0;
    ctx.strokeStyle = '#57c7e8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    counts.forEach((cnt, b) => {
      acc += cnt;
      const x = padL + (b + 1) * binW;
      const y = padT + plotH - (acc / total) * plotH;
      if (b === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = '#9fb6cc';
    ctx.fillText(`n=${cells.length}  累计曲线→`, padL, padT + 10);
  }
}

export function drawLegend(canvas, view) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = '12px sans-serif';
  let x = 8;
  for (const level of LEVELS) {
    ctx.fillStyle = level.color;
    ctx.fillRect(x, 6, 14, 14);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.strokeRect(x + 0.5, 6.5, 13, 13);
    const n = view.stats.byLevel[level.id] || 0;
    ctx.fillStyle = '#d6e2f0';
    const label = `${level.label} ${n}`;
    ctx.fillText(label, x + 19, 18);
    x += 19 + ctx.measureText(label).width + 14;
  }
  ctx.fillStyle = '#7d92ab';
  ctx.fillText('（计数随筛选与统计口径同步）', x, 18);
}
