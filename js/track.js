/* 轨道几何：花生形闭合环线，J1 道岔提供内环/外环两条路径。
   设计坐标系为 canvas 像素，世界距离（米）= 设计长度 × PX_PER_M。 */
(function (global) {
  "use strict";
  var MC = global.MC || (global.MC = {});

  var PX_PER_M = 0.4;
  var SAMPLE_STEP = 2;

  // 关键控制点（960×520 画布）
  var START = { x: 480, y: 385 };
  var BRANCH = { x: 600, y: 385 };          // J1 道岔起点
  var RC = { x: 700, y: 265 };              // 右环圆心
  var R_OUT = 120, R_IN = 88;
  var LC = { x: 260, y: 265 };              // 左环圆心
  var R_LEFT = 120;
  var TOP_MERGE = { x: 700, y: 145 };
  var TOP_END = { x: 260, y: 145 };
  var BOW_CTRL = { x: 480, y: 200 };

  function arcPts(cx, cy, r, a0, a1, steps) {
    var out = [];
    for (var i = 0; i <= steps; i++) {
      var a = a0 + (a1 - a0) * i / steps;
      out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return out;
  }
  function quadPts(p0, c, p1, steps) {
    var out = [];
    for (var i = 0; i <= steps; i++) {
      var t = i / steps, u = 1 - t;
      out.push({
        x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
        y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y
      });
    }
    return out;
  }
  function linePts(p0, p1, steps) {
    var out = [];
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      out.push({ x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t });
    }
    return out;
  }

  // 拼接一条完整路径（去重相邻点）
  function buildSegments(route) {
    var segs = [];
    segs.push({ kind: "line", pts: linePts(START, BRANCH, 60) });
    if (route === "inner") {
      var inBottom = { x: RC.x, y: RC.y + R_IN };
      var inTop = { x: RC.x, y: RC.y - R_IN };
      segs.push({ kind: "quad", pts: quadPts(BRANCH, { x: 655, y: 388 }, inBottom, 24) });
      segs.push({ kind: "arc", name: "A", pts: arcPts(RC.x, RC.y, R_IN, Math.PI / 2, -Math.PI / 2, 72) });
      segs.push({ kind: "quad", pts: quadPts(inTop, { x: 748, y: 162 }, TOP_MERGE, 20) });
    } else {
      var outBottom = { x: RC.x, y: RC.y + R_OUT };
      var outTop = { x: RC.x, y: RC.y - R_OUT };
      segs.push({ kind: "line", pts: linePts(BRANCH, outBottom, 60) });
      segs.push({ kind: "arc", name: "A", pts: arcPts(RC.x, RC.y, R_OUT, Math.PI / 2, -Math.PI / 2, 90) });
      // 外环顶点即 TOP_MERGE
      segs.push({ kind: "line", pts: linePts(outTop, TOP_MERGE, 4) });
    }
    segs.push({ kind: "quad", name: "K", pts: quadPts(TOP_MERGE, BOW_CTRL, TOP_END, 90) });
    segs.push({ kind: "arc", name: "S", pts: arcPts(LC.x, LC.y, R_LEFT, -Math.PI / 2, -Math.PI * 1.5, 90) });
    segs.push({ kind: "line", pts: linePts({ x: LC.x, y: LC.y + R_LEFT }, START, 110) });
    return segs;
  }

  function buildPath(route) {
    var segs = buildSegments(route);
    var pts = [];
    var segRanges = [];
    segs.forEach(function (seg) {
      var startIdx = pts.length;
      seg.pts.forEach(function (p, i) {
        if (pts.length && i === 0 && pts[pts.length - 1].x === p.x && pts[pts.length - 1].y === p.y) return;
        pts.push({ x: p.x, y: p.y });
      });
      segRanges.push({ kind: seg.kind, name: seg.name || null, a: startIdx, b: pts.length - 1 });
    });
    var cum = [0];
    for (var i = 1; i < pts.length; i++) {
      var dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
      cum.push(cum[i - 1] + Math.sqrt(dx * dx + dy * dy));
    }
    return {
      route: route, pts: pts, cum: cum,
      totalDesign: cum[cum.length - 1],
      totalM: cum[cum.length - 1] * PX_PER_M,
      segRanges: segRanges
    };
  }

  var PATHS = { outer: buildPath("outer"), inner: buildPath("inner") };

  function poseAt(path, sDesign) {
    var total = path.totalDesign;
    var s = ((sDesign % total) + total) % total;
    var cum = path.cum, pts = path.pts;
    var lo = 0, hi = cum.length - 1;
    while (lo < hi - 1) {
      var mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid; else hi = mid;
    }
    var span = cum[hi] - cum[lo] || 1;
    var t = (s - cum[lo]) / span;
    var a = pts[lo], b = pts[hi];
    var hd = Math.atan2(b.y - a.y, b.x - a.x);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, hd: hd };
  }

  // 曲线危险区间（设计距离范围，米）——按路径段换算
  function hazardZones(path) {
    return path.segRanges.filter(function (r) { return r.name; }).map(function (r) {
      return {
        name: r.name,
        fromM: path.cum[r.a] * PX_PER_M,
        toM: path.cum[r.b] * PX_PER_M,
        limit: 13.5
      };
    });
  }

  var branchM = PATHS.outer.cum[indexOf(PATHS.outer.pts, BRANCH)] * PX_PER_M;
  function indexOf(pts, p) {
    for (var i = 0; i < pts.length; i++) if (pts[i].x === p.x && pts[i].y === p.y) return i;
    return 0;
  }

  MC.Track = {
    PX_PER_M: PX_PER_M,
    START: START,
    BRANCH: BRANCH,
    branchM: branchM,
    paths: PATHS,
    poseAt: poseAt,
    hazardZones: hazardZones,
    requiredRoutes: ["inner", "outer", "inner"],
    stopZoneM: 90,          // 终点缓冲停车区
    stopSpeed: 4.4,         // 进入停车区安全阈值
    curveLimit: 13.5,
    switchWarnM: 130
  };
  MC.toDesign = function (meter) { return meter / PX_PER_M; };
  MC.Track.toDesign = MC.toDesign;

  if (typeof module !== "undefined" && module.exports) module.exports = MC.Track;
})(typeof window !== "undefined" ? window : globalThis);
