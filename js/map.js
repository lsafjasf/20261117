// Canvas 地图：地形晕渲底图 + 栖息地适宜性着色 + 选中/过滤态 + 命中检测。

import { GRID_COLS, GRID_ROWS } from './data.js';
import { LEVELS } from './pipeline.js';

const levelColor = (id) => LEVELS.find((l) => l.id === id).color;

function terrainShade(cell) {
  // 高程灰度 + 简单光照晕渲，纯展示用，不参与评分。
  const e = cell.norm.elevation;
  const light = 0.32 + e * 0.5;
  const g = Math.round(60 + light * 150);
  return `rgb(${g - 18}, ${g}, ${g - 26})`;
}

export class HabitatMap {
  constructor(canvas, onPick) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onPick = onPick;
    this.cellPx = 0;
    this.originX = 0;
    this.originY = 0;
    this.attachEvents();
  }

  attachEvents() {
    this.canvas.addEventListener('click', (e) => {
      const hit = this.hitTest(e.offsetX, e.offsetY);
      if (hit !== null) this.onPick(hit);
    });
  }

  hitTest(x, y) {
    const col = Math.floor((x - this.originX) / this.cellPx);
    const row = Math.floor((y - this.originY) / this.cellPx);
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return null;
    return row * GRID_COLS + col;
  }

  layout(view) {
    const { width, height } = this.canvas;
    const { zoom, offsetX, offsetY } = view.view;
    this.cellPx = Math.floor((Math.min(width, height * (GRID_COLS / GRID_ROWS)) - 24) / GRID_COLS) * zoom;
    const gridW = this.cellPx * GRID_COLS;
    const gridH = this.cellPx * GRID_ROWS;
    this.originX = (width - gridW) / 2 + offsetX;
    this.originY = (height - gridH) / 2 + offsetY;
  }

  draw(view) {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0f1620';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.layout(view);
    const visible = new Set(view.filteredCells.map((c) => c.cellId));

    for (const cell of view.allCells) {
      const x = this.originX + cell.col * this.cellPx;
      const y = this.originY + cell.row * this.cellPx;
      ctx.fillStyle = terrainShade(cell);
      ctx.fillRect(x, y, this.cellPx, this.cellPx);
      if (visible.has(cell.cellId)) {
        ctx.globalAlpha = 0.78;
        ctx.fillStyle = levelColor(cell.level);
        ctx.fillRect(x, y, this.cellPx, this.cellPx);
        ctx.globalAlpha = 1;
      } else {
        // 被过滤掉的格子打斜纹遮罩。
        ctx.strokeStyle = 'rgba(10,14,20,0.55)';
        ctx.beginPath();
        ctx.moveTo(x, y + this.cellPx);
        ctx.lineTo(x + this.cellPx, y);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.strokeRect(x + 0.5, y + 0.5, this.cellPx - 1, this.cellPx - 1);
    }

    if (view.selected) {
      const { col, row } = view.selected;
      const x = this.originX + col * this.cellPx;
      const y = this.originY + row * this.cellPx;
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(x + 1.5, y + 1.5, this.cellPx - 3, this.cellPx - 3);
      ctx.lineWidth = 1;
    }
    this.drawFrame(view);
  }

  drawFrame(view) {
    const { ctx } = this;
    ctx.strokeStyle = '#8fb4d9';
    ctx.strokeRect(this.originX - 1, this.originY - 1, this.cellPx * GRID_COLS + 2, this.cellPx * GRID_ROWS + 2);
    ctx.fillStyle = '#9fb6cc';
    ctx.font = '11px sans-serif';
    ctx.fillText(`N ↑  网格 ${GRID_COLS}×${GRID_ROWS}  版本 ${view.version}`, 10, 16);
  }
}
