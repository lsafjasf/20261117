/**
 * Minimal vector / matrix helpers shared by the browser app and Node tests.
 * No dependencies. Matrices are column-major Float32Array(16), OpenGL style.
 */
(function (global) {
  'use strict';
  var NS = (global.TeaCup = global.TeaCup || {});

  function v3(x, y, z) { return [x, y, z]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
  }
  function length(a) { return Math.hypot(a[0], a[1], a[2]); }
  function normalize(a) {
    var len = length(a) || 1;
    return [a[0] / len, a[1] / len, a[2] / len];
  }

  function identity() {
    var m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  }

  function multiply(a, b) {
    var out = new Float32Array(16);
    for (var col = 0; col < 4; col++) {
      for (var row = 0; row < 4; row++) {
        out[col * 4 + row] =
          a[0 * 4 + row] * b[col * 4 + 0] +
          a[1 * 4 + row] * b[col * 4 + 1] +
          a[2 * 4 + row] * b[col * 4 + 2] +
          a[3 * 4 + row] * b[col * 4 + 3];
      }
    }
    return out;
  }

  function translation(x, y, z) {
    var m = identity();
    m[12] = x; m[13] = y; m[14] = z;
    return m;
  }

  function rotationX(rad) {
    var c = Math.cos(rad), s = Math.sin(rad), m = identity();
    m[5] = c; m[6] = s;
    m[9] = -s; m[10] = c;
    return m;
  }

  function rotationY(rad) {
    var c = Math.cos(rad), s = Math.sin(rad), m = identity();
    m[0] = c; m[2] = -s;
    m[8] = s; m[10] = c;
    return m;
  }

  function perspective(fovyRad, aspect, near, far) {
    var f = 1 / Math.tan(fovyRad / 2), m = new Float32Array(16);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = (far + near) / (near - far);
    m[11] = -1;
    m[14] = (2 * far * near) / (near - far);
    return m;
  }

  function transform(m, p) {
    var x = p[0], y = p[1], z = p[2];
    return [
      m[0] * x + m[4] * y + m[8] * z + m[12],
      m[1] * x + m[5] * y + m[9] * z + m[13],
      m[2] * x + m[6] * y + m[10] * z + m[14],
      m[3] * x + m[7] * y + m[11] * z + m[15]
    ];
  }

  function transform4(m, p) {
    var x = p[0], y = p[1], z = p[2], w = p[3] === undefined ? 1 : p[3];
    return [
      m[0] * x + m[4] * y + m[8] * z + m[12] * w,
      m[1] * x + m[5] * y + m[9] * z + m[13] * w,
      m[2] * x + m[6] * y + m[10] * z + m[14] * w,
      m[3] * x + m[7] * y + m[11] * z + m[15] * w
    ];
  }

  function at(m, r, c) { return m[c * 4 + r]; }

  function invert(m) {
    var inv = new Float32Array(16);
    var a = [[], [], [], []];
    for (var r = 0; r < 4; r++) {
      for (var c = 0; c < 4; c++) a[r][c] = at(m, r, c);
    }
    var e = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
    for (var col = 0; col < 4; col++) {
      var pivot = col;
      for (var r2 = col + 1; r2 < 4; r2++) {
        if (Math.abs(a[r2][col]) > Math.abs(a[pivot][col])) pivot = r2;
      }
      if (Math.abs(a[pivot][col]) < 1e-10) return identity();
      if (pivot !== col) {
        var ta = a[col]; a[col] = a[pivot]; a[pivot] = ta;
        var te = e[col]; e[col] = e[pivot]; e[pivot] = te;
      }
      var div = a[col][col];
      for (var k2 = 0; k2 < 4; k2++) {
        a[col][k2] /= div;
        e[col][k2] /= div;
      }
      for (var r3 = 0; r3 < 4; r3++) {
        if (r3 === col) continue;
        var factor = a[r3][col];
        for (var k3 = 0; k3 < 4; k3++) {
          a[r3][k3] -= factor * a[col][k3];
          e[r3][k3] -= factor * e[col][k3];
        }
      }
    }
    for (var rr = 0; rr < 4; rr++) {
      for (var cc = 0; cc < 4; cc++) inv[cc * 4 + rr] = e[rr][cc];
    }
    return inv;
  }

  function clamp(v, lo, hi) {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  NS.math3d = {
    v3: v3, add: add, sub: sub, scale: scale, dot: dot, cross: cross,
    length: length, normalize: normalize,
    identity: identity, multiply: multiply, translation: translation,
    rotationX: rotationX, rotationY: rotationY, perspective: perspective,
    transform: transform, transform4: transform4,
    invert: invert, clamp: clamp
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
