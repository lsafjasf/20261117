// Canvas 可视化：事件时间线 + 声道分布/立体声场
import { EVENT_META } from './engine.js';
const TYPE_ORDER = [null, 'success', 'warning', 'error'];
export class Visualizer {
  constructor(timelineCanvas, stereoCanvas, sequencer, engine) {
    this.tl = timelineCanvas.getContext('2d');
    this.st = stereoCanvas.getContext('2d');
    this.seq = sequencer;
    this.engine = engine;
    this.recent = [];
    this.playheadStep = -1;
    sequencer.onStep = (i) => {
      this.playheadStep = i;
      const type = sequencer.pattern[i];
      if (type) {
        this.recent.push({ type, pan: engine.params[type].pan, t: performance.now() });
        if (this.recent.length > 40) this.recent.shift();
      }
    };
  }
  cyclePattern(stepIndex) {
    const cur = this.seq.pattern[stepIndex];
    const next = TYPE_ORDER[(TYPE_ORDER.indexOf(cur) + 1) % TYPE_ORDER.length];
    this.seq.pattern[stepIndex] = next;
  }
  handleTimelineClick(x, canvas) {
    const w = canvas.width;
    const n = this.seq.pattern.length;
    const cell = w / n;
    const idx = Math.floor(x / cell);
    if (idx >= 0 && idx < n) this.cyclePattern(idx);
  }
  draw() {
    this.drawTimeline();
    this.drawStereo();
  }
  drawTimeline() {
    const ctx = this.tl;
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.clearRect(0, 0, W, H);
    const n = this.seq.pattern.length;
    const cell = W / n;
    for (let i = 0; i < n; i++) {
      const type = this.seq.pattern[i];
      ctx.fillStyle = '#171b21';
      ctx.fillRect(i * cell + 2, 8, cell - 4, H - 16);
      ctx.strokeStyle = '#2c333d';
      ctx.strokeRect(i * cell + 2, 8, cell - 4, H - 16);
      if (type) {
        const meta = EVENT_META[type];
        ctx.fillStyle = meta.color;
        const bh = H - 40;
        ctx.fillRect(i * cell + 8, 20, cell - 16, bh);
        ctx.fillStyle = '#12151a';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(meta.label, i * cell + cell / 2, 20 + bh / 2 + 4);
      }
      ctx.fillStyle = '#6b7a8a';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), i * cell + cell / 2, H - 12);
    }
    if (this.seq.playing && this.playheadStep >= 0) {
      ctx.strokeStyle = '#7cc7ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(this.playheadStep * cell + 2, 8, cell - 4, H - 16);
      ctx.lineWidth = 1;
    }
  }
  drawStereo() {
    const ctx = this.st;
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.clearRect(0, 0, W, H);
    const midY = H / 2;
    ctx.strokeStyle = '#2c333d';
    ctx.beginPath();
    ctx.moveTo(20, midY);
    ctx.lineTo(W - 20, midY);
    ctx.stroke();
    ctx.fillStyle = '#6b7a8a';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('L', 20, midY - 8);
    ctx.fillText('C', W / 2, midY - 8);
    ctx.fillText('R', W - 20, midY - 8);
    const lv = this.engine.getLevels();
    if (lv.bufL && lv.bufR) {
      ctx.strokeStyle = 'rgba(124,199,255,0.5)';
      ctx.beginPath();
      const scale = H * 0.9;
      const step = 8;
      for (let i = 0; i < lv.bufL.length; i += step) {
        const x = W / 2 + lv.bufL[i] * scale;
        const y = midY - lv.bufR[i] * scale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    const now = performance.now();
    for (const ev of this.recent) {
      const age = (now - ev.t) / 2000;
      if (age > 1) continue;
      const meta = EVENT_META[ev.type];
      const x = W / 2 + ev.pan * (W / 2 - 40);
      const y = midY + 30 + age * 40;
      ctx.globalAlpha = 1 - age;
      ctx.fillStyle = meta.color;
      ctx.beginPath();
      ctx.arc(x, y, 8 * (1 - age * 0.5), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    const db = (v) => (v > 1e-6 ? 20 * Math.log10(v) : -80);
    const bar = (x, val, label) => {
      const h = Math.max(0, Math.min(1, (db(val) + 60) / 60)) * (H - 60);
      ctx.fillStyle = '#2a323d';
      ctx.fillRect(x, 20, 14, H - 60);
      ctx.fillStyle = '#4ade80';
      ctx.fillRect(x, 20 + (H - 60 - h), 14, h);
      ctx.fillStyle = '#9fb3c8';
      ctx.fillText(label, x + 7, 14);
    };
    bar(44, lv.l || 0, 'L');
    bar(W - 58, lv.r || 0, 'R');
  }
}
