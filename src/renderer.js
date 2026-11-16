/* global DBConfig */
/** Canvas 剖面渲染：海水分层、深度刻度、取样点、钟体与脐带缆绳。 */
(function () {
  'use strict';
  const C = window.DBConfig;

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.W = canvas.width;
    this.H = canvas.height;
    this.margin = { top: 20, bottom: 24, left: 56, right: 24 };
  }

  Renderer.prototype._scale = function () {
    const usableH = this.H - this.margin.top - this.margin.bottom;
    return {
      y: (depth) => this.margin.top + (depth / C.MAX_DEPTH) * usableH,
      x: (drift) => this.W / 2 + drift * 14
    };
  };

  Renderer.prototype.draw = function (snap) {
    const ctx = this.ctx;
    const sc = this._scale();
    ctx.clearRect(0, 0, this.W, this.H);
    this._drawWater(ctx, sc);
    this._drawScale(ctx, sc);
    this._drawStations(ctx, sc, snap);
    this._drawCable(ctx, sc, snap);
    this._drawBell(ctx, sc, snap);
    this._drawCurrent(ctx, snap);
  };

  Renderer.prototype._drawWater = function (ctx) {
    // 深度分层条纹
    const bands = 8;
    const bandH = (this.H - this.margin.top - this.margin.bottom) / bands;
    for (let i = 0; i < bands; i++) {
      ctx.fillStyle = 'rgba(255,255,255,' + (0.025 - i * 0.002) + ')';
      ctx.fillRect(this.margin.left, this.margin.top + i * bandH,
        this.W - this.margin.left - this.margin.right, bandH);
    }
    // 水面线
    ctx.strokeStyle = '#7fc4e8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(this.margin.left, this.margin.top);
    ctx.lineTo(this.W - this.margin.right, this.margin.top);
    ctx.stroke();
    ctx.fillStyle = '#9fd6f2';
    ctx.font = '12px sans-serif';
    ctx.fillText('海面 / 母船', this.margin.left, this.margin.top - 6);
  };

  Renderer.prototype._drawScale = function (ctx, sc) {
    ctx.strokeStyle = 'rgba(160,190,215,0.35)';
    ctx.fillStyle = '#8aa3ba';
    ctx.font = '11px sans-serif';
    ctx.lineWidth = 1;
    for (let d = 0; d <= C.MAX_DEPTH; d += 10) {
      const y = sc.y(d);
      ctx.beginPath();
      ctx.moveTo(this.margin.left - 6, y);
      ctx.lineTo(this.margin.left, y);
      ctx.stroke();
      ctx.fillText(d + 'm', 8, y + 4);
      ctx.strokeStyle = 'rgba(160,190,215,0.12)';
      ctx.beginPath();
      ctx.moveTo(this.margin.left, y);
      ctx.lineTo(this.W - this.margin.right, y);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(160,190,215,0.35)';
    }
  };

  Renderer.prototype._drawStations = function (ctx, sc, snap) {
    const self = this;
    C.STATIONS.forEach(function (st) {
      const y = sc.y(st.depth);
      const done = snap.mission.completed.indexOf(st.id) !== -1;
      const active = snap.mission.activeStation === st.id;
      ctx.strokeStyle = done ? '#46c47c' : active ? '#e8c25a' : 'rgba(180,200,220,0.35)';
      ctx.setLineDash(active ? [6, 5] : [3, 6]);
      ctx.lineWidth = active ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(self.margin.left, y);
      ctx.lineTo(self.W - self.margin.right, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = done ? '#7ee0a0' : active ? '#f0d27a' : '#8aa3ba';
      ctx.font = '12px sans-serif';
      ctx.fillText('取样点 ' + st.id + '（' + st.depth + 'm）' + (done ? ' ✓' : ''),
        self.W - self.margin.right - 132, y - 5);
    });
  };

  window.DBRenderer = Renderer;

  Renderer.prototype._drawCable = function (ctx, sc, snap) {
    const g = snap.gauges;
    const topX = this.W / 2;
    const topY = this.margin.top;
    const bellX = sc.x(g.drift);
    const bellY = sc.y(g.depth);
    // 缆绳颜色随张力状态变化
    const color = g.tensionState === 'tight' ? '#ff6b6b'
      : g.tensionState === 'slack' ? '#8fb8d8' : '#d8c98f';
    ctx.strokeStyle = color;
    ctx.lineWidth = g.tensionState === 'tight' ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(topX, topY);
    // 松弛时画出下垂弧度
    const midX = (topX + bellX) / 2;
    const sag = g.tensionState === 'slack' ? 26 : 8;
    ctx.quadraticCurveTo(midX, (topY + bellY) / 2 + sag, bellX, bellY);
    ctx.stroke();
    // 母船锚点
    ctx.fillStyle = '#cfe3f5';
    ctx.fillRect(topX - 7, topY - 4, 14, 6);
    // 张力标注
    if (g.tensionState !== 'normal') {
      ctx.fillStyle = color;
      ctx.font = '11px sans-serif';
      ctx.fillText(g.tensionState === 'tight' ? '缆绳过紧!' : '缆绳松弛',
        midX + 6, (topY + bellY) / 2 + sag);
    }
  };

  Renderer.prototype._drawBell = function (ctx, sc, snap) {
    const g = snap.gauges;
    const x = sc.x(g.drift);
    const y = sc.y(g.depth);
    // 钟体（倒扣钟形）
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#d9a441';
    ctx.strokeStyle = '#f2cf7e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-16, -12);
    ctx.lineTo(16, -12);
    ctx.lineTo(16, 8);
    ctx.quadraticCurveTo(0, 18, -16, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // 观察窗
    ctx.fillStyle = '#16324a';
    ctx.beginPath();
    ctx.arc(0, -3, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 垂直速度箭头
    if (Math.abs(g.vSpeed) > 0.4) {
      ctx.strokeStyle = g.vSpeed < 0 ? '#7ee0a0' : '#f0b95c';
      ctx.lineWidth = 2;
      const dir = Math.sign(g.vSpeed);
      const len = Math.min(22, Math.abs(g.vSpeed) * 4);
      ctx.beginPath();
      ctx.moveTo(x, y - 20);
      ctx.lineTo(x, y - 20 + dir * len);
      ctx.stroke();
    }
    // 深度读数
    ctx.fillStyle = '#dce7f2';
    ctx.font = '12px sans-serif';
    ctx.fillText(g.depth.toFixed(1) + 'm', x + 22, y + 4);

    // 取样进度环
    if (snap.mission.sample) {
      ctx.strokeStyle = '#7ee0a0';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 24, -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * snap.mission.sample.ratio);
      ctx.stroke();
    }
  };

  Renderer.prototype._drawCurrent = function (ctx, snap) {
    const cur = snap.gauges.current;
    ctx.fillStyle = '#7fc4e8';
    ctx.font = '12px sans-serif';
    ctx.fillText('海流 ' + cur.toFixed(2) + ' m/s →', this.W - this.margin.right - 130,
      this.H - 8);
    // 流向小箭头组
    ctx.strokeStyle = 'rgba(127,196,232,0.5)';
    for (let i = 0; i < 4; i++) {
      const yy = this.margin.top + 60 + i * 130;
      const offset = (snap.time * 30 + i * 40) % 120;
      const xx = this.margin.left + 20 + offset;
      ctx.beginPath();
      ctx.moveTo(xx, yy);
      ctx.lineTo(xx + 14, yy);
      ctx.moveTo(xx + 14, yy);
      ctx.lineTo(xx + 9, yy - 4);
      ctx.moveTo(xx + 14, yy);
      ctx.lineTo(xx + 9, yy + 4);
      ctx.stroke();
    }
  };
})();
