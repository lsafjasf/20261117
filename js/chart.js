/* Canvas 雨量曲线：多站点折线、时间游标、窗口手柄、缺失断段 */
(function (root) {
  'use strict';
  var RF = root.RF;
  var ST = RF.pipeline.ST;
  var PALETTE = ['#4ea1ff', '#ffd166', '#46d39a', '#ff8fa3', '#b48cff',
    '#7cd6f0', '#ffb347', '#e6edf7', '#f4764d', '#9be37d', '#e58fff', '#8aa6ff'];

  function ChartView(canvas, state, tooltip) {
    this.canvas = canvas;
    this.state = state;
    this.tooltip = tooltip;
    this.pad = { l: 58, r: 18, t: 18, b: 46 };
    this.drag = null;
    this.bind();
  }

  ChartView.prototype.stationSet = function () {
    var visible = this.state.visibleStations().map(function (s) { return s.id; });
    if (!this.state.selected.length) return visible;
    var sel = this.state.selected;
    return visible.filter(function (id) { return sel.indexOf(id) >= 0; });
  };

  ChartView.prototype.render = function () {
    var setup = RF.util.setupCanvas(this.canvas, 340);
    var ctx = setup.ctx, W = setup.w, Hh = setup.h;
    var pad = this.pad;
    var plot = { x: pad.l, y: pad.t, w: W - pad.l - pad.r, h: Hh - pad.t - pad.b };
    this.plot = plot;
    var s = this.state;
    ctx.clearRect(0, 0, W, Hh);

    var ids = this.stationSet();
    var maxV = 1;
    ids.forEach(function (id) {
      var cell = s.data().grid[id];
      for (var h = s.window[0]; h <= s.window[1]; h++) {
        var v = s.mode === 'cumulative' ? cell.cum[h] : cell.values[h];
        if (v !== null && (cell.status[h] === ST.VALID || cell.status[h] === ST.FILLED)) {
          maxV = Math.max(maxV, v);
        }
      }
    });
    this.maxV = maxV;

    var self = this;
    function xAt(h) {
      return plot.x + (h - s.window[0]) /
        Math.max(1, s.window[1] - s.window[0]) * plot.w;
    }
    function yAt(v) { return plot.y + plot.h - (v / maxV) * plot.h; }
    this.xAt = xAt;

    // 网格与 Y 轴
    ctx.strokeStyle = '#23344f';
    ctx.fillStyle = '#93a4bd';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    for (var g = 0; g <= 4; g++) {
      var val = maxV * g / 4;
      var yy = yAt(val);
      ctx.beginPath(); ctx.moveTo(plot.x, yy); ctx.lineTo(plot.x + plot.w, yy); ctx.stroke();
      ctx.fillText(RF.util.fmt(val, val >= 100 ? 0 : 1), plot.x - 8, yy + 4);
    }

    // X 轴刻度（每 6 小时）
    ctx.textAlign = 'center';
    for (var hh = s.window[0]; hh <= s.window[1]; hh++) {
      if (hh % 6 !== 0) continue;
      var xx = xAt(hh);
      ctx.strokeStyle = '#1c2c45';
      ctx.beginPath(); ctx.moveTo(xx, plot.y); ctx.lineTo(xx, plot.y + plot.h); ctx.stroke();
      ctx.fillStyle = '#93a4bd';
      ctx.fillText(RF.util.hourToShort(hh), xx, plot.y + plot.h + 16);
    }

    // 缺失/异常背景带：在被选站点合并标注
    this.drawGapBands(ctx, ids, xAt, plot);

    // 折线（遇缺失断开，补缺段用虚线）
    ids.forEach(function (id, i) {
      var cell = s.data().grid[id];
      var color = PALETTE[i % PALETTE.length];
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      var pen = false;
      for (var h = s.window[0]; h <= s.window[1]; h++) {
        var stv = cell.status[h];
        var v = s.mode === 'cumulative' ? cell.cum[h] : cell.values[h];
        var ok = (stv === ST.VALID || stv === ST.FILLED) && v !== null;
        ctx.setLineDash(stv === ST.FILLED ? [4, 3] : []);
        if (!ok) { pen = false; continue; }
        var px = xAt(h), py = yAt(v);
        if (!pen) { ctx.beginPath(); ctx.moveTo(px, py); pen = true; }
        else ctx.lineTo(px, py);
      }
      ctx.setLineDash([]);
      ctx.stroke();
    });

    // 游标
    var cx = xAt(s.cursor);
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx, plot.y); ctx.lineTo(cx, plot.y + plot.h); ctx.stroke();
    ctx.fillStyle = '#ffd166';
    ctx.textAlign = 'left';
    ctx.fillText('游标 ' + RF.util.hourToISO(s.cursor).slice(5), cx + 5, plot.y + 12);

    // 两侧手柄（拖动改窗口）
    this.drawHandle(ctx, plot.x, true);
    this.drawHandle(ctx, plot.x + plot.w, false);

    // 图例
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ids.slice(0, 8).forEach(function (id, i) {
      var st2 = RF.stations.byId(id);
      ctx.fillStyle = PALETTE[i % PALETTE.length];
      var lx = plot.x + i * 96;
      ctx.fillRect(lx, Hh - 14, 12, 8);
      ctx.fillStyle = '#c7d4e8';
      ctx.fillText(st2.id + ' ' + st2.name, lx + 15, Hh - 7);
    });

    if (!ids.length) {
      ctx.fillStyle = '#ffd166';
      ctx.textAlign = 'center';
      ctx.font = '14px sans-serif';
      ctx.fillText('空结果：当前阈值/选择下没有可绘制的站点', plot.x + plot.w / 2, plot.y + plot.h / 2);
    }
    this.drawGapLegend(ctx, W, Hh);
  };

  ChartView.prototype.drawHandle = function (ctx, x, left) {
    ctx.fillStyle = '#4ea1ff';
    ctx.fillRect(x - 3, this.plot.y - 2, 6, this.plot.h + 4);
    ctx.beginPath();
    ctx.moveTo(x, this.plot.y + this.plot.h / 2 - 8);
    ctx.lineTo(x + (left ? 7 : -7), this.plot.y + this.plot.h / 2);
    ctx.lineTo(x, this.plot.y + this.plot.h / 2 + 8);
    ctx.closePath();
    ctx.fill();
  };

  ChartView.prototype.drawGapBands = function (ctx, ids, xAt, plot) {
    var s = this.state;
    for (var h = s.window[0]; h <= s.window[1]; h++) {
      var miss = 0, anom = 0;
      ids.forEach(function (id) {
        var cell = s.data().grid[id];
        if (cell.origin[h] === ST.ANOMALOUS) anom++;
        else if (cell.status[h] === ST.MISSING) miss++;
      });
      if (!miss && !anom) continue;
      var x0 = xAt(h), x1 = xAt(h + 1);
      ctx.fillStyle = anom ? 'rgba(255,107,107,.22)' : 'rgba(255,209,102,.16)';
      ctx.fillRect(x0, plot.y, Math.max(1, x1 - x0), plot.h);
    }
  };

  ChartView.prototype.drawGapLegend = function (ctx, W, Hh) {
    ctx.textAlign = 'right';
    ctx.font = '11px sans-serif';
    ctx.fillStyle = 'rgba(255,209,102,.5)';
    ctx.fillRect(W - 250, 4, 12, 8);
    ctx.fillStyle = '#93a4bd';
    ctx.fillText('缺测背景', W - 232, 12);
    ctx.fillStyle = 'rgba(255,107,107,.4)';
    ctx.fillRect(W - 168, 4, 12, 8);
    ctx.fillStyle = '#93a4bd';
    ctx.fillText('异常背景', W - 150, 12);
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = '#93a4bd';
    ctx.beginPath(); ctx.moveTo(W - 96, 8); ctx.lineTo(W - 78, 8); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText('补缺段', W - 70, 12);
  };

  ChartView.prototype.hourAt = function (x) {
    var s = this.state;
    return s.window[0] + (x - this.plot.x) / this.plot.w *
      (s.window[1] - s.window[0]);
  };

  ChartView.prototype.bind = function () {
    var self = this;
    this.canvas.addEventListener('mousedown', function (ev) {
      var p = RF.util.eventPos(self.canvas, ev);
      if (p.x < self.plot.x || p.x > self.plot.x + self.plot.w ||
        p.y < self.plot.y || p.y > self.plot.y + self.plot.h) return;
      var nearL = Math.abs(p.x - self.plot.x) < 9;
      var nearR = Math.abs(p.x - (self.plot.x + self.plot.w)) < 9;
      self.drag = { mode: nearL ? 'left' : nearR ? 'right' : 'cursor', x0: p.x };
      if (self.drag.mode !== 'cursor') self.state.saveCheckpoint();
    });
    window.addEventListener('mousemove', function (ev) {
      var p = RF.util.eventPos(self.canvas, ev);
      if (self.drag) {
        var h = self.hourAt(p.x);
        if (self.drag.mode === 'left') self.state.setWindow(h, self.state.window[1], true);
        else if (self.drag.mode === 'right') self.state.setWindow(self.state.window[0], h, true);
        else self.state.setCursor(h, true);
        self.state.emit('window-drag');
      } else {
        self.showTooltip(ev, p);
      }
    });
    window.addEventListener('mouseup', function () {
      if (self.drag) {
        self.drag = null;
        self.state.emit('window');
      }
    });
  };

  ChartView.prototype.showTooltip = function (ev, p) {
    if (!this.plot || !RF.util.pointInRect(p.x, p.y, this.plot)) {
      this.tooltip.hidden = true;
      return;
    }
    var s = this.state;
    var h = RF.util.clamp(Math.round(this.hourAt(p.x)), s.window[0], s.window[1]);
    var rows = this.stationSet().map(function (id) {
      var cell = s.data().grid[id];
      var v = s.mode === 'cumulative' ? cell.cum[h] : cell.values[h];
      var fromAnomaly = cell.origin[h] === ST.ANOMALOUS;
      var label = cell.status[h] === ST.MISSING && !fromAnomaly ? '缺测' :
        fromAnomaly && cell.status[h] === ST.MISSING ? '异常未补(' + RF.util.fmt(cell.raw[h], 1) + ')' :
        fromAnomaly ? '异常补缺' :
        cell.status[h] === ST.FILLED ? '补缺' : '实测';
      return '<div class="t-row">' + RF.stations.byId(id).name +
        ' <b>' + (v === null || label === '缺测' || label.indexOf('异常') === 0 ?
          label : RF.util.fmt(v, 2)) + '</b></div>';
    }).join('');
    this.tooltip.innerHTML = '<div class="t-title">' + RF.util.hourToISO(h) +
      '（' + (s.mode === 'cumulative' ? '累计 mm' : '瞬时 mm/h') + '）</div>' + rows;
    this.tooltip.hidden = false;
    this.tooltip.style.left = (ev.clientX + 14) + 'px';
    this.tooltip.style.top = (ev.clientY + 14) + 'px';
  };

  RF.ChartView = ChartView;
})(typeof window !== 'undefined' ? window : globalThis);
