import { LITHOLOGY, DEPTH_TICK_M } from '../core/constants.js';
import { paintTexture } from './texture.js';
import { computeGeometry, AXIS_W, COL_W, TOP_PAD, BOTTOM_PAD, ROW_H } from './geometry.js';

export class ColumnView {
  constructor(canvas, store, onSelect) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.store = store;
    this.onSelect = onSelect;
    this.hitBoxes = [];
    canvas.addEventListener('click', (e) => this.handleClick(e));
    this.unsub = store.subscribe(() => this.render());
    this.render();
  }

  layout(model, view) {
    return computeGeometry(model, view);
  }

  render() {
    const { model, view } = this.store.snapshot();
    const ctx = this.ctx;
    const L = this.layout(model, view);
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = L.width * dpr;
    this.canvas.height = L.height * dpr;
    this.canvas.style.width = `${L.width}px`;
    this.canvas.style.height = `${L.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, L.width, L.height);
    this.hitBoxes = [];

    if (model.columns.length === 0) {
      ctx.fillStyle = '#888';
      ctx.font = '13px sans-serif';
      ctx.fillText('空结果：当前没有选中任何钻孔，请在平面图中选择钻孔。', 12, 40);
      return;
    }

    this.drawAxis(L);
    model.columns.forEach((col, i) => this.drawColumn(col, i, L, model));
    if (model.columns.length === 2) this.drawCorrelation(model, L);
  }

  drawAxis(L) {
    const ctx = this.ctx;
    ctx.strokeStyle = '#555';
    ctx.fillStyle = '#333';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    const first = Math.ceil(L.top / DEPTH_TICK_M) * DEPTH_TICK_M;
    for (let d = first; d <= L.bottom + 0.001; d += DEPTH_TICK_M) {
      const y = L.yOf(d);
      if (y < TOP_PAD - 2 || y > L.height - BOTTOM_PAD + 2) continue;
      ctx.beginPath();
      ctx.moveTo(AXIS_W - 10, y); ctx.lineTo(AXIS_W - 2, y); ctx.stroke();
      ctx.fillText(`${d}`, AXIS_W - 13, y + 4);
    }
    ctx.save();
    ctx.translate(14, (L.height + TOP_PAD) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('深度 (m)', 0, 0);
    ctx.restore();
    ctx.textAlign = 'left';
  }

  drawColumn(col, i, L, model) {
    const ctx = this.ctx;
    const x = L.colX(i);
    const meta = model.filtered.boreholes.find((b) => b.id === col.boreholeId);
    ctx.fillStyle = '#222';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(meta ? meta.name : col.boreholeId, x + COL_W / 2, 18);
    ctx.textAlign = 'left';

    for (const u of col.units) {
      if (u.bottom <= L.top || u.top >= L.bottom) continue;
      const y0 = L.yOf(Math.max(u.top, L.top));
      const y1 = L.yOf(Math.min(u.bottom, L.bottom));
      const h = Math.max(1, y1 - y0);
      const selected = this.isSelected(u);
      if (u.kind === 'gap') {
        ctx.fillStyle = '#f4f4f2';
        ctx.fillRect(x, y0, COL_W, h);
        ctx.save();
        ctx.beginPath(); ctx.rect(x, y0, COL_W, h); ctx.clip();
        ctx.strokeStyle = '#b8b8b0'; ctx.lineWidth = 1.5;
        for (let xx = x - h; xx < x + COL_W + h; xx += 8) {
          ctx.beginPath(); ctx.moveTo(xx, y0); ctx.lineTo(xx + h, y0 + h); ctx.stroke();
        }
        ctx.restore();
      } else {
        ctx.fillStyle = LITHOLOGY[u.lithoId].color;
        ctx.fillRect(x, y0, COL_W, h);
        paintTexture(ctx, LITHOLOGY[u.lithoId].texture, x, y0, COL_W, h);
      }
      ctx.strokeStyle = '#444';
      ctx.lineWidth = selected ? 2.4 : 0.8;
      ctx.strokeRect(x + (selected ? 1 : 0), y0, COL_W - (selected ? 2 : 0), h);
      if (h > 16) {
        ctx.fillStyle = u.kind === 'gap' ? '#777' : '#222';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(u.kind === 'gap' ? '缺失段' : u.lithoName, x + COL_W / 2, y0 + h / 2 + 3);
        ctx.textAlign = 'left';
      }
      this.hitBoxes.push({ x, y: y0, w: COL_W, h, unit: u });
    }
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x, TOP_PAD, COL_W, (L.bottom - L.top) * ROW_H);
  }

  isSelected(u) {
    const sel = this.store.snapshot().state.selectedUnit;
    return sel && sel.boreholeId === u.boreholeId && sel.top === u.top && sel.bottom === u.bottom;
  }

  drawCorrelation(model, L) {
    const ctx = this.ctx;
    const xA = L.colX(0) + COL_W;
    const xB = L.colX(1);
    ctx.lineWidth = 1.4;
    for (const line of model.correlation.lines) {
      const yA = L.yOf(line.a.depth);
      const yB = L.yOf(line.b.depth);
      if (yA < TOP_PAD || yB < TOP_PAD) continue;
      ctx.strokeStyle = LITHOLOGY[line.lithoId].color;
      ctx.beginPath();
      ctx.moveTo(xA, yA);
      ctx.lineTo(xB, yB);
      ctx.stroke();
    }
  }

  handleClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    for (const box of this.hitBoxes) {
      if (px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h) {
        this.onSelect(box.unit);
        return;
      }
    }
    this.onSelect(null);
  }

  // 供导出模块复用的几何参数，保证屏幕与 SVG 同一比例
  geometry() {
    const { model, view } = this.store.snapshot();
    return this.layout(model, view);
  }
}
