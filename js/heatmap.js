/* Canvas 时间热区：行=站点 列=小时；窗口/游标高亮与缺失异常标记 */
(function (root) {
  'use strict';
  var RF = root.RF;
  var ST = RF.pipeline.ST;

  var SCALE = ['#16324f', '#1c5a86', '#2480b8', '#3aa9d6', '#79d0e8',
    '#c8ecdc', '#ffe08a', '#ffb347', '#ef7b52', '#d93f3f'];

  function HeatView(canvas, state, tooltip) {
    this.canvas = canvas;
    this.state = state;
    this.tooltip = tooltip;
    this.patterns = null;
    this.bind();
  }

  HeatView.prototype.colorFor = function (t) {
    t = RF.util.clamp(t, 0, 1);
    return SCALE[Math.min(SCALE.length - 1, Math.floor(t * SCALE.length))];
  };

  HeatView.prototype.ensurePatterns = function (ctx) {
    if (this.patterns) return;
    var miss = ctx.createPattern(stripeCanvas('rgba(255,209,102,.9)'), 'repeat');
    var anom = ctx.createPattern(stripeCanvas('rgba(255,107,107,.95)'), 'repeat');
    this.patterns = { missing: miss, anomalous: anom };
  };

  function stripeCanvas(color) {
    var c = document.createElement('canvas');
    c.width = 8; c.height = 8;
    var cx = c.getContext('2d');
    cx.strokeStyle = color;
    cx.lineWidth = 2;
    cx.beginPath();
    cx.moveTo(-2, 10); cx.lineTo(10, -2);
    cx.moveTo(2, 12); cx.lineTo(12, 2);
    cx.stroke();
    return c;
  }

  HeatView.prototype.render = function () {
    var setup = RF.util.setupCanvas(this.canvas, 330);
    var ctx = setup.ctx, W = setup.w, Hh = setup.h;
    this.ensurePatterns(ctx);
    var s = this.state;
    ctx.clearRect(0, 0, W, Hh);

    var visible = s.visibleStations();
    var rows = visible.length ? visible : [];
    var labelW = 92;
    var top = 26, bottom = 40;
    var gridW = W - labelW - 14;
    var rowH = rows.length ? Math.min(26, (Hh - top - bottom) / rows.length) : 0;
    var cellW = gridW / RF.util.HOURS;
    this.geom = { labelW: labelW, top: top, cellW: cellW, rowH: rowH, rows: rows };

    var maxV = 1;
    rows.forEach(function (st) {
      var cell = s.data().grid[st.id];
      for (var h = 0; h < RF.util.HOURS; h++) {
        if (cell.status[h] === ST.VALID || cell.status[h] === ST.FILLED) {
          var v = s.mode === 'cumulative' ? cell.cum[h] : cell.values[h];
          if (v !== null) maxV = Math.max(maxV, v);
        }
      }
    });

    // 日分隔与日期表头
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    for (var d = 0; d < 7; d++) {
      var dx = labelW + d * 24 * cellW;
      ctx.fillStyle = '#93a4bd';
      ctx.fillText('第' + (d + 1) + '天', dx + 12 * cellW, 16);
      ctx.strokeStyle = '#2b3b57';
      ctx.beginPath();
      ctx.moveTo(dx, top - 4); ctx.lineTo(dx, top + rowH * rows.length);
      ctx.stroke();
    }

    var self = this;
    rows.forEach(function (st, r) {
      var y = top + r * rowH;
      ctx.textAlign = 'left';
      ctx.fillStyle = s.selected.indexOf(st.id) >= 0 ? '#ffd166' : '#c7d4e8';
      ctx.fillText(st.id + ' ' + st.name, 6, y + rowH / 2 + 4);
      var cell = s.data().grid[st.id];
      for (var h = 0; h < RF.util.HOURS; h++) {
        var x = labelW + h * cellW;
        var stv = cell.status[h];
        var fromAnomaly = cell.origin[h] === ST.ANOMALOUS;
        var v = s.mode === 'cumulative' ? cell.cum[h] : cell.values[h];
        if (stv === ST.MISSING && !fromAnomaly) {
          ctx.fillStyle = '#2a2417';
          ctx.fillRect(x, y, Math.ceil(cellW), rowH);
          ctx.fillStyle = self.patterns.missing;
          ctx.fillRect(x, y, Math.ceil(cellW), rowH);
        } else if (stv === ST.MISSING || fromAnomaly) {
          ctx.fillStyle = '#3a1d1d';
          ctx.fillRect(x, y, Math.ceil(cellW), rowH);
          ctx.fillStyle = self.patterns.anomalous;
          ctx.fillRect(x, y, Math.ceil(cellW), rowH);
          if (stv === ST.FILLED) {
            ctx.fillStyle = self.colorFor((v || 0) / maxV);
            ctx.globalAlpha = .55;
            ctx.fillRect(x, y, Math.ceil(cellW), rowH);
            ctx.globalAlpha = 1;
          }
        } else if (v !== null) {
          ctx.fillStyle = self.colorFor(v / maxV);
          ctx.fillRect(x, y, Math.ceil(cellW), rowH);
          if (stv === ST.FILLED) {
            ctx.strokeStyle = 'rgba(70,211,154,.9)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x + .5, y + .5, Math.max(0, cellW - 1), rowH - 1);
          }
        }
      }
    });

    // 当前窗口外区域压暗
    var wx0 = labelW + s.window[0] * cellW;
    var wx1 = labelW + (s.window[1] + 1) * cellW;
    var gridH = rowH * rows.length;
    ctx.fillStyle = 'rgba(8,12,22,.55)';
    ctx.fillRect(labelW, top - 4, s.window[0] * cellW, gridH + 4);
    ctx.fillRect(wx1, top - 4, gridW - (s.window[1] + 1) * cellW, gridH + 4);
    ctx.strokeStyle = '#4ea1ff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(wx0, top - 4, wx1 - wx0, gridH + 4);

    // 游标列
    var cx = labelW + (s.cursor + .5) * cellW;
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, top - 6);
    ctx.lineTo(cx, top + gridH + 2);
    ctx.stroke();

    // 图例
    var ly = Hh - 14;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    legendSwatch(ctx, labelW, ly, '#2a2417', self.patterns.missing, '缺测');
    legendSwatch(ctx, labelW + 86, ly, '#3a1d1d', self.patterns.anomalous, '异常剔除');
    ctx.strokeStyle = '#46d39a';
    ctx.strokeRect(labelW + 186, ly - 1, 12, 10);
    ctx.fillStyle = '#93a4bd';
    ctx.fillText('线性补缺', labelW + 202, ly + 9);
    ctx.strokeStyle = '#ffd166';
    ctx.beginPath(); ctx.moveTo(labelW + 286, ly + 4); ctx.lineTo(labelW + 298, ly + 4); ctx.stroke();
    ctx.fillText('游标', labelW + 303, ly + 9);

    if (!rows.length) {
      ctx.fillStyle = '#ffd166';
      ctx.textAlign = 'center';
      ctx.font = '14px sans-serif';
      ctx.fillText('空结果：没有站点通过当前阈值筛选', W / 2, Hh / 2);
    }
  };

  function legendSwatch(ctx, x, y, base, pattern, label) {
    ctx.fillStyle = base;
    ctx.fillRect(x, y - 1, 12, 10);
    ctx.fillStyle = pattern;
    ctx.fillRect(x, y - 1, 12, 10);
    ctx.fillStyle = '#93a4bd';
    ctx.fillText(label, x + 16, y + 9);
  }

  HeatView.prototype.bind = function () {
    var self = this;
    this.canvas.addEventListener('click', function (ev) {
      if (!self.geom || !self.geom.rows.length) return;
      var p = RF.util.eventPos(self.canvas, ev);
      var g = self.geom;
      if (p.x < g.labelW || p.x > g.labelW + g.cellW * RF.util.HOURS) return;
      var h = Math.floor((p.x - g.labelW) / g.cellW);
      h = RF.util.clamp(h, 0, RF.util.HOURS - 1);
      var r = Math.floor((p.y - g.top) / g.rowH);
      if (r < 0 || r >= g.rows.length) return;
      // 点击单元格：定位游标，若点在窗口外则扩展窗口
      if (h < self.state.window[0] || h > self.state.window[1]) {
        self.state.saveCheckpoint();
        self.state.setWindow(Math.min(self.state.window[0], h),
          Math.max(self.state.window[1], h), true);
      }
      self.state.setCursor(h);
    });
    this.canvas.addEventListener('mousemove', function (ev) {
      self.showTooltip(ev);
    });
  };

  HeatView.prototype.showTooltip = function (ev) {
    if (!this.geom || !this.geom.rows.length) { this.tooltip.hidden = true; return; }
    var p = RF.util.eventPos(this.canvas, ev);
    var g = this.geom;
    var h = Math.floor((p.x - g.labelW) / g.cellW);
    var r = Math.floor((p.y - g.top) / g.rowH);
    if (h < 0 || h >= RF.util.HOURS || r < 0 || r >= g.rows.length) {
      this.tooltip.hidden = true;
      return;
    }
    var st = g.rows[r];
    var cell = this.state.data().grid[st.id];
    var v = this.state.mode === 'cumulative' ? cell.cum[h] : cell.values[h];
    var fromAnomaly = cell.origin[h] === ST.ANOMALOUS;
    var label = cell.status[h] === ST.MISSING && !fromAnomaly ?
        '缺测（已标注，未参与统计）' :
      fromAnomaly && cell.status[h] === ST.MISSING ?
        '异常剔除且无法补缺，原始值 ' + RF.util.fmt(cell.raw[h], 1) + ' mm/h' :
      fromAnomaly ? '异常后线性补缺，原始值 ' + RF.util.fmt(cell.raw[h], 1) + ' mm/h' :
      cell.status[h] === ST.FILLED ? '缺测后线性补缺值' : '实测值';
    this.tooltip.innerHTML =
      '<div class="t-title">' + st.id + ' ' + st.name + ' · ' + RF.util.hourToISO(h) + '</div>' +
      '<div class="t-row">' + label + '</div>' +
      (v !== null && cell.status[h] !== ST.MISSING && cell.status[h] !== ST.ANOMALOUS ?
        '<div class="t-row">数值 <b>' + RF.util.fmt(v, 2) +
        (this.state.mode === 'cumulative' ? ' mm</b>' : ' mm/h</b></div>') : '');
    this.tooltip.hidden = false;
    this.tooltip.style.left = (ev.clientX + 14) + 'px';
    this.tooltip.style.top = (ev.clientY + 14) + 'px';
  };

  RF.HeatView = HeatView;
})(typeof window !== 'undefined' ? window : globalThis);
