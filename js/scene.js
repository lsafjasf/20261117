/*
 * scene.js — 纯逻辑核心：参数定义与校验、确定性场景生成、
 * 像素按 亮度/饱和度/色相 分层、状态导出与导入。
 * 同时兼容浏览器 (window.SceneCore) 与 Node (module.exports)。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SceneCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = 1;
  const LAYER_COUNT = 3;
  const BASE_W = 480;
  const BASE_H = 320;

  const PARAM_DEFS = {
    seed:        { type: 'int',   min: 0, max: 99999999, def: 20261117, label: '随机种子' },
    shapeCount:  { type: 'int',   min: 1, max: 200,    def: 36,       label: '图形数量' },
    hueBase:     { type: 'float', min: 0, max: 360,    def: 210,      label: '基准色相' },
    hueSpread:   { type: 'float', min: 0, max: 360,    def: 180,      label: '色相跨度' },
    saturation:  { type: 'float', min: 0, max: 100,    def: 70,       label: '饱和度' },
    brightness:  { type: 'float', min: 0, max: 100,    def: 55,       label: '亮度' },
    waveAmp:     { type: 'float', min: 0, max: 100,    def: 30,       label: '波浪振幅' },
    waveFreq:    { type: 'float', min: 1, max: 20,     def: 6,        label: '波浪频率' },
    bgLight:     { type: 'float', min: 0, max: 100,    def: 12,       label: '背景亮度' },
    animSpeed:   { type: 'float', min: 0, max: 5,      def: 1,        label: '动画速度' },
    splitMode:   { type: 'enum',  values: ['brightness', 'saturation', 'hue'], def: 'brightness', label: '分层依据' },
    th1:         { type: 'float', min: 0, max: 1,      def: 0.33,     label: '阈值1' },
    th2:         { type: 'float', min: 0, max: 1,      def: 0.66,     label: '阈值2' },
  };

  const VIEW_DEFS = {
    zoom: { min: 0.25, max: 4, def: 1 },
    panX: { min: -2000, max: 2000, def: 0 },
    panY: { min: -2000, max: 2000, def: 0 },
  };

  function defaultParams() {
    const p = {};
    for (const k in PARAM_DEFS) p[k] = PARAM_DEFS[k].def;
    return p;
  }

  function defaultLayers() {
    const names = ['层1(低)', '层2(中)', '层3(高)'];
    const arr = [];
    for (let i = 0; i < LAYER_COUNT; i++) {
      arr.push({ id: i, name: names[i], visible: true, opacity: 1, hueShift: 0 });
    }
    return arr;
  }

  function defaultView() {
    return { zoom: VIEW_DEFS.zoom.def, panX: VIEW_DEFS.panX.def, panY: VIEW_DEFS.panY.def };
  }

  /* ---------------- 参数校验 ---------------- */

  function validateParams(raw) {
    const errors = [];
    const params = {};
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, errors: ['参数必须是对象'], params: null };
    }
    for (const key in PARAM_DEFS) {
      const def = PARAM_DEFS[key];
      const val = raw[key];
      if (val === undefined) { params[key] = def.def; continue; }
      if (def.type === 'enum') {
        if (def.values.indexOf(val) === -1) {
          errors.push(`${def.label}(${key}) 必须是 ${def.values.join('/')} 之一，收到: ${JSON.stringify(val)}`);
          continue;
        }
        params[key] = val;
      } else {
        const num = typeof val === 'string' && val.trim() !== '' ? Number(val) : val;
        if (typeof num !== 'number' || !isFinite(num)) {
          errors.push(`${def.label}(${key}) 必须是数字，收到: ${JSON.stringify(val)}`);
          continue;
        }
        if (num < def.min || num > def.max) {
          errors.push(`${def.label}(${key}) 超出范围 [${def.min}, ${def.max}]，收到: ${num}`);
          continue;
        }
        params[key] = def.type === 'int' ? Math.round(num) : num;
      }
    }
    if (errors.length) return { ok: false, errors, params: null };
    if (params.th1 >= params.th2) {
      errors.push(`阈值必须满足 th1 < th2，当前 th1=${params.th1}, th2=${params.th2}`);
      return { ok: false, errors, params: null };
    }
    return { ok: true, errors: [], params };
  }

  function validateView(raw) {
    const errors = [];
    const view = {};
    if (raw === null || typeof raw !== 'object') {
      return { ok: false, errors: ['视角必须是对象'], view: null };
    }
    for (const key in VIEW_DEFS) {
      const def = VIEW_DEFS[key];
      const val = raw[key] === undefined ? def.def : raw[key];
      if (typeof val !== 'number' || !isFinite(val) || val < def.min || val > def.max) {
        errors.push(`视角 ${key} 超出范围 [${def.min}, ${def.max}]，收到: ${JSON.stringify(raw[key])}`);
        continue;
      }
      view[key] = val;
    }
    return errors.length ? { ok: false, errors, view: null } : { ok: true, errors: [], view };
  }

  function validateLayers(raw) {
    const errors = [];
    if (!Array.isArray(raw) || raw.length !== LAYER_COUNT) {
      return { ok: false, errors: [`图层数组必须包含 ${LAYER_COUNT} 项`], layers: null };
    }
    const layers = raw.map((item, i) => {
      if (item === null || typeof item !== 'object') {
        errors.push(`图层 ${i} 必须是对象`);
        return null;
      }
      const opacity = item.opacity === undefined ? 1 : item.opacity;
      const hueShift = item.hueShift === undefined ? 0 : item.hueShift;
      if (typeof opacity !== 'number' || opacity < 0 || opacity > 1) {
        errors.push(`图层 ${i} opacity 需在 [0,1]，收到: ${JSON.stringify(item.opacity)}`);
      }
      if (typeof hueShift !== 'number' || hueShift < -360 || hueShift > 360) {
        errors.push(`图层 ${i} hueShift 需在 [-360,360]，收到: ${JSON.stringify(item.hueShift)}`);
      }
      return {
        id: i,
        name: typeof item.name === 'string' ? item.name : `层${i + 1}`,
        visible: item.visible !== false,
        opacity, hueShift,
      };
    });
    return errors.length ? { ok: false, errors, layers: null } : { ok: true, errors: [], layers };
  }

  /* ---------------- 确定性随机与场景生成 ---------------- */

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /*
   * 由参数确定性地生成图形列表。相同 params 必然得到相同结果，
   * 因此导出 JSON 只需保存 params 即可在重新载入后复原颜色与位置。
   */
  function generateScene(params, width, height) {
    const w = width || BASE_W;
    const h = height || BASE_H;
    const rand = mulberry32(params.seed);
    const shapes = [];
    const types = ['circle', 'ring', 'rect', 'wave'];
    const margin = 40;
    for (let i = 0; i < params.shapeCount; i++) {
      const type = types[Math.floor(rand() * types.length)];
      const hue = (params.hueBase + rand() * params.hueSpread) % 360;
      const sat = clamp(params.saturation + (rand() - 0.5) * 30, 0, 100);
      const light = clamp(params.brightness + (rand() - 0.5) * 40, 0, 100);
      const shape = {
        id: i,
        type,
        x: margin + rand() * (w - margin * 2),
        y: margin + rand() * (h - margin * 2),
        hue, sat, light,
        phase: rand() * Math.PI * 2,
      };
      if (type === 'circle' || type === 'ring') {
        shape.r = 12 + rand() * 48;
      } else if (type === 'rect') {
        shape.w = 20 + rand() * 90;
        shape.h = 20 + rand() * 90;
        shape.rot = (rand() - 0.5) * Math.PI / 3;
      } else { // wave
        shape.amp = (params.waveAmp / 100) * 60 * (0.4 + rand() * 0.6);
        shape.freq = params.waveFreq * (0.6 + rand() * 0.8);
        shape.thick = 3 + rand() * 9;
      }
      shapes.push(shape);
    }
    return shapes;
  }

  /* ---------------- 颜色空间转换 ---------------- */

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }

  /* ---------------- 像素分层 ---------------- */

  /*
   * 依据 splitMode 把单个像素分到 0/1/2 层：
   *  - brightness / saturation: 按 th1、th2 把 [0,1] 切成三段
   *  - hue: 把色相环切成三个 120° 扇区
   */
  function classifyPixel(h, s, l, mode, th1, th2) {
    let v;
    if (mode === 'hue') v = (h % 360) / 360;
    else if (mode === 'saturation') v = s;
    else v = l;
    if (v < th1) return 0;
    if (v < th2) return 1;
    return 2;
  }

  /*
   * 把 RGBA 像素数组拆成 LAYER_COUNT 层。每层保留原颜色与 alpha，
   * 不属于该层的像素 alpha 置 0。返回各层像素数组与计数。
   */
  function splitImage(data, mode, th1, th2) {
    const total = data.length / 4;
    const layers = [];
    const counts = [];
    for (let i = 0; i < LAYER_COUNT; i++) {
      layers.push(new Uint8ClampedArray(data.length));
      counts.push(0);
    }
    for (let p = 0; p < total; p++) {
      const o = p * 4;
      const a = data[o + 3];
      if (a === 0) continue;
      const hsl = rgbToHsl(data[o], data[o + 1], data[o + 2]);
      const idx = classifyPixel(hsl[0], hsl[1], hsl[2], mode, th1, th2);
      const dst = layers[idx];
      dst[o] = data[o]; dst[o + 1] = data[o + 1];
      dst[o + 2] = data[o + 2]; dst[o + 3] = a;
      counts[idx]++;
    }
    return { layers, counts, total };
  }

  /* ---------------- 状态导出 / 导入 ---------------- */

  function exportState(params, layers, view, counts, total) {
    return {
      version: VERSION,
      savedAt: new Date().toISOString(),
      params: Object.assign({}, params),
      layers: layers.map(l => ({
        id: l.id, name: l.name, visible: l.visible,
        opacity: l.opacity, hueShift: l.hueShift,
      })),
      view: Object.assign({}, view),
      stats: {
        layerOrder: layers.map(l => l.id),
        pixelCounts: counts ? counts.slice() : null,
        totalPixels: total || null,
      },
    };
  }

  /*
   * 解析导入的 JSON（字符串或对象）。任何字段非法都返回错误原因，
   * 调用方应保留上一次可用画面，不得清空画布。
   */
  function importState(raw) {
    let obj = raw;
    if (typeof raw === 'string') {
      try { obj = JSON.parse(raw); }
      catch (e) { return { ok: false, errors: ['JSON 解析失败: ' + e.message] }; }
    }
    if (obj === null || typeof obj !== 'object') {
      return { ok: false, errors: ['导入内容必须是 JSON 对象'] };
    }
    if (obj.version !== VERSION) {
      return { ok: false, errors: [`不支持的版本: ${JSON.stringify(obj.version)}，需要 ${VERSION}`] };
    }
    const pv = validateParams(obj.params || {});
    if (!pv.ok) return { ok: false, errors: pv.errors };
    const lv = validateLayers(obj.layers);
    if (!lv.ok) return { ok: false, errors: lv.errors };
    const vv = validateView(obj.view || {});
    if (!vv.ok) return { ok: false, errors: vv.errors };
    return { ok: true, errors: [], params: pv.params, layers: lv.layers, view: vv.view };
  }

  /* ---------------- 预设 ---------------- */

  function presetDefault() {
    return { params: defaultParams(), layers: defaultLayers(), view: defaultView() };
  }

  function presetExtreme() {
    const params = defaultParams();
    Object.assign(params, {
      seed: 7, shapeCount: 200, hueBase: 0, hueSpread: 360,
      saturation: 100, brightness: 95, waveAmp: 100, waveFreq: 20,
      bgLight: 2, animSpeed: 5, splitMode: 'hue', th1: 0.05, th2: 0.95,
    });
    return { params, layers: defaultLayers(), view: defaultView() };
  }

  return {
    VERSION, LAYER_COUNT, BASE_W, BASE_H,
    PARAM_DEFS, VIEW_DEFS,
    defaultParams, defaultLayers, defaultView,
    validateParams, validateView, validateLayers,
    mulberry32, generateScene,
    rgbToHsl, classifyPixel, splitImage,
    exportState, importState,
    presetDefault, presetExtreme,
  };
});
