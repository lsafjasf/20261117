// Canvas 渲染：玻璃轮廓、磨轮、火花、水流全部由仿真状态驱动。
import { BURN_TEMP, CRACK_LIMIT } from './config.js';

const SPARK_POOL = 90;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sparks = Array.from({ length: SPARK_POOL }, () => this._deadSpark());
    this.drops = Array.from({ length: 40 }, () => ({ x: 0, y: 0, vy: 0, life: 0 }));
  }

  _deadSpark() {
    return { x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1 };
  }

  _glassPath(ctx, cx, cy, radius, arc, progress) {
    const start = -Math.PI / 2 - arc / 2;
    const end = start + arc * Math.max(0.02, progress);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, end);
  }

  _emitSparks(x, y, pressure, feed) {
    const count = Math.round(pressure / 18);
    for (let i = 0; i < count; i += 1) {
      const slot = this.sparks.find((s) => s.life <= 0);
      if (!slot) return;
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      const speed = 1.2 + feed * 0.12 + Math.random() * 1.5;
      slot.x = x;
      slot.y = y;
      slot.vx = Math.cos(angle) * speed;
      slot.vy = Math.sin(angle) * speed;
      slot.life = slot.max = 18 + Math.random() * 20;
    }
  }

  _updateSparks() {
    for (const s of this.sparks) {
      if (s.life <= 0) continue;
      s.x += s.vx;
      s.y += s.vy;
      s.vy += 0.08;
      s.life -= 1;
    }
  }

  _updateDrops(coolant, nozzleX, nozzleY) {
    for (const d of this.drops) {
      if (d.life > 0) {
        d.y += d.vy;
        d.life -= 1;
      } else if (Math.random() < coolant / 25) {
        d.x = nozzleX + (Math.random() - 0.5) * 10;
        d.y = nozzleY;
        d.vy = 2 + Math.random() * 2;
        d.life = 26 + Math.random() * 14;
      }
    }
  }

  draw(sim) {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0e1420';
    ctx.fillRect(0, 0, w, h);

    const current = sim.glasses[sim.currentIndex];
    const cx = w / 2;
    const cy = h * 0.62;
    const baseRadius = Math.min(w * 0.14, h * 0.26);
    const slot = Math.min(230, (w - 80) / sim.glasses.length);

    sim.glasses.forEach((glass, idx) => {
      const offset = (idx - (sim.glasses.length - 1) / 2) * slot;
      const radius = baseRadius * (90 / glass.radius + 0.72);
      const gx = cx + offset;
      const progress = Math.min(1, glass.work / glass.workRequired);
      const isCurrent = idx === sim.currentIndex && sim.status !== 'completed';
      this._drawGlass(ctx, gx, cy, radius, glass, progress, isCurrent, idx);
    });

    if (current && sim.status !== 'completed') {
      const radius = baseRadius * (90 / current.radius + 0.72);
      const angle = -Math.PI / 2 - current.arc / 2 + current.arc *
        Math.min(1, current.work / current.workRequired);
      const contactX = cx + radius * Math.cos(angle);
      const contactY = cy + radius * Math.sin(angle);
      this._drawWheel(ctx, contactX, contactY, sim);
      const nozzleX = contactX + 34;
      const nozzleY = contactY - 46;
      this._drawNozzle(ctx, nozzleX, nozzleY, sim.params.coolant);
      if (sim.status === 'running') {
        this._emitSparks(contactX, contactY, sim.params.pressure, sim.params.feed);
        this._updateDrops(sim.params.coolant, nozzleX, nozzleY + 8);
      }
    }
    this._updateSparks();
    this._drawSparks(ctx);
    this._drawDrops(ctx);
    this._drawStatusBanner(ctx, w, sim);
  }

  _drawGlass(ctx, x, y, radius, glass, progress, isCurrent, idx) {
    ctx.save();
    ctx.lineCap = 'round';
    // 未磨到的轮廓（暗）
    this._glassPath(ctx, x, y, radius, glass.arc, 1);
    ctx.strokeStyle = 'rgba(120,150,190,0.25)';
    ctx.lineWidth = 14;
    ctx.stroke();
    // 已磨轮廓
    this._glassPath(ctx, x, y, radius, glass.arc, progress);
    const heatRatio = Math.min(1, (glass.heat - 25) / (BURN_TEMP - 25));
    const goodColor = glass.done && glass.pass ? '#4ade80' : '#7dd3fc';
    ctx.strokeStyle = glass.burn ? '#f97316'
      : glass.cracked ? '#ef4444'
      : isCurrent ? this._heatColor(heatRatio)
      : goodColor;
    ctx.lineWidth = 14;
    ctx.stroke();
    // 裂纹
    if (glass.crack > 0) this._drawCracks(ctx, x, y, radius, glass);
    // 缺陷位置标记
    glass.defects.forEach((d) => {
      const a = -Math.PI / 2 - glass.arc / 2 + glass.arc * d.position;
      const dx = x + radius * Math.cos(a);
      const dy = y + radius * Math.sin(a);
      ctx.fillStyle = d.type === 'burn' ? '#fb923c' : '#f87171';
      ctx.beginPath();
      ctx.arc(dx, dy - 14, 4.5, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = isCurrent ? '#e2e8f0' : '#64748b';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${glass.id} ${glass.label}`, x, y + radius + 34);
    ctx.restore();
  }

  _heatColor(ratio) {
    const r = Math.round(125 + ratio * 120);
    const g = Math.round(211 - ratio * 150);
    return `rgb(${r},${g},220)`;
  }

  _drawCracks(ctx, x, y, radius, glass) {
    const intensity = Math.min(1, glass.crack / CRACK_LIMIT);
    ctx.strokeStyle = `rgba(239,68,68,${0.4 + intensity * 0.6})`;
    ctx.lineWidth = 1.5;
    const n = Math.max(1, Math.round(intensity * 5));
    for (let i = 0; i < n; i += 1) {
      const a = -Math.PI / 2 + (i - n / 2) * 0.22;
      ctx.beginPath();
      ctx.moveTo(x + radius * Math.cos(a), y + radius * Math.sin(a));
      ctx.lineTo(x + (radius - 18) * Math.cos(a + 0.1), y + (radius - 18) * Math.sin(a + 0.1));
      ctx.stroke();
    }
  }

  _drawWheel(ctx, x, y, sim) {
    ctx.save();
    ctx.translate(x, y);
    if (sim.status === 'running') ctx.rotate((sim.clock * 9) % (Math.PI * 2));
    ctx.fillStyle = sim.status === 'shutdown' ? '#475569' : '#94a3b8';
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i += 1) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(15 * Math.cos((i / 6) * Math.PI * 2), 15 * Math.sin((i / 6) * Math.PI * 2));
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawNozzle(ctx, x, y, coolant) {
    ctx.fillStyle = '#334155';
    ctx.fillRect(x - 5, y - 10, 10, 14);
    if (coolant > 0) {
      ctx.fillStyle = 'rgba(96,165,250,0.9)';
      ctx.fillRect(x - 3, y + 2, 6, 4);
    }
  }

  _drawSparks(ctx) {
    for (const s of this.sparks) {
      if (s.life <= 0) continue;
      const alpha = s.life / s.max;
      ctx.fillStyle = `rgba(253,${150 + Math.round(80 * alpha)},40,${alpha})`;
      ctx.fillRect(s.x, s.y, 2.5, 2.5);
    }
  }

  _drawDrops(ctx) {
    ctx.fillStyle = 'rgba(96,165,250,0.75)';
    for (const d of this.drops) {
      if (d.life <= 0) continue;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawStatusBanner(ctx, w, sim) {
    const map = {
      idle: ['待机', '#94a3b8'], running: ['研磨中', '#4ade80'], paused: ['已暂停', '#facc15'],
      shutdown: [`停机：${sim.shutdownReason}`, '#f87171'], completed: ['批次完成', '#4ade80'],
    };
    const [text, color] = map[sim.status] || map.idle;
    ctx.fillStyle = color;
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(text, 18, 28);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '13px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`clock ${sim.clock.toFixed(1)}s  缓存 ${sim.cache.length}  能耗 ${sim.energyKwh.toFixed(4)}kWh`, w - 18, 28);
  }
}
