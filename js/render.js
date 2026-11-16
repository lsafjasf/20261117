/*
 * Canvas 渲染：河口水色网格、浮标、热点、告警、鱼群与趋势曲线
 */
(function (global) {
  'use strict';
  var RT = global.RT;

  // 藻密度 -> 水色（蓝绿 -> 橄榄 -> 赤褐），按实际值着色
  function algaeColor(v) {
    var t = Math.min(1, v / 25);
    var stops = [
      [31, 111, 139],   // 清水蓝
      [46, 139, 110],   // 蓝绿
      [122, 148, 62],   // 橄榄绿
      [176, 102, 58],   // 棕
      [196, 58, 52]     // 赤潮红
    ];
    var seg = t * (stops.length - 1);
    var i = Math.min(stops.length - 2, Math.floor(seg));
    var f = seg - i;
    var a = stops[i], b = stops[i + 1];
    return 'rgb(' +
      Math.round(a[0] + (b[0] - a[0]) * f) + ',' +
      Math.round(a[1] + (b[1] - a[1]) * f) + ',' +
      Math.round(a[2] + (b[2] - a[2]) * f) + ')';
  }

  function drawMap(canvas, sim, hover) {
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;
    var cw = W / RT.GRID_W, ch = H / RT.GRID_H;
    ctx.clearRect(0, 0, W, H);
    var cov = RT.coverageMap(sim);

    // 底泥扰动让整体水色偏浑浊
    var turbMix = sim.disturbance * 0.35;

    sim.cells.forEach(function (c) {
      var px = c.x * cw, py = c.y * ch;
      ctx.fillStyle = algaeColor(c.algae);
      ctx.fillRect(px, py, cw + 1, ch + 1);

      if (turbMix > 0) {
        ctx.fillStyle = 'rgba(150, 120, 80, ' + turbMix.toFixed(3) + ')';
        ctx.fillRect(px, py, cw + 1, ch + 1);
      }

      // 无观测区：斜纹遮罩，明确区分“看不到”
      if (!cov[c.y * RT.GRID_W + c.x]) {
        ctx.fillStyle = 'rgba(8, 18, 24, 0.45)';
        ctx.fillRect(px, py, cw, ch);
        ctx.strokeStyle = 'rgba(180, 200, 210, 0.18)';
        ctx.lineWidth = 1;
        for (var s = -ch; s < cw; s += 8) {
          ctx.beginPath();
          ctx.moveTo(px + s, py + ch);
          ctx.lineTo(px + s + ch, py);
          ctx.stroke();
        }
      }

      // 告警网格：红色描边
      if (c.alarm) {
        ctx.strokeStyle = '#ff3b35';
        ctx.lineWidth = 3;
        ctx.strokeRect(px + 2, py + 2, cw - 4, ch - 4);
      }

      // 鱼群：数量按 fish 值显示小鱼点
      var fishN = Math.round(c.fish * 4);
      ctx.fillStyle = 'rgba(160, 220, 255, 0.9)';
      for (var f = 0; f < fishN; f++) {
        var fx = px + 8 + (f % 2) * (cw - 16);
        var fy = py + 10 + Math.floor(f / 2) * 12;
        ctx.beginPath();
        ctx.ellipse(fx, fy, 3.4, 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // 浮标覆盖范围（淡金圈）
    sim.buoys.forEach(function (b) {
      var bx = b.x * cw + cw / 2, by = b.y * ch + ch / 2;
      ctx.strokeStyle = 'rgba(255, 224, 138, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(bx, by, cw * 1.5, 0, Math.PI * 2);
      ctx.stroke();
    });

    // 热点目标：红色菱形（复现位置）
    sim.hotspots.forEach(function (h) {
      var hx = h.x * cw + cw / 2, hy = h.y * ch + ch / 2;
      var r = 8;
      ctx.fillStyle = 'rgba(255, 90, 78, 0.95)';
      ctx.beginPath();
      ctx.moveTo(hx, hy - r);
      ctx.lineTo(hx + r, hy);
      ctx.lineTo(hx, hy + r);
      ctx.lineTo(hx - r, hy);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });

    // 浮标：金色圆 + 十字
    sim.buoys.forEach(function (b) {
      var bx = b.x * cw + cw / 2, by = b.y * ch + ch / 2;
      ctx.fillStyle = '#ffe08a';
      ctx.beginPath();
      ctx.arc(bx, by, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#5a4a12';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(bx - 8, by); ctx.lineTo(bx + 8, by);
      ctx.moveTo(bx, by - 8); ctx.lineTo(bx, by + 8);
      ctx.stroke();
    });

    if (hover) {
      ctx.strokeStyle = 'rgba(53, 194, 224, 0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(hover.x * cw + 1, hover.y * ch + 1, cw - 2, ch - 2);
    }
  }

  global.RT.drawMap = drawMap;
  global.RT.algaeColor = algaeColor;

  // 趋势曲线：藻密度 / 溶氧 / 鱼类存活率，标注临界阈值线
  function drawChart(canvas, sim) {
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;
    var pad = 34;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = '#274f63';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, 8); ctx.lineTo(pad, H - 22);
    ctx.lineTo(W - 8, H - 22);
    ctx.stroke();

    var hist = sim.history;
    if (hist.length < 2) return;
    var maxTick = Math.max(RT.DURATION_TICKS + RT.POST_RUN_TICKS, hist[hist.length - 1].tick, 1);
    function X(tick) { return pad + (W - pad - 10) * (tick / maxTick); }
    // 双尺度：左轴藻密度 0..30，右轴溶氧 0..12；鱼 0..1 映射到 0..30 显示
    function YAlgae(v) { return H - 22 - (H - 34) * Math.min(1, v / 30); }
    function YDo(v) { return H - 22 - (H - 34) * Math.min(1, v / 12); }
    function YFish(v) { return H - 22 - (H - 34) * v; }

    // 临界藻密度阈值线
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = '#f2635f';
    ctx.beginPath();
    ctx.moveTo(pad, YAlgae(RT.TH.algae));
    ctx.lineTo(W - 8, YAlgae(RT.TH.algae));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#f2635f';
    ctx.font = '11px "Noto Sans SC Local", "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText('藻密度阈值 15', W - 110, YAlgae(RT.TH.algae) - 4);

    function line(key, yfn, color) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      hist.forEach(function (h, i) {
        var x = X(h.tick), y = yfn(h[key]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    line('algae', YAlgae, '#ff8a66');
    line('do2', YDo, '#6fd3ff');
    line('fish', YFish, '#7fd99a');

    // 恢复观察区分隔
    if (sim.recoveryTick > 0) {
      ctx.strokeStyle = '#f2b94b';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(X(sim.recoveryTick), 8);
      ctx.lineTo(X(sim.recoveryTick), H - 22);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.fillStyle = '#8fb4c4';
    ctx.font = '12px "Noto Sans SC Local", "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText('— 藻密度(橙)  — 溶氧(蓝)  — 鱼存活(绿)', pad + 6, 16);
    ctx.fillText('D1', pad, H - 6);
    ctx.fillText('D4', X(RT.DURATION_TICKS), H - 6);
  }

  global.RT.drawChart = drawChart;
})(typeof window !== 'undefined' ? window : globalThis);
