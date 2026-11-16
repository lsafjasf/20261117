/* Canvas 渲染：轨道、道岔、车辆、限速标识，以及两侧仪表的速度表/环形资源表。 */
(function (global) {
  "use strict";
  var MC = global.MC || (global.MC = {});
  var T = MC.Track;

  function pathPoints(route) {
    return T.paths[route].pts;
  }

  function strokePath(ctx, pts, color, width, dash) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    if (dash) ctx.setLineDash(dash); else ctx.setLineDash([]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawTrack(ctx, engine) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    var selected = engine.switchPos;
    var other = selected === "inner" ? "outer" : "inner";

    // 未选中路径（暗淡的备选线）
    strokePath(ctx, pathPoints(other), "rgba(70,110,120,.22)", 10, [6, 8]);
    // 轨道底板与选中路径
    strokePath(ctx, pathPoints(selected), "#12262e", 26);
    strokePath(ctx, pathPoints(selected), "rgba(55,216,207,.18)", 20);
    strokePath(ctx, pathPoints(selected), "rgba(120,220,214,.55)", 2);

    // 枕木刻度
    var pts = pathPoints(selected);
    ctx.strokeStyle = "rgba(120,170,178,.18)";
    ctx.lineWidth = 1;
    for (var i = 0; i < pts.length; i += 14) {
      var p = pts[i], p2 = pts[Math.min(i + 1, pts.length - 1)];
      var nx = -(p2.y - p.y), ny = (p2.x - p.x);
      var nl = Math.hypot(nx, ny) || 1;
      nx /= nl; ny /= nl;
      ctx.beginPath();
      ctx.moveTo(p.x - nx * 11, p.y - ny * 11);
      ctx.lineTo(p.x + nx * 11, p.y + ny * 11);
      ctx.stroke();
    }

    drawMarkers(ctx, engine);
    drawTrain(ctx, engine);
  }

  function drawMarkers(ctx, engine) {
    var s = T.START;
    // 起点 / 终点停车区
    ctx.fillStyle = "rgba(242,193,78,.85)";
    for (var i = -2; i <= 2; i++) ctx.fillRect(s.x + i * 10 - 3, s.y - 26, 5, 10);
    ctx.font = "10px Consolas, monospace";
    ctx.fillStyle = "rgba(242,193,78,.9)";
    ctx.textAlign = "center";
    ctx.fillText("TERMINAL / 3 LAPS", s.x, s.y - 32);

    // J1 道岔
    var b = T.BRANCH;
    var required = T.requiredRoutes[(engine.lap - 1) % 3];
    var ok = engine.switchPos === required;
    ctx.strokeStyle = ok ? "#37d8cf" : "#f2c14e";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(b.x, b.y, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = ok ? "#37d8cf" : "#f2c14e";
    ctx.textAlign = "left";
    ctx.fillText("J1 · " + (engine.switchPos === "inner" ? "内环" : "外环") +
      (engine.distance < T.branchM ? " · " + Math.round(T.branchM - engine.distance) + "m" : ""), b.x + 12, b.y - 10);

    // 限速标识（三个曲线区中点）
    var zones = T.hazardZones(T.paths[engine.switchPos]);
    zones.forEach(function (z) {
      var mid = (z.fromM + z.toM) / 2;
      var pose = T.poseAt(T.paths[engine.switchPos], T.toDesign(mid));
      ctx.fillStyle = "rgba(160,190,196,.75)";
      ctx.textAlign = "center";
      ctx.fillText(z.name + " 弯", pose.x, pose.y - 22);
      ctx.fillStyle = "rgba(242,193,78,.8)";
      ctx.fillText("LIMIT " + z.limit + " m/s", pose.x, pose.y - 10);
    });

    // 圈数标记 1/2/3
    [0.33, 0.55, 0.78].forEach(function (frac, idx) {
      var pose = T.poseAt(T.paths[engine.switchPos], T.paths[engine.switchPos].totalDesign * frac);
      ctx.strokeStyle = idx + 1 === engine.lap ? "#e8763c" : "rgba(150,180,186,.5)";
      ctx.lineWidth = idx + 1 === engine.lap ? 2 : 1;
      ctx.strokeRect(pose.x - 8, pose.y - 8, 16, 16);
      ctx.fillStyle = idx + 1 === engine.lap ? "#e8763c" : "rgba(150,180,186,.6)";
      ctx.fillText(String(idx + 1), pose.x, pose.y + 3);
    });
  }

  function drawTrain(ctx, engine) {
    var path = T.paths[engine.switchPos];
    var pose = T.poseAt(path, T.toDesign(engine.distance));
    ctx.save();
    ctx.translate(pose.x, pose.y);
    ctx.rotate(pose.hd);
    // 光晕
    ctx.fillStyle = "rgba(55,216,207,.15)";
    ctx.beginPath();
    ctx.ellipse(0, 0, 26, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    // 车体 M-07
    ctx.fillStyle = "#d7e6ea";
    ctx.fillRect(-16, -7, 30, 14);
    ctx.fillStyle = "#0b1419";
    ctx.fillRect(2, -5, 9, 10);
    ctx.fillStyle = "#e8763c";
    ctx.fillRect(-16, -7, 5, 14);
    ctx.fillStyle = "#37d8cf";
    ctx.fillRect(14, -3, 4, 6);
    ctx.restore();

    ctx.fillStyle = "rgba(160,190,196,.8)";
    ctx.textAlign = "left";
    ctx.font = "10px Consolas, monospace";
    ctx.fillText("TRAIN M-07", pose.x - 30, pose.y - 24);
    var pv = engine.preview();
    if (pv) {
      ctx.textAlign = "right";
      ctx.fillStyle = pv.kind === "switch" ? "#f2c14e" : "rgba(160,190,196,.8)";
      ctx.fillText("NEXT " + pv.id + " · " + Math.round(pv.dist) + "m", ctx.canvas.width - 16, 26);
    }
  }

  // ---- 半圆速度表 ----
  function drawGauge(canvas, speed, limit, accent) {
    var ctx = canvas.getContext("2d");
    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    var cx = w / 2, cy = h - 8, r = h - 20;
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(120,160,168,.18)";
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI, 0);
    ctx.stroke();
    var frac = Math.min(1, speed / (limit + 4));
    ctx.strokeStyle = accent;
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI, Math.PI + Math.PI * frac);
    ctx.stroke();
    // 限速刻度
    var lx = cx + r * Math.cos(Math.PI + Math.PI * limit / (limit + 4));
    var ly = cy + r * Math.sin(Math.PI + Math.PI * limit / (limit + 4));
    ctx.fillStyle = "#f2c14e";
    ctx.beginPath();
    ctx.arc(lx, ly, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- 环形资源表 ----
  function drawRing(canvas, pct, accent) {
    var ctx = canvas.getContext("2d");
    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    var cx = w / 2, cy = h / 2, r = 18;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(120,160,168,.2)";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = accent;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct / 100);
    ctx.stroke();
  }

  MC.Render = { drawTrack: drawTrack, drawGauge: drawGauge, drawRing: drawRing };
  if (typeof module !== "undefined" && module.exports) module.exports = MC.Render;
})(typeof window !== "undefined" ? window : globalThis);
