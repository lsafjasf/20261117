// scene.js — pure geometry & state module (no DOM). Shared by browser app,
// Node tests and the export tool.

export const WORLD = { width: 1000, height: 700 };

export const RANGES = {
  'sun.azimuth': { min: -85, max: 85, label: 'sun.azimuth' },
  'sun.elevation': { min: 5, max: 80, label: 'sun.elevation' },
  'shadows.softness': { min: 0, max: 1, label: 'shadows.softness' },
  'shadows.strength': { min: 0, max: 1, label: 'shadows.strength' },
  'shadows.length': { min: 0.2, max: 2.5, label: 'shadows.length' },
  'view.zoom': { min: 0.65, max: 2.6, label: 'view.zoom' },
  'view.panX': { min: -200, max: 200, label: 'view.panX' },
  'view.panY': { min: -120, max: 120, label: 'view.panY' },
};

export const DEFAULT_STATE = {
  version: 1,
  sun: { azimuth: -34, elevation: 31 },
  shadows: { softness: 0.62, strength: 0.58, length: 1 },
  view: { zoom: 1, panX: 0, panY: 0, preset: 'wide' },
  layers: {
    sky: true, sun: true, ridges: true, ridgeShadows: true,
    objectShadows: true, terrainDetails: true, labels: true, annotations: true,
  },
  paused: true,
  seed: 24017,
};

export const EXTREME_STATE = {
  ...DEFAULT_STATE,
  sun: { azimuth: 64, elevation: 9 },
  shadows: { softness: 0.9, strength: 0.82, length: 1.8 },
  view: { zoom: 1.06, panX: 36, panY: 14, preset: 'manual' },
};

export const LAYER_ORDER = [
  'sky', 'sun', 'ridges', 'ridgeShadows',
  'objectShadows', 'terrainDetails', 'labels', 'annotations',
];

export function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function getPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

// validateState returns { ok, errors[] }; every error names the field,
// the allowed range and the offending value.
export function validateState(state) {
  const errors = [];
  if (!state || typeof state !== 'object') {
    return { ok: false, errors: ['状态不是对象'] };
  }
  for (const [path, range] of Object.entries(RANGES)) {
    const value = getPath(state, path);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`${range.label} 不是有效数字（当前 ${String(value)}）`);
    } else if (value < range.min || value > range.max) {
      errors.push(`${range.label} 超出范围 ${range.min}–${range.max}（当前 ${value}）`);
    }
  }
  if (!Number.isInteger(state.seed) || state.seed < 1 || state.seed > 99999) {
    errors.push(`seed 必须是 1–99999 的整数（当前 ${String(state.seed)}）`);
  }
  if (!state.layers || typeof state.layers !== 'object') {
    errors.push('layers 缺失或不是对象');
  }
  return { ok: errors.length === 0, errors };
}

// Deterministic PRNG so a seed always reproduces the same scene.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RIDGE_COUNT = 5;
const NODES_PER_RIDGE = 201; // 5 * 201 = 1005 ridge nodes

function ridgeProfile(rand, index) {
  const baseY = 170 + index * 108;
  const amp = 34 + index * 12;
  const f1 = 0.006 + rand() * 0.004;
  const f2 = 0.017 + rand() * 0.009;
  const p1 = rand() * Math.PI * 2;
  const p2 = rand() * Math.PI * 2;
  const nodes = [];
  for (let i = 0; i < NODES_PER_RIDGE; i += 1) {
    const x = -50 + (1100 * i) / (NODES_PER_RIDGE - 1);
    const y = baseY
      - amp * Math.sin(x * f1 + p1)
      - amp * 0.45 * Math.sin(x * f2 + p2)
      - amp * 0.2 * Math.sin(x * f2 * 2.7 + p1 * 1.7);
    nodes.push({ x, y });
  }
  return nodes;
}

// generateScene builds the full deterministic object graph for a seed.
export function generateScene(seed) {
  const rand = mulberry32(seed);
  const ridges = [];
  for (let i = 0; i < RIDGE_COUNT; i += 1) {
    ridges.push({ index: i, nodes: ridgeProfile(rand, i) });
  }
  const front = ridges[RIDGE_COUNT - 1];
  const sampleFront = (t) => {
    const idx = Math.max(0, Math.min(NODES_PER_RIDGE - 1, Math.round(t * (NODES_PER_RIDGE - 1))));
    return front.nodes[idx];
  };
  const trees = [];
  for (let i = 0; i < 9; i += 1) {
    const t = 0.08 + 0.84 * rand();
    const p = sampleFront(t);
    trees.push({
      id: `tree-${i}`, x: p.x, y: p.y,
      height: 26 + rand() * 30, width: 12 + rand() * 10,
    });
  }
  const rocks = [];
  for (let i = 0; i < 3; i += 1) {
    const t = 0.12 + 0.76 * rand();
    const p = sampleFront(t);
    rocks.push({
      id: `rock-${i}`, x: p.x, y: p.y,
      height: 8 + rand() * 8, width: 16 + rand() * 12,
    });
  }
  const labels = [
    { id: 'label-0', text: '北脊 1842m', ridge: 1, t: 0.3 },
    { id: 'label-1', text: '观景台', ridge: 3, t: 0.62 },
    { id: 'label-2', text: '主峰 2316m', ridge: 2, t: 0.45 },
    { id: 'label-3', text: '营地', ridge: 4, t: 0.78 },
  ].map((spec) => {
    const ridge = ridges[spec.ridge];
    const idx = Math.round(spec.t * (NODES_PER_RIDGE - 1));
    const p = ridge.nodes[idx];
    return { id: spec.id, text: spec.text, x: p.x, y: p.y - 14 };
  });
  return { seed, ridges, trees, rocks, labels };
}

export function sceneCounts(scene) {
  return {
    ridges: scene.ridges.length,
    ridgeNodes: scene.ridges.reduce((n, r) => n + r.nodes.length, 0),
    trees: scene.trees.length,
    rocks: scene.rocks.length,
    labels: scene.labels.length,
    total: scene.ridges.length + scene.trees.length
      + scene.rocks.length + scene.labels.length,
  };
}

// Stable hash of every object position; used to prove reload consistency.
export function positionHash(scene) {
  let h = 0;
  const mix = (n) => {
    h = (Math.imul(h, 31) + Math.round(n * 1000)) | 0;
  };
  for (const ridge of scene.ridges) for (const p of ridge.nodes) { mix(p.x); mix(p.y); }
  for (const t of scene.trees) { mix(t.x); mix(t.y); }
  for (const r of scene.rocks) { mix(r.x); mix(r.y); }
  for (const l of scene.labels) { mix(l.x); mix(l.y); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const DEG = Math.PI / 180;

// Sun geometry. Azimuth 0 = sun due south (shadows fall straight down-screen),
// negative azimuth = sun to the west (shadows fall right), elevation in degrees.
// Returns the 2D shadow-cast direction (unit-ish) and length per unit height.
export function shadowVector(sun, lengthScale = 1) {
  const az = sun.azimuth * DEG;
  const el = sun.elevation * DEG;
  const run = 1 / Math.tan(el); // ground run per unit height
  return {
    dx: Math.sin(az) * run * lengthScale,
    dy: Math.cos(az) * run * lengthScale * 0.42, // screen foreshortening
    run: run * lengthScale,
  };
}

export function sunScreenPosition(sun) {
  const az = sun.azimuth * DEG;
  const el = sun.elevation * DEG;
  return {
    x: WORLD.width / 2 - Math.sin(az) * WORLD.width * 0.42,
    y: 40 + (1 - Math.sin(el)) * 180,
  };
}

// Height of ridge silhouette at x via linear interpolation of its nodes.
export function ridgeHeightAt(ridge, x) {
  const nodes = ridge.nodes;
  if (x <= nodes[0].x) return nodes[0].y;
  if (x >= nodes[nodes.length - 1].x) return nodes[nodes.length - 1].y;
  let lo = 0;
  let hi = nodes.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (nodes[mid].x <= x) lo = mid; else hi = mid;
  }
  const a = nodes[lo];
  const b = nodes[hi];
  const t = (x - a.x) / (b.x - a.x);
  return a.y + (b.y - a.y) * t;
}

// Ridge-cast shadow: ridges sit at increasing depth (index = depth layer).
// From each receiver node on ridge j we trace the sun ray backwards across
// each caster depth plane i < j: the ray travels (j-i) depth steps, gaining
// height with elevation and shifting sideways with azimuth. If the caster
// crest at that x rises above the ray, the node is shadowed. The margin
// between ray and crest drives a penumbra whose width grows with softness.
const DEPTH_STEP = 150; // screen-px depth between adjacent ridge layers

export function computeRidgeShadows(scene, state) {
  const { shadows, sun } = state;
  const el = sun.elevation * DEG;
  const az = sun.azimuth * DEG;
  const shiftX = Math.tan(az) * DEPTH_STEP; // sideways ray travel per layer
  const riseY = Math.tan(el) * DEPTH_STEP * 0.9; // height gain per layer
  const result = [];
  for (let j = 1; j < scene.ridges.length; j += 1) {
    const receiver = scene.ridges[j];
    const segments = [];
    for (const node of receiver.nodes) {
      let occluded = 0; // 0 lit, 1 fully shadowed
      for (let i = 0; i < j; i += 1) {
        const gaps = j - i;
        const rayX = node.x - shiftX * gaps;
        const rayY = node.y - riseY * gaps;
        const crestY = ridgeHeightAt(scene.ridges[i], rayX);
        if (crestY < rayY) { // caster crest (smaller y = higher) blocks the sun
          const depth = Math.min(1, (rayY - crestY) / (16 + shadows.softness * 52));
          const attenuation = 1 - 0.14 * (gaps - 1); // haze softens far casters
          occluded = Math.max(occluded, (0.25 + 0.75 * depth) * attenuation);
        }
      }
      segments.push({ x: node.x, y: node.y, shade: occluded });
    }
    result.push({ ridgeIndex: j, segments });
  }
  return result;
}

// Object drop shadows: each tree/rock casts a projected quad along the
// shadow vector, clipped later to the receiver ridge at render time.
export function computeObjectShadows(scene, state) {
  const vec = shadowVector(state.sun, state.shadows.length);
  const cast = (obj) => {
    const tipX = obj.x + vec.dx * obj.height;
    const tipY = obj.y + vec.dy * obj.height;
    return {
      id: `${obj.id}-shadow`,
      baseX: obj.x, baseY: obj.y,
      tipX, tipY,
      halfWidth: obj.width * 0.5,
      length: Math.hypot(tipX - obj.x, tipY - obj.y),
    };
  };
  return {
    vector: vec,
    trees: scene.trees.map(cast),
    rocks: scene.rocks.map(cast),
  };
}
