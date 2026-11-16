/* 浮雕地图核心模块：地形生成、参数验证、山体阴影渲染、投影换算。
   同时支持浏览器（window.Hillshade）与 Node（module.exports）。 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.Hillshade = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LIMITS = {
    azimuth: [0, 360],
    altitude: [1, 90],
    exaggeration: [0.1, 10],
    softness: [0, 12],
    zoom: [0.25, 8],
    pan: [-4096, 4096]
  };

  var DEFAULTS = {
    seed: 20261117,
    size: 512,
    view: { zoom: 1, panX: 0, panY: 0 },
    params: { azimuth: 315, altitude: 45, exaggeration: 2, softness: 2 },
    layers: { tint: true, hillshade: true },
    autoRotate: false
  };

  var EXTREME = {
    seed: 20261117,
    size: 512,
    view: { zoom: 4, panX: -220, panY: 140 },
    params: { azimuth: 135, altitude: 12, exaggeration: 8, softness: 4 },
    layers: { tint: true, hillshade: true },
    autoRotate: false
  };

  var PARAM_LABELS = {
    azimuth: '光源方位角',
    altitude: '光源高度角',
    exaggeration: '夸张系数',
    softness: '阴影柔度',
    zoom: '缩放',
    panX: '平移X',
    panY: '平移Y'
  };

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* 确定性分形地形 + 一条河谷，输出高程（米）。同一种子结果完全一致。 */
  function generateElevation(seed, size) {
    var rand = mulberry32(seed);
    var octaves = 7;
    var grids = [];
    for (var o = 0; o < octaves; o++) {
      var n = (2 << o) + 1;
      var g = new Float32Array(n * n);
      for (var i = 0; i < n * n; i++) g[i] = rand();
      grids.push({ n: n, g: g });
    }
    var elev = new Float32Array(size * size);
    var riverAmp = size * 0.16;
    var riverFreq = (Math.PI * 2) / size;
    for (var y = 0; y < size; y++) {
      var riverX = size * 0.5 + Math.sin(y * riverFreq * 1.7) * riverAmp
        + Math.sin(y * riverFreq * 4.3) * riverAmp * 0.25;
      for (var x = 0; x < size; x++) {
        var h = 0, amp = 1, total = 0;
        for (var k = 0; k < octaves; k++) {
          var gd = grids[k], n2 = gd.n;
          var fx = (x / (size - 1)) * (n2 - 1);
          var fy = (y / (size - 1)) * (n2 - 1);
          var x0 = Math.min(Math.floor(fx), n2 - 2);
          var y0 = Math.min(Math.floor(fy), n2 - 2);
          var tx = fx - x0, ty = fy - y0;
          tx = tx * tx * (3 - 2 * tx);
          ty = ty * ty * (3 - 2 * ty);
          var i00 = gd.g[y0 * n2 + x0], i10 = gd.g[y0 * n2 + x0 + 1];
          var i01 = gd.g[(y0 + 1) * n2 + x0], i11 = gd.g[(y0 + 1) * n2 + x0 + 1];
          var top = i00 + (i10 - i00) * tx;
          var bot = i01 + (i11 - i01) * tx;
          h += (top + (bot - top) * ty) * amp;
          total += amp;
          amp *= 0.5;
        }
        h /= total;
        var ridge = 1 - Math.abs(h * 2 - 1);
        h = h * 0.45 + Math.pow(ridge, 1.5) * 0.55;
        var d = Math.abs(x - riverX) / (size * 0.09);
        var carve = Math.exp(-d * d) * 0.55;
        h = Math.max(0, h - carve * h - carve * 0.12);
        elev[y * size + x] = h;
      }
    }
    var min = Infinity, max = -Infinity;
    for (var j = 0; j < elev.length; j++) {
      if (elev[j] < min) min = elev[j];
      if (elev[j] > max) max = elev[j];
    }
    var range = max - min || 1;
    for (var m = 0; m < elev.length; m++) {
      var t = (elev[m] - min) / range;
      elev[m] = Math.pow(t, 1.5) * 2600 + 40;
    }
    return elev;
  }

  function checkRange(errors, field, label, value, min, max) {
    if (typeof value !== 'number' || !isFinite(value)) {
      errors.push({ field: field, reason: label + '必须是有限数字，收到: ' + String(value) });
      return;
    }
    if (value < min || value > max) {
      errors.push({ field: field, reason: label + '超出范围 [' + min + ', ' + max + ']，收到: ' + value });
    }
  }

  /* 校验完整状态，返回错误数组（空数组表示合法）。 */
  function validateState(state) {
    var errors = [];
    if (!state || typeof state !== 'object') {
      return [{ field: 'state', reason: '状态缺失或不是对象' }];
    }
    var p = state.params || {};
    var v = state.view || {};
    checkRange(errors, 'azimuth', PARAM_LABELS.azimuth, p.azimuth, LIMITS.azimuth[0], LIMITS.azimuth[1]);
    checkRange(errors, 'altitude', PARAM_LABELS.altitude, p.altitude, LIMITS.altitude[0], LIMITS.altitude[1]);
    checkRange(errors, 'exaggeration', PARAM_LABELS.exaggeration, p.exaggeration, LIMITS.exaggeration[0], LIMITS.exaggeration[1]);
    checkRange(errors, 'softness', PARAM_LABELS.softness, p.softness, LIMITS.softness[0], LIMITS.softness[1]);
    checkRange(errors, 'zoom', PARAM_LABELS.zoom, v.zoom, LIMITS.zoom[0], LIMITS.zoom[1]);
    checkRange(errors, 'panX', PARAM_LABELS.panX, v.panX, LIMITS.pan[0], LIMITS.pan[1]);
    checkRange(errors, 'panY', PARAM_LABELS.panY, v.panY, LIMITS.pan[0], LIMITS.pan[1]);
    if (!Number.isInteger(state.seed) || state.seed < 1 || state.seed > 2147483647) {
      errors.push({ field: 'seed', reason: '随机种子必须是 1..2147483647 的整数，收到: ' + String(state.seed) });
    }
    if (!Number.isInteger(state.size) || state.size < 64 || state.size > 2048) {
      errors.push({ field: 'size', reason: '地形尺寸必须是 64..2048 的整数，收到: ' + String(state.size) });
    }
    var ly = state.layers || {};
    if (typeof ly.tint !== 'boolean' || typeof ly.hillshade !== 'boolean') {
      errors.push({ field: 'layers', reason: '图层开关必须是布尔值' });
    }
    return errors;
  }

  var CELL_METERS = 25000 / 512; /* 假定实地范围 25km */

  /* 标准山体阴影：陡坡与河谷使用同一光照模型，保证明暗一致。 */
  function computeHillshade(elev, size, params) {
    var zenith = (90 - params.altitude) * Math.PI / 180;
    var azimuth = ((360 - params.azimuth + 90) % 360) * Math.PI / 180;
    var cosZ = Math.cos(zenith), sinZ = Math.sin(zenith);
    var zFactor = params.exaggeration / (2 * CELL_METERS);
    var shade = new Float32Array(size * size);
    for (var y = 0; y < size; y++) {
      var ym = y > 0 ? y - 1 : 0;
      var yp = y < size - 1 ? y + 1 : size - 1;
      for (var x = 0; x < size; x++) {
        var xm = x > 0 ? x - 1 : 0;
        var xp = x < size - 1 ? x + 1 : size - 1;
        var dzdx = (elev[y * size + xp] - elev[y * size + xm]) * zFactor;
        var dzdy = (elev[yp * size + x] - elev[ym * size + x]) * zFactor;
        var slope = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
        var aspect = Math.atan2(dzdy, -dzdx);
        var hs = cosZ * Math.cos(slope) + sinZ * Math.sin(slope) * Math.cos(azimuth - aspect);
        shade[y * size + x] = hs < 0 ? 0 : (hs > 1 ? 1 : hs);
      }
    }
    if (params.softness > 0) blurInPlace(shade, size, Math.round(params.softness));
    return shade;
  }

  /* 三遍可分离盒式模糊近似高斯，柔化阴影。 */
  function blurInPlace(buf, size, radius) {
    if (radius < 1) return;
    var tmp = new Float32Array(buf.length);
    for (var pass = 0; pass < 3; pass++) {
      var x, y, i, acc;
      for (y = 0; y < size; y++) {
        acc = 0;
        for (x = -radius; x <= radius; x++) {
          acc += buf[y * size + Math.min(size - 1, Math.max(0, x))];
        }
        for (x = 0; x < size; x++) {
          i = y * size + x;
          tmp[i] = acc / (2 * radius + 1);
          var xAdd = Math.min(size - 1, x + radius + 1);
          var xSub = Math.max(0, x - radius);
          acc += buf[y * size + xAdd] - buf[y * size + xSub];
        }
      }
      for (x = 0; x < size; x++) {
        acc = 0;
        for (y = -radius; y <= radius; y++) {
          acc += tmp[Math.min(size - 1, Math.max(0, y)) * size + x];
        }
        for (y = 0; y < size; y++) {
          i = y * size + x;
          buf[i] = acc / (2 * radius + 1);
          var yAdd = Math.min(size - 1, y + radius + 1);
          var ySub = Math.max(0, y - radius);
          acc += tmp[yAdd * size + x] - tmp[ySub * size + x];
        }
      }
    }
  }

  /* 分层设色：低地绿 -> 山地棕 -> 高山灰白。 */
  function tintColor(elevMeters, out, idx) {
    var t = Math.min(1, Math.max(0, (elevMeters - 40) / 2600));
    var r, g, b;
    if (t < 0.35) {
      var u = t / 0.35;
      r = 88 + u * 72; g = 140 + u * 20; b = 70 + u * 10;
    } else if (t < 0.7) {
      var v = (t - 0.35) / 0.35;
      r = 160 + v * 40; g = 160 - v * 30; b = 80 + v * 40;
    } else {
      var w = (t - 0.7) / 0.3;
      r = 200 + w * 55; g = 130 + w * 125; b = 120 + w * 135;
    }
    out[idx] = r; out[idx + 1] = g; out[idx + 2] = b; out[idx + 3] = 255;
  }

  /* 图层合成：底色层在下，阴影层以正片叠底方式叠加在上。 */
  function compose(elev, shade, size, layers) {
    var rgba = new Uint8ClampedArray(size * size * 4);
    var tintOn = layers.tint, shadeOn = layers.hillshade;
    for (var i = 0, p = 0; i < size * size; i++, p += 4) {
      if (tintOn) tintColor(elev[i], rgba, p);
      else { rgba[p] = 255; rgba[p + 1] = 255; rgba[p + 2] = 255; rgba[p + 3] = 255; }
      if (shadeOn) {
        var f = 0.30 + 0.70 * shade[i];
        rgba[p] *= f; rgba[p + 1] *= f; rgba[p + 2] *= f;
      }
    }
    return rgba;
  }

  /* 完整渲染：高程 -> 阴影 -> 合成 RGBA。elev 可传入缓存以避免重复生成。 */
  function renderFrame(state, elev) {
    var errors = validateState(state);
    if (errors.length) {
      var err = new Error('参数非法');
      err.validationErrors = errors;
      throw err;
    }
    var elevation = elev || generateElevation(state.seed, state.size);
    var shade = computeHillshade(elevation, state.size, state.params);
    return compose(elevation, shade, state.size, state.layers);
  }

  /* 世界坐标(地形像素) <-> 屏幕坐标。 */
  function project(view, canvasW, canvasH, size, wx, wy) {
    return {
      x: (wx - size / 2) * view.zoom + canvasW / 2 + view.panX,
      y: (wy - size / 2) * view.zoom + canvasH / 2 + view.panY
    };
  }

  function unproject(view, canvasW, canvasH, size, sx, sy) {
    return {
      x: (sx - canvasW / 2 - view.panX) / view.zoom + size / 2,
      y: (sy - canvasH / 2 - view.panY) / view.zoom + size / 2
    };
  }

  function sampleElevation(elev, size, wx, wy) {
    var x = Math.round(wx), y = Math.round(wy);
    if (x < 0 || y < 0 || x >= size || y >= size) return null;
    return elev[y * size + x];
  }

  function serializeState(state) { return JSON.stringify(state); }

  function deserializeState(text) {
    var state = JSON.parse(text);
    var errors = validateState(state);
    if (errors.length) {
      var err = new Error('持久化状态非法');
      err.validationErrors = errors;
      throw err;
    }
    return state;
  }

  /* FNV-1a 校验和，用于测试渲染确定性与一致性（浮点先量化）。 */
  function checksum(arr) {
    var h = 0x811c9dc5;
    for (var i = 0; i < arr.length; i++) {
      h ^= Math.round(arr[i] * 4096) & 0xffffff;
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  }

  return {
    LIMITS: LIMITS,
    DEFAULTS: DEFAULTS,
    EXTREME: EXTREME,
    PARAM_LABELS: PARAM_LABELS,
    CELL_METERS: CELL_METERS,
    clone: clone,
    mulberry32: mulberry32,
    generateElevation: generateElevation,
    validateState: validateState,
    computeHillshade: computeHillshade,
    compose: compose,
    renderFrame: renderFrame,
    project: project,
    unproject: unproject,
    sampleElevation: sampleElevation,
    serializeState: serializeState,
    deserializeState: deserializeState,
    checksum: checksum
  };
});
