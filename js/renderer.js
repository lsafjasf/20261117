/* Canvas 生产线渲染：铺装层 → 缓存 → 预热热区 → 缓存 → 压机 */
(function (global) {
  'use strict';

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.W = canvas.width;
    this.H = canvas.height;
    this.zones = {
      forming: { x: 30, y: 70, w: 150, h: 220, label: '铺装层 / 铺装机' },
      bufForming: { x: 205, y: 120, w: 110, h: 120, label: '缓存 A' },
      preheat: { x: 340, y: 70, w: 170, h: 220, label: '预热热区' },
      bufPreheat: { x: 535, y: 120, w: 110, h: 120, label: '缓存 B' },
      press: { x: 670, y: 70, w: 260, h: 220, label: '液压压机' }
    };
  }

  Renderer.prototype.draw = function (snap) {
    var ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    this._drawBackground();
    this._drawConveyor();
    this._drawForming(snap);
    this._drawBuffer('bufForming', snap.buffers.forming, snap.limits);
    this._drawPreheat(snap);
    this._drawBuffer('bufPreheat', snap.buffers.preheat, snap.limits);
    this._drawPress(snap);
    this._drawFinished(snap);
  };

  Renderer.prototype._drawBackground = function () {
    var ctx = this.ctx;
    ctx.fillStyle = '#0c1118';
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.font = '13px sans-serif';
  };

  Renderer.prototype._drawConveyor = function () {
    var ctx = this.ctx;
    ctx.strokeStyle = '#33445c';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(40, 320);
    ctx.lineTo(920, 320);
    ctx.stroke();
    ctx.lineWidth = 1;
  };

  Renderer.prototype._zoneBox = function (zone, color, label) {
    var ctx = this.ctx;
    var z = this.zones[zone];
    ctx.strokeStyle = color;
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2;
    ctx.strokeRect(z.x, z.y, z.w, z.h);
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = '13px sans-serif';
    ctx.fillText(label || z.label, z.x, z.y - 10);
  };

  Renderer.prototype._board = function (x, y, w, h, board) {
    var ctx = this.ctx;
    var bad = board.defects && board.defects.length > 0;
    var color = board.stage === 'finished'
      ? (board.passed ? '#4ade80' : '#f87171')
      : (bad ? '#f87171' : '#c8a165');
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#0c1118';
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#0c1118';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('#' + board.id, x + 6, y + 16);
    if (board.density !== null && board.density !== undefined) {
      ctx.fillText(board.density + ' g/cm³', x + 6, y + 32);
    }
    if (board.progress !== undefined && board.stage !== 'finished' && board.progress > 0) {
      ctx.fillStyle = '#0c1118';
      ctx.fillRect(x + 4, y + h - 10, w - 8, 5);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(x + 4, y + h - 10, (w - 8) * board.progress, 5);
    }
  };

  Renderer.prototype._drawForming = function (snap) {
    var z = this.zones.forming;
    var on = snap.equipment.former.running;
    this._zoneBox('forming', on ? '#38bdf8' : '#f87171',
      '铺装层 / 铺装机 ' + (on ? '运行' : '停机'));
    var ctx = this.ctx;
    for (var layer = 0; layer < 3; layer++) {
      ctx.fillStyle = ['#8b5e34', '#a47148', '#bb8a52'][layer];
      var lw = z.w - 30 - layer * 14;
      ctx.fillRect(z.x + 15 + layer * 7, z.y + 40 + layer * 26, lw, 20);
    }
    if (snap.stations.forming) {
      this._board(z.x + 25, z.y + 150, z.w - 50, 50, snap.stations.forming);
    }
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px sans-serif';
    ctx.fillText('待加工木片: ' + snap.rawRemaining, z.x + 10, z.y + z.h - 10);
  };

  Renderer.prototype._drawBuffer = function (zoneKey, boards) {
    var z = this.zones[zoneKey];
    var ctx = this.ctx;
    ctx.strokeStyle = '#64748b';
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(z.x, z.y, z.w, z.h);
    ctx.setLineDash([]);
    ctx.fillStyle = '#64748b';
    ctx.font = '12px sans-serif';
    ctx.fillText(z.label + ' ' + boards.length + '/2', z.x + 8, z.y - 8);
    var slotW = (z.w - 24) / 2;
    for (var i = 0; i < 2; i++) {
      var sx = z.x + 8 + i * (slotW + 8);
      ctx.strokeStyle = '#33445c';
      ctx.strokeRect(sx, z.y + 12, slotW, z.h - 24);
      if (boards[i]) {
        this._board(sx + 3, z.y + 22, slotW - 6, 44, boards[i]);
      }
    }
  };

  Renderer.prototype._drawPreheat = function (snap) {
    var z = this.zones.preheat;
    var on = snap.equipment.heater.running;
    this._zoneBox('preheat', on ? '#fb923c' : '#f87171',
      '预热热区 / 蒸汽 ' + (on ? '供应中' : '中断'));
    var ctx = this.ctx;
    if (on) {
      var grad = ctx.createLinearGradient(0, z.y, 0, z.y + z.h);
      grad.addColorStop(0, 'rgba(251,146,60,0.35)');
      grad.addColorStop(1, 'rgba(251,146,60,0.05)');
      ctx.fillStyle = grad;
      ctx.fillRect(z.x + 2, z.y + 2, z.w - 4, z.h - 4);
      ctx.fillStyle = '#fdba74';
      ctx.font = '18px sans-serif';
      for (var s = 0; s < 4; s++) {
        var rise = (Date.now() / 500 + s * 18) % 60;
        ctx.fillText('♨', z.x + 20 + s * 38, z.y + z.h - 30 - rise);
      }
    } else {
      ctx.fillStyle = '#7f1d1d';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText('蒸汽中断', z.x + 40, z.y + z.h / 2);
    }
    if (snap.stations.preheat) {
      this._board(z.x + 30, z.y + 130, z.w - 60, 52, snap.stations.preheat);
    }
  };

  Renderer.prototype._drawPress = function (snap) {
    var z = this.zones.press;
    var on = snap.equipment.pump.running;
    this._zoneBox('press', on ? '#a78bfa' : '#f87171',
      '液压压机 / 泵 ' + (on ? '运行 ' + snap.pumpPowerKW + ' kW' : '停机'));
    var ctx = this.ctx;
    ctx.fillStyle = '#475569';
    ctx.fillRect(z.x + 20, z.y + 20, z.w - 40, 22);
    ctx.fillRect(z.x + 20, z.y + z.h - 42, z.w - 40, 22);
    var travel = on && snap.stations.press ? 46 : 18;
    ctx.fillStyle = on ? '#a78bfa' : '#64748b';
    ctx.fillRect(z.x + 20, z.y + 20, 18, travel);
    ctx.fillRect(z.x + z.w - 38, z.y + 20, 18, travel);
    if (snap.stations.press) {
      this._board(z.x + 55, z.y + 95, z.w - 110, 56, snap.stations.press);
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '12px sans-serif';
      ctx.fillText('设定压力 ' + snap.params.pressure + ' MPa', z.x + 20, z.y + z.h - 8);
    } else {
      ctx.fillStyle = '#64748b';
      ctx.font = '12px sans-serif';
      ctx.fillText('待机', z.x + 20, z.y + z.h / 2);
    }
  };

  Renderer.prototype._drawFinished = function (snap) {
    var ctx = this.ctx;
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px sans-serif';
    ctx.fillText('成品区', 30, 375);
    var startX = 90;
    snap.finished.forEach(function (board, i) {
      this._board(startX + i * 84, 350, 72, 46, board);
    }, this);
  };

  global.PressRenderer = Renderer;
})(window);
