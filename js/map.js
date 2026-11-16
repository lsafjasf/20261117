/* Canvas 站点地图：背景轮廓、河流、站点着色、框选与点选 */
(function (root) {
  'use strict';
  var RF = root.RF;
  var ST = RF.pipeline.ST;

  var COLORS = ['#1c3f6e', '#1d6fb8', '#2f97d6', '#5fc4e3', '#a7e3c0',
    '#ffe08a', '#ffb347', '#f4764d', '#d93f3f'];

  function colorScale(t) {
    t = RF.util.clamp(t, 0, 1);
    var idx = Math.min(COLORS.length - 1, Math.floor(t * COLORS.length));
    return COLORS[idx];
  }

  function MapView(canvas, state, tooltip) {
    this.canvas = canvas;
    this.state = state;
    this.tooltip = tooltip;
    this.hit = {};
    this.drag = null;
    this.bind();
  }

  MapView.prototype.metric = function (st) {
    var d = this.state.data();
    var agg = RF.pipeline.aggregate(d.grid[st.id], this.state.window[0], this.state.window[1]);
    return this.state.mode === 'cumulative' ?
      (agg.total === null ? 0 : agg.total) : (agg.maxInstant || 0);
  };

  MapView.prototype.render = function () {
    var setup = RF.util.setupCanvas(this.canvas, 380);
    var ctx = setup.ctx, W = setup.w, Hh = setup.h;
    var box = { x: 56, y: 28, w: W - 84, h: Hh - 52 };
    this.box = box;
    var self = this;
    ctx.clearRect(0, 0, W, Hh);

    // 区域边界
    ctx.beginPath();
    RF.stations.BOUNDARY.forEach(function (p, i) {
      var q = RF.stations.projectPoint(p[0], p[1], box);
      if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
    });
    ctx.closePath();
    ctx.fillStyle = '#13233b';
    ctx.fill();
    ctx.strokeStyle = '#3d557a';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 河流
    ctx.beginPath();
    RF.stations.RIVER.forEach(function (p, i) {
      var q = RF.stations.projectPoint(p[0], p[1], box);
      if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
    });
    ctx.strokeStyle = 'rgba(95,196,227,.55)';
    ctx.lineWidth = 3;
    ctx.stroke();

    var visible = this.state.visibleStations();
    var visIds = visible.map(function (s) { return s.id; });
    var maxMetric = Math.max(1, Math.max.apply(null,
      RF.stations.STATIONS.map(function (s) { return self.metric(s); })));
    var d = this.state.data();
    this.hit = {};

    RF.stations.STATIONS.forEach(function (st) {
      var p = RF.stations.project(st, box);
      var cell = d.grid[st.id];
      var agg = RF.pipeline.aggregate(cell, self.state.window[0], self.state.window[1]);
      var isSelected = self.state.selected.indexOf(st.id) >= 0;
      var isVisible = visIds.indexOf(st.id) >= 0;
      var metric = self.metric(st);
      var radius = 8 + 10 * (metric / maxMetric);
      self.hit[st.id] = { x: p.x, y: p.y, r: Math.max(radius, 9) };

      ctx.globalAlpha = isVisible ? 1 : .3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = colorScale(metric / maxMetric);
      ctx.fill();
      if (isSelected) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#ffd166';
      } else {
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#d7e3f5';
      }
      ctx.stroke();

      // 缺测/异常明确标注：红色叉 / 琥珀色空心环
      if (agg.anomalous > 0) {
        ctx.strokeStyle = '#ff6b6b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p.x - 5, p.y - 5); ctx.lineTo(p.x + 5, p.y + 5);
        ctx.moveTo(p.x + 5, p.y - 5); ctx.lineTo(p.x - 5, p.y + 5);
        ctx.stroke();
      } else if (agg.missing > 0) {
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius + 4, 0, Math.PI * 1.5);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
      ctx.fillStyle = isVisible ? '#e6edf7' : '#7c8aa3';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(st.id + ' ' + st.name, p.x, p.y - radius - 7);
    });

    // 图例
    var lx = box.x, ly = Hh - 16;
    ctx.font = '11px sans-serif';
    COLORS.forEach(function (c, i) {
      ctx.fillStyle = c;
      ctx.fillRect(lx + i * 18, ly - 8, 16, 8);
    });
    ctx.fillStyle = '#93a4bd';
    ctx.textAlign = 'left';
    var unit = this.state.mode === 'cumulative' ? '累计 mm' : '瞬时 mm/h';
    ctx.fillText('低 → 高（' + unit + '；琥珀环=含缺测，红叉=含异常）', lx, ly + 6);

    if (this.drag) {
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = '#4ea1ff';
      ctx.fillStyle = 'rgba(78,161,255,.12)';
      var x = Math.min(this.drag.x0, this.drag.x1);
      var y = Math.min(this.drag.y0, this.drag.y1);
      var w = Math.abs(this.drag.x1 - this.drag.x0);
      var h = Math.abs(this.drag.y1 - this.drag.y0);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }

    if (!this.state.selected.length) {
      ctx.fillStyle = 'rgba(255,209,102,.95)';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('当前未选中任何站点（曲线将回退显示全部可见站点；点站点或框选恢复）',
        box.x + box.w / 2, box.y + 18);
    }
  };

  MapView.prototype.hitStation = function (x, y) {
    var ids = Object.keys(this.hit);
    for (var i = ids.length - 1; i >= 0; i--) {
      var r = this.hit[ids[i]];
      if (Math.hypot(x - r.x, y - r.y) <= r.r) return ids[i];
    }
    return null;
  };

  MapView.prototype.bind = function () {
    var self = this;
    this.canvas.addEventListener('mousedown', function (ev) {
      var p = RF.util.eventPos(self.canvas, ev);
      self.drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, moved: false };
    });
    window.addEventListener('mousemove', function (ev) {
      var p = RF.util.eventPos(self.canvas, ev);
      if (self.drag) {
        if (Math.abs(p.x - self.drag.x0) + Math.abs(p.y - self.drag.y0) > 6) self.drag.moved = true;
        self.drag.x1 = p.x; self.drag.y1 = p.y;
        self.render();
      } else {
        self.showTooltip(ev, p);
      }
    });
    window.addEventListener('mouseup', function (ev) {
      if (!self.drag) return;
      var p = RF.util.eventPos(self.canvas, ev);
      if (self.drag.moved) self.applyBox(ev.shiftKey);
      else self.applyClick(p, ev.shiftKey);
      self.drag = null;
      self.render();
    });
  };

  MapView.prototype.applyClick = function (p, additive) {
    var id = this.hitStation(p.x, p.y);
    if (id) {
      if (additive) this.state.setSelection([id], true);
      else this.state.toggleStation(id);
    } else if (!additive) {
      this.state.clearSelection();
    }
  };

  MapView.prototype.applyBox = function (additive) {
    var self = this;
    var r = {
      x: Math.min(this.drag.x0, this.drag.x1),
      y: Math.min(this.drag.y0, this.drag.y1),
      w: Math.abs(this.drag.x1 - this.drag.x0),
      h: Math.abs(this.drag.y1 - this.drag.y0)
    };
    var ids = RF.stations.STATIONS.filter(function (st) {
      var p = RF.stations.project(st, self.box);
      return RF.util.pointInRect(p.x, p.y, r);
    }).map(function (s) { return s.id; });
    this.state.setSelection(ids, additive);
  };

  MapView.prototype.showTooltip = function (ev, p) {
    var id = this.hitStation(p.x, p.y);
    if (!id || p.x < 0 || p.y < 0 || p.x > this.canvas.clientWidth ||
      p.y > this.canvas.clientHeight) {
      this.tooltip.hidden = true;
      return;
    }
    var st = RF.stations.byId(id);
    var d = this.state.data();
    var agg = RF.pipeline.aggregate(d.grid[id], this.state.window[0], this.state.window[1]);
    this.tooltip.innerHTML =
      '<div class="t-title">' + st.id + ' ' + st.name + '（海拔 ' + st.elev + 'm）</div>' +
      '<div class="t-row">窗口累计 <b>' + RF.util.fmt(agg.total) + '</b> mm</div>' +
      '<div class="t-row">最大瞬时 <b>' + RF.util.fmt(agg.maxInstant) + '</b> mm/h</div>' +
      '<div class="t-row">有效/补缺/缺失/异常 <b>' + agg.valid + '/' + agg.filled +
        '/' + agg.missing + '/' + agg.anomalous + '</b> h</div>' +
      '<div class="t-row">缺失率 <b>' + RF.util.pct(agg.missingRate) + '</b></div>';
    this.tooltip.hidden = false;
    this.tooltip.style.left = (ev.clientX + 14) + 'px';
    this.tooltip.style.top = (ev.clientY + 14) + 'px';
  };

  RF.MapView = MapView;
})(typeof window !== 'undefined' ? window : globalThis);
