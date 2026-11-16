/* Repair parameter schema, defaults and persistence. */
(function (root) {
  const STORAGE_KEY = 'tape-repair-params-v1';
  const DURATION_SEC = 10;

  const DEFAULTS = {
    speed: 1.0,
    wowDepth: 0.012,
    clickLevel: 0.55,
    noiseLevel: 0.12,
    deessFreq: 7000,
    deessGain: -8,
    notchFreq: 3300,
    notchQ: 12,
    gateThreshold: -50,
    gateEnabled: true,
    outputGain: 0.7,
    mode: 'main',
  };

  const SCHEMA = {
    speed: { min: 0.5, max: 2.0, step: 0.01 },
    wowDepth: { min: 0, max: 0.05, step: 0.001 },
    clickLevel: { min: 0, max: 1, step: 0.01 },
    noiseLevel: { min: 0, max: 0.5, step: 0.01 },
    deessFreq: { min: 4000, max: 12000, step: 50 },
    deessGain: { min: -24, max: 0, step: 0.5 },
    notchFreq: { min: 500, max: 8000, step: 10 },
    notchQ: { min: 2, max: 30, step: 0.5 },
    gateThreshold: { min: -90, max: -20, step: 1 },
    outputGain: { min: 0, max: 1.5, step: 0.01 },
  };

  function sanitize(raw) {
    const out = Object.assign({}, DEFAULTS);
    if (!raw || typeof raw !== 'object') return out;
    for (const key of Object.keys(SCHEMA)) {
      const spec = SCHEMA[key];
      let v = raw[key];
      if (typeof v !== 'number' || !isFinite(v)) continue;
      v = Math.min(spec.max, Math.max(spec.min, v));
      const inv = 1 / spec.step;
      out[key] = Math.round(v * inv) / inv;
    }
    if (typeof raw.gateEnabled === 'boolean') out.gateEnabled = raw.gateEnabled;
    if (raw.mode === 'main' || raw.mode === 'bypass' || raw.mode === 'mute') {
      out.mode = raw.mode;
    }
    return out;
  }

  function save(params) {
    const clean = sanitize(params);
    clean.savedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    return clean;
  }

  function load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return { params: sanitize(parsed), savedAt: parsed.savedAt || null };
    } catch (err) {
      return null;
    }
  }

  function clear() {
    localStorage.removeItem(STORAGE_KEY);
  }

  const api = { STORAGE_KEY, DURATION_SEC, DEFAULTS, SCHEMA, sanitize, save, load, clear };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.TapeParams = api;
  }
})(typeof self !== 'undefined' ? self : globalThis);
