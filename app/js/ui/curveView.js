import { DEPTH_TICK_M } from '../core/constants.js';

const MARGIN = { left: 56, right: 16, top: 30, bottom: 22 };
const PANEL_W = 230;

export class CurveView {
  constructor(canvas, store) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.store = store;
    this.unsub = store.subscribe(() => this.render());
    this.render();
  }

  render() {
    const { model, view } = this.store.snapshot();
    const ctx = this.ctx;
    const top = view?.depthTop ?? 0;
    const bottom = view?.depthBottom ?? (model.maxDepth || 10);
    const span = Math.max(1, bottom - top);
    const count = Math.max(1, model.columns.length);
    const width = MARGIN.left + count * PANEL_W + MARGIN.right;
    const height = MARGIN.top + span * 9 + MARGIN.bottom;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (model.filtered.empty) {
      ctx.fillStyle = '#888';
      ctx.font = '13px sans-serif';
      ctx.fillText('当前筛选/时间窗口无测井数据（空结果）', MARGIN.left, 40);
      return;
    }

    model.columns.forEach((col, i) => this.drawPanel(col, i, { top, bottom, span, height }));
  }

  drawPanel(col, i, range) {
    const { model } = this.store.snapshot();
    const ctx = this.ctx;
    const x0 = MARGIN.left + i * PANEL_W;
    const plotW = PANEL_W - 18;
    const yOf = (d) => MARGIN.top + (d - range.top) * 9;
    const series = model.resampled[col.boreholeId];
    const meta = model.filtered.boreholes.find((b) => b.id === col.boreholeId);

    ctx.fillStyle = '#222';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(`${meta ? meta.name : col.boreholeId} GR`, x0, 18);

    const vals = series.grid.filter((g) => g.gr !== null).map((g) => g.gr);
    const max = vals.length ? Math.max(...vals) : 100;
    const min = vals.length ? Math.min(...vals) : 0;
    const xOf = (gr) => x0 + (gr - min) / Math.max(1e-6, max - min) * plotW;

    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0, MARGIN.top, plotW, (range.bottom - range.top) * 9);
    for (let d = Math.ceil(range.top / DEPTH_TICK_M) * DEPTH_TICK_M; d <= range.bottom; d += DEPTH_TICK_M) {
      const y = yOf(d);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + plotW, y); ctx.stroke();
      ctx.fillStyle = '#666';
      ctx.font = '10px sans-serif';
      ctx.fillText(`${d}`, x0 - 30, y + 3);
    }
    ctx.fillStyle = '#666';
    ctx.fillText(min.toFixed(0), x0, MARGIN.top + (range.bottom - range.top) * 9 + 14);
    ctx.fillText(max.toFixed(0), x0 + plotW - 12, MARGIN.top + (range.bottom - range.top) * 9 + 14);

    ctx.strokeStyle = '#1f6fb2';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    let pen = false;
    for (const g of series.grid) {
      if (g.depth < range.top || g.depth > range.bottom) continue;
      const y = yOf(g.depth);
      if (g.gr === null) { pen = false; continue; }
      const x = xOf(g.gr);
      if (!pen) { ctx.moveTo(x, y); pen = true; } else { ctx.lineTo(x, y); }
    }
    ctx.stroke();
  }
}
