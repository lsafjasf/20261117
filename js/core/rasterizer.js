/**
 * Tiny software 3D rasterizer on an RGB framebuffer + depth buffer.
 * Renders flat-shaded low-poly triangles, planar ground shadows projected
 * with a fixed light direction, and an optional wireframe layer. Hidden
 * surfaces are removed by depth test, so rotation never flips normals or
 * shadows and occlusion stays correct.
 */
(function (global) {
  'use strict';
  var NS = (global.TeaCup = global.TeaCup || {});
  var m3 = NS.math3d;

  var LAYERS = ['ground', 'shadow', 'cup', 'wireframe', 'handlepoints'];
  var LIGHT_DIR = m3.normalize([0.45, 0.8, 0.35]);
  var BODY_COLOR = [214, 120, 70];
  var HANDLE_COLOR = [176, 92, 48];

  function createView(view) {
    var width = view.width, height = view.height;
    return {
      width: width,
      height: height,
      rgb: new Uint8Array(width * height * 3),
      depth: new Float32Array(width * height),
      view: view
    };
  }

  function clear(buf, color) {
    for (var i = 0; i < buf.width * buf.height; i++) {
      buf.rgb[i * 3] = color[0];
      buf.rgb[i * 3 + 1] = color[1];
      buf.rgb[i * 3 + 2] = color[2];
      buf.depth[i] = Infinity;
    }
  }

  function cameraMatrix(view) {
    var aspect = view.width / view.height;
    var target = view.target || [0, view.targetY != null ? view.targetY : 1, 0];
    var dist = (view.distance || 6) / (view.scale || 1);
    var fovy = (view.fovy || 50) * Math.PI / 180;
    var eye = [
      target[0] + dist * Math.cos(view.pitch) * Math.sin(view.yaw),
      target[1] + dist * Math.sin(view.pitch),
      target[2] + dist * Math.cos(view.pitch) * Math.cos(view.yaw)
    ];
    var forward = m3.normalize(m3.sub(target, eye));
    var right = m3.normalize(m3.cross(forward, [0, 1, 0]));
    var up = m3.cross(right, forward);
    var rm = [
      right[0], right[1], right[2],
      up[0], up[1], up[2],
      -forward[0], -forward[1], -forward[2]
    ];
    var tx = -(right[0] * eye[0] + right[1] * eye[1] + right[2] * eye[2]);
    var ty = -(up[0] * eye[0] + up[1] * eye[1] + up[2] * eye[2]);
    var tz = forward[0] * eye[0] + forward[1] * eye[1] +
      forward[2] * eye[2];
    var view = new Float32Array(16);
    view[0] = rm[0]; view[1] = rm[3]; view[2] = rm[6]; view[3] = 0;
    view[4] = rm[1]; view[5] = rm[4]; view[6] = rm[7]; view[7] = 0;
    view[8] = rm[2]; view[9] = rm[5]; view[10] = rm[8]; view[11] = 0;
    view[12] = tx; view[13] = ty; view[14] = tz; view[15] = 1;
    var proj = m3.perspective(fovy, aspect, 0.1, 100);
    return m3.multiply(proj, view);
  }

  function project(buf, matrix, point) {
    var clip = m3.transform(matrix, point);
    if (clip[3] <= 0.0001) return null;
    var ndc = [clip[0] / clip[3], clip[1] / clip[3], clip[2] / clip[3]];
    return {
      x: (ndc[0] * 0.5 + 0.5) * buf.width,
      y: (1 - (ndc[1] * 0.5 + 0.5)) * buf.height,
      z: ndc[2],
      w: clip[3]
    };
  }

  function fillTriangle(buf, a, b, c, color) {
    var minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
    var maxX = Math.min(buf.width - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
    var minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
    var maxY = Math.min(buf.height - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
    var area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(area) < 1e-6) return;
    for (var y = minY; y <= maxY; y++) {
      for (var x = minX; x <= maxX; x++) {
        var px = x + 0.5, py = y + 0.5;
        var w0 = ((b.x - px) * (c.y - py) - (b.y - py) * (c.x - px)) / area;
        var w1 = ((c.x - px) * (a.y - py) - (c.y - py) * (a.x - px)) / area;
        var w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        var z = w0 * a.z + w1 * b.z + w2 * c.z;
        var idx = y * buf.width + x;
        if (z >= buf.depth[idx]) continue;
        buf.depth[idx] = z;
        var o = idx * 3;
        buf.rgb[o] = color[0]; buf.rgb[o + 1] = color[1];
        buf.rgb[o + 2] = color[2];
      }
    }
  }

  function shade(mesh, face, worldNormal) {
    var base = face.group === 'handle' ? HANDLE_COLOR : BODY_COLOR;
    var diffuse = Math.max(0, m3.dot(worldNormal, LIGHT_DIR));
    var k = 0.32 + 0.68 * diffuse;
    return [Math.round(base[0] * k), Math.round(base[1] * k),
      Math.round(base[2] * k)];
  }

  /** Project p onto the y=0 ground plane along the fixed light direction. */
  function projectShadow(p) {
    if (p[1] <= 0.0001) return [p[0], 0, p[2]];
    var t = p[1] / LIGHT_DIR[1];
    return [p[0] - t * LIGHT_DIR[0], 0, p[2] - t * LIGHT_DIR[2]];
  }

  NS.rasterizer = {
    LAYERS: LAYERS,
    LIGHT_DIR: LIGHT_DIR,
    createView: createView,
    clear: clear,
    cameraMatrix: cameraMatrix,
    project: project,
    fillTriangle: fillTriangle,
    shade: shade,
    projectShadow: projectShadow
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
