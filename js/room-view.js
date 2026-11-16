// Canvas 房间渲染与拖拽交互。
import { ROOM, computeSpatial, pxToM } from './acoustics.js';

const SOURCE_COLORS = ['#48d597', '#ffcf6e', '#ff7676'];
const SPEAKERS = [
  { name: 'FL', x: 30, y: 30 }, { name: 'FR', x: ROOM.widthPx - 30, y: 30 },
  { name: 'BL', x: 30, y: ROOM.depthPx - 30 }, { name: 'BR', x: ROOM.widthPx - 30, y: ROOM.depthPx - 30 },
];

export class RoomView {
  constructor(canvas, state, onChange) {
    this.canvas = canvas;
    this.state = state;
    this.onChange = onChange;
    this.drag = null;
    this.hover = null;
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', () => { this.drag = null; });
    canvas.addEventListener('pointerleave', () => { this.drag = null; this.hover = null; this.draw(); });
  }

  toCanvas(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (this.canvas.width / rect.width),
      y: (e.clientY - rect.top) * (this.canvas.height / rect.height),
    };
  }

  hitTest(p) {
    if (Math.hypot(p.x - this.state.listener.x, p.y - this.state.listener.y) < 18) {
      return { kind: 'listener' };
    }
    for (const source of this.state.sources) {
      if (Math.hypot(p.x - source.x, p.y - source.y) < 18) {
        return { kind: 'source', id: source.id };
      }
    }
    return null;
  }

  clamp(p) {
    return {
      x: Math.max(12, Math.min(ROOM.widthPx - 12, p.x)),
      y: Math.max(12, Math.min(ROOM.depthPx - 12, p.y)),
    };
  }

  onDown(e) {
    const p = this.toCanvas(e);
    this.drag = this.hitTest(p);
    this.canvas.setPointerCapture(e.pointerId);
  }

  onMove(e) {
    const p = this.toCanvas(e);
    if (!this.drag) {
      this.hover = this.hitTest(p);
      this.canvas.style.cursor = this.hover ? 'grab' : 'crosshair';
      this.draw();
      return;
    }
    const next = this.clamp(p);
    if (this.drag.kind === 'listener') {
      this.state.listener = next;
    } else {
      const source = this.state.sources.find((s) => s.id === this.drag.id);
      source.x = next.x;
      source.y = next.y;
    }
    this.onChange();
    this.draw();
  }

  draw(activeStep = -1) {
    const ctx = this.canvas.getContext('2d');
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // 墙面与网格。
    ctx.fillStyle = '#121a28';
    ctx.fillRect(0, 0, ROOM.widthPx, ROOM.depthPx);
    ctx.strokeStyle = '#1d2a40';
    ctx.lineWidth = 1;
    for (let x = 90; x < ROOM.widthPx; x += 90) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ROOM.depthPx); ctx.stroke();
    }
    for (let y = 90; y < ROOM.depthPx; y += 90) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(ROOM.widthPx, y); ctx.stroke();
    }
    ctx.strokeStyle = '#3a4a68';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, ROOM.widthPx - 8, ROOM.depthPx - 8);

    // 四角扬声器。
    ctx.font = '11px sans-serif';
    SPEAKERS.forEach((sp) => {
      ctx.fillStyle = '#7f93b8';
      ctx.fillRect(sp.x - 7, sp.y - 7, 14, 14);
      ctx.fillStyle = '#aab6cb';
      ctx.fillText(sp.name, sp.x - 10, sp.y + 24);
    });

    // 声源到监听点的距离线与空间化标注。
    this.state.sources.forEach((source, i) => {
      const spatial = computeSpatial(this.state.mode, source, this.state.listener);
      ctx.strokeStyle = SOURCE_COLORS[i] + '66';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(this.state.listener.x, this.state.listener.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#8ea0bd';
      ctx.fillText(`${spatial.distanceM.toFixed(2)}m / ${spatial.delayMs.toFixed(1)}ms`,
        (source.x + this.state.listener.x) / 2 + 6,
        (source.y + this.state.listener.y) / 2 - 6);

      const lit = source.pattern[activeStep] === 1;
      ctx.beginPath();
      ctx.arc(source.x, source.y, lit ? 16 : 12, 0, Math.PI * 2);
      ctx.fillStyle = SOURCE_COLORS[i] + (lit ? '' : 'aa');
      ctx.fill();
      ctx.strokeStyle = lit ? '#ffffff' : SOURCE_COLORS[i];
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#0d1118';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(source.name.slice(-1), source.x - 4, source.y + 4);
      ctx.fillStyle = SOURCE_COLORS[i];
      ctx.font = '11px sans-serif';
      ctx.fillText(`${source.name} ${source.freq}Hz`, source.x + 16, source.y - 12);
    });

    // 监听点（人耳）。
    const l = this.state.listener;
    ctx.beginPath();
    ctx.arc(l.x, l.y, 11, 0, Math.PI * 2);
    ctx.fillStyle = '#2f6df6';
    ctx.fill();
    ctx.strokeStyle = '#cfe0ff';
    ctx.stroke();
    ctx.fillStyle = '#cfe0ff';
    ctx.font = '10px sans-serif';
    ctx.fillText('监听', l.x - 14, l.y - 16);

    ctx.fillStyle = '#6c7d99';
    ctx.fillText(`房间 ${ROOM.widthM}m × ${ROOM.depthM}m（1 格 = ${pxToM(90).toFixed(1)}m）`, 14, ROOM.depthPx - 14);
  }
}

export { SOURCE_COLORS };
