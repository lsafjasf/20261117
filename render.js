/* render.js - Canvas 渲染：塔身轨道、叶片根部、冰区、吊篮、风迹与调试叠加层 */
(function () {
  'use strict';

  function Renderer(canvas, engine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.E = engine;
    this.particles = [];
    for (var i = 0; i < 70; i++) {
      this.particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        len: 14 + Math.random() * 26,
        alpha: 0.25 + Math.random() * 0.5
      });
    }
  }

  Renderer.prototype.yToPx = function (y) {
    var pad = 34;
    return this.canvas.height - pad - (y / this.E.TOWER_H) *
      (this.canvas.height - pad * 2);
  };

  Renderer.prototype.xToPx = function (x) {
    var cx = this.canvas.width / 2;
    return cx + x * 46;
  };

  Renderer.prototype.draw = function (s, opts) {
    opts = opts || {};
    var ctx = this.ctx;
    var W = this.canvas.width;
    var H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    this.drawSky(s);
    this.drawTower(s);
    this.drawIce(s);
    this.drawBlades(s);
    if (opts.pathTarget !== undefined) this.drawPlannedPath(s, opts.pathTarget);
    this.drawWind(s);
    this.drawGondola(s);
    this.drawHeightScale(s);
    this.drawWindArrow(s);
    this.drawDebugText(s, opts);
  };

  Renderer.prototype.drawSky = function () {
    var ctx = this.ctx;
    var grad = ctx.createLinearGradient(0, 0, 0, this.canvas.height);
    grad.addColorStop(0, '#16314f');
    grad.addColorStop(1, '#0a1422');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  };

  Renderer.prototype.drawTower = function (s) {
    var ctx = this.ctx;
    var cx = this.canvas.width / 2;
    var top = this.yToPx(this.E.TOWER_H);
    var bottom = this.yToPx(0);

    ctx.strokeStyle = '#5d789c';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 16, bottom);
    ctx.lineTo(cx - 9, top);
    ctx.moveTo(cx + 16, bottom);
    ctx.lineTo(cx + 9, top);
    ctx.stroke();

    ctx.strokeStyle = '#3c5575';
    ctx.lineWidth = 1;
    for (var y = 0; y <= this.E.TOWER_H; y += 5) {
      var py = this.yToPx(y);
      var half = 16 - (y / this.E.TOWER_H) * 7;
      ctx.beginPath();
      ctx.moveTo(cx - half, py);
      ctx.lineTo(cx + half, py);
      ctx.stroke();
    }

    ctx.strokeStyle = '#8fb4dd';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, top);
    ctx.lineTo(cx, bottom);
    ctx.stroke();

    ctx.fillStyle = '#7fa3cc';
    ctx.beginPath();
    ctx.arc(cx, top - 8, 7, 0, Math.PI * 2);
    ctx.fill();
  };

  window.WindmillRenderer = Renderer;

  Renderer.prototype.drawIce = function (s) {
    var ctx = this.ctx;
    var cx = this.canvas.width / 2;
    s.map.iceZones.forEach(function (zone) {
      var y1 = this.yToPx(zone.hi);
      var y2 = this.yToPx(zone.lo);
      ctx.fillStyle = 'rgba(150, 205, 255, 0.16)';
      ctx.fillRect(cx - 34, y1, 68, y2 - y1);
      ctx.strokeStyle = 'rgba(180, 225, 255, 0.55)';
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(cx - 34, y1, 68, y2 - y1);
      ctx.setLineDash([]);
      ctx.fillStyle = '#b9e1ff';
      ctx.font = '11px sans-serif';
      ctx.fillText('结冰', cx - 42, (y1 + y2) / 2);
    }, this);
  };

  Renderer.prototype.drawBlades = function (s) {
    var ctx = this.ctx;
    var cx = this.canvas.width / 2;
    s.map.blades.forEach(function (bladeY, i) {
      var py = this.yToPx(bladeY);
      var done = s.inspected[i];
      ctx.save();
      ctx.strokeStyle = done ? '#4f9f74' : '#d8a84e';
      ctx.fillStyle = done ? 'rgba(79,159,116,0.25)' : 'rgba(216,168,78,0.25)';
      ctx.lineWidth = 2;
      for (var k = 0; k < 3; k++) {
        var ang = (k * 2 * Math.PI) / 3 + bladeY * 0.02;
        ctx.beginPath();
        ctx.moveTo(cx, py);
        ctx.lineTo(cx + Math.cos(ang) * 78, py + Math.sin(ang) * 30);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx, py, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = done ? '#7ce2a6' : '#f3cd83';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText((i + 1) + '号根部', cx + 16, py - 8);
      ctx.restore();
    }, this);
  };

  Renderer.prototype.drawGondola = function (s) {
    var ctx = this.ctx;
    var cx = this.xToPx(s.x);
    var cy = this.yToPx(s.y);

    ctx.strokeStyle = '#93b2d8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(this.canvas.width / 2, this.yToPx(this.E.TOWER_H));
    ctx.lineTo(cx, cy - 18);
    ctx.stroke();

    ctx.fillStyle = s.iceLocked ? '#9fd4ff' : '#e28b3c';
    ctx.strokeStyle = '#ffd9ad';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(cx - 15, cy - 14, 30, 22);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#1b2a40';
    for (var i = 0; i < s.kits; i++) {
      ctx.fillRect(cx - 12 + i * 9, cy + 2, 6, 5);
    }

    ctx.strokeStyle = Math.abs(s.x) >= this.E.constants.COLLISION_X ?
      '#ff6b81' : 'rgba(255,255,255,0.35)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(this.xToPx(-this.E.constants.COLLISION_X), this.yToPx(0));
    ctx.lineTo(this.xToPx(-this.E.constants.COLLISION_X), this.yToPx(this.E.TOWER_H));
    ctx.moveTo(this.xToPx(this.E.constants.COLLISION_X), this.yToPx(0));
    ctx.lineTo(this.xToPx(this.E.constants.COLLISION_X), this.yToPx(this.E.TOWER_H));
    ctx.stroke();
    ctx.setLineDash([]);

    if (s.iceLocked) {
      ctx.fillStyle = '#cfeaff';
      ctx.font = '12px sans-serif';
      ctx.fillText('结冰锁定 ' + s.iceTimer.toFixed(1) + 's', cx - 40, cy - 24);
    }
  };

  Renderer.prototype.drawPlannedPath = function (s, target) {
    if (target === null || target === undefined) return;
    var ctx = this.ctx;
    var cx = this.canvas.width / 2;
    ctx.strokeStyle = 'rgba(127, 226, 166, 0.6)';
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, this.yToPx(s.y));
    ctx.lineTo(cx, this.yToPx(target));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#7ce2a6';
    ctx.font = '11px sans-serif';
    ctx.fillText('目标 ' + target.toFixed(1) + 'm', cx + 8, this.yToPx(target));
  };

  Renderer.prototype.drawWind = function (s) {
    var ctx = this.ctx;
    var wind = this.E.windAt(s.map, s.t, s.y);
    var speed = Math.abs(wind);
    this.particles.forEach(function (p) {
      p.x += wind * 2.2;
      if (p.x > this.canvas.width + 40) p.x = -40;
      if (p.x < -40) p.x = this.canvas.width + 40;
      var alpha = (p.alpha * Math.min(1, 0.35 + speed / 6)).toFixed(2);
      ctx.strokeStyle = 'rgba(180, 220, 255, ' + alpha + ')';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - (wind >= 0 ? 1 : -1) *
        p.len * Math.min(2, 0.6 + speed / 4), p.y);
      ctx.stroke();
    }, this);
  };

  Renderer.prototype.drawWindArrow = function (s) {
    var ctx = this.ctx;
    var wind = this.E.windAt(s.map, s.t, s.y);
    var x = this.canvas.width - 86;
    var y = 26;
    ctx.fillStyle = 'rgba(8,16,28,0.6)';
    ctx.fillRect(x - 12, y - 16, 92, 40);
    ctx.strokeStyle = '#9fd6ff';
    ctx.fillStyle = '#9fd6ff';
    ctx.lineWidth = 2;
    var dir = wind >= 0 ? 1 : -1;
    var len = 18 + Math.min(46, Math.abs(wind) * 6);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + dir * len, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + dir * len, y);
    ctx.lineTo(x + dir * (len - 8), y - 5);
    ctx.lineTo(x + dir * (len - 8), y + 5);
    ctx.closePath();
    ctx.fill();
    ctx.font = '11px sans-serif';
    ctx.fillText('风 ' + wind.toFixed(1) + ' m/s', x - 8, y + 18);
  };

  Renderer.prototype.drawHeightScale = function () {
    var ctx = this.ctx;
    ctx.strokeStyle = 'rgba(160,190,225,0.4)';
    ctx.fillStyle = '#8fb0d4';
    ctx.font = '10px sans-serif';
    for (var y = 0; y <= this.E.TOWER_H; y += 20) {
      var py = this.yToPx(y);
      ctx.beginPath();
      ctx.moveTo(14, py);
      ctx.lineTo(24, py);
      ctx.stroke();
      ctx.fillText(y + 'm', 26, py + 3);
    }
  };

  Renderer.prototype.drawDebugText = function (s, opts) {
    if (!opts.debug) return;
    var ctx = this.ctx;
    var wind = this.E.windAt(s.map, s.t, s.y);
    var weight = this.E.constants.GONDOLA_KG + s.kits * this.E.constants.KIT_KG;
    var lines = [
      'DEBUG seed=' + s.seed + ' tick=' + s.ticks,
      'y=' + s.y.toFixed(2) + ' vy=' + s.vy.toFixed(2),
      'x=' + s.x.toFixed(2) + ' vx=' + s.vx.toFixed(2),
      'wind=' + wind.toFixed(2) + ' m/s',
      'load=' + weight + ' kg  kits=' + s.kits,
      'ice=' + (s.iceLocked ? s.iceTimer.toFixed(1) + 's' : 'no')
    ];
    ctx.fillStyle = 'rgba(8,16,28,0.72)';
    ctx.fillRect(8, 8, 172, lines.length * 16 + 10);
    ctx.fillStyle = '#9fe0ff';
    ctx.font = '11px monospace';
    lines.forEach(function (line, i) {
      ctx.fillText(line, 14, 24 + i * 16);
    });
  };
})();
