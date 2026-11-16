// Canvas 渲染：三段曲率轨道、线圈、车体与悬浮间隙、受力箭头、故障点
(function () {
  const SEG_COLORS = { 1: '#3b82f6', 2: '#f59e0b', 3: '#10b981' };
  const SEG_NAMES = { 1: '缓弯 R14m', 2: '急弯 R8m', 3: '大半径 R22m' };

  function roundRectPath(ctx, x, y, w, h, r) {
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      return;
    }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function Renderer(canvas, track) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.track = track;
    this.scale = 1;
    this.offX = 0;
    this.offY = 0;
    this.resize();
  }

  Renderer.prototype.resize = function () {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = rect.width;
    this.h = rect.height;
    const pts = this.track.pts;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pts.forEach(p => {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
    const pad = 46;
    this.scale = Math.min((this.w - pad * 2) / (maxX - minX),
      (this.h - pad * 2) / (maxY - minY));
    this.offX = (this.w - (maxX - minX) * this.scale) / 2 - minX * this.scale;
    this.offY = (this.h - (maxY - minY) * this.scale) / 2 - minY * this.scale;
  };

  Renderer.prototype.toScreen = function (x, y) {
    return [x * this.scale + this.offX, y * this.scale + this.offY];
  };

  Renderer.prototype.drawTrack = function () {
    const ctx = this.ctx, pts = this.track.pts;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // 轨道底板
    ctx.beginPath();
    pts.forEach((p, i) => {
      const [sx, sy] = this.toScreen(p.x, p.y);
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    });
    ctx.closePath();
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 13;
    ctx.stroke();
    // 按曲率段着色
    for (let id = 1; id <= 3; id++) {
      ctx.beginPath();
      let started = false;
      pts.forEach(p => {
        if (p.id !== id) return;
        const [sx, sy] = this.toScreen(p.x, p.y);
        if (!started) { ctx.moveTo(sx, sy); started = true; }
        else ctx.lineTo(sx, sy);
      });
      ctx.strokeStyle = SEG_COLORS[id];
      ctx.lineWidth = 5;
      ctx.stroke();
    }
    this.drawCoils();
  };

  Renderer.prototype.drawCoils = function () {
    const ctx = this.ctx;
    ctx.fillStyle = '#fbbf24';
    const step = Math.round(this.track.pts.length / 46);
    for (let i = 0; i < this.track.pts.length; i += step) {
      const p = this.track.pts[i];
      const [sx, sy] = this.toScreen(p.x, p.y);
      ctx.beginPath();
      ctx.arc(sx, sy, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  Renderer.prototype.drawCar = function (view, showForce) {
    const ctx = this.ctx;
    const [cx, cy] = this.toScreen(view.x, view.y);
    const angle = Math.atan2(view.ty, view.tx);
    const carLen = 2.1 * this.scale;
    const carW = 0.95 * this.scale;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    // 车体
    ctx.fillStyle = '#e2e8f0';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.5;
    roundRectPath(ctx, -carLen / 2, -carW / 2, carLen, carW, 5);
    ctx.fill();
    ctx.stroke();
    // 车载磁铁
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(-carLen * 0.28, carW / 2 - 2, carLen * 0.56, 4);
    // 朝向指示
    ctx.fillStyle = '#0ea5e9';
    ctx.beginPath();
    ctx.moveTo(carLen / 2, 0);
    ctx.lineTo(carLen / 2 - 8, -5);
    ctx.lineTo(carLen / 2 - 8, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 悬浮间隙标注（法向）
    const gx = view.x + view.nx * view.gap * 4;
    const gy = view.y + view.ny * view.gap * 4;
    const [px, py] = this.toScreen(gx, gy);
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(px, py);
    ctx.stroke();

    if (showForce) this.drawForces(view, cx, cy, angle);
  };

  Renderer.prototype.drawForces = function (view, cx, cy, angle) {
    const ctx = this.ctx;
    const k = 0.012 * this.scale;
    const arrows = [
      ['#ef4444', -view.Fm, '磁吸力'],
      ['#a855f7', view.Fspring, '弹簧'],
      ['#f59e0b', view.Fdamp, '阻尼']
    ];
    let off = -10;
    arrows.forEach(([color, val, label]) => {
      const len = Math.max(-26, Math.min(26, val * k));
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy + off);
      ctx.lineTo(cx, cy + off + len);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy + off + len, 2.5, 0, Math.PI * 2);
      ctx.fill();
      off += 10;
    });
  };

  Renderer.prototype.drawFault = function (fault) {
    if (!fault) return;
    const ctx = this.ctx;
    const [sx, sy] = this.toScreen(fault.x, fault.y);
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 3;
    const r = 11;
    ctx.beginPath();
    ctx.moveTo(sx - r, sy - r); ctx.lineTo(sx + r, sy + r);
    ctx.moveTo(sx + r, sy - r); ctx.lineTo(sx - r, sy + r);
    ctx.stroke();
    ctx.fillStyle = '#dc2626';
    ctx.font = '12px sans-serif';
    ctx.fillText('首次故障点 t=' + fault.time.toFixed(2) + 's', sx + 14, sy - 8);
  };

  Renderer.prototype.drawLegend = function () {
    const ctx = this.ctx;
    ctx.font = '12px sans-serif';
    let y = 18;
    Object.keys(SEG_COLORS).forEach(id => {
      ctx.fillStyle = SEG_COLORS[id];
      ctx.fillRect(12, y - 9, 14, 4);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(SEG_NAMES[id], 32, y - 4);
      y += 18;
    });
  };

  Renderer.prototype.render = function (view, fault, showForce) {
    this.ctx.clearRect(0, 0, this.w, this.h);
    this.drawTrack();
    this.drawCar(view, showForce);
    this.drawFault(fault);
    this.drawLegend();
  };

  window.Renderer = Renderer;
})();
