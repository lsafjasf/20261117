/* params.js — 共享纯逻辑：参数定义、校验、场景几何、图层顺序、序列化。
 * 同时被浏览器 (app.js) 与 Node 测试 (test.js) 使用，禁止依赖 DOM/WebGL。 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GlassParams = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 每个参数的取值范围与默认值（边界测试以此为准）
  const PARAM_DEFS = {
    camAzimuth:    { min: -180, max: 180, def: 35,   label: '视点方位角(°)' },
    camElevation:  { min: -80,  max: 80,  def: 18,   label: '视点俯仰角(°)' },
    camDistance:   { min: 3,    max: 15,  def: 7.5,  label: '视点距离' },
    lightAzimuth:  { min: -180, max: 180, def: 55,   label: '光源方位角(°)' },
    lightElevation:{ min: 5,    max: 85,  def: 50,   label: '光源高度角(°)' },
    lightDistance: { min: 3,    max: 20,  def: 9,    label: '光源距离' },
    ior:           { min: 1.0,  max: 2.5, def: 1.5,  label: '折射率 IOR' },
    absorb:        { min: 0,    max: 1,   def: 0.45, label: '玻璃吸收强度' },
    zSphere:       { min: -2,   max: 2,   def: 0.0,  label: '球体图层深度' },
    zBox:          { min: -2,   max: 2,   def: 0.55, label: '方块图层深度' },
    zTorus:        { min: -2,   max: 2,   def: -0.4, label: '圆环图层深度' },
    hueSphere:     { min: 0,    max: 360, def: 205,  label: '球体色相(°)' },
    hueBox:        { min: 0,    max: 360, def: 125,  label: '方块色相(°)' },
    hueTorus:      { min: 0,    max: 360, def: 325,  label: '圆环色相(°)' },
  };

  const PARAM_KEYS = Object.keys(PARAM_DEFS);

  // 三块玻璃的基础摆放（不同形状、不同位置，z 参数叠加图层偏移）
  const SHAPES = [
    { id: 0, key: 'Sphere', name: '球体',   base: [-1.55, 0.25, 0.0],  zKey: 'zSphere', hueKey: 'hueSphere' },
    { id: 1, key: 'Box',    name: '方块',   base: [0.15, -0.15, 0.55], zKey: 'zBox',    hueKey: 'hueBox' },
    { id: 2, key: 'Torus',  name: '圆环',   base: [1.55, 0.05, -0.35], zKey: 'zTorus',  hueKey: 'hueTorus' },
  ];

  const STORAGE_KEY = 'glass-stack-state-v1';

  function defaultParams() {
    const p = {};
    for (const k of PARAM_KEYS) p[k] = PARAM_DEFS[k].def;
    return p;
  }

  // 极端画面预设：贴边/极限取值，用于检查缩放、遮挡与边界稳定性
  const PRESETS = {
    default: defaultParams(),
    extreme: {
      camAzimuth: 165, camElevation: 72, camDistance: 3.2,
      lightAzimuth: -170, lightElevation: 8, lightDistance: 18,
      ior: 2.4, absorb: 0.95,
      zSphere: 2, zBox: -2, zTorus: 1.6,
      hueSphere: 0, hueBox: 240, hueTorus: 60,
    },
  };

  function presetParams(name) {
    const src = PRESETS[name];
    if (!src) return null;
    return Object.assign(defaultParams(), src);
  }

  function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
  }

  /* 校验参数：返回 { ok, errors[] }，每个错误都带可读原因。
   * 调用方在校验失败时必须保留上一次可用画面。 */
  function validateParams(p) {
    const errors = [];
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      return { ok: false, errors: ['参数必须是对象，收到: ' + typeof p] };
    }
    for (const k of PARAM_KEYS) {
      const def = PARAM_DEFS[k];
      const v = p[k];
      if (v === undefined || v === null) {
        errors.push(`缺少参数 ${k}（${def.label}）`);
        continue;
      }
      if (!isFiniteNumber(v)) {
        errors.push(`参数 ${k}（${def.label}）必须是有限数字，收到: ${JSON.stringify(v)}`);
        continue;
      }
      if (v < def.min || v > def.max) {
        errors.push(`参数 ${k}（${def.label}）=${v} 超出范围 [${def.min}, ${def.max}]`);
      }
    }
    return { ok: errors.length === 0, errors };
  }

  /* 尝试应用候选参数：合法则返回 { ok:true, params }，
   * 非法则返回 { ok:false, errors, params: prev }，保证界面保留上一次可用状态。 */
  function applyCandidate(prev, candidate) {
    const r = validateParams(candidate);
    if (r.ok) return { ok: true, errors: [], params: Object.assign({}, candidate) };
    return { ok: false, errors: r.errors, params: prev };
  }

  function hsl2rgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = (t) => {
      t = ((t % 1) + 1) % 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
  }

  function deg2rad(d) { return d * Math.PI / 180; }

  function spherical(azimuthDeg, elevationDeg, distance) {
    const az = deg2rad(azimuthDeg), el = deg2rad(elevationDeg);
    return [
      distance * Math.cos(el) * Math.sin(az),
      distance * Math.sin(el),
      distance * Math.cos(el) * Math.cos(az),
    ];
  }

  /* 由参数计算场景几何：相机、光源、各形状位置/颜色、图层顺序（近→远）。 */
  function computeScene(p) {
    const camPos = spherical(p.camAzimuth, p.camElevation, p.camDistance);
    const target = [0, 0, 0];
    const viewDir = normalize3(sub3(target, camPos));
    const lightPos = spherical(p.lightAzimuth, p.lightElevation, p.lightDistance);
    const shapes = SHAPES.map((s) => {
      const pos = [s.base[0], s.base[1], s.base[2] + p[s.zKey]];
      const color = hsl2rgb(p[s.hueKey], 0.75, 0.55);
      const depth = dot3(sub3(pos, camPos), viewDir);
      return { id: s.id, key: s.key, name: s.name, pos, color, depth };
    });
    const layerOrder = shapes.slice().sort((a, b) => a.depth - b.depth).map((s) => s.key);
    return {
      camera: { pos: camPos, target, viewDir },
      light: { pos: lightPos },
      shapes,
      layerOrder,
    };
  }

  function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function normalize3(a) {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  }

  function serialize(p) { return JSON.stringify({ version: 1, params: p }); }

  /* 反序列化并校验：任何一步失败都返回 { ok:false, errors }，绝不抛出。 */
  function deserialize(json) {
    if (typeof json !== 'string' || json.length === 0) {
      return { ok: false, errors: ['存档为空或不是字符串'] };
    }
    let data;
    try { data = JSON.parse(json); } catch (e) {
      return { ok: false, errors: ['存档 JSON 解析失败: ' + e.message] };
    }
    if (!data || data.version !== 1 || !data.params) {
      return { ok: false, errors: ['存档版本或结构不受支持'] };
    }
    const r = validateParams(data.params);
    if (!r.ok) return { ok: false, errors: r.errors.map((e) => '存档校验失败: ' + e) };
    return { ok: true, errors: [], params: Object.assign({}, data.params) };
  }

  return {
    PARAM_DEFS, PARAM_KEYS, SHAPES, STORAGE_KEY,
    defaultParams, presetParams, validateParams, applyCandidate,
    computeScene, hsl2rgb, serialize, deserialize,
  };
});
