/**
 * Scene composition: fixed layer order ground -> shadow -> cup ->
 * wireframe -> handlepoints. Every layer except markers writes/reads the
 * same depth buffer, giving correct occlusion at any yaw/pitch.
 */
(function (global) {
  'use strict';
  var NS = (global.TeaCup = global.TeaCup || {});
  var rz = NS.rasterizer;
  var m3 = NS.math3d;

  function setPixel(buf, x, y, color, z) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= buf.width || y >= buf.height) return;
    var idx = y * buf.width + x;
    if (z !== undefined && z >= buf.depth[idx]) return;
    if (z !== undefined) buf.depth[idx] = z;
    var o = idx * 3;
    buf.rgb[o] = color[0]; buf.rgb[o + 1] = color[1];
    buf.rgb[o + 2] = color[2];
  }

  function drawLine3D(buf, a, b, color) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var steps = Math.max(1, Math.round(Math.max(Math.abs(dx), Math.abs(dy))));
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      setPixel(buf, a.x + dx * t, a.y + dy * t, color,
        a.z + (b.z - a.z) * t);
    }
  }

  function drawMarker(buf, p, color) {
    var r = 6;
    for (var dy = -r; dy <= r; dy++) {
      for (var dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r) {
          setPixel(buf, p.x + dx, p.y + dy, color);
        }
      }
    }
  }

  function drawGround(buf, matrix) {
    var s = 9;
    var corners = [[-s, 0, -s], [s, 0, -s], [s, 0, s], [-s, 0, s]];
    var pts = corners.map(function (c) { return rz.project(buf, matrix, c); });
    if (pts.some(function (p) { return !p; })) return;
    rz.fillTriangle(buf, pts[0], pts[1], pts[2], [58, 74, 70]);
    rz.fillTriangle(buf, pts[0], pts[2], pts[3], [52, 67, 64]);
  }

  function drawShadows(buf, matrix, mesh) {
    mesh.faces.forEach(function (face) {
      var idx = face.indices;
      var pa = rz.projectShadow(mesh.vertices[idx[0]]);
      var pb = rz.projectShadow(mesh.vertices[idx[1]]);
      var pc = rz.projectShadow(mesh.vertices[idx[2]]);
      pa[1] = pb[1] = pc[1] = 0.002;
      var a = rz.project(buf, matrix, pa);
      var b = rz.project(buf, matrix, pb);
      var c = rz.project(buf, matrix, pc);
      if (a && b && c) rz.fillTriangle(buf, a, b, c, [28, 34, 33]);
    });
  }

  function drawCup(buf, matrix, mesh) {
    mesh.faces.forEach(function (face) {
      var idx = face.indices;
      var a = rz.project(buf, matrix, mesh.vertices[idx[0]]);
      var b = rz.project(buf, matrix, mesh.vertices[idx[1]]);
      var c = rz.project(buf, matrix, mesh.vertices[idx[2]]);
      if (!a || !b || !c) return;
      var normal = m3.normalize(m3.cross(
        m3.sub(mesh.vertices[idx[1]], mesh.vertices[idx[0]]),
        m3.sub(mesh.vertices[idx[2]], mesh.vertices[idx[0]])));
      rz.fillTriangle(buf, a, b, c, rz.shade(mesh, face, normal));
    });
  }

  function drawWireframe(buf, matrix, mesh) {
    var seen = {};
    mesh.faces.forEach(function (face) {
      var idx = face.indices;
      for (var e = 0; e < 3; e++) {
        var i1 = idx[e], i2 = idx[(e + 1) % 3];
        var key = i1 < i2 ? i1 + '_' + i2 : i2 + '_' + i1;
        if (seen[key]) continue;
        seen[key] = 1;
        var a = rz.project(buf, matrix, mesh.vertices[i1]);
        var b = rz.project(buf, matrix, mesh.vertices[i2]);
        if (a && b) {
          drawLine3D(buf, a, b,
            face.group === 'handle' ? [64, 36, 20] : [48, 28, 18]);
        }
      }
    });
  }

  function drawControlPoints(buf, matrix, mesh, activeId) {
    mesh.controlPoints.forEach(function (cp) {
      var p = rz.project(buf, matrix, cp.position);
      if (!p) return;
      drawMarker(buf, p, cp.id === activeId ? [255, 226, 90] : [240, 240, 235]);
    });
  }

  /**
   * @param {Object} layers visibility map, e.g. {shadow:true, wireframe:false}
   */
  function render(mesh, viewSpec, layers) {
    var spec = Object.assign({}, viewSpec);
    var radius = Math.max(mesh.bbox.size[0], mesh.bbox.size[1],
      mesh.bbox.size[2]) / 2;
    var aspect = spec.width / spec.height;
    var fovy = (spec.fovy || 50) * Math.PI / 180;
    var fitFov = Math.min(fovy,
      2 * Math.atan(Math.tan(fovy / 2) * aspect));
    var fitDistance = radius / Math.sin(fitFov / 2) * 1.15;
    spec.distance = fitDistance * (spec.userZoom || 1);
    spec.target = [mesh.bbox.center[0], mesh.bbox.center[1],
      mesh.bbox.center[2]];
    var buf = rz.createView(spec);
    rz.clear(buf, viewSpec.background || [236, 238, 235]);
    var matrix = rz.cameraMatrix(spec);
    layers = layers || {};
    drawGround(buf, matrix);
    if (layers.shadow !== false) drawShadows(buf, matrix, mesh);
    drawCup(buf, matrix, mesh);
    if (layers.wireframe) drawWireframe(buf, matrix, mesh);
    if (layers.handlepoints !== false) {
      drawControlPoints(buf, matrix, mesh, spec.activePoint);
    }
    return buf;
  }

  NS.scene = {
    render: render,
    drawGround: drawGround,
    drawShadows: drawShadows,
    drawCup: drawCup,
    drawWireframe: drawWireframe,
    drawControlPoints: drawControlPoints,
    drawLine3D: drawLine3D
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
