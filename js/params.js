// Parameter schema, validation, presets and state (de)serialization.
// Pure JS, shared by the browser app and the Node test suite.

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SaltParams = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const STATE_VERSION = 1;
  const STORAGE_KEY = "rocksalt.state.v1";

  // name -> [min, max, integer?]
  const RANGES = {
    seed: [0, 99999999, true],
    crystalScale: [2, 48, true],   // Voronoi cells across the tile
    porosity: [0, 1, false],       // pore coverage
    wetness: [0, 1, false],        // specular + edge gloss amount
    grain: [0, 1, false],          // fine surface noise amount
    relief: [0, 1, false],         // crystal height contrast
    brushSize: [4, 128, false],    // brush radius in tile px (at render res)
    brushStrength: [0.05, 1, false],
  };

  const DEFAULTS = {
    seed: 20261117,
    crystalScale: 12,
    porosity: 0.35,
    wetness: 0.45,
    grain: 0.5,
    relief: 0.6,
    brushSize: 28,
    brushStrength: 0.5,
  };

  const PRESETS = {
    default: { ...DEFAULTS },
    extreme: {
      seed: 777,
      crystalScale: 40,
      porosity: 0.9,
      wetness: 1,
      grain: 1,
      relief: 1,
      brushSize: 20,
      brushStrength: 0.8,
    },
  };

  const LAYER_ORDER = ["base", "relief", "pores", "wet"];
  const DEFAULT_LAYERS = { base: true, relief: true, pores: true, wet: true };
  const DEFAULT_VIEW = { zoom: 1, cx: 0.5, cy: 0.5 };
  const BRUSH_MODES = ["wet", "pit", "heal"];

  function isFiniteNumber(n) {
    return typeof n === "number" && Number.isFinite(n);
  }

  // Strict validation: returns { ok, errors, value }.
  // `value` is only meaningful when ok === true (clamped copy of input).
  function validateParams(input) {
    const errors = [];
    const value = {};
    if (input == null || typeof input !== "object") {
      return { ok: false, errors: ["参数必须是对象"], value: null };
    }
    for (const [name, [min, max, isInt]] of Object.entries(RANGES)) {
      const raw = input[name];
      if (!isFiniteNumber(raw)) {
        errors.push(`参数 ${name} 缺失或不是有限数字（收到 ${String(raw)}）`);
        continue;
      }
      if (raw < min || raw > max) {
        errors.push(`参数 ${name}=${raw} 超出范围 [${min}, ${max}]`);
        continue;
      }
      value[name] = isInt ? Math.round(raw) : raw;
    }
    return { ok: errors.length === 0, errors, value: errors.length ? null : value };
  }

  function validateView(view) {
    const v = { ...DEFAULT_VIEW };
    if (view && typeof view === "object") {
      if (isFiniteNumber(view.zoom) && view.zoom >= 0.25 && view.zoom <= 16) v.zoom = view.zoom;
      if (isFiniteNumber(view.cx)) v.cx = view.cx;
      if (isFiniteNumber(view.cy)) v.cy = view.cy;
    }
    return v;
  }

  function validateLayers(layers) {
    const out = { ...DEFAULT_LAYERS };
    if (layers && typeof layers === "object") {
      for (const k of LAYER_ORDER) {
        if (typeof layers[k] === "boolean") out[k] = layers[k];
      }
    }
    return out;
  }

  function validateDabs(dabs) {
    if (!Array.isArray(dabs)) return [];
    const out = [];
    for (const d of dabs) {
      if (!d || typeof d !== "object") continue;
      if (!isFiniteNumber(d.u) || !isFiniteNumber(d.v)) continue;
      if (!isFiniteNumber(d.r) || d.r <= 0 || d.r > 0.5) continue;
      if (!isFiniteNumber(d.s) || d.s <= 0 || d.s > 1) continue;
      if (!BRUSH_MODES.includes(d.mode)) continue;
      out.push({
        u: d.u - Math.floor(d.u),
        v: d.v - Math.floor(d.v),
        r: d.r, s: d.s, mode: d.mode,
      });
      if (out.length >= 5000) break; // cap to keep state bounded
    }
    return out;
  }

  function makeState(params, view, layers, dabs, extra) {
    return {
      version: STATE_VERSION,
      params: { ...params },
      view: validateView(view),
      layers: validateLayers(layers),
      dabs: validateDabs(dabs),
      paused: !!(extra && extra.paused),
      animate: !!(extra && extra.animate),
    };
  }

  function serializeState(state) {
    return JSON.stringify(state);
  }

  // Returns a sanitized state, or null when the payload is unusable.
  function deserializeState(json) {
    let raw;
    try { raw = JSON.parse(json); } catch { return null; }
    if (!raw || typeof raw !== "object" || raw.version !== STATE_VERSION) return null;
    const check = validateParams(raw.params);
    if (!check.ok) return null;
    return makeState(check.value, raw.view, raw.layers, raw.dabs, raw);
  }

  return {
    STATE_VERSION, STORAGE_KEY, RANGES, DEFAULTS, PRESETS,
    LAYER_ORDER, DEFAULT_LAYERS, DEFAULT_VIEW, BRUSH_MODES,
    validateParams, validateView, validateLayers, validateDabs,
    makeState, serializeState, deserializeState,
  };
});
