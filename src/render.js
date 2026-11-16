// Canvas 渲染：巷道、风机、风门、风流粒子与仪表

import { CONFIG, STATIONS } from './engine.js';

export class MineView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.lastSpawn = 0;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = rect.width;
    this.h = rect.height;
  }

  render(state, simClock) {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    this._drawTunnel();
    this._updateParticles(state, simClock);
    this._drawFan(state);
    this._drawDoor(state);
    this._drawZones(state);
    this._drawOverlays(state);
  }

  _drawTunnel() {
    const { ctx, w, h } = this;
    const top = h * 0.22;
    const bottom = h * 0.78;
    ctx.fillStyle = '#1c2430';
    ctx.fillRect(0, top, w, bottom - top);
    ctx.strokeStyle = '#3a4759';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, top);
    ctx.lineTo(w, top);
    ctx.moveTo(0, bottom);
    ctx.lineTo(w, bottom);
    ctx.stroke();
    // 中线分隔两个工作面
    ctx.setLineDash([8, 10]);
    ctx.strokeStyle = '#46586f';
    ctx.beginPath();
    ctx.moveTo(w * 0.62, top);
    ctx.lineTo(w * 0.62, bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    // 支架
    ctx.strokeStyle = '#2f3b4c';
    ctx.lineWidth = 3;
    for (let x = 40; x < w; x += 90) {
      ctx.beginPath();
      ctx.arc(x, (top + bottom) / 2, 26, Math.PI * 0.5, Math.PI * 1.5);
      ctx.stroke();
    }
  }

  _updateParticles(state, clock) {
    const speed = 0.0006 + state.fan / 100 * 0.0022;
    if (clock - this.lastSpawn > 90) {
      this.lastSpawn = clock;
      const lane = Math.random() < state.door / 100 ? 0 : 1;
      this.particles.push({
        x: 70,
        lane,
        y: lane === 0 ? this.h * 0.38 : this.h * 0.62,
        life: 1,
      });
    }
    for (const p of this.particles) {
      const backflow = state.zones[p.lane]?.backflow;
      p.x += (backflow ? -1 : 1) * speed * (16 + state.fan * 0.5);
      p.life -= 0.006;
    }
    this.particles = this.particles.filter((p) => p.x < this.w - 20 && p.life > 0);
    const ctx = this.ctx;
    for (const p of this.particles) {
      const z = state.zones[p.lane];
      ctx.fillStyle = z?.backflow ? '#e0604d' : z?.safe ? '#6fd3c9' : '#e8b04b';
      ctx.globalAlpha = Math.max(p.life, 0.2);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  _drawFan(state) {
    const { ctx, h } = this;
    const x = 48;
    const y = h * 0.5;
    const st = state.stations.upstream;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#243040';
    ctx.strokeStyle = st.protected ? '#e0604d' : '#7fa8d6';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.rotate(performance.now() * 0.01 * (state.fan / 50));
    ctx.strokeStyle = '#9fc3e8';
    ctx.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(10, -8, 20, 0);
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = '#c7d3e0';
    ctx.font = '12px sans-serif';
    ctx.fillText('上游风机', x - 24, y + 46);
  }

  _drawDoor(state) {
    const { ctx, w, h } = this;
    const x = w * 0.4;
    const y = h * 0.5;
    const angle = ((state.door - 50) / 30) * 0.9;
    const st = state.stations.downstream;
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = '#3a4759';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(0, -h * 0.26);
    ctx.lineTo(0, h * 0.26);
    ctx.stroke();
    ctx.rotate(angle);
    ctx.fillStyle = st.protected ? '#7a3b32' : '#3d5670';
    ctx.strokeStyle = st.protected ? '#e0604d' : '#9fc3e8';
    ctx.lineWidth = 2;
    ctx.fillRect(-5, -h * 0.24, 10, h * 0.48);
    ctx.strokeRect(-5, -h * 0.24, 10, h * 0.48);
    ctx.restore();
    ctx.fillStyle = '#c7d3e0';
    ctx.font = '12px sans-serif';
    ctx.fillText('下游风门', x - 24, y + h * 0.3);
  }

  _drawZones(state) {
    const { ctx, w, h } = this;
    const labels = ['A 工作面', 'B 工作面'];
    state.zones.forEach((z, i) => {
      const x = w * (0.66 + i * 0.17);
      const y = h * (i === 0 ? 0.36 : 0.64);
      ctx.fillStyle = z.safe ? 'rgba(70,160,130,0.18)' : 'rgba(200,90,70,0.22)';
      ctx.strokeStyle = z.safe ? '#46a082' : '#c85a46';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x - 60, y - 34, 120, 68, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#dbe5ef';
      ctx.font = 'bold 13px sans-serif';
      ctx.fillText(labels[i], x - 40, y - 14);
      ctx.font = '11px sans-serif';
      ctx.fillStyle = z.safe ? '#8fd8c0' : '#f0a08e';
      ctx.fillText(z.safe ? '安全' : z.unsafeReasons[0] || '异常', x - 40, y + 4);
      ctx.fillStyle = '#9fb2c6';
      ctx.fillText(`瓦斯 ${z.gas.toFixed(1)}%`, x - 40, y + 20);
      ctx.fillText(`风 ${z.flow.toFixed(1)} 压 ${z.pressure.toFixed(1)}`, x - 40, y + 32);
    });
  }

  _drawOverlays(state) {
    const { ctx, w, h } = this;
    if (state.status === 'paused') this._banner('已暂停', '#e8c468');
    if (state.status === 'succeeded') this._banner('任务成功：两区域安全 10 分钟', '#6fd3a0');
    if (state.status === 'failed') this._banner(`任务失败：${state.failReason}`, '#e0604d');
    for (const id of ['upstream', 'downstream']) {
      const st = state.stations[id];
      if (st.protected) {
        ctx.fillStyle = 'rgba(224,96,77,0.92)';
        const x = id === 'upstream' ? 24 : w * 0.4 - 70;
        ctx.fillRect(x, 12, 140, 26);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(`${STATIONS[id].label} 保护中`, x + 10, 29);
      }
    }
  }

  _banner(text, color) {
    const { ctx, w, h } = this;
    ctx.fillStyle = 'rgba(10,15,22,0.72)';
    ctx.fillRect(0, h * 0.42, w, 56);
    ctx.fillStyle = color;
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(text, w / 2, h * 0.42 + 37);
    ctx.textAlign = 'left';
  }
}
